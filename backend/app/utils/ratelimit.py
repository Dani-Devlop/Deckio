"""In-memory sliding-window rate limiter (no external dependencies).

Sized for single-process deployments: the sandbox uvicorn worker and each
Docker container run exactly one API process, so a plain in-memory store is
sufficient (multi-worker deployments would move this to Redis).

Buckets are keyed by `(name, client identifier)` and hold request timestamps;
expired entries are pruned lazily on every check.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    """Fixed-budget sliding window: `max_requests` per `window_seconds`."""

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Record a hit for `key` or raise 429 with a Retry-After header."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            cutoff = now - self.window
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self.max:
                retry_after = int(self.window - (now - hits[0])) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many attempts — try again in {retry_after}s.",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)

    def reset(self, key: str) -> None:
        """Drop all hits for a key (handy for tests)."""
        with self._lock:
            self._hits.pop(key, None)


def client_ip(request: Request) -> str:
    """Best-effort client identity: first X-Forwarded-For hop, else socket IP."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# Brute-force protection for credential endpoints: 10 attempts / 5 min / IP.
auth_limiter = SlidingWindowLimiter(max_requests=10, window_seconds=300)
