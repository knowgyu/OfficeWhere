from __future__ import annotations

import copy
import os
import threading
from collections import OrderedDict
from time import monotonic
from typing import Any, Hashable

_DEFAULT_MAX_ENTRIES = 64
_DEFAULT_TTL_SECONDS = 30.0

_LOCK = threading.RLock()
_EPOCH = 0
_CACHE: "OrderedDict[Hashable, tuple[float, dict[str, Any]]]" = OrderedDict()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def max_entries() -> int:
    return max(0, _env_int("OW_SEARCH_CACHE_MAX_ENTRIES", _DEFAULT_MAX_ENTRIES))


def ttl_seconds() -> float:
    return max(0.0, _env_float("OW_SEARCH_CACHE_TTL_SECONDS", _DEFAULT_TTL_SECONDS))


def enabled() -> bool:
    return max_entries() > 0 and ttl_seconds() > 0


def current_epoch() -> int:
    with _LOCK:
        return _EPOCH


def bump_search_cache_epoch(reason: str = "") -> int:
    """Invalidate all backend search responses after search-visible DB changes."""

    global _EPOCH
    with _LOCK:
        _EPOCH += 1
        _CACHE.clear()
        return _EPOCH


def get_search_cache(key: Hashable) -> dict[str, Any] | None:
    if not enabled():
        return None
    deadline = ttl_seconds()
    now = monotonic()
    with _LOCK:
        entry = _CACHE.get(key)
        if entry is None:
            return None
        created_at, payload = entry
        if now - created_at > deadline:
            _CACHE.pop(key, None)
            return None
        _CACHE.move_to_end(key)
        return copy.deepcopy(payload)


def set_search_cache(key: Hashable, payload: dict[str, Any]) -> None:
    if not enabled():
        return
    limit = max_entries()
    with _LOCK:
        _CACHE[key] = (monotonic(), copy.deepcopy(payload))
        _CACHE.move_to_end(key)
        while len(_CACHE) > limit:
            _CACHE.popitem(last=False)


def reset_search_cache_for_tests() -> None:
    global _EPOCH
    with _LOCK:
        _EPOCH = 0
        _CACHE.clear()
