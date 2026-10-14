"""Card CRUD endpoints + CSV bulk import + CSV export."""

import csv
import io
import re

from sqlalchemy import func, or_

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_owned_card, get_owned_deck
from ..models import Card, Deck, User
from ..schemas import BulkImportResult, CardCreate, CardOut, CardUpdate, tags_to_storage
from ..utils.csv_import import MAX_ROWS_PER_IMPORT, parse_cards_csv

router = APIRouter(tags=["Cards"])

# Hard limit for one upload (1 MB is plenty for thousands of flashcards).
MAX_UPLOAD_BYTES = 1_000_000


# ------------------------- Card CRUD -------------------------


@router.get(
    "/decks/{deck_id}/cards",
    response_model=list[CardOut],
    summary="List all cards in a deck (optional text search and tag filter)",
)
async def list_cards(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(default=None, max_length=100, description="Search front/back text"),
    tag: str | None = Query(default=None, max_length=64, description="Exact tag match (case-insensitive)"),
) -> list[CardOut]:
    stmt = select(Card).where(Card.deck_id == deck.id)

    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Card.front.ilike(like), Card.back.ilike(like)))
    if tag:
        # Tags are stored comma-separated; LIKE with the padded delimiter also
        # prevents prefix collisions (e.g. tag="verb" must not match "verbs").
        needle = f"%,{tag.strip().lower()},%"
        stmt = stmt.where(func.lower("," + func.coalesce(Card.tags, "") + ",").like(needle))

    rows = (
        await db.scalars(stmt.order_by(Card.created_at, Card.id))
    ).all()
    return [CardOut.model_validate(c) for c in rows]


@router.post(
    "/decks/{deck_id}/cards",
    response_model=CardOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a card to a deck",
)
async def create_card(
    payload: CardCreate,
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    card = Card(
        deck_id=deck.id,
        front=payload.front,
        back=payload.back,
        tags=tags_to_storage(payload.tags),
        hint=payload.hint,
        image_url=payload.image_url,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return CardOut.model_validate(card)


@router.put("/cards/{card_id}", response_model=CardOut, summary="Update a card")
async def update_card(
    payload: CardUpdate,
    card: Card = Depends(get_owned_card),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    data = payload.model_dump(exclude_unset=True)
    if "tags" in data:
        # list[str] → comma-separated storage (None clears all tags).
        data["tags"] = tags_to_storage(data["tags"] or [])
    for field, value in data.items():
        setattr(card, field, value)
    await db.commit()
    await db.refresh(card)
    return CardOut.model_validate(card)


@router.delete(
    "/cards/{card_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a card",
)
async def delete_card(
    card: Card = Depends(get_owned_card),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.delete(card)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------- CSV export -------------------------


@router.get(
    "/decks/{deck_id}/cards/export",
    response_class=PlainTextResponse,
    summary="Export a deck's cards as CSV (front,back)",
)
async def export_cards_csv(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    """Round-trip companion to the bulk import: the exported file can be
    re-imported into any other deck (or into Anki-style tools) as-is.
    Optional `tags` (3rd, `|`-separated) and `hint` (4th) columns are included
    only when at least one card uses them; the bulk importer accepts them back."""
    cards = (
        await db.scalars(
            select(Card).where(Card.deck_id == deck.id).order_by(Card.created_at, Card.id)
        )
    ).all()

    include_tags = any(c.tags for c in cards)
    include_hints = any(c.hint for c in cards)
    include_images = any(c.image_url for c in cards)
    header = ["front", "back"]
    if include_tags:
        header.append("tags")
    if include_hints:
        header.append("hint")
    if include_images:
        header.append("image_url")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for card in cards:
        row = [card.front, card.back]
        if include_tags:
            row.append("|".join(t.strip() for t in (card.tags or "").split(",") if t.strip()))
        if include_hints:
            row.append(card.hint or "")
        if include_images:
            row.append(card.image_url or "")
        writer.writerow(row)

    # Filesystem-safe filename derived from the deck title.
    slug = re.sub(r"[^a-zA-Z0-9-_]+", "-", deck.title).strip("-").lower() or "deck"
    return PlainTextResponse(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-cards.csv"'},
    )


# ------------------------- CSV bulk import -------------------------


@router.post(
    "/decks/{deck_id}/cards/bulk",
    response_model=BulkImportResult,
    summary="Bulk-import cards from CSV (multipart `file` field, or raw text/csv body)",
)
async def bulk_import_cards(
    request: Request,
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
    file: UploadFile | None = File(default=None),
) -> BulkImportResult:
    """Accepts either:
    - a multipart/form-data upload with a `file` field (recommended), or
    - a raw request body with `Content-Type: text/csv` / `text/plain`.

    CSV format: two columns `front,back` (delimiter auto-detected:
    comma / semicolon / tab). Optional extra columns: `tags` (`|`-separated),
    `hint` and `image_url`. An optional header row is tolerated.
    Rows that fail validation are reported with their row numbers.
    """
    content_type = request.headers.get("content-type", "")
    if file is not None:
        raw = await file.read()
    elif "text/csv" in content_type or "text/plain" in content_type:
        raw = await request.body()
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide a multipart 'file' field or a raw text/csv body",
        )

    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="CSV file too large (max 1 MB)",
        )

    cards, errors = parse_cards_csv(raw.decode("utf-8-sig", errors="replace"))

    if not cards:
        # Nothing importable — surface the parse errors to the client.
        detail = "; ".join(errors[:5]) if errors else "No valid rows found in the CSV."
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)

    if len(cards) > MAX_ROWS_PER_IMPORT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Too many rows — max {MAX_ROWS_PER_IMPORT} cards per import "
            f"(got {len(cards)}).",
        )

    # Single bulk insert — one flush for the whole file. Each parsed row is a
    # (front, back, tags, hint, image_url) tuple; tags is [] / others None when absent.
    db.add_all(
        [
            Card(
                deck_id=deck.id,
                front=front,
                back=back,
                tags=tags_to_storage(tag_list),
                hint=hint,
                image_url=image_url,
            )
            for front, back, tag_list, hint, image_url in cards
        ]
    )
    await db.commit()

    return BulkImportResult(imported=len(cards), skipped=len(errors), errors=errors[:50])
