"""Async SQLAlchemy engine & session management.

Supports PostgreSQL (production, via `DATABASE_URL`) and SQLite (local dev
fallback). FastAPI dependencies yield one `AsyncSession` per request.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

_connect_args: dict = {}
if settings.DATABASE_URL.startswith("sqlite"):
    # SQLite requires this flag for FastAPI's (threaded) request handling.
    _connect_args["check_same_thread"] = False

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args=_connect_args,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one database session per request, always closed."""
    async with AsyncSessionLocal() as session:
        yield session


async def run_startup_migrations() -> None:
    """Lightweight, **idempotent** column migrations for the SQLite dev DB.

    `create_all()` creates missing tables but never alters existing ones.
    These targeted ALTERs keep an existing local dev database in sync with
    model changes (e.g. the SM-2 spaced-repetition columns added to `cards`).
    Docker/PostgreSQL deployments always start from a fresh volume, where
    `create_all()` already produces the full schema.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    def _migrate(sync_conn) -> None:
        from sqlalchemy import inspect

        insp = inspect(sync_conn)

        card_cols = {c["name"] for c in insp.get_columns("cards")}
        card_additions = {
            "ease": "ALTER TABLE cards ADD COLUMN ease FLOAT NOT NULL DEFAULT 2.5",
            "interval_days": "ALTER TABLE cards ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 0",
            "reps": "ALTER TABLE cards ADD COLUMN reps INTEGER NOT NULL DEFAULT 0",
            "lapses": "ALTER TABLE cards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0",
            "due_at": "ALTER TABLE cards ADD COLUMN due_at DATETIME",
            "tags": "ALTER TABLE cards ADD COLUMN tags TEXT",
            "hint": "ALTER TABLE cards ADD COLUMN hint TEXT",
            "image_url": "ALTER TABLE cards ADD COLUMN image_url VARCHAR(500)",
        }
        for name, ddl in card_additions.items():
            if name not in card_cols:
                sync_conn.exec_driver_sql(ddl)

        session_cols = {c["name"] for c in insp.get_columns("study_sessions")}
        if "srs" not in session_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE study_sessions ADD COLUMN srs BOOLEAN NOT NULL DEFAULT 0"
            )
        if "plan_json" not in session_cols:
            sync_conn.exec_driver_sql("ALTER TABLE study_sessions ADD COLUMN plan_json TEXT")
        if "quiz_direction" not in session_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE study_sessions ADD COLUMN quiz_direction VARCHAR(5)"
            )
        if "time_limit_seconds" not in session_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE study_sessions ADD COLUMN time_limit_seconds INTEGER"
            )

        user_cols = {c["name"] for c in insp.get_columns("users")}
        if "daily_goal" not in user_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 20"
            )

        deck_cols = {c["name"] for c in insp.get_columns("decks")}
        if "share_token" not in deck_cols:
            sync_conn.exec_driver_sql("ALTER TABLE decks ADD COLUMN share_token TEXT")
            sync_conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_decks_share_token ON decks (share_token)"
            )
        if "new_per_day" not in deck_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE decks ADD COLUMN new_per_day INTEGER NOT NULL DEFAULT 20"
            )
        if "max_reviews" not in deck_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE decks ADD COLUMN max_reviews INTEGER NOT NULL DEFAULT 100"
            )
        if "quiz_questions" not in deck_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE decks ADD COLUMN quiz_questions INTEGER NOT NULL DEFAULT 10"
            )
        if "quiz_answer_side" not in deck_cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE decks ADD COLUMN quiz_answer_side VARCHAR(5) NOT NULL DEFAULT 'front'"
            )

    async with engine.begin() as conn:
        await conn.run_sync(_migrate)
