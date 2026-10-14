"""Spaced repetition scheduling — simplified SM-2 (SuperMemo-2) algorithm.

State lives on the Card row:
    ease          — ease factor, clamped to [1.3, 3.0] (starts at 2.5)
    interval_days — current inter-review interval in days
    reps          — consecutive correct reviews
    lapses        — how many times the card was forgotten
    due_at        — next review timestamp (NULL = new card, due immediately)

Rules (Anki-like simplification):
    correct → reps 1 → 1 day, reps 2 → 3 days, then interval × ease (rounded),
              ease += 0.1
    wrong   → lapses += 1, reps reset, interval reset, ease -= 0.2 (floor 1.3),
              card re-due in 10 minutes (same-session relearning)
"""

from datetime import timedelta

from ..models import Card, utcnow

EASE_MAX = 3.0
EASE_MIN = 1.3
EASE_DELTA = 0.1
RELEARN_MINUTES = 10


def apply_sm2(card: Card, correct: bool) -> None:
    """Mutate the card's SM-2 scheduling state after a study review."""
    now = utcnow()

    if correct:
        if card.reps == 0:
            card.interval_days = 1
        elif card.reps == 1:
            card.interval_days = 3
        else:
            card.interval_days = max(1, round(card.interval_days * card.ease))
        card.reps += 1
        card.ease = min(EASE_MAX, card.ease + EASE_DELTA)
        card.due_at = now + timedelta(days=card.interval_days)
    else:
        card.lapses += 1
        card.reps = 0
        card.interval_days = 0
        card.ease = max(EASE_MIN, card.ease - EASE_DELTA)
        card.due_at = now + timedelta(minutes=RELEARN_MINUTES)


def is_due_expr():
    """SQL condition: a card is due when it was never scheduled OR is overdue."""
    from sqlalchemy import or_

    from ..models import utcnow as _now

    # Python-side UTC timestamp keeps the comparison consistent across
    # SQLite (string storage) and PostgreSQL (timestamptz).
    return or_(Card.due_at.is_(None), Card.due_at <= _now())
