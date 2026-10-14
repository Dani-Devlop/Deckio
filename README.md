# 📚 Deckio — Simple Flashcards API & Web App

<p>
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-0.115+-009485?logo=fastapi&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img alt="SQLAlchemy" src="https://img.shields.io/badge/SQLAlchemy-2.0async-D71F00" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white" />
</p>

A lightweight, product-focused **flashcards platform**: manage decks, practice with flip-card
study sessions, take auto-generated multiple-choice quizzes, and track learning progress —
exposed through a clean REST API and bundled with a polished web client.

| Live stack | |
|---|---|
| **API** | FastAPI (async) · Pydantic v2 · SQLAlchemy 2.0 async · JWT (bcrypt) |
| **Database** | PostgreSQL (production) · SQLite (zero-config dev fallback) |
| **Web** | Next.js 16 · TypeScript · Tailwind CSS 4 · shadcn/ui · Zustand |
| **Ops** | Docker & Docker Compose · interactive Swagger UI at `/docs` |

---

## ✨ Features

- 🔐 **JWT authentication** — register / login, bcrypt-hashed passwords, bearer-token sessions
- 🗂 **Deck management** — CRUD with color accents, emoji icons, search, sorting, live stats
- 🃏 **Flashcards** — CRUD per deck, plus **CSV bulk import & export** (delimiter auto-detection, per-row error reports, round-trip files)
- 📖 **Study mode** — server-tracked sessions, random card order, self-grading, progress resume
- ✨ **Spaced repetition (SM-2)** — *Smart review* sessions cover only due cards; correct answers grow the interval (1d → 3d → interval × ease), lapses reschedule in 10 minutes
- 🧠 **Quiz mode** — auto-generated questions with **4 options** (1 correct + 3 distractors), instant feedback, full result breakdown
- 📊 **Analytics** — accuracy, review streaks, 7-day activity, mastered cards, per-deck stats, **weak-card detection**
- 🖥 **Web app included** — responsive, dark-mode ready client that speaks to the API out of the box
- 🐳 **One-command deployment** — `docker compose up --build`

## 🏗 Architecture

```
┌─────────────┐   fetch /api/*    ┌──────────────────┐   SQLAlchemy (async)   ┌────────────┐
│  Next.js 16 │ ────────────────▶ │   FastAPI (async) │ ─────────────────────▶ │ PostgreSQL │
│  web client │ ◀──── JWT/JSON ── │  JWT · Pydantic   │ ◀───────────────────── │    16      │
└─────────────┘                   └──────────────────┘                         └────────────┘
     :3000                              :8000                                      :5432
```

**Entity model**

```
User 1───* Deck 1───* Card
User 1───* StudySession *───1 Deck
StudySession 1───* CardReview *───1 Card        (result: correct | wrong)
```

> Small pragmatic extensions to the base schema: `StudySession.mode` (`study`/`quiz`),
> `StudySession.total_planned` (quiz length) and `CardReview.selected_answer` (what the user
> picked) power the quiz result screen and correct session accounting.

## 🚀 Quickstart

### Option A — Docker Compose (recommended)

```bash
git clone https://github.com/Dani-Devlop/Deckio.git
cd Deckio

# optional but recommended for production:
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"

docker compose up --build
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |

> The web client is built with `NEXT_PUBLIC_API_URL=http://localhost:8000` by default.
> Change it via env var before building if your API lives elsewhere.

### Option B — Manual development

**Backend** (Python 3.12+ — uses SQLite automatically, no Postgres needed):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# or simply:  ../scripts/dev-backend.sh
```

**Frontend** (Bun or Node 20+):

```bash
bun install
NEXT_PUBLIC_API_URL=http://localhost:8000 bun run dev   # http://localhost:3000
```

## 🔑 Environment variables

### API (`backend/.env`, see `.env.example`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./flashcards.db` | Async SQLAlchemy URL. `postgres://` / `postgresql://` / Prisma-style `file:` URLs are auto-normalized. |
| `SECRET_KEY` | dev value | **Change in production.** JWT signing key. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 days) | JWT lifetime |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `DEBUG` | `false` | SQL echo logging |

### Web (`NEXT_PUBLIC_*` — build time)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | *(unset → sandbox gateway mode)* | Absolute API base, e.g. `http://localhost:8000`. Unset = same-origin `/api` + `XTransformPort` gateway routing. |
| `NEXT_PUBLIC_API_PORT` | `8001` | Gateway mode only: backend port behind the preview gateway |

## 📡 API overview

All endpoints are JSON over HTTP and (except auth) require `Authorization: Bearer <token>`.
Full reference with examples: **[docs/API.md](docs/API.md)** · Interactive: **`/docs`** (Swagger).

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create account → JWT + user |
| `POST` | `/auth/login` | Log in → JWT + user |
| `GET` | `/auth/me` | Current user (session restore) |
| `GET` | `/decks` | List decks with card counts & accuracy |
| `POST` | `/decks` | Create deck |
| `GET/PUT/DELETE` | `/decks/{id}` | Read / update / delete deck |
| `GET` | `/decks/{id}/cards` | List cards |
| `POST` | `/decks/{id}/cards` | Add card |
| `GET` | `/decks/{id}/cards/export` | **Export deck as CSV** (`front,back`) |
| `POST` | `/decks/{id}/cards/bulk` | **CSV bulk import** (multipart `file` or raw `text/csv`) |
| `PUT/DELETE` | `/cards/{id}` | Update / delete card |
| `POST` | `/decks/{id}/study/start` | Open a study session (`?srs=true` → only due cards) |
| `GET` | `/decks/{id}/study/next` | Next un-reviewed card (random order) |
| `POST` | `/study/review` | Record `correct` / `wrong` |
| `POST` | `/decks/{id}/quiz/start` | Generate questions (1 correct + 3 distractors, `?limit=`) |
| `POST` | `/quiz/answer` | Submit an answer (validated server-side) |
| `GET` | `/quiz/{session_id}/result` | Score, duration, per-question breakdown |
| `GET` | `/stats/overview` | Totals, accuracy, streak, 7-day activity, mastered cards |
| `GET` | `/stats/decks/{id}` | Per-deck stats + recent sessions |
| `GET` | `/stats/weak-cards` | Cards with the lowest accuracy |

Every router is mounted **twice** — at the root (`/decks`) and under `/api` (`/api/decks`) —
so the API works standalone and behind the sandbox preview gateway without code changes.

## 📥 CSV import format

```csv
front,back
What does ORM stand for?,Object-Relational Mapping
¿Cómo se dice "hello" en español?;hola        ← semicolons also work
front<tab>back                                ← and tabs; header row optional
```

- Delimiter **auto-detected** (comma / semicolon / tab), quotes supported
- Optional header row is recognized (`front,back`, `question,answer`, …)
- Invalid rows are reported **with row numbers**; exact duplicates are skipped
- Limits: 1 MB per upload, 1000 cards per import

## 📁 Project structure

```
Deckio/
├── backend/                  # FastAPI application
│   ├── app/
│   │   ├── main.py           # app factory: CORS, routers (root + /api), health
│   │   ├── config.py         # pydantic-settings (env, URL normalization)
│   │   ├── database.py       # async engine + session dependency
│   │   ├── models.py         # User, Deck, Card, StudySession, CardReview
│   │   ├── schemas.py        # Pydantic request/response schemas
│   │   ├── security.py       # bcrypt hashing + JWT encode/decode
│   │   ├── deps.py           # auth + ownership dependencies
│   │   ├── utils/csv_import.py
│   │   └── routers/          # auth, decks, cards, study, quiz, stats
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── src/                      # Next.js 16 web app (App Router)
│   ├── app/                  # layout + single-page client app
│   ├── components/flashcards/# auth, dashboard, deck detail, study, quiz, stats
│   └── lib/                  # typed API client, zustand store, helpers
├── docs/API.md               # full API reference
├── scripts/dev-backend.sh    # local backend dev helper
├── docker-compose.yml        # db + api + web
└── Dockerfile                # web image (Bun build → node runner)
```

## 🧪 Quality

- **36-check end-to-end API smoke suite** (auth, CRUD, CSV edge cases, session flow, stats math) — all passing
- ESLint clean (Next.js 16 + react-hooks rules)
- Ownership enforced on every resource; foreign ids return `404` (no existence leaks)
- Typed end-to-end: Pydantic schemas ↔ TypeScript interfaces in `src/lib/types.ts`

## 🔭 Roadmap ideas

- Spaced repetition scheduling (SM-2) · image occlusion cards · deck sharing
- Refresh tokens / OAuth · per-card hints & tags · export decks as CSV/Anki

---

Built with ❤️ by [Dani-Devlop](https://github.com/Dani-Devlop) — FastAPI · PostgreSQL · Next.js
