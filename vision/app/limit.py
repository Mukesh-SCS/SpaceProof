"""Per-process request window. A restart clears it. It is not shared across instances."""

from __future__ import annotations

import time
from collections import defaultdict

WINDOW_SECONDS = 60
_hits: dict[str, list[float]] = defaultdict(list)


def allow(key: str, limit: int, now: float | None = None) -> bool:
    moment = time.monotonic() if now is None else now
    recent = [stamp for stamp in _hits[key] if moment - stamp < WINDOW_SECONDS]
    if len(recent) >= limit:
        _hits[key] = recent
        return False
    recent.append(moment)
    _hits[key] = recent
    return True
