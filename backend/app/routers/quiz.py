"""Quiz mode: auto-generated multiple-choice sessions.

Flow:
    POST /decks/{id}/quiz/start   → builds N questions, each with 4 options
                                     (1 correct + 3 random distractors)
    POST /quiz/answer             → validates an answer, stores the review
    GET  /quiz/{session_id}/result → score, duration and per-question breakdown

Distractor strategy: sample 3 other answers **from the same deck** first; if
the deck is small, top the pool up with answers from the user's other decks.
The correct answer is never sent to the client before it is answered.
"""

import random

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user, get_owned_deck, get_owned_session, load_owned_session
from ..models import Card, CardReview, Deck, StudySession, User, utcnow
from ..schemas import (
    QuizAnswerIn,
    QuizAnswerOut,
    QuizQuestion,
    QuizResultItem,
    QuizResultOut,
    QuizStartOut,
)

router = APIRouter(tags=["Quiz"])


@router.post(
    "/decks/{deck_id}/quiz/start",
    response_model=QuizStartOut,
    status_code=status.HTTP_201_CREATED,
    summary="Start a quiz session (4 options per card)",
)
async def start_quiz(
    deck: Deck = Depends(get_owned_deck),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=10, ge=1, le=50, description="Max questions per quiz"),
) -> QuizStartOut:
    cards = (await db.scalars(select(Card).where(Card.deck_id == deck.id))).all()
    if not cards:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This deck has no cards yet — add some cards first",
        )

    # Cap long decks; shuffle so each quiz feels different.
    if len(cards) > limit:
        cards = random.sample(cards, limit)
    random.shuffle(cards)

    # Build the distractor pool: same deck first, then the user's other decks.
    pool = [c.back.strip() for c in cards if c.back.strip()]
    if len(cards) < 4:
        extra = (
            await db.scalars(
                select(Card)
                .join(Deck, Deck.id == Card.deck_id)
                .where(Deck.user_id == user.id, Card.deck_id != deck.id)
            )
        ).all()
        pool += [c.back.strip() for c in extra if c.back.strip()]
    # De-duplicate while preserving order (identical answers would be ambiguous).
    pool = list(dict.fromkeys(pool))
    random.shuffle(pool)

    questions: list[QuizQuestion] = []
    for card in cards:
        correct = card.back.strip()
        distractors = [b for b in pool if b != correct][:3]
        options = distractors + [correct]
        random.shuffle(options)  # never reveal the correct answer by position
        questions.append(QuizQuestion(card_id=card.id, front=card.front, options=options, hint=card.hint))

    session = StudySession(user_id=user.id, deck_id=deck.id, mode="quiz", total_planned=len(questions))
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return QuizStartOut(
        session_id=session.id,
        deck_id=deck.id,
        total_questions=len(questions),
        questions=questions,
    )


@router.post("/quiz/answer", response_model=QuizAnswerOut, summary="Answer a quiz question")
async def answer_quiz_question(
    payload: QuizAnswerIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QuizAnswerOut:
    session = await load_owned_session(db, user, payload.session_id)
    if session.mode != "quiz":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session is not a quiz session",
        )

    card = await db.get(Card, payload.card_id)
    if card is None or card.deck_id != session.deck_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Card does not belong to this quiz session",
        )

    # Exact match after trimming — the options were generated from real backs.
    correct = card.back.strip() == payload.answer.strip()
    result = "correct" if correct else "wrong"

    # Upsert review (last answer within a session wins).
    review = (
        await db.scalars(
            select(CardReview).where(
                CardReview.session_id == session.id, CardReview.card_id == card.id
            )
        )
    ).first()
    if review is not None:
        review.result = result
        review.selected_answer = payload.answer
        review.reviewed_at = utcnow()
    else:
        db.add(
            CardReview(
                session_id=session.id,
                card_id=card.id,
                result=result,
                selected_answer=payload.answer,
                reviewed_at=utcnow(),
            )
        )
    await db.commit()

    answered = await db.scalar(
        select(func.count()).select_from(CardReview).where(CardReview.session_id == session.id)
    )
    answered = int(answered or 0)
    # A quiz session is complete when its PLANNED questions are all answered
    # (not the whole deck — the start endpoint may have capped the quiz).
    total = session.total_planned or await db.scalar(
        select(func.count()).select_from(Card).where(Card.deck_id == session.deck_id)
    )
    total = int(total or 0)
    finished = answered >= total
    if finished and session.finished_at is None:
        session.finished_at = utcnow()
        await db.commit()

    return QuizAnswerOut(
        correct=correct,
        correct_answer=card.back,
        selected_answer=payload.answer,
        answered=answered,
        total=total,
        finished=finished,
    )


@router.get(
    "/quiz/{session_id}/result",
    response_model=QuizResultOut,
    summary="Full result breakdown for a finished quiz session",
)
async def quiz_result(
    session: StudySession = Depends(get_owned_session),
    db: AsyncSession = Depends(get_db),
) -> QuizResultOut:
    if session.mode != "quiz":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session is not a quiz session",
        )

    # Join reviews with their cards for the per-question breakdown.
    rows = (
        await db.execute(
            select(CardReview, Card)
            .join(Card, Card.id == CardReview.card_id)
            .where(CardReview.session_id == session.id)
            .order_by(CardReview.reviewed_at)
        )
    ).all()

    details = [
        QuizResultItem(
            card_id=card.id,
            front=card.front,
            correct_answer=card.back,
            selected_answer=review.selected_answer,
            result=review.result,
        )
        for review, card in rows
    ]
    answered = len(details)
    correct = sum(1 for d in details if d.result == "correct")

    total = session.total_planned or await db.scalar(
        select(func.count()).select_from(Card).where(Card.deck_id == session.deck_id)
    )
    total = int(total or 0)

    # Close the session if every question was answered.
    now = utcnow()
    if answered >= total and session.finished_at is None:
        session.finished_at = now
        await db.commit()

    # Duration: finished_at (or now) minus start; normalize naive SQLite
    # datetimes to UTC so subtraction never explodes.
    started = session.started_at
    if started.tzinfo is None:
        from datetime import timezone

        started = started.replace(tzinfo=timezone.utc)
    ended = session.finished_at or now
    if ended.tzinfo is None:
        from datetime import timezone

        ended = ended.replace(tzinfo=timezone.utc)

    return QuizResultOut(
        session_id=session.id,
        deck_id=session.deck_id,
        total=total,
        answered=answered,
        correct=correct,
        wrong=answered - correct,
        accuracy=round(correct / answered * 100, 1) if answered else 0.0,
        duration_seconds=round((ended - started).total_seconds(), 1),
        finished_at=session.finished_at,
        details=details,
    )
