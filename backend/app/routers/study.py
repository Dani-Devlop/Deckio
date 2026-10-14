"""Study mode: self-paced flashcard sessions.

Flow:
    POST /decks/{id}/study/start  → opens a session for the whole deck
    GET  /decks/{id}/study/next   → next un-reviewed card (random order)
    POST /study/review            → record correct/wrong for one card

The server tracks progress by comparing `card_reviews` rows against the
deck's card list, so sessions survive page reloads and card edits.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user, get_owned_deck, load_owned_session
from ..models import Card, CardReview, Deck, StudySession, User, utcnow
from ..schemas import ReviewIn, ReviewOut, StudyNextOut, StudyStartOut

router = APIRouter(tags=["Study"])


async def _session_progress(db: AsyncSession, session: StudySession) -> tuple[int, int]:
    """Return (reviewed_cards, total_cards) for a session."""
    total = await db.scalar(
        select(func.count()).select_from(Card).where(Card.deck_id == session.deck_id)
    )
    reviewed = await db.scalar(
        select(func.count()).select_from(CardReview).where(CardReview.session_id == session.id)
    )
    return int(reviewed or 0), int(total or 0)


@router.post(
    "/decks/{deck_id}/study/start",
    response_model=StudyStartOut,
    status_code=status.HTTP_201_CREATED,
    summary="Start a study session for a deck",
)
async def start_study(
    deck: Deck = Depends(get_owned_deck),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StudyStartOut:
    total = await db.scalar(
        select(func.count()).select_from(Card).where(Card.deck_id == deck.id)
    )
    if not total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This deck has no cards yet — add some cards first",
        )

    session = StudySession(user_id=user.id, deck_id=deck.id, mode="study")
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return StudyStartOut(session_id=session.id, deck_id=deck.id, total_cards=int(total))


@router.get(
    "/decks/{deck_id}/study/next",
    response_model=StudyNextOut,
    summary="Get the next card to review in a session",
)
async def study_next(
    deck_id: int,
    session_id: int | None = None,
    deck: Deck = Depends(get_owned_deck),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StudyNextOut:
    """`session_id` is optional — when omitted, the latest active (unfinished)
    session for this deck is used, which makes resuming trivial for clients."""
    if session_id is not None:
        session = await load_owned_session(db, user, session_id)
        if session.deck_id != deck.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Session does not belong to this deck",
            )
    else:
        session = (
            await db.scalars(
                select(StudySession)
                .where(
                    StudySession.deck_id == deck.id,
                    StudySession.user_id == user.id,
                    StudySession.finished_at.is_(None),
                )
                .order_by(StudySession.started_at.desc())
                .limit(1)
            )
        ).first()
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active session — start studying first",
            )

    reviewed, total = await _session_progress(db, session)

    # Next card = a card of this deck that has no review row in this session,
    # picked at random so every run-through feels fresh.
    next_card = (
        await db.scalars(
            select(Card)
            .where(
                Card.deck_id == session.deck_id,
                ~Card.id.in_(
                    select(CardReview.card_id).where(CardReview.session_id == session.id)
                ),
            )
            .order_by(func.random())
            .limit(1)
        )
    ).first()

    finished = next_card is None
    if finished and session.finished_at is None:
        session.finished_at = utcnow()
        await db.commit()

    return StudyNextOut(
        session_id=session.id,
        card=next_card,
        reviewed=reviewed,
        total=total,
        finished=finished,
    )


@router.post("/study/review", response_model=ReviewOut, summary="Record a card review result")
async def submit_review(
    payload: ReviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReviewOut:
    session = await load_owned_session(db, user, payload.session_id)
    if session.mode != "study":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session is not a study session",
        )

    card = await db.get(Card, payload.card_id)
    if card is None or card.deck_id != session.deck_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Card does not belong to this session's deck",
        )

    # Upsert: re-reviewing the same card inside one session updates the result
    # (keeps progress counting simple: one review row per card per session).
    review = (
        await db.scalars(
            select(CardReview).where(
                CardReview.session_id == session.id, CardReview.card_id == card.id
            )
        )
    ).first()
    if review is not None:
        review.result = payload.result
        review.reviewed_at = utcnow()
    else:
        db.add(
            CardReview(
                session_id=session.id,
                card_id=card.id,
                result=payload.result,
                reviewed_at=utcnow(),
            )
        )
    await db.commit()

    reviewed, total = await _session_progress(db, session)
    finished = reviewed >= total
    if finished and session.finished_at is None:
        session.finished_at = utcnow()
        await db.commit()

    return ReviewOut(
        card_id=card.id,
        result=payload.result,
        reviewed=reviewed,
        total=total,
        finished=finished,
    )
