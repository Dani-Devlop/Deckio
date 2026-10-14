# Deckio API Reference

Base URL (standalone): `http://localhost:8000`
All routers are also mounted under the `/api` prefix (`/api/auth/register`, `/api/decks`, …)
for gateway deployments — both behave identically.

- Content type: `application/json` (except CSV import)
- Auth: `Authorization: Bearer <access_token>` on every endpoint except `/auth/*`
- Interactive documentation: **`/docs`** (Swagger UI) · `/redoc`
- Errors use FastAPI conventions: `{"detail": "<message>"}` with proper status codes

---

## Authentication

> **Rate limiting:** `POST /auth/register` and `POST /auth/login` are limited to
> **10 requests per 5 minutes per client IP** (in-memory sliding window). Exceeding it
> returns `429` with a `Retry-After` header and a `Too many attempts…` detail.

### `POST /auth/register` — create an account

Request:
```json
{ "email": "ana@example.com", "password": "supersecret123" }
```

Response `201 Created`:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": { "id": 1, "email": "ana@example.com", "created_at": "2025-01-01T12:00:00Z" }
}
```

Errors: `409` email already registered · `422` validation (email format, password < 8 chars)

### `POST /auth/login` — obtain a token

Request: `{ "email": "ana@example.com", "password": "supersecret123" }`
Response `200`: same shape as register.
Errors: `401 Incorrect email or password` (same message for unknown emails — no user enumeration).

### `GET /auth/me` — current user

Response `200`: the `user` object. Use after page reloads to restore a stored token.
Errors: `401` missing/expired/invalid token.

### `PUT /auth/password` — change the account password

Request:
```json
{ "current_password": "supersecret123", "new_password": "evenbetter456" }
```

Response `204 No Content`. Existing JWTs stay valid — only future logins need the new password.
Errors: `403` current password incorrect · `422` new password < 8 chars or identical to the current one.

### `POST /auth/account/delete` — permanently delete the account

Request: `{ "password": "supersecret123" }` (re-verification).
Response `204 No Content`. The user row is deleted — decks, cards, sessions and
reviews all cascade at the DB level. Issued tokens become unusable immediately.
Errors: `403` password incorrect.

---

## Decks

### `GET /decks` — list my decks (newest first)

Response `200`:
```json
[
  {
    "id": 1, "title": "Spanish Basics", "description": "Everyday words",
    "color": "#10b981", "icon": "🇪🇸", "created_at": "2025-01-01T12:00:00Z",
    "card_count": 11, "reviews_count": 42, "accuracy": 83.3,
    "last_studied_at": "2025-01-07T09:30:00Z", "due_count": 4
  }
]
```

### `POST /decks` — create a deck

Request:
```json
{ "title": "Spanish Basics", "description": "Everyday words", "color": "#10b981", "icon": "🇪🇸" }
```
Only `title` is required; `color` must match `^#[0-9a-fA-F]{6}$`, `icon` is a short emoji.
Response `201 Created` → `Deck` (as above, zero stats).

### `GET /decks/{id}` — deck details · `PUT /decks/{id}` — update (partial body allowed) · `DELETE /decks/{id}` — delete

- `DELETE` removes the deck **and cascades** to its cards, sessions and reviews → `204 No Content`
- Errors: `404` (deck not found **or not owned by you** — ownership violations are indistinguishable by design)

### `POST /decks/{id}/duplicate` — duplicate a deck → `201`

Copies the deck (title becomes `"<title> (copy)"`, color/icon/description carried over)
**with all of its cards, including their tags**. Copied cards start as brand-new (SRS state
zeroed, `due_at = NULL` → due immediately), so the copy is fully studiable right away;
review history does not carry over.

Response `201`: the new `Deck` object (same shape as the list endpoint, `card_count` and
`due_count` already populated).

---

## Cards

### `GET /decks/{deck_id}/cards` — list cards (creation order) → `200` `[Card]`

Optional query filters:
- `?q=text` — case-insensitive substring match on front/back
- `?tag=vocabulary` — exact, case-insensitive tag match

```json
{ "id": 5, "deck_id": 1, "front": "hola", "back": "hello", "tags": ["greetings", "a1"], "created_at": "...",
  "ease": 2.5, "interval_days": 0, "reps": 0, "lapses": 0, "due_at": null }
```

The SM-2 scheduling fields are read-only surfaces for the UI: `due_at: null` means a new
card (due immediately); otherwise the client renders `due` / `in Nd` chips from it.

### `POST /decks/{deck_id}/cards` — add a card

Request: `{ "front": "hola", "back": "hello", "tags": ["greetings"] }`
(front ≤ 1000 chars, back ≤ 2000, up to 8 tags of ≤ 32 chars — trimmed and deduped
case-insensitively by the server) → `201`

### `GET /decks/{deck_id}/cards/export` — export deck as CSV

Response `200` with `Content-Type: text/csv` and `Content-Disposition: attachment`:

```csv
front,back,tags
hola,hello,greetings|a1
gato,cat,
```

Header row included. The third `tags` column appears only when at least one card has
tags (`|` separates tags inside the cell). Output remains a valid round-trip input for
the bulk import endpoint.

### `POST /decks/{deck_id}/cards/bulk` — CSV import

Two accepted formats:

1. **Multipart form** (recommended): field name `file`, e.g.
   `curl -F "file=@cards.csv" -H "Authorization: Bearer $T" .../cards/bulk`
2. **Raw body**: `Content-Type: text/csv` (or `text/plain`) with the CSV as body.

Response `200`:
```json
{ "imported": 3, "skipped": 1, "errors": ["Row 4: front and back must not be empty."] }
```

Rules: delimiter auto-detected (`,` `;` tab) · optional header row · optional third column for tags (`|`-separated) · duplicates skipped
silently · limits: 1 MB, 1000 rows · `422` if the file yields zero importable rows.

### `PUT /cards/{id}` — update (partial) · `DELETE /cards/{id}` — delete (`204`)

---

## Deck bundles (share)

### `GET /decks/{id}/bundle` — export a portable JSON bundle → `200`

```json
{
  "version": 1, "app": "deckio",
  "title": "Spanish Basics", "description": "...", "color": "#f59e0b", "icon": "\xf0\x9f\x93\x9a",
  "card_count": 2,
  "cards": [
    { "front": "hola", "back": "hello", "tags": ["greetings"] },
    { "front": "gato", "back": "cat", "tags": [] }
  ]
}
```

Response carries `Content-Disposition: attachment` with a `<slug>-deckio.json` filename.
SRS progress and review history are intentionally **not** included.

### `POST /decks/import` — create a deck from a bundle → `201`

Body: a previously exported bundle (min 1 card, max 1000). Creates a new deck owned by
the caller with every card inserted as **new** (`due_at = null` → due immediately).
Response: the new `DeckOut` (with the real `due_count`). Errors: `422` validation
(empty cards array, bad color/icon, …).

---

## Search

### `GET /search?q=<text>` — global search → `200`

Searches the caller's decks (title / description) and cards (front / back / tags).
Optional `?limit=` (1–25, default 8 per section).

```json
{
  "decks": [ { "id": 1, "title": "Spanish Basics", "card_count": 8, "due_count": 3, "...": "..." } ],
  "cards": [
    { "card_id": 5, "deck_id": 1, "deck_title": "Spanish Basics",
      "front": "hola", "back": "hello", "tags": ["greetings"] }
  ]
}
```

---

## Study mode

### `POST /decks/{deck_id}/study/start?srs=true` → `201`

```json
{ "session_id": 10, "deck_id": 1, "mode": "study", "srs": true, "total_cards": 8 }
```

- **Regular session** (`srs=false`, default): covers the whole deck in random order.
- **Smart review** (`srs=true`): covers only cards that are *due* — new cards
  (never reviewed) or overdue per the SM-2 schedule — oldest due first.
  `total_cards` is the fixed due count at start.
  `400 "Nothing due right now — you're all caught up! 🎉"` when the deck has no due cards.
Errors: `400 This deck has no cards yet`.

### `GET /decks/{deck_id}/study/next?session_id=10` → `200`

```json
{ "session_id": 10, "card": { "id": 5, "front": "hola", "back": "hello", "...": "..." },
  "reviewed": 3, "total": 11, "finished": false }
```

- Cards are picked **at random** among those not yet reviewed in the session.
- `session_id` is optional — omitted, the latest active session for the deck is used.
- `finished: true` → `card` is `null` and the session is closed (`finished_at` set).

### `POST /study/review` — record a self-grade

Request: `{ "session_id": 10, "card_id": 5, "result": "correct" }` (`"correct" | "wrong"`)

Response `200`:
```json
{ "card_id": 5, "result": "correct", "reviewed": 4, "total": 11, "finished": false }
```
Re-reviewing a card in the same session **updates** the previous result (one review row per
card per session). Errors: `400` card not in the session's deck / not a study session.

**Scheduling:** study-mode reviews update the card's SM-2 state — correct answers grow the
interval (`1d → 3d → interval × ease`, ease +0.1), wrong answers reset the card and re-due it
in 10 minutes (ease −0.2, floor 1.3). Quiz answers are practice-only and do not reschedule.

Scheduling state per card (returned in card payloads only when scheduled):
`ease` (1.3–3.0), `interval_days`, `reps`, `lapses`, `due_at`.

---

## Quiz mode

### `POST /decks/{deck_id}/quiz/start?limit=10` → `201`

Generates up to `limit` (default 10, max 50) questions. Each has **4 options**:
1 correct answer + 3 distractors sampled from the same deck (topped up from the user's other
decks when the deck is small). The correct answer is never sent before answering.

```json
{
  "session_id": 11, "deck_id": 1, "mode": "quiz", "total_questions": 10,
  "questions": [
    { "card_id": 5, "front": "hola", "options": ["cat", "hello", "dog", "milk"] }
  ]
}
```

### `POST /quiz/answer` — submit an answer

Request: `{ "session_id": 11, "card_id": 5, "answer": "hello" }`

Response `200`:
```json
{ "correct": true, "correct_answer": "hello", "selected_answer": "hello",
  "answered": 1, "total": 10, "finished": false }
```
The session closes automatically when all planned questions are answered. The stored review
keeps the selected answer for the result screen.

### `GET /quiz/{session_id}/result` — score & breakdown → `200`

```json
{
  "session_id": 11, "deck_id": 1, "total": 10, "answered": 10,
  "correct": 8, "wrong": 2, "accuracy": 80.0, "duration_seconds": 213.4,
  "finished_at": "2025-01-07T10:02:11Z",
  "details": [
    { "card_id": 5, "front": "hola", "correct_answer": "hello",
      "selected_answer": "hello", "result": "correct" },
    { "card_id": 7, "front": "gato", "correct_answer": "cat",
      "selected_answer": "dog", "result": "wrong" }
  ]
}
```

---

## Statistics

### `GET /stats/overview` → `200`

Optional query: `?days=91` — length of the activity window (default `7`, min `7`, max `366`).
The web client requests `?days=182` for its 26-week heatmap and slices the last 7 entries
for the weekly bar chart.

```json
{
  "total_decks": 3, "total_cards": 87, "total_sessions": 14,
  "total_reviews": 412, "correct_reviews": 344, "accuracy": 83.5,
  "streak_days": 4, "mastered_cards": 21, "due_cards": 9,
  "activity": [ { "date": "2025-01-01", "reviews": 18, "correct": 15 },
                { "date": "2025-01-02", "reviews": 0,  "correct": 0 } ]
}
```
- `streak_days` — consecutive days with reviews ending today (yesterday still counts as grace)
- `mastered_cards` — cards with ≥ 3 reviews and ≥ 80% accuracy
- `due_cards` — cards due right now across all decks (new or overdue per SM-2)
- `activity` — last `days` days (UTC), ascending, missing days zero-filled

### `GET /stats/sessions?limit=15` — recent sessions across all decks → `200`

Newest first, with per-session accuracy and duration (null while a session is still open).

```json
[ { "id": 12, "deck_id": 1, "deck_title": "Spanish Basics", "mode": "study", "srs": true,
    "started_at": "...", "finished_at": "...", "reviews": 8, "correct": 7,
    "accuracy": 87.5, "duration_seconds": 62.4 } ]
```

### `GET /stats/decks/{deck_id}` → `200`

```json
{
  "deck_id": 1, "title": "Spanish Basics", "total_cards": 11,
  "total_reviews": 42, "correct_reviews": 35, "accuracy": 83.3,
  "sessions_count": 5, "weak_cards_count": 2,
  "last_studied_at": "2025-01-07T09:30:00Z",
  "recent_sessions": [
    { "id": 11, "mode": "quiz", "started_at": "...", "finished_at": "...",
      "reviews": 10, "accuracy": 80.0 }
  ]
}
```

### `GET /stats/weak-cards` → `200` (max 20, worst first)

```json
[
  { "card_id": 7, "deck_id": 1, "deck_title": "Spanish Basics",
    "front": "gato", "back": "cat", "times_reviewed": 5, "times_wrong": 3,
    "accuracy": 40.0 }
]
```

---

## Status code conventions

| Code | Meaning |
|---|---|
| `201` | Resource created |
| `204` | Deleted (no body) |
| `400` | Business-rule violation (empty deck, wrong session mode, …) |
| `401` | Missing / invalid / expired JWT |
| `404` | Resource not found **or not owned** (no existence leak) |
| `409` | Duplicate email on register |
| `413` | CSV upload > 1 MB |
| `422` | Validation error (Pydantic detail array) or empty CSV |
