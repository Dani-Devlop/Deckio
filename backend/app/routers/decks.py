"""Deck CRUD endpoints with aggregated list statistics.

The list endpoint computes card counts / review counts / accuracy for every
deck in **three aggregate queries** (not N+1 per-deck queries) so the
dashboard stays fast as the library grows.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user, get_owned_deck
from ..models import Card, CardReview, Deck, StudySession, User
from ..schemas import DeckCreate, DeckOut, DeckUpdate

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
    )


async def _collect_stats(user: User, db: AsyncSession, deck_ids: set[int]) -> dict[int, dict]:
    """Aggregate card counts, review counts, accuracy and last-studied per deck."""
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
        stats[deck_id]["card_count"] = count

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
        stats[deck_id]["reviews"] = total
        stats[deck_id]["correct"] = int(correct or 0)

    # 3) Most recent study session per deck.
    last_rows = await db.execute(
        select(StudySession.deck_id, func.max(StudySession.started_at))
        .where(StudySession.user_id == user.id)
        .group_by(StudySession.deck_id)
    )
    for deck_id, last in last_rows.all():
        stats[deck_id]["last_studied_at"] = last

    return stats


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
