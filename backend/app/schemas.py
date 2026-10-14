"""Pydantic schemas — request validation and response serialization.

Grouped by domain: Auth, Decks, Cards, Study, Quiz, Stats.
`from_attributes=True` allows building response models directly from ORM rows.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .utils.csv_import import MAX_ROWS_PER_IMPORT

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


class PasswordChange(BaseModel):
    """Change-password payload — the current password must be re-supplied."""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128, description="New password, min 8 chars")


class AccountDelete(BaseModel):
    """Account-deletion confirmation — requires the current password.

    Sent as a JSON body on POST (DELETE-with-body is unreliable across
    proxies, so a dedicated POST route is safer).
    """

    password: str = Field(min_length=1, max_length=128)


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

MAX_TAGS_PER_CARD = 8
MAX_TAG_LENGTH = 32


def clean_tags(tags: list[str]) -> list[str]:
    """Trim tags, drop empties, cap length and de-duplicate (case-insensitive)."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in tags:
        tag = raw.strip()
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag[:MAX_TAG_LENGTH])
        if len(out) >= MAX_TAGS_PER_CARD:
            break
    return out


def tags_to_storage(tags: list[str]) -> str | None:
    """Serialize a clean tag list for the DB column (comma-joined, NULL if empty)."""
    tags = clean_tags(tags)
    return ",".join(tags) if tags else None


class CardBase(BaseModel):
    front: str = Field(min_length=1, max_length=1000)
    back: str = Field(min_length=1, max_length=2000)
    tags: list[str] = Field(
        default_factory=list,
        description=f"Free-form labels (max {MAX_TAGS_PER_CARD}, {MAX_TAG_LENGTH} chars each)",
    )

    @field_validator("tags")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        return clean_tags(v)


class CardCreate(CardBase):
    pass


class CardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=1000)
    back: str | None = Field(default=None, min_length=1, max_length=2000)
    tags: list[str] | None = Field(default=None)

    @field_validator("tags")
    @classmethod
    def _clean(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else clean_tags(v)


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deck_id: int
    front: str
    back: str
    tags: list[str] = []
    created_at: datetime
    # --- Spaced-repetition state (read-only surface for the web UI) ---
    # due_at == NULL means "new card" → due immediately; otherwise the
    # frontend renders a "due" / "in Nd" chip from this timestamp.
    ease: float = 2.5
    interval_days: int = 0
    reps: int = 0
    lapses: int = 0
    due_at: datetime | None = None

    @field_validator("tags", mode="before")
    @classmethod
    def _split_stored_tags(cls, v: object) -> object:
        """Accept the raw comma-separated DB string and expose a clean list."""
        if isinstance(v, str):
            return [t.strip() for t in v.split(",") if t.strip()]
        if v is None:
            return []
        return v


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
    activity: list[ActivityDay]  # last `days` days, ascending (client chooses window)


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


# ============================== Search ==============================


class SearchCardHit(BaseModel):
    """One matching card in global search results."""

    card_id: int
    deck_id: int
    deck_title: str
    front: str
    back: str
    tags: list[str] = []


class SearchResults(BaseModel):
    """Global search across the user's decks and cards (powers the ⌘K palette)."""

    decks: list[DeckOut]
    cards: list[SearchCardHit]


# ============================== Session history ==============================


class SessionSummary(BaseModel):
    """One study/quiz session for the account-wide history list."""

    id: int
    deck_id: int
    deck_title: str
    mode: str  # "study" | "quiz"
    srs: bool
    started_at: datetime
    finished_at: datetime | None
    reviews: int
    correct: int
    accuracy: float | None
    duration_seconds: float | None


# ============================== Deck bundle (share) ==============================


class BundleCardIn(BaseModel):
    front: str = Field(min_length=1, max_length=1000)
    back: str = Field(min_length=1, max_length=2000)
    tags: list[str] = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        return clean_tags(v)


class DeckBundleIn(BaseModel):
    """Payload for `POST /decks/import` — a previously exported deck bundle."""

    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(default="#f59e0b", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str = Field(default="📚", max_length=8)
    cards: list[BundleCardIn] = Field(min_length=1, max_length=MAX_ROWS_PER_IMPORT)


class DeckBundleOut(BaseModel):
    """Export shape returned by `GET /decks/{id}/bundle` (JSON attachment)."""

    version: int = 1
    app: str = "deckio"
    title: str
    description: str | None
    color: str
    icon: str
    card_count: int
    cards: list[BundleCardIn]
