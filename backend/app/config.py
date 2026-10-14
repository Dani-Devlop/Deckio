"""Application configuration, loaded from environment variables (`.env` supported)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def _normalize_database_url(url: str) -> str:
    """Normalize common database URL styles into SQLAlchemy **async** URLs.

    Makes the API tolerant of real-world configuration:
      - `file:...` (Prisma-style SQLite)  → `sqlite+aiosqlite:///...`
      - `postgres://` (legacy Heroku)     → `postgresql+asyncpg://...`
      - `postgresql://`                   → `postgresql+asyncpg://...`
    """
    url = (url or "").strip()
    if url.startswith("file:"):
        path = url[len("file:"):]
        return f"sqlite+aiosqlite:///{path}"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


class Settings(BaseSettings):
    """Central settings object — everything overridable via environment."""

    # --- Application ---
    APP_NAME: str = "Deckio Flashcards API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # --- Database ---
    # PostgreSQL in production (see docker-compose.yml); SQLite fallback for local dev.
    DATABASE_URL: str = "sqlite+aiosqlite:///./flashcards.db"

    # --- Security / JWT ---
    # Always override SECRET_KEY via environment in production!
    SECRET_KEY: str = "dev-insecure-secret-change-me-9f2c1a"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # --- CORS ---
    CORS_ORIGINS: str = "*"  # comma-separated list of origins, "*" allows all

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    """Cached settings factory (keeps .env parsing to a single pass)."""
    s = Settings()
    s.DATABASE_URL = _normalize_database_url(s.DATABASE_URL)
    return s


settings = get_settings()
