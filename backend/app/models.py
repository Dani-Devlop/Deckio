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

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

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
    # For quiz sessions: how many questions were generated at start (spec
    # extension). Lets the session close exactly when its planned questions
    # are answered, even if the deck was capped by `limit` or grows later.
    total_planned: Mapped[int | None] = mapped_column(default=None)
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
