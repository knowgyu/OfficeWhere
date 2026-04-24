import os


def get_worker_count(default: int = 4, cap: int = 8) -> int:
    """Return a conservative worker count for Office parsing tasks."""
    override = os.environ.get("ODJ_MAX_WORKERS", "").strip()
    if override:
        try:
            return max(1, min(cap, int(override)))
        except ValueError:
            pass

    cpu_count = os.cpu_count() or default
    return max(1, min(cap, cpu_count))
