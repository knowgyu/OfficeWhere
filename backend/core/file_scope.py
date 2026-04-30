from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Iterable

from ..file_constants import DEFAULT_EXCLUDED_FOLDER_NAMES, SUPPORTED_EXTENSIONS, SUPPORTED_EXTENSIONS_LABEL


def normalize_excluded_folder_names(values: Iterable[str] | None) -> list[str]:
    """Trim and dedupe folder-name exclusions using case-insensitive matching."""

    seen: set[str] = set()
    normalized: list[str] = []
    for value in values or []:
        name = str(value).strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(name)
    return normalized


def excluded_folder_key_set(values: Iterable[str] | None) -> set[str]:
    return {name.casefold() for name in normalize_excluded_folder_names(values)}


def should_exclude_dir(path: Path, excluded_keys: set[str]) -> bool:
    return path.name.casefold() in excluded_keys


def sorted_counter_map(counter: Counter[str]) -> dict[str, int]:
    return dict(sorted(counter.items(), key=lambda item: (-item[1], item[0].casefold())))
