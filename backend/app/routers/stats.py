"""Learning statistics & analytics.

All endpoints are user-scoped (reviews are joined through study sessions to
enforce ownership). Aggregations happen in SQL; only small post-processing
(streak / activity fill / accuracy math) happens in Python.
"""

import csv
import io
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user, get_owned_deck
from ..models import Card, CardReview, Deck, StudySession, User, utcnow
from ..schemas import (
    ActivityDay,
    DeckSessionOut,
    DeckStatsOut,
    SessionSummary,
    StatsOverview,
    WeakCardOut,
)

router = APIRouter(prefix="/stats", tags=["Stats"])

MASTERED_MIN_REVIEWS = 3
MASTERED_MIN_ACCURACY = 0.8


def _as_utc(dt: datetime) -> datetime:
    """Normalize possibly-naive (SQLite) datetimes to timezone-aware UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# Column contract shared by the account-wide and per-deck CSV exports
# (decks.py imports `_reviews_csv` from here — no circular import, since
# stats.py never imports from decks.py).
REVIEW_CSV_HEADER = [
    "reviewed_at",
    "deck_id",
    "deck_title",
    "card_id",
    "front",
    "back",
    "result",
    "selected_answer",
    "mode",
    "session_id",
]


def _reviews_csv(rows) -> str:
    """Serialize review-history rows as downloadable CSV text.

    `rows` are (CardReview, Card, Deck, StudySession) tuples as produced by
    the export queries below. `reviewed_at` is emitted as ISO-8601 UTC (naive
    SQLite datetimes are normalized first). The writer uses QUOTE_MINIMAL, so
    commas/quotes/newlines inside card text are escaped automatically; a
    UTF-8 BOM is prepended so Excel opens the file with the right encoding.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)  # QUOTE_MINIMAL (default) is fine for this data
    writer.writerow(REVIEW_CSV_HEADER)
    for review, card, deck, session in rows:
        writer.writerow(
            [
                _as_utc(review.reviewed_at).isoformat(),
                deck.id,
                deck.title,
                card.id,
                card.front,
                card.back,
                review.result,
                review.selected_answer or "",
                session.mode,
                session.id,
            ]
        )
    return "\ufeff" + buf.getvalue()


def _streak_days(review_dates: set[date]) -> int:
    """Count consecutive days ending today (or yesterday, for grace) backwards."""
    if not review_dates:
        return 0
    today = datetime.now(timezone.utc).date()
    cursor = today if today in review_dates else today - timedelta(days=1)
    streak = 0
    while cursor in review_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@router.get("/overview", response_model=StatsOverview, summary="Global learning statistics")
async def stats_overview(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    days: int = Query(
        default=7,
        ge=7,
        le=366,
        description="Length of the activity window in days (7 = weekly bars, 91 = 13-week heatmap)",
    ),
) -> StatsOverview:
    total_decks = await db.scalar(
        select(func.count()).select_from(Deck).where(Deck.user_id == user.id)
    )
    total_cards = await db.scalar(
        select(func.count())
        .select_from(Card)
        .join(Deck, Deck.id == Card.deck_id)
        .where(Deck.user_id == user.id)
    )
    total_sessions = await db.scalar(
        select(func.count()).select_from(StudySession).where(StudySession.user_id == user.id)
    )

    # Cards due right now across all decks (SM-2: new or overdue).
    due_cards = await db.scalar(
        select(func.count())
        .select_from(Card)
        .join(Deck, Deck.id == Card.deck_id)
        .where(Deck.user_id == user.id, or_(Card.due_at.is_(None), Card.due_at <= utcnow()))
    )

    # All reviews of this user, with timestamps for the activity chart / streak.
    review_rows = (
        await db.execute(
            select(CardReview.result, CardReview.reviewed_at)
            .join(StudySession, StudySession.id == CardReview.session_id)
            .where(StudySession.user_id == user.id)
        )
    ).all()
    total_reviews = len(review_rows)
    correct_reviews = sum(1 for result, _ in review_rows if result == "correct")

    # ---- Activity: last `days` days (UTC), missing days filled with zeros ----
    # The window length is configurable so the web client can request a
    # 13-week (91-day) range for its review heatmap in the same call.
    today = datetime.now(timezone.utc).date()
    counts: dict[date, int] = {}
    corrects: dict[date, int] = {}
    for result, reviewed_at in review_rows:
        day = _as_utc(reviewed_at).date()
        counts[day] = counts.get(day, 0) + 1
        if result == "correct":
            corrects[day] = corrects.get(day, 0) + 1
    activity = [
        ActivityDay(
            date=str(today - timedelta(days=days - 1 - i)),
            reviews=counts.get(today - timedelta(days=days - 1 - i), 0),
            correct=corrects.get(today - timedelta(days=days - 1 - i), 0),
        )
        for i in range(days)
    ]

    # ---- Mastered cards: enough reviews AND high accuracy ----
    per_card = (
        await db.execute(
            select(
                CardReview.card_id,
                func.count(CardReview.id),
                func.sum(case((CardReview.result == "correct", 1), else_=0)),
            )
            .join(StudySession, StudySession.id == CardReview.session_id)
            .where(StudySession.user_id == user.id)
            .group_by(CardReview.card_id)
        )
    ).all()
    mastered = sum(
        1
        for _, n, c in per_card
        if n >= MASTERED_MIN_REVIEWS and (int(c or 0) / n) >= MASTERED_MIN_ACCURACY
    )

    return StatsOverview(
        total_decks=int(total_decks or 0),
        total_cards=int(total_cards or 0),
        total_sessions=int(total_sessions or 0),
        total_reviews=total_reviews,
        correct_reviews=correct_reviews,
        accuracy=round(correct_reviews / total_reviews * 100, 1) if total_reviews else None,
        streak_days=_streak_days(set(counts.keys())),
        mastered_cards=mastered,
        due_cards=int(due_cards or 0),
        # Daily-goal ring inputs: reviews logged today (UTC) vs the user's goal.
        today_reviews=counts.get(today, 0),
        daily_goal=user.daily_goal,
        activity=activity,
    )


@router.get("/sessions", response_model=list[SessionSummary], summary="Recent sessions across all decks")
async def recent_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=15, ge=1, le=50, description="How many sessions to return"),
) -> list[SessionSummary]:
    """Account-wide session history (newest first) with per-session accuracy."""
    sessions = (
        await db.execute(
            select(StudySession, Deck.title)
            .join(Deck, Deck.id == StudySession.deck_id)
            .where(StudySession.user_id == user.id)
            .order_by(StudySession.started_at.desc())
            .limit(limit)
        )
    ).all()

    per_session: dict[int, tuple[int, int]] = {}
    if sessions:
        rows = await db.execute(
            select(
                CardReview.session_id,
                func.count(CardReview.id),
                func.sum(case((CardReview.result == "correct", 1), else_=0)),
            )
            .where(CardReview.session_id.in_([s.id for s, _ in sessions]))
            .group_by(CardReview.session_id)
        )
        for sid, n, c in rows.all():
            per_session[sid] = (int(n), int(c or 0))

    out: list[SessionSummary] = []
    for s, deck_title in sessions:
        n, c = per_session.get(s.id, (0, 0))
        duration = (
            max(0.0, (_as_utc(s.finished_at) - _as_utc(s.started_at)).total_seconds())
            if s.finished_at is not None
            else None
        )
        out.append(
            SessionSummary(
                id=s.id,
                deck_id=s.deck_id,
                deck_title=deck_title,
                mode=s.mode,
                srs=s.srs,
                started_at=s.started_at,
                finished_at=s.finished_at,
                reviews=n,
                correct=c,
                accuracy=round(c / n * 100, 1) if n else None,
                duration_seconds=duration,
            )
        )
    return out


@router.get("/decks/{deck_id}", response_model=DeckStatsOut, summary="Per-deck statistics")
async def deck_stats(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
) -> DeckStatsOut:
    total_cards = await db.scalar(
        select(func.count()).select_from(Card).where(Card.deck_id == deck.id)
    )
    sessions_count = await db.scalar(
        select(func.count()).select_from(StudySession).where(StudySession.deck_id == deck.id)
    )

    review_rows = (
        await db.execute(
            select(CardReview.result, CardReview.session_id)
            .join(StudySession, StudySession.id == CardReview.session_id)
            .where(StudySession.deck_id == deck.id)
        )
    ).all()
    total_reviews = len(review_rows)
    correct_reviews = sum(1 for result, _ in review_rows if result == "correct")

    # Weak cards inside this deck: cards with at least one wrong review.
    weak_cards = await db.scalar(
        select(func.count(func.distinct(CardReview.card_id)))
        .join(StudySession, StudySession.id == CardReview.session_id)
        .where(StudySession.deck_id == deck.id, CardReview.result == "wrong")
    )

    # Recent sessions with their own accuracy (single grouped query).
    recent = (
        (
            await db.scalars(
                select(StudySession)
                .where(StudySession.deck_id == deck.id)
                .order_by(StudySession.started_at.desc())
                .limit(5)
            )
        )
        .all()
    )
    per_session: dict[int, tuple[int, int]] = {}
    if recent:
        rows = await db.execute(
            select(
                CardReview.session_id,
                func.count(CardReview.id),
                func.sum(case((CardReview.result == "correct", 1), else_=0)),
            )
            .where(CardReview.session_id.in_([s.id for s in recent]))
            .group_by(CardReview.session_id)
        )
        for sid, n, c in rows.all():
            per_session[sid] = (int(n), int(c or 0))

    recent_out = [
        DeckSessionOut(
            id=s.id,
            mode=s.mode,
            started_at=s.started_at,
            finished_at=s.finished_at,
            reviews=per_session.get(s.id, (0, 0))[0],
            accuracy=(
                round(per_session[s.id][1] / per_session[s.id][0] * 100, 1)
                if per_session.get(s.id, (0, 0))[0]
                else None
            ),
        )
        for s in recent
    ]

    return DeckStatsOut(
        deck_id=deck.id,
        title=deck.title,
        total_cards=int(total_cards or 0),
        total_reviews=total_reviews,
        correct_reviews=correct_reviews,
        accuracy=round(correct_reviews / total_reviews * 100, 1) if total_reviews else None,
        sessions_count=int(sessions_count or 0),
        weak_cards_count=int(weak_cards or 0),
        last_studied_at=recent[0].started_at if recent else None,
        recent_sessions=recent_out,
    )


@router.get(
    "/export/reviews.csv",
    summary="Export the user's full review history as CSV",
)
async def export_reviews_csv(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Full review history across all decks as a CSV download.

    Reviews are joined through study sessions (user-scoped) to cards and
    decks; rows are ordered oldest → newest. The dataset is small enough that
    streaming/chunking is unnecessary — one query, in-memory CSV.
    """
    rows = (
        await db.execute(
            select(CardReview, Card, Deck, StudySession)
            .join(StudySession, StudySession.id == CardReview.session_id)
            .join(Card, Card.id == CardReview.card_id)
            .join(Deck, Deck.id == Card.deck_id)
            .where(StudySession.user_id == user.id)
            .order_by(CardReview.reviewed_at)
        )
    ).all()
    return Response(
        content=_reviews_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="deckio-reviews-all.csv"'},
    )


@router.get("/weak-cards", response_model=list[WeakCardOut], summary="Cards the user struggles with")
async def weak_cards(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WeakCardOut]:
    """Cards with at least one wrong review, worst first (max 20)."""
    rows = (
        await db.execute(
            select(
                Card,
                Deck.title,
                func.count(CardReview.id),
                func.sum(case((CardReview.result == "wrong", 1), else_=0)),
            )
            .join(CardReview, CardReview.card_id == Card.id)
            .join(StudySession, StudySession.id == CardReview.session_id)
            .join(Deck, Deck.id == Card.deck_id)
            .where(StudySession.user_id == user.id)
            .group_by(Card.id, Deck.id)
            .order_by(
                func.sum(case((CardReview.result == "wrong", 1), else_=0)).desc(),
                func.count(CardReview.id).desc(),
            )
            .limit(20)
        )
    ).all()

    out: list[WeakCardOut] = []
    for card, deck_title, reviewed, wrong in rows:
        reviewed, wrong = int(reviewed), int(wrong or 0)
        if wrong == 0:
            continue  # ordered by wrong desc — nothing weaker beyond this point
        out.append(
            WeakCardOut(
                card_id=card.id,
                deck_id=card.deck_id,
                deck_title=deck_title,
                front=card.front,
                back=card.back,
                times_reviewed=reviewed,
                times_wrong=wrong,
                accuracy=round((reviewed - wrong) / reviewed * 100, 1),
            )
        )
    return out
