"""Public (no-auth) deck preview served via share tokens.

`GET /public/decks/{token}` returns a read-only snapshot of a deck — title,
description, theme and cards — for anyone holding the token. Owner identity,
SRS scheduling state and review history are intentionally excluded.

Tokens are created/revoked by the owner through:
    POST   /decks/{id}/share   → create (or `?regenerate=true` to rotate)
    DELETE /decks/{id}/share   → revoke
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Card, Deck
from ..schemas import PublicCardOut, PublicDeckOut

router = APIRouter(prefix="/public", tags=["Public"])


@router.get(
    "/decks/{token}",
    response_model=PublicDeckOut,
    summary="Read-only deck preview by share token (no authentication)",
)
async def public_deck(token: str, db: AsyncSession = Depends(get_db)) -> PublicDeckOut:
    """Anyone with the link can preview the deck and flip through its cards.
    Unknown or revoked tokens → 404 (indistinguishable, no enumeration)."""
    deck = (
        await db.scalars(select(Deck).where(Deck.share_token == token))
    ).first()
    if deck is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This deck is private or the link has been revoked",
        )

    cards = (
        await db.scalars(
            select(Card).where(Card.deck_id == deck.id).order_by(Card.created_at, Card.id)
        )
    ).all()

    return PublicDeckOut(
        title=deck.title,
        description=deck.description,
        color=deck.color,
        icon=deck.icon,
        card_count=len(cards),
        cards=[
            PublicCardOut(
                front=c.front,
                back=c.back,
                tags=[t.strip() for t in (c.tags or "").split(",") if t.strip()],
                hint=c.hint,
            )
            for c in cards
        ],
    )
