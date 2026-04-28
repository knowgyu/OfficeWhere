import os


def get_worker_count(default: int = 4, cap: int = 8) -> int:
    """Return a conservative worker count for Office parsing tasks."""
    override = os.environ.get("OW_MAX_WORKERS", "").strip()
    if override:
        try:
            return max(1, min(cap, int(override)))
        except ValueError:
            pass

    cpu_count = os.cpu_count() or default
    return max(1, min(cap, cpu_count))


def get_fast_worker_count(default: int = 8, cap: int = 24) -> int:
    """Return the explicit high-speed worker count for large local indexing runs.

    The normal worker count stays conservative for background/automatic refresh.
    Fast mode is user-triggered, so it may use more CPU/RAM, while still keeping a
    hard cap to avoid overwhelming SQLite writes, shared folders, or antivirus
    file hooks.
    """
    override = os.environ.get("OW_FAST_MAX_WORKERS", "").strip()
    if override:
        try:
            return max(1, min(cap, int(override)))
        except ValueError:
            pass

    cpu_count = os.cpu_count() or default
    return max(1, min(cap, cpu_count))
