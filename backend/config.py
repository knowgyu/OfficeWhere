from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class LibraryRescanConfig:
    batch_flush_file_limit: int = 24
    batch_flush_chunk_limit: int = 5000
    batch_flush_interval_seconds: float = 1.0
    initial_staging_file_threshold: int = 50


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, float(raw))
    except ValueError:
        return default


def get_library_rescan_config() -> LibraryRescanConfig:
    """Return lightweight backend config for library rescan coordination.

    Defaults intentionally match the pre-config constants in
    ``backend.core.library``. Environment overrides are narrow and optional so
    production behavior is unchanged unless operators opt in for diagnostics or
    local performance tuning.
    """

    defaults = LibraryRescanConfig()
    return LibraryRescanConfig(
        batch_flush_file_limit=_env_int(
            "OW_RESCAN_BATCH_FLUSH_FILE_LIMIT",
            defaults.batch_flush_file_limit,
        ),
        batch_flush_chunk_limit=_env_int(
            "OW_RESCAN_BATCH_FLUSH_CHUNK_LIMIT",
            defaults.batch_flush_chunk_limit,
        ),
        batch_flush_interval_seconds=_env_float(
            "OW_RESCAN_BATCH_FLUSH_INTERVAL_SECONDS",
            defaults.batch_flush_interval_seconds,
        ),
        initial_staging_file_threshold=_env_int(
            "OW_RESCAN_INITIAL_STAGING_FILE_THRESHOLD",
            defaults.initial_staging_file_threshold,
        ),
    )
