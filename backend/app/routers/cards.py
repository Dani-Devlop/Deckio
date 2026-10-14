"""Card CRUD endpoints + CSV bulk import."""

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_owned_card, get_owned_deck
from ..models import Card, Deck, User
from ..schemas import BulkImportResult, CardCreate, CardOut, CardUpdate
from ..utils.csv_import import MAX_ROWS_PER_IMPORT, parse_cards_csv

router = APIRouter(tags=["Cards"])

# Hard limit for one upload (1 MB is plenty for thousands of flashcards).
MAX_UPLOAD_BYTES = 1_000_000


# ------------------------- Card CRUD -------------------------


@router.get(
    "/decks/{deck_id}/cards",
    response_model=list[CardOut],
    summary="List all cards in a deck",
)
async def list_cards(
    deck: Deck = Depends(get_owned_deck),
    db: AsyncSession = Depends(get_db),
) -> list[Card]:
    return (
        await db.scalars(
            select(Card).where(Card.deck_id == deck.id).order_by(Card.created_at, Card.id)
        )
    ).all()


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
) -> Card:
    card = Card(deck_id=deck.id, **payload.model_dump())
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


@router.put("/cards/{card_id}", response_model=CardOut, summary="Update a card")
async def update_card(
    payload: CardUpdate,
    card: Card = Depends(get_owned_card),
    db: AsyncSession = Depends(get_db),
) -> Card:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(card, field, value)
    await db.commit()
    await db.refresh(card)
    return card


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
    comma / semicolon / tab). An optional header row is tolerated.
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

    # Single bulk insert — one flush for the whole file.
    db.add_all([Card(deck_id=deck.id, front=front, back=back) for front, back in cards])
    await db.commit()

    return BulkImportResult(imported=len(cards), skipped=len(errors), errors=errors[:50])
