from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Callable, Dict, TypeVar

_LOG_LOCK = threading.Lock()
_LOG_PATH: Path | None = None
_ENABLED: bool | None = None
T = TypeVar("T")


def _is_disabled() -> bool:
    return os.environ.get("OW_INDEX_PERF_LOG", "").strip().lower() in {"0", "false", "no", "off"}


def _is_forced_enabled() -> bool:
    return os.environ.get("OW_INDEX_PERF_LOG", "").strip().lower() in {"1", "true", "yes", "on"}


def _resolve_log_path() -> Path:
    configured = os.environ.get("OW_INDEX_PERF_LOG_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()

    data_dir = os.environ.get("OW_DATA_DIR", "").strip()
    if data_dir:
        return Path(data_dir).expanduser().parent / "logs" / "index-performance.log"

    return Path.home() / ".officewhere" / "logs" / "index-performance.log"


def index_perf_log_path() -> Path:
    global _LOG_PATH
    if _LOG_PATH is None:
        _LOG_PATH = _resolve_log_path()
    return _LOG_PATH


def index_perf_enabled() -> bool:
    global _ENABLED
    if _ENABLED is None:
        _ENABLED = not _is_disabled() and (
            _is_forced_enabled()
            or bool(os.environ.get("OW_INDEX_PERF_LOG_PATH", "").strip())
            or bool(os.environ.get("OW_DATA_DIR", "").strip())
        )
    return _ENABLED


def log_index_perf(event: str, **fields: Any) -> None:
    """Append one NDJSON performance event for indexing diagnostics.

    This log intentionally lives outside the normal backend log so expensive
    corporate-PC indexing runs can be inspected without mixing timing data with
    exceptions or uvicorn output.  It records file paths and timing only; never
    document text.
    """
    if not index_perf_enabled():
        return

    payload: Dict[str, Any] = {
        "ts": datetime.now().isoformat(timespec="milliseconds"),
        "event": event,
        "pid": os.getpid(),
        "thread": threading.current_thread().name,
        **fields,
    }

    path = index_perf_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(payload, ensure_ascii=False, default=str)
        with _LOG_LOCK:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line)
                handle.write("\n")
    except Exception:
        # Performance logging must never break indexing.
        return


def elapsed_ms(started: float) -> int:
    return int(round((perf_counter() - started) * 1000))


def timed_ms(target: Dict[str, Any], key: str, func: Callable[[], T]) -> T:
    started = perf_counter()
    try:
        return func()
    finally:
        target[key] = elapsed_ms(started)
