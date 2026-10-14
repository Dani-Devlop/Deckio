"""CSV parsing for the bulk card import endpoint.

Accepted formats (delimiter auto-detected: comma, semicolon or tab):

    front,back
    "What is ORM?","Object-Relational Mapping"
    What is FastAPI?;A modern async Python web framework
    hola,hello,vocabulary|basics          ← optional 3rd column = tags
    hola,hello,vocabulary,think "oh-la"   ← optional 4th column = hint
    hola,hello,,,"https://...jpg"         ← optional 5th column = image URL

An optional header row is tolerated. When a header is present, columns are
mapped BY NAME (in any order): front/question/term/word/prompt, back/answer/
definition/translation/response, plus the optional tags, hint and
image/image_url/picture columns. Without a header, parsing stays positional
(3rd column = tags, 4th = hint, 5th = image URL). The third column holds tags
separated by `|` (e.g. `verbs|beginner`); the fourth is a hint shown on the
question side while studying; the fifth is an image URL rendered above the
text — either a plain http(s) URL (≤500 chars) or an inline
`data:image/...;base64` payload (same rules as the API's clean_image_url).
Exact duplicate rows within a file are silently de-duplicated; invalid
rows are reported with row numbers.
"""

import csv
import io

MAX_FRONT_LEN = 1000
MAX_BACK_LEN = 2000
MAX_HINT_LEN = 300
MAX_IMAGE_URL_LEN = 500
MAX_ROWS_PER_IMPORT = 1000

CsvCard = tuple[str, str, list[str], str | None, str | None]  # (front, back, tags, hint, image_url)

_FRONT_HEADERS = {"front", "question", "term", "word", "prompt"}
_BACK_HEADERS = {"back", "answer", "definition", "translation", "response"}
_TAGS_HEADERS = {"tags"}
_HINT_HEADERS = {"hint"}
_IMAGE_HEADERS = {"image", "image_url", "picture"}

_HEADER_TOKENS = _FRONT_HEADERS | _BACK_HEADERS | _TAGS_HEADERS | _HINT_HEADERS | _IMAGE_HEADERS


def parse_cards_csv(text: str) -> tuple[list[CsvCard], list[str]]:
    """Parse raw CSV text into `(cards, errors)`.

    Returns:
        cards:  validated (front, back, tags, hint, image_url) tuples, de-duplicated, in file order.
        errors: human-readable messages with row numbers for the UI.
    """
    errors: list[str] = []
    cards: list[CsvCard] = []
    seen: set[tuple[str, str]] = set()

    # Local import: app.schemas imports MAX_ROWS_PER_IMPORT from this module,
    # so a module-level import would be circular. Keeps the inline-image
    # rules (regex + size budget) in ONE place — schemas.clean_image_url.
    from ..schemas import MAX_DATA_URI_LENGTH, is_valid_data_uri

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

    # Optional header row → semantic column mapping; otherwise positional.
    cmap: dict[str, int] | None = None
    first_row_no = 1
    if rows and _looks_like_header(rows[0]):
        cmap = _column_map(rows[0])
        rows = rows[1:]
        first_row_no = 2  # user-facing numbering keeps the header as row 1

    for i, row in enumerate(rows, start=first_row_no):
        if len(row) < 2:
            errors.append(f"Row {i}: expected 2 columns (front, back), got {len(row)}.")
            continue

        def col(key: str) -> str:
            """Header-mapped cell ("" when the column is absent from this row)."""
            idx = cmap.get(key) if cmap else None
            return row[idx].strip() if idx is not None and len(row) > idx else ""

        if cmap is not None:
            front, back = col("front"), col("back")
            tags_src = col("tags")
            hint_src = col("hint")
            image_src = col("image")
        else:
            front, back = row[0].strip(), row[1].strip()
            tags_src = row[2] if len(row) >= 3 else ""
            hint_src = row[3] if len(row) >= 4 else ""
            image_src = row[4] if len(row) >= 5 else ""

        if not front or not back:
            errors.append(f"Row {i}: front and back must not be empty.")
            continue
        if len(front) > MAX_FRONT_LEN:
            errors.append(f"Row {i}: front exceeds {MAX_FRONT_LEN} characters.")
            continue
        if len(back) > MAX_BACK_LEN:
            errors.append(f"Row {i}: back exceeds {MAX_BACK_LEN} characters.")
            continue

        # Optional tags: separated by `|` inside the cell.
        tags = [t.strip() for t in tags_src.split("|") if t.strip()]

        # Optional hint (trimmed, capped, empty → None).
        hint = hint_src.strip()[:MAX_HINT_LEN] or None

        # Optional image URL (empty → None). Same policy as the API's
        # clean_image_url(): `data:image/...` payloads get the (much larger)
        # inline-image budget plus mime/base64 checks; every other prefix
        # keeps the plain 500-character URL rule. Row errors keep the
        # long-standing "image URL" phrasing expected by the UI.
        image_url: str | None = None
        raw_url = image_src.strip()
        if raw_url:
            if raw_url.lower().startswith("data:image/"):
                if len(raw_url) > MAX_DATA_URI_LENGTH:
                    errors.append(f"Row {i}: Inline image too large — keep it under ~500KB")
                    continue
                if not is_valid_data_uri(raw_url):
                    errors.append(
                        f"Row {i}: Inline image must be a base64 data URI: "
                        "data:image/(png|jpeg|jpg|webp|gif) — SVG is not allowed"
                    )
                    continue
            elif len(raw_url) > MAX_IMAGE_URL_LEN:
                errors.append(f"Row {i}: image URL exceeds {MAX_IMAGE_URL_LEN} characters.")
                continue
            elif not raw_url.lower().startswith(("http://", "https://", "data:image/", "//", "/")):
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


def _column_map(header_row: list[str]) -> dict[str, int]:
    """Map semantic column names to indices from a header row (first match wins)."""
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        name = cell.strip().lower()
        if name in _FRONT_HEADERS and "front" not in mapping:
            mapping["front"] = idx
        elif name in _BACK_HEADERS and "back" not in mapping:
            mapping["back"] = idx
        elif name in _TAGS_HEADERS and "tags" not in mapping:
            mapping["tags"] = idx
        elif name in _HINT_HEADERS and "hint" not in mapping:
            mapping["hint"] = idx
        elif name in _IMAGE_HEADERS and "image" not in mapping:
            mapping["image"] = idx
    # Front/back are mandatory — fall back to positional parsing when the
    # header doesn't name them (e.g. a bare `tags,hint` first row).
    mapping.setdefault("front", 0)
    mapping.setdefault("back", 1)
    return mapping
