"""Study mode: self-paced flashcard sessions.

Flow:
    POST /decks/{id}/study/start  → opens a session for the whole deck
    GET  /decks/{id}/study/next   → next un-reviewed card (random order)
    POST /study/review            → record correct/wrong for one card

The server tracks progress by comparing `card_reviews` rows against the
deck's card list, so sessions survive page reloads and card edits.

Smart review (`?srs=true`) additionally honors the deck's presets:
    - `max_reviews` caps the session size,
    - `new_per_day` limits how many brand-new cards may be introduced per
      calendar day (UTC). The exact ordered card plan is stored on the
      session (`plan_json`) so limits stay deterministic across reloads.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user, get_owned_deck, load_owned_session
from ..models import Card, CardReview, Deck, StudySession, User, utcnow
from ..schemas import ReviewIn, ReviewOut, StudyNextOut, StudyStartOut
from ..utils.srs import apply_sm2

router = APIRouter(tags=["Study"])


async def _new_introduced_today(db: AsyncSession, deck_id: int) -> int:
    """Count deck cards whose FIRST review happened today (UTC).

    These are the "new cards introduced today" — they burn the deck's
    `new_per_day` budget so limits survive session restarts.
    """
    today = utcnow().date().isoformat()
    return int(
        await db.scalar(
            select(func.count()).select_from(
                select(CardReview.card_id)
                .join(Card, CardReview.card_id == Card.id)
                .where(Card.deck_id == deck_id)
                .group_by(CardReview.card_id)
                .having(func.date(func.min(CardReview.reviewed_at)) == today)
                .subquery()
            )
        )
        or 0
    )


async def _build_srs_plan(db: AsyncSession, deck: Deck) -> tuple[list[int], int, int, str | None]:
    """Ordered card-id plan for a smart-review session.

    Reviews (reps > 0, due now) come first — most overdue wins — then new
    cards (reps == 0), shaped by the deck presets:

        plan = due_reviews[:max_reviews] + due_new[:min(new_budget, room_left)]

    where `new_budget = new_per_day - new cards already introduced today`.

    Returns:
        (plan_ids, n_reviews, n_new, note) — `note` is a human-readable reason
        when the deck's limits actually trimmed the plan (for the UI), else None.
    """
    now = utcnow()
    due_cards = (
        await db.scalars(
            select(Card)
            .where(Card.deck_id == deck.id, or_(Card.due_at.is_(None), Card.due_at <= now))
            .order_by(Card.due_at.asc().nulls_first(), Card.created_at)
        )
    ).all()

    reviews = [c for c in due_cards if c.reps > 0]
    new_cards = [c for c in due_cards if c.reps == 0]

    plan_reviews = [c.id for c in reviews[: deck.max_reviews]]
    room_left = deck.max_reviews - len(plan_reviews)
    new_budget = max(0, deck.new_per_day - await _new_introduced_today(db, deck.id))
    plan_new = [c.id for c in new_cards[: min(new_budget, room_left)]]

    note: str | None = None
    if reviews and len(plan_reviews) < len(reviews):
        note = f"Capped at {deck.max_reviews} cards by the deck's session limit"
    elif new_cards and len(plan_new) < len(new_cards):
        # Name the binding constraint: the daily budget or the session cap.
        if new_budget <= room_left:
            note = f"Daily limit — {deck.new_per_day} new card{'s' if deck.new_per_day == 1 else ''}/day"
        else:
            note = f"Capped at {deck.max_reviews} cards by the deck's session limit"

    return plan_reviews + plan_new, len(plan_reviews), len(plan_new), note


async def _session_progress(db: AsyncSession, session: StudySession) -> tuple[int, int]:
    """Return (reviewed_cards, total_cards) for a session.

    Quiz and SRS sessions have a fixed plan (total_planned); regular study
    sessions cover the whole deck, so the total is the deck's card count.
    """
    total: int | None = session.total_planned
    if total is None:
        total = int(
            await db.scalar(
                select(func.count()).select_from(Card).where(Card.deck_id == session.deck_id)
            )
            or 0
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
    srs: bool = Query(default=False, description="Smart review: only cards due by the SM-2 schedule"),
) -> StudyStartOut:
    if srs:
        # Spaced-repetition session shaped by the deck's presets. The ordered
        # plan is stored on the session so limits stay deterministic.
        plan, n_reviews, n_new, note = await _build_srs_plan(db, deck)
        if not plan:
            due_exists = await db.scalar(
                select(func.count()).select_from(Card).where(
                    Card.deck_id == deck.id,
                    or_(Card.due_at.is_(None), Card.due_at <= utcnow()),
                )
            )
            if due_exists:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Daily smart-review limit reached — raise the limits in the deck settings ⚙️",
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nothing due right now — you're all caught up! 🎉",
            )
        session = StudySession(
            user_id=user.id,
            deck_id=deck.id,
            mode="study",
            srs=True,
            total_planned=len(plan),
            plan_json=json.dumps(plan),
        )
        total = len(plan)
    else:
        total = await db.scalar(
            select(func.count()).select_from(Card).where(Card.deck_id == deck.id)
        )
        if not total:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This deck has no cards yet — add some cards first",
            )
        session = StudySession(user_id=user.id, deck_id=deck.id, mode="study")
        n_reviews = n_new = 0
        note = None

    db.add(session)
    await db.commit()
    await db.refresh(session)

    out = StudyStartOut(
        session_id=session.id,
        deck_id=deck.id,
        srs=session.srs,
        total_cards=total,
        plan_reviews=n_reviews,
        plan_new=n_new,
        note=note,
    )
    return out


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

    # Next card selection:
    # - SRS session with a stored plan → next un-reviewed card in plan order
    #   (reviews first, then new cards — the plan was shaped by the presets)
    # - legacy SRS session (no plan) → oldest due card (most overdue wins)
    # - regular session → any un-reviewed card, random order
    not_reviewed = ~Card.id.in_(
        select(CardReview.card_id).where(CardReview.session_id == session.id)
    )
    next_card = None
    if session.srs and session.plan_json:
        try:
            plan_ids: list[int] = json.loads(session.plan_json)
        except (TypeError, ValueError):
            plan_ids = []
        if plan_ids:
            plan_rows = (
                await db.scalars(select(Card).where(Card.id.in_(plan_ids)))
            ).all()
            existing = {c.id: c for c in plan_rows}
            reviewed_ids = set(
                (
                    await db.scalars(
                        select(CardReview.card_id).where(CardReview.session_id == session.id)
                    )
                ).all()
            )
            for cid in plan_ids:  # plan order wins over dict order
                if cid not in reviewed_ids and cid in existing:
                    next_card = existing[cid]
                    break
    # Legacy SRS fallback only applies when NO plan was stored — a stored plan
    # is authoritative: once it's exhausted the session is finished, even if
    # other cards became due mid-session (they wait for the next session).
    if next_card is None and session.srs and not session.plan_json:
        next_card = (
            await db.scalars(
                select(Card)
                .where(
                    Card.deck_id == session.deck_id,
                    not_reviewed,
                    or_(Card.due_at.is_(None), Card.due_at <= utcnow()),
                )
                .order_by(Card.due_at.asc().nulls_first())
                .limit(1)
            )
        ).first()
    if next_card is None and not session.srs:
        next_card = (
            await db.scalars(
                select(Card)
                .where(Card.deck_id == session.deck_id, not_reviewed)
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

    # Study-mode reviews (regular AND smart/SRS) drive SM-2 scheduling so the
    # card comes back at the right time. Quiz answers are practice-only and do
    # not touch the schedule.
    if session.mode == "study":
        apply_sm2(card, payload.result == "correct")

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
