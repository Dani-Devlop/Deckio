"""Deck CRUD endpoints with aggregated list statistics.

The list endpoint computes card counts / review counts / accuracy for every
deck in **three aggregate queries** (not N+1 per-deck queries) so the
dashboard stays fast as the library grows.
"""

import re

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user, get_owned_deck
from ..models import Card, CardReview, Deck, StudySession, User, utcnow
from ..schemas import (
    BundleCardIn,
    DeckBundleIn,
    DeckBundleOut,
    DeckCreate,
    DeckOut,
    DeckUpdate,
    tags_to_storage,
)

router = APIRouter(prefix="/decks", tags=["Decks"])


def _to_deck_out(deck: Deck, stats: dict) -> DeckOut:
    """Serialize a Deck row plus its pre-computed stats into DeckOut."""
    reviews = stats.get("reviews", 0)
    correct = stats.get("correct", 0)
    return DeckOut(
        id=deck.id,
        title=deck.title,
        description=deck.description,
        color=deck.color,
        icon=deck.icon,
        created_at=deck.created_at,
        card_count=stats.get("card_count", 0),
        reviews_count=reviews,
        accuracy=round(correct / reviews * 100, 1) if reviews else None,
        last_studied_at=stats.get("last_studied_at"),
        due_count=stats.get("due", 0),
    )


async def _collect_stats(user: User, db: AsyncSession, deck_ids: set[int]) -> dict[int, dict]:
    """Aggregate card counts, review counts, accuracy and last-studied per deck.

    Aggregates are user-scoped (one grouped query each), so rows may arrive for
    decks outside the requested `deck_ids` — `setdefault` tolerates that and
    callers simply ignore the extra entries.
    """
    stats: dict[int, dict] = {deck_id: {} for deck_id in deck_ids}
    if not deck_ids:
        return stats

    # 1) Card counts per deck (scoped to this user's decks).
    card_rows = await db.execute(
        select(Card.deck_id, func.count(Card.id))
        .join(Deck, Deck.id == Card.deck_id)
        .where(Deck.user_id == user.id)
        .group_by(Card.deck_id)
    )
    for deck_id, count in card_rows.all():
        stats.setdefault(deck_id, {})["card_count"] = count

    # 2) Review counts + correct answers per deck (reviews → sessions → decks).
    review_rows = await db.execute(
        select(
            StudySession.deck_id,
            func.count(CardReview.id),
            func.sum(case((CardReview.result == "correct", 1), else_=0)),
        )
        .join(CardReview, CardReview.session_id == StudySession.id)
        .where(StudySession.user_id == user.id)
        .group_by(StudySession.deck_id)
    )
    for deck_id, total, correct in review_rows.all():
        stats.setdefault(deck_id, {})["reviews"] = total
        stats[deck_id]["correct"] = int(correct or 0)

    # 3) Most recent study session per deck.
    last_rows = await db.execute(
        select(StudySession.deck_id, func.max(StudySession.started_at))
        .where(StudySession.user_id == user.id)
        .group_by(StudySession.deck_id)
    )
    for deck_id, last in last_rows.all():
        stats.setdefault(deck_id, {})["last_studied_at"] = last

    # 4) Cards due right now per deck (SM-2: new cards or overdue).
    now = utcnow()
    due_rows = await db.execute(
        select(Card.deck_id, func.count())
        .join(Deck, Deck.id == Card.deck_id)
        .where(Deck.user_id == user.id, or_(Card.due_at.is_(None), Card.due_at <= now))
        .group_by(Card.deck_id)
    )
    for deck_id, due in due_rows.all():
        stats.setdefault(deck_id, {})["due"] = due

    return stats


@router.post(
    "/{deck_id}/duplicate",
    response_model=DeckOut,
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate a deck (cards copied, SRS progress reset)",
)
async def duplicate_deck(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeckOut:
    """Copy the deck together with all of its cards.

    Copies start as *new* cards (SRS state zeroed, `due_at = NULL` → due
    immediately) so the duplicate can be studied right away — review history
    intentionally does NOT carry over. The copy is named `"<title> (copy)"`.
    """
    cards = (
        await db.scalars(select(Card).where(Card.deck_id == deck.id))
    ).all()

    copy = Deck(
        user_id=user.id,
        title=f"{deck.title} (copy)"[:120],  # respect the column limit
        description=deck.description,
        color=deck.color,
        icon=deck.icon,
    )
    db.add(copy)
    await db.flush()  # assign copy.id before inserting child cards

    # New cards keep front/back/tags — SRS fields use their model defaults.
    db.add_all(
        [Card(deck_id=copy.id, front=c.front, back=c.back, tags=c.tags) for c in cards]
    )
    await db.commit()
    await db.refresh(copy)

    # Copied cards are brand-new → all due immediately; compute the real
    # due stat so the dashboard's "N due" badge is correct on first paint.
    due = await db.scalar(
        select(func.count())
        .select_from(Card)
        .where(Card.deck_id == copy.id, or_(Card.due_at.is_(None), Card.due_at <= utcnow()))
    )
    return _to_deck_out(copy, {"card_count": len(cards), "due": int(due or 0)})


@router.get("", response_model=list[DeckOut], summary="List the authenticated user's decks")
async def list_decks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeckOut]:
    """Return all decks owned by the current user, newest first, with stats."""
    decks = (
        (
            await db.scalars(
                select(Deck).where(Deck.user_id == user.id).order_by(Deck.created_at.desc())
            )
        ).all()
    )
    stats = await _collect_stats(user, db, {d.id for d in decks})
    return [_to_deck_out(d, stats.get(d.id, {})) for d in decks]


@router.post("", response_model=DeckOut, status_code=status.HTTP_201_CREATED, summary="Create a deck")
async def create_deck(
    payload: DeckCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeckOut:
    deck = Deck(user_id=user.id, **payload.model_dump())
    db.add(deck)
    await db.commit()
    await db.refresh(deck)
    return _to_deck_out(deck, {"card_count": 0})


@router.get("/{deck_id}", response_model=DeckOut, summary="Get a single deck (with stats)")
async def get_deck(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeckOut:
    stats = await _collect_stats(user, db, {deck.id})
    return _to_deck_out(deck, stats[deck.id])


@router.put("/{deck_id}", response_model=DeckOut, summary="Update a deck (partial allowed)")
async def update_deck(
    payload: DeckUpdate,
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeckOut:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(deck, field, value)
    await db.commit()
    await db.refresh(deck)

    stats = await _collect_stats(user, db, {deck.id})
    return _to_deck_out(deck, stats[deck.id])


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a deck")
async def delete_deck(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Deletes the deck; its cards, sessions and reviews cascade (DB level)."""
    await db.delete(deck)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------- Deck bundle (share) -------------------------


def _bundle_filename(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9-_]+", "-", title).strip("-").lower() or "deck"
    return f"{slug}-deckio.json"


@router.get(
    "/{deck_id}/bundle",
    response_model=DeckBundleOut,
    summary="Export a deck as a portable JSON bundle (cards + tags, no SRS history)",
)
async def export_deck_bundle(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Share-friendly snapshot of a deck. Re-import it with `POST /decks/import`
    (on any account) to get a fresh copy with SRS progress reset."""
    cards = (
        await db.scalars(select(Card).where(Card.deck_id == deck.id).order_by(Card.created_at))
    ).all()
    bundle = DeckBundleOut(
        title=deck.title,
        description=deck.description,
        color=deck.color,
        icon=deck.icon,
        card_count=len(cards),
        cards=[
            BundleCardIn(
                front=c.front,
                back=c.back,
                tags=[t.strip() for t in (c.tags or "").split(",") if t.strip()],
            )
            for c in cards
        ],
    )
    return JSONResponse(
        content=bundle.model_dump(),
        headers={"Content-Disposition": f'attachment; filename="{_bundle_filename(deck.title)}"'},
    )


@router.post(
    "/import",
    response_model=DeckOut,
    status_code=status.HTTP_201_CREATED,
    summary="Import a deck from a JSON bundle (cards + tags, SRS reset)",
)
async def import_deck_bundle(
    payload: DeckBundleIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeckOut:
    """Create a new deck from an exported bundle. All cards are inserted as
    brand-new (SRS state zeroed → due immediately)."""
    deck = Deck(
        user_id=user.id,
        title=payload.title[:120],
        description=payload.description,
        color=payload.color,
        icon=payload.icon,
    )
    db.add(deck)
    await db.flush()

    db.add_all(
        [
            Card(deck_id=deck.id, front=c.front, back=c.back, tags=tags_to_storage(c.tags))
            for c in payload.cards
        ]
    )
    await db.commit()
    await db.refresh(deck)

    # All imported cards are new → due immediately; report the real due count.
    due = await db.scalar(
        select(func.count())
        .select_from(Card)
        .where(Card.deck_id == deck.id, or_(Card.due_at.is_(None), Card.due_at <= utcnow()))
    )
    return _to_deck_out(deck, {"card_count": len(payload.cards), "due": int(due or 0)})
