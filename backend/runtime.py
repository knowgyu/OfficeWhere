import os

FAST_WORKER_MIN = 4
FAST_WORKER_DEFAULT = 24
FAST_WORKER_MAX = 48
FAST_WORKER_STEP = 4


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


def normalize_fast_worker_count(
    value: int | str | None = None,
    *,
    default: int = FAST_WORKER_DEFAULT,
    minimum: int = FAST_WORKER_MIN,
    cap: int = FAST_WORKER_MAX,
    step: int = FAST_WORKER_STEP,
) -> int:
    try:
        numeric = int(value) if value is not None else int(default)
    except (TypeError, ValueError):
        numeric = int(default)

    bounded = max(minimum, min(cap, numeric))
    return max(minimum, min(cap, ((bounded + step // 2) // step) * step))


def get_fast_worker_count(configured: int | None = None, default: int = FAST_WORKER_DEFAULT, cap: int = FAST_WORKER_MAX) -> int:
    """Return the explicit high-speed worker count for large local indexing runs.

    The normal worker count stays conservative for background/automatic refresh.
    Fast mode is user-triggered, so it may use more CPU/RAM, while still keeping a
    hard cap to avoid overwhelming SQLite writes, shared folders, or antivirus
    file hooks.
    """
    if configured is not None:
        return normalize_fast_worker_count(configured, default=default, cap=cap)

    override = os.environ.get("OW_FAST_MAX_WORKERS", "").strip()
    if override:
        return normalize_fast_worker_count(override, default=default, cap=cap)

    return normalize_fast_worker_count(default, default=default, cap=cap)
