"""SQLAlchemy ORM models — the persistence layer of Deckio.

Entity relationship overview:

    User 1───* Deck 1───* Card
    User 1───* StudySession *───1 Deck
    StudySession 1───* CardReview *───1 Card

Notes on the base spec:
- `StudySession.mode` ("study" | "quiz") and `CardReview.selected_answer` are
  small pragmatic extensions used to power quiz results in the web UI.
- All child rows use ON DELETE CASCADE so removing a deck/user cleans up
  cards, sessions and reviews automatically.
- Timestamps that participate in arithmetic (started_at / finished_at /
  reviewed_at) are set in Python as timezone-aware UTC datetimes so duration
  math stays consistent on both SQLite (dev) and PostgreSQL (prod).
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# Allowed values for CardReview.result
CARD_RESULT_CORRECT = "correct"
CARD_RESULT_WRONG = "wrong"


def utcnow() -> datetime:
    """Timezone-aware UTC now (used for all session/review timestamps)."""
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # Daily review goal (reviews per day) — powers the goal ring on the stats
    # dashboard. Purely motivational, never enforced by the API.
    daily_goal: Mapped[int] = mapped_column(Integer, default=20)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # One user owns many decks; deleting a user deletes their decks.
    decks: Mapped[list["Deck"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    sessions: Mapped[list["StudySession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Deck(Base):
    __tablename__ = "decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    color: Mapped[str] = mapped_column(String(16), default="#f59e0b")  # hex accent for the UI
    icon: Mapped[str] = mapped_column(String(8), default="📚")  # emoji icon for the UI
    # Public read-only share token (secrets.token_urlsafe). NULL = private.
    # The web client builds a `/?share=<token>` preview URL from it.
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, default=None)
    # --- Smart-review (SRS) presets, honored by `study/start?srs=true` ---
    # new_per_day: how many brand-new (never studied) cards a smart review
    #   session may introduce per calendar day (UTC). 0 = review-only mode.
    # max_reviews: hard cap on the total size of one smart-review session.
    new_per_day: Mapped[int] = mapped_column(Integer, default=20)
    max_reviews: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    owner: Mapped["User"] = relationship(back_populates="decks")
    cards: Mapped[list["Card"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", order_by="Card.created_at"
    )
    sessions: Mapped[list["StudySession"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan"
    )


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("decks.id", ondelete="CASCADE"), index=True)
    front: Mapped[str] = mapped_column(Text)  # question / prompt side
    back: Mapped[str] = mapped_column(Text)  # answer side
    # Free-form labels stored as a comma-separated string (","). The API layer
    # serializes them as a proper list[str] — the storage format is an
    # implementation detail that keeps SQLite/PG schemas simple and lets the
    # search filter use a plain LIKE.
    tags: Mapped[str | None] = mapped_column(Text, default=None)
    # Optional memory aid shown on the question side before flipping.
    hint: Mapped[str | None] = mapped_column(Text, default=None)
    # Optional picture (validated URL) rendered above the text on both sides.
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # --- Spaced repetition state (simplified SM-2, updated on study reviews) ---
    # due_at == NULL means "new card" → due immediately.
    ease: Mapped[float] = mapped_column(Float, default=2.5)  # ease factor (1.3 – 3.0)
    interval_days: Mapped[int] = mapped_column(Integer, default=0)  # current review interval
    reps: Mapped[int] = mapped_column(Integer, default=0)  # consecutive correct reps
    lapses: Mapped[int] = mapped_column(Integer, default=0)  # total times forgotten
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    deck: Mapped["Deck"] = relationship(back_populates="cards")
    reviews: Mapped[list["CardReview"]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )


class StudySession(Base):
    __tablename__ = "study_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("decks.id", ondelete="CASCADE"), index=True)
    # "study" = self-paced flip cards, "quiz" = multiple-choice (spec extension).
    mode: Mapped[str] = mapped_column(String(10), default="study")
    # True → smart spaced-repetition session covering only DUE cards.
    srs: Mapped[bool] = mapped_column(Boolean, default=False)
    # For quiz sessions: how many questions were generated at start (spec
    # extension). Lets the session close exactly when its planned questions
    # are answered, even if the deck was capped by `limit` or grows later.
    # For SRS study sessions it stores the number of due cards.
    total_planned: Mapped[int | None] = mapped_column(default=None)
    # SRS sessions: exact ordered card-id plan as a JSON list — deck reviews
    # (oldest due first) then new cards within the deck's presets. Keeps the
    # daily-limit budget deterministic across reloads; NULL = legacy session
    # (plan re-derived from due state on each `next`).
    plan_json: Mapped[str | None] = mapped_column(Text, default=None)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    user: Mapped["User"] = relationship(back_populates="sessions")
    deck: Mapped["Deck"] = relationship(back_populates="sessions")
    reviews: Mapped[list["CardReview"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class CardReview(Base):
    __tablename__ = "card_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("study_sessions.id", ondelete="CASCADE"), index=True
    )
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"), index=True)
    result: Mapped[str] = mapped_column(
        Enum(CARD_RESULT_CORRECT, CARD_RESULT_WRONG, name="review_result")
    )
    # What the user picked in quiz mode — powers the "your answer" column on
    # the quiz result screen (pragmatic extension of the base spec).
    selected_answer: Mapped[str | None] = mapped_column(Text, default=None)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped["StudySession"] = relationship(back_populates="reviews")
    card: Mapped["Card"] = relationship(back_populates="reviews")
