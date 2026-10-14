"""CSV parsing for the bulk card import endpoint.

Accepted formats (delimiter auto-detected: comma, semicolon or tab):

    front,back
    "What is ORM?","Object-Relational Mapping"
    What is FastAPI?;A modern async Python web framework
    hola,hello,vocabulary|basics          ← optional 3rd column = tags
    hola,hello,vocabulary,think "oh-la"   ← optional 4th column = hint
    hola,hello,,,"https://...jpg"         ← optional 5th column = image URL

An optional header row is tolerated; it is detected when the first cells are
column names (front/back/question/answer/tags/hint/image/...). The optional
third column holds tags separated by `|` (e.g. `verbs|beginner`); the optional
fourth column is a hint shown on the question side while studying; the fifth
is an image URL rendered above the text. Exact duplicate rows within a file
are silently de-duplicated; invalid rows are reported with row numbers.
"""

import csv
import io

MAX_FRONT_LEN = 1000
MAX_BACK_LEN = 2000
MAX_HINT_LEN = 300
MAX_IMAGE_URL_LEN = 500
MAX_ROWS_PER_IMPORT = 1000

CsvCard = tuple[str, str, list[str], str | None, str | None]  # (front, back, tags, hint, image_url)

_HEADER_TOKENS = {
    "front",
    "back",
    "question",
    "answer",
    "term",
    "definition",
    "word",
    "translation",
    "prompt",
    "response",
    "tags",  # optional 3rd column
    "hint",  # optional 4th column
    "image",  # optional 5th column
    "image_url",
    "picture",
}


def parse_cards_csv(text: str) -> tuple[list[CsvCard], list[str]]:
    """Parse raw CSV text into `(cards, errors)`.

    Returns:
        cards:  validated (front, back, tags, hint, image_url) tuples, de-duplicated, in file order.
        errors: human-readable messages with row numbers for the UI.
    """
    errors: list[str] = []
    cards: list[CsvCard] = []
    seen: set[tuple[str, str]] = set()

    # Normalize line endings and strip a possible UTF-8 BOM.
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return [], ["The file is empty."]

    # Sniff the delimiter from a small sample; fall back to plain comma.
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel

    rows = [
        row
        for row in csv.reader(io.StringIO(text), dialect)
        if any(cell.strip() for cell in row)  # skip blank lines
    ]

    for i, row in enumerate(rows, start=1):
        if i == 1 and _looks_like_header(row):
            continue  # optional header row
        if len(row) < 2:
            errors.append(f"Row {i}: expected 2 columns (front, back), got {len(row)}.")
            continue

        front, back = row[0].strip(), row[1].strip()
        if not front or not back:
            errors.append(f"Row {i}: front and back must not be empty.")
            continue
        if len(front) > MAX_FRONT_LEN:
            errors.append(f"Row {i}: front exceeds {MAX_FRONT_LEN} characters.")
            continue
        if len(back) > MAX_BACK_LEN:
            errors.append(f"Row {i}: back exceeds {MAX_BACK_LEN} characters.")
            continue

        # Optional third column: tags separated by `|` inside the cell.
        tags: list[str] = []
        if len(row) >= 3:
            tags = [t.strip() for t in row[2].split("|") if t.strip()]

        # Optional fourth column: hint (trimmed, capped, empty → None).
        hint: str | None = None
        if len(row) >= 4:
            hint = row[3].strip()[:MAX_HINT_LEN] or None

        # Optional fifth column: image URL (light scheme check, empty → None).
        image_url: str | None = None
        if len(row) >= 5:
            raw_url = row[4].strip()
            if raw_url:
                if len(raw_url) > MAX_IMAGE_URL_LEN:
                    errors.append(f"Row {i}: image URL exceeds {MAX_IMAGE_URL_LEN} characters.")
                    continue
                if not raw_url.lower().startswith(("http://", "https://", "data:image/", "//", "/")):
                    errors.append(
                        f"Row {i}: image URL must start with http://, https://, data:image/ or / "
                    )
                    continue
                image_url = raw_url

        pair = (front, back)
        if pair in seen:
            continue  # silent duplicate skip
        seen.add(pair)
        cards.append((front, back, tags, hint, image_url))

    return cards, errors


def _looks_like_header(row: list[str]) -> bool:
    """True when the first row's first two cells are recognized column names."""
    cells = [cell.strip().lower() for cell in row[:2]]
    return len(cells) == 2 and all(c in _HEADER_TOKENS for c in cells)
