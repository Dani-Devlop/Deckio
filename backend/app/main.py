"""Deckio Flashcards API — application entrypoint (Step 1: scaffold + health).

Routers are registered incrementally in later steps (auth, decks, cards,
study, quiz, stats). Every router is mounted twice:
  - at the root      → canonical REST paths (e.g. `/decks`)
  - under `/api`     → gateway-friendly paths used by the bundled web client
Both expose identical behaviour, so the API works standalone AND behind the
sandbox preview gateway without any code changes.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine, run_startup_migrations
from .routers import auth, cards, decks, quiz, stats, study


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Prepare the database on startup.

    1. `create_all` — creates any missing tables (safe & idempotent).
    2. `run_startup_migrations` — idempotent column ALTERs for existing SQLite
       dev databases (Postgres deployments start from a fresh volume).
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_startup_migrations()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Lightweight flashcards API: decks, cards, study sessions, "
        "multiple-choice quizzes and learning analytics. "
        "JWT auth with bcrypt password hashing."
    ),
    lifespan=lifespan,
)

# Permissive CORS by default — tighten via the CORS_ORIGINS env var in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Routers (mounted at root AND under /api for gateway compatibility) ----
app.include_router(auth.router)
app.include_router(decks.router)
app.include_router(cards.router)
app.include_router(study.router)
app.include_router(quiz.router)
app.include_router(stats.router)
app.include_router(auth.router, prefix="/api")
app.include_router(decks.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(study.router, prefix="/api")
app.include_router(quiz.router, prefix="/api")
app.include_router(stats.router, prefix="/api")


@app.get("/health", tags=["Meta"])
@app.get("/api/health", tags=["Meta"])
async def health() -> dict:
    """Liveness probe used by Docker health checks and monitoring."""
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}
