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
    daily_goal: int = 20
    created_at: datetime


class GoalUpdate(BaseModel):
    """Daily review goal (reviews/day) — used by the stats goal ring."""

    daily_goal: int = Field(ge=1, le=500)


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
    # Smart-review presets honored by `study/start?srs=true`:
    new_per_day: int = Field(
        default=20, ge=0, le=100,
        description="New cards a smart review may introduce per day (UTC); 0 = review-only",
    )
    max_reviews: int = Field(
        default=100, ge=5, le=500,
        description="Hard cap on the size of one smart-review session",
    )


class DeckCreate(DeckBase):
    pass


class DeckUpdate(BaseModel):
    """Partial update — only provided fields are applied (PATCH-like semantics on PUT)."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str | None = Field(default=None, max_length=8)
    new_per_day: int | None = Field(default=None, ge=0, le=100)
    max_reviews: int | None = Field(default=None, ge=5, le=500)


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
    # Smart-review presets (per-deck):
    new_per_day: int = 20
    max_reviews: int = 100
    # Public share link token (null = private). The client builds
    # `/?share=<token>` preview URLs from it.
    share_token: str | None = None


# ============================== Cards ==============================

MAX_TAGS_PER_CARD = 8
MAX_TAG_LENGTH = 32
MAX_HINT_LENGTH = 300
MAX_IMAGE_URL_LENGTH = 500

# Allowed image sources for Card.image_url:
# - http(s):// external URLs
# - data:image/... inline payloads (small embedded pictures)
# - protocol-relative "//cdn.example/x.png" and relative "/uploads/x.png"
_IMAGE_PREFIXES = ("http://", "https://", "data:image/", "//", "/")


def clean_image_url(url: str | None) -> str | None:
    """Normalize an image URL: trim, drop empties, cap length, sanity-check scheme.

    Raises ValueError for clearly invalid input so API clients get feedback
    instead of silently storing a broken image.
    """
    if url is None:
        return None
    url = url.strip()
    if not url:
        return None
    if len(url) > MAX_IMAGE_URL_LENGTH:
        raise ValueError(f"image_url must be at most {MAX_IMAGE_URL_LENGTH} characters")
    if not url.lower().startswith(_IMAGE_PREFIXES):
        raise ValueError("image_url must start with http://, https://, data:image/ or / ")
    return url


def clean_hint(hint: str | None) -> str | None:
    """Normalize a hint: trim, drop empties, cap length."""
    if hint is None:
        return None
    hint = hint.strip()
    return hint[:MAX_HINT_LENGTH] or None


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
    hint: str | None = Field(
        default=None,
        max_length=MAX_HINT_LENGTH,
        description="Optional memory aid shown before flipping",
    )
    image_url: str | None = Field(
        default=None,
        max_length=MAX_IMAGE_URL_LENGTH,
        description="Optional picture (URL) rendered above the text",
    )

    @field_validator("tags")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        return clean_tags(v)

    @field_validator("hint")
    @classmethod
    def _clean_hint(cls, v: str | None) -> str | None:
        return clean_hint(v)

    @field_validator("image_url")
    @classmethod
    def _clean_image(cls, v: str | None) -> str | None:
        return clean_image_url(v)


class CardCreate(CardBase):
    pass


class CardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=1000)
    back: str | None = Field(default=None, min_length=1, max_length=2000)
    tags: list[str] | None = Field(default=None)
    hint: str | None = Field(default=None, max_length=MAX_HINT_LENGTH)
    image_url: str | None = Field(default=None, max_length=MAX_IMAGE_URL_LENGTH)

    @field_validator("tags")
    @classmethod
    def _clean(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else clean_tags(v)

    @field_validator("hint")
    @classmethod
    def _clean_hint(cls, v: str | None) -> str | None:
        return clean_hint(v)

    @field_validator("image_url")
    @classmethod
    def _clean_image(cls, v: str | None) -> str | None:
        return clean_image_url(v)


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deck_id: int
    front: str
    back: str
    tags: list[str] = []
    hint: str | None = None
    image_url: str | None = None
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
    # Smart-review plan shape (0/0 for regular sessions):
    plan_reviews: int = 0  # scheduled cards that already have reps
    plan_new: int = 0  # brand-new cards the session introduces
    # Human-readable reason when the deck's limits trimmed the plan, else None.
    note: str | None = None


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
    hint: str | None = None  # optional memory aid, may be revealed by the client
    image_url: str | None = None  # optional picture on the question side


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
    # Daily goal ring: reviews completed today (UTC) vs the user's goal.
    today_reviews: int = 0
    daily_goal: int = 20
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
    hint: str | None = Field(default=None, max_length=MAX_HINT_LENGTH)
    image_url: str | None = Field(default=None, max_length=MAX_IMAGE_URL_LENGTH)

    @field_validator("tags")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        return clean_tags(v)

    @field_validator("hint")
    @classmethod
    def _clean_hint(cls, v: str | None) -> str | None:
        return clean_hint(v)

    @field_validator("image_url")
    @classmethod
    def _clean_image(cls, v: str | None) -> str | None:
        return clean_image_url(v)


class DeckBundleIn(BaseModel):
    """Payload for `POST /decks/import` — a previously exported deck bundle."""

    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(default="#f59e0b", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str = Field(default="📚", max_length=8)
    # Optional SRS presets (older bundles don't carry them → model defaults).
    new_per_day: int | None = Field(default=None, ge=0, le=100)
    max_reviews: int | None = Field(default=None, ge=5, le=500)
    cards: list[BundleCardIn] = Field(min_length=1, max_length=MAX_ROWS_PER_IMPORT)


class DeckBundleOut(BaseModel):
    """Export shape returned by `GET /decks/{id}/bundle` (JSON attachment)."""

    version: int = 1
    app: str = "deckio"
    title: str
    description: str | None
    color: str
    icon: str
    new_per_day: int = 20
    max_reviews: int = 100
    card_count: int
    cards: list[BundleCardIn]


# ============================== Share links & public decks ==============================


class ShareLinkOut(BaseModel):
    """Public share state of a deck (token is enough — the client builds URLs)."""

    share_token: str | None = None
    share_path: str | None = None  # e.g. "/?share=abc123" (relative SPA route)


class PublicCardOut(BaseModel):
    """One card on the public read-only deck preview (no SRS/owner data)."""

    front: str
    back: str
    tags: list[str] = []
    hint: str | None = None
    image_url: str | None = None


class PublicDeckOut(BaseModel):
    """Read-only deck preview served WITHOUT authentication via a share token."""

    title: str
    description: str | None
    color: str
    icon: str
    card_count: int
    cards: list[PublicCardOut]
