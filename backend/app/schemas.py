"""Pydantic schemas — request validation and response serialization.

Grouped by domain: Auth, Decks, Cards, Study, Quiz, Stats.
`from_attributes=True` allows building response models directly from ORM rows.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ============================== Auth ==============================


class UserCreate(BaseModel):
    """Registration payload."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128, description="Plain password, min 8 chars")


class LoginRequest(BaseModel):
    """Login payload (no password length rule — old/short creds must reach the hasher)."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    created_at: datetime


class AuthResponse(BaseModel):
    """JWT + fresh user, returned by register and login for frictionless onboarding."""

    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ============================== Decks ==============================


class DeckBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(default="#f59e0b", pattern=r"^#[0-9a-fA-F]{6}$", description="Hex accent color")
    icon: str = Field(default="📚", max_length=8, description="Emoji icon")


class DeckCreate(DeckBase):
    pass


class DeckUpdate(BaseModel):
    """Partial update — only provided fields are applied (PATCH-like semantics on PUT)."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str | None = Field(default=None, max_length=8)


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    color: str
    icon: str
    created_at: datetime
    # Aggregated stats (computed per-request, not stored):
    card_count: int = 0
    reviews_count: int = 0
    accuracy: float | None = None  # percentage 0–100
    last_studied_at: datetime | None = None
    due_count: int = 0  # cards due for review (SM-2 spaced repetition)


# ============================== Cards ==============================


class CardBase(BaseModel):
    front: str = Field(min_length=1, max_length=1000)
    back: str = Field(min_length=1, max_length=2000)


class CardCreate(CardBase):
    pass


class CardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=1000)
    back: str | None = Field(default=None, min_length=1, max_length=2000)


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deck_id: int
    front: str
    back: str
    created_at: datetime


class BulkImportResult(BaseModel):
    """Outcome of a CSV bulk import, with per-row errors for the UI."""

    imported: int
    skipped: int
    errors: list[str] = []


# ============================== Study ==============================


class StudyStartOut(BaseModel):
    session_id: int
    deck_id: int
    mode: str = "study"
    srs: bool = False
    total_cards: int


class StudyNextOut(BaseModel):
    session_id: int
    card: CardOut | None  # None → session finished
    reviewed: int
    total: int
    finished: bool


class ReviewIn(BaseModel):
    session_id: int
    card_id: int
    result: Literal["correct", "wrong"]


class ReviewOut(BaseModel):
    card_id: int
    result: Literal["correct", "wrong"]
    reviewed: int
    total: int
    finished: bool


# ============================== Quiz ==============================


class QuizQuestion(BaseModel):
    """A generated multiple-choice question (the correct answer is NOT included)."""

    card_id: int
    front: str
    options: list[str]


class QuizStartOut(BaseModel):
    session_id: int
    deck_id: int
    mode: str = "quiz"
    total_questions: int
    questions: list[QuizQuestion]


class QuizAnswerIn(BaseModel):
    session_id: int
    card_id: int
    answer: str = Field(min_length=1, max_length=2000)


class QuizAnswerOut(BaseModel):
    correct: bool
    correct_answer: str
    selected_answer: str
    answered: int
    total: int
    finished: bool


class QuizResultItem(BaseModel):
    card_id: int
    front: str
    correct_answer: str
    selected_answer: str | None
    result: Literal["correct", "wrong"]


class QuizResultOut(BaseModel):
    session_id: int
    deck_id: int
    total: int
    answered: int
    correct: int
    wrong: int
    accuracy: float
    duration_seconds: float
    finished_at: datetime | None
    details: list[QuizResultItem]


# ============================== Stats ==============================


class ActivityDay(BaseModel):
    date: str  # YYYY-MM-DD
    reviews: int
    correct: int


class StatsOverview(BaseModel):
    total_decks: int
    total_cards: int
    total_sessions: int
    total_reviews: int
    correct_reviews: int
    accuracy: float | None
    streak_days: int
    mastered_cards: int
    due_cards: int
    activity: list[ActivityDay]  # last 7 days, ascending


class DeckSessionOut(BaseModel):
    id: int
    mode: str
    started_at: datetime
    finished_at: datetime | None
    reviews: int
    accuracy: float | None


class DeckStatsOut(BaseModel):
    deck_id: int
    title: str
    total_cards: int
    total_reviews: int
    correct_reviews: int
    accuracy: float | None
    sessions_count: int
    weak_cards_count: int
    last_studied_at: datetime | None
    recent_sessions: list[DeckSessionOut]


class WeakCardOut(BaseModel):
    card_id: int
    deck_id: int
    deck_title: str
    front: str
    back: str
    times_reviewed: int
    times_wrong: int
    accuracy: float
