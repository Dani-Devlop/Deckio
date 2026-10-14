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
