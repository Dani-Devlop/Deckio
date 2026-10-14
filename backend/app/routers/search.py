"""Global search across the user's decks and cards.

Powers the web client's ⌘K command palette: one lightweight request that
returns matching decks (with their dashboard stats) and matching cards.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import Card, Deck, User
from ..schemas import DeckOut, SearchCardHit, SearchResults
from .decks import _collect_stats, _to_deck_out

router = APIRouter(prefix="/search", tags=["Search"])


@router.get("", response_model=SearchResults, summary="Search the user's decks and cards")
async def search(
    q: str = Query(min_length=1, max_length=100, description="Text to look for"),
    limit: int = Query(default=8, ge=1, le=25, description="Max hits per section"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResults:
    needle = f"%{q.strip()}%"

    # ---- Matching decks (title / description) ----
    decks = (
        await db.scalars(
            select(Deck)
            .where(
                Deck.user_id == user.id,
                or_(Deck.title.ilike(needle), Deck.description.ilike(needle)),
            )
            .order_by(Deck.created_at.desc())
            .limit(limit)
        )
    ).all()
    stats = await _collect_stats(user, db, {d.id for d in decks})

    # ---- Matching cards (front / back / tags) inside the user's decks ----
    card_rows = (
        await db.execute(
            select(Card, Deck.title)
            .join(Deck, Deck.id == Card.deck_id)
            .where(
                Deck.user_id == user.id,
                or_(
                    Card.front.ilike(needle),
                    Card.back.ilike(needle),
                    Card.tags.ilike(needle),
                ),
            )
            .order_by(Deck.title, Card.created_at)
            .limit(limit)
        )
    ).all()

    return SearchResults(
        decks=[_to_deck_out(d, stats.get(d.id, {})) for d in decks],
        cards=[
            SearchCardHit(
                card_id=card.id,
                deck_id=card.deck_id,
                deck_title=title,
                front=card.front,
                back=card.back,
                tags=[t.strip() for t in (card.tags or "").split(",") if t.strip()],
            )
            for card, title in card_rows
        ],
    )
