from __future__ import annotations

import json
import math
import os

from ..database import get_setting, set_setting
from ..models.schemas import LibrarySettings
from ..runtime import normalize_fast_worker_count
from .file_scope import normalize_excluded_folder_names

SETTINGS_KEY = "library_settings"
LAST_RESCAN_KEY = "library_last_rescan_at"


def _normalize_interval_hours(value: float) -> int:
    if not math.isfinite(float(value)) or value < 1:
        return 1
    return max(1, int(math.floor(float(value))))


def _normalize_library_settings(settings: LibrarySettings) -> LibrarySettings:
    return LibrarySettings(
        watched_folders=[
            {
                "path": os.path.normpath(folder.path.strip()),
                "recursive": folder.recursive,
            }
            for folder in settings.watched_folders
            if folder.path.strip()
        ],
        excluded_folder_names=normalize_excluded_folder_names(settings.excluded_folder_names),
        auto_rescan_mode=settings.auto_rescan_mode,
        auto_rescan_interval_hours=_normalize_interval_hours(settings.auto_rescan_interval_hours),
        auto_rescan_daily_time=settings.auto_rescan_daily_time,
        fast_worker_count=normalize_fast_worker_count(settings.fast_worker_count),
        last_rescan_at=settings.last_rescan_at,
    )


def load_library_settings() -> LibrarySettings:
    raw = get_setting(SETTINGS_KEY, "")
    if not raw:
        return LibrarySettings()
    try:
        settings = LibrarySettings(**json.loads(raw))
        settings.last_rescan_at = get_setting(LAST_RESCAN_KEY) or None
        return _normalize_library_settings(settings)
    except Exception:
        return LibrarySettings()


def save_library_settings(settings: LibrarySettings) -> LibrarySettings:
    normalized = _normalize_library_settings(settings)
    set_setting(SETTINGS_KEY, normalized.model_dump_json())
    normalized.last_rescan_at = get_setting(LAST_RESCAN_KEY) or None
    return normalized
