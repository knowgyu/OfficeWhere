from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple

from ..database import PreparedIndexedFile


@dataclass
class PreparedLibraryWrite:
    path: str
    name: str
    action: str
    payload: PreparedIndexedFile
    metrics: Dict[str, Any]
    file_started: float
    ready_at: float


@dataclass(frozen=True)
class RescanWritePolicy:
    file_limit: int
    chunk_limit: int
    interval_seconds: float

    def should_flush_before_append(self, current_chunk_count: int, item_chunk_count: int) -> bool:
        return current_chunk_count + item_chunk_count > self.chunk_limit

    def is_single_large_file(self, item_chunk_count: int) -> bool:
        return item_chunk_count >= self.chunk_limit

    def flush_reason_after_append(
        self,
        *,
        file_count: int,
        chunk_count: int,
        elapsed_since_flush: float,
    ) -> Optional[str]:
        if file_count <= 0:
            return None
        if chunk_count >= self.chunk_limit:
            return "chunk_limit"
        if file_count >= self.file_limit:
            return "file_limit"
        if elapsed_since_flush >= self.interval_seconds:
            return "interval"
        return None


class RescanStatusCoordinator:
    """Small seam for rescan status, cancellation, and execution ownership.

    ``library.py`` keeps compatibility aliases to these primitives, while this
    class owns the coordination rules so start/cancel/status behavior can be
    tested without spreading lock mutation through the controller.
    """

    def __init__(self, initial_status_factory: Callable[[], Dict[str, Any]]):
        self.lock = threading.Lock()
        self.status: Dict[str, Any] = initial_status_factory()
        self.execution_lock = threading.Lock()
        self.cancel_event = threading.Event()

    def snapshot(self) -> Dict[str, Any]:
        with self.lock:
            return dict(self.status)

    def update(self, patch: Dict[str, Any], *, now_iso: Callable[[], str]) -> Dict[str, Any]:
        with self.lock:
            self.status.update(patch)
            self.status["updated_at"] = now_iso()
            return dict(self.status)

    def begin_or_current(
        self,
        initial_status: Dict[str, Any],
        *,
        already_running_status: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], bool]:
        with self.lock:
            if self.status.get("running"):
                return dict(self.status), False
            if not self.execution_lock.acquire(blocking=False):
                return dict(already_running_status), False

            self.cancel_event.clear()
            self.status.clear()
            self.status.update(initial_status)
            return dict(self.status), True

    def request_cancel(self, cancelling_patch: Dict[str, Any], *, now_iso: Callable[[], str]) -> Dict[str, Any]:
        with self.lock:
            if not self.status.get("running"):
                return dict(self.status)
            self.cancel_event.set()
            self.status.update(cancelling_patch)
            self.status["updated_at"] = now_iso()
            return dict(self.status)

    def is_active(self) -> bool:
        with self.lock:
            if bool(self.status.get("running")):
                return True
        return self.execution_lock.locked()
