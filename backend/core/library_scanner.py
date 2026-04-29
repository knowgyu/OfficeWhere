from __future__ import annotations

import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from .file_scope import (
    DEFAULT_EXCLUDED_FOLDER_NAMES,
    SUPPORTED_EXTENSIONS,
    excluded_folder_key_set,
    should_exclude_dir,
    sorted_counter_map,
)


@dataclass
class ScanCollection:
    paths: List[str]
    visited_dir_count: int = 0
    skipped_dir_count: int = 0
    skipped_dirs_by_name: Dict[str, int] | None = None
    inaccessible_dir_count: int = 0
    inaccessible_dirs_by_name: Dict[str, int] | None = None
    unsupported_file_count: int = 0
    unsupported_extensions_by_suffix: Dict[str, int] | None = None


def collect_supported_paths_with_stats(
    folder_path: str,
    recursive: bool,
    excluded_folder_names: Optional[List[str]] = None,
) -> ScanCollection:
    folder = Path(os.path.normpath(folder_path.strip()))
    try:
        if not folder.exists():
            raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
        if not folder.is_dir():
            raise ValueError(f"폴더가 아닙니다: {folder_path}")
    except PermissionError:
        return ScanCollection(
            paths=[],
            inaccessible_dir_count=1,
            inaccessible_dirs_by_name={folder.name or str(folder): 1},
        )

    supported = {extension.lower() for extension in SUPPORTED_EXTENSIONS}
    excluded_keys = excluded_folder_key_set(
        DEFAULT_EXCLUDED_FOLDER_NAMES if excluded_folder_names is None else excluded_folder_names
    )
    paths: List[str] = []
    skipped_dirs: Counter[str] = Counter()
    inaccessible_dirs: Counter[str] = Counter()
    unsupported_extensions: Counter[str] = Counter()
    visited_dir_count = 0

    def mark_inaccessible(path: Path) -> None:
        inaccessible_dirs[path.name or str(path)] += 1

    def visit_file(path: Path) -> None:
        if path.name.startswith("~$"):
            return
        suffix = path.suffix.lower()
        if suffix in supported:
            paths.append(os.path.normpath(str(path)))
        elif suffix:
            unsupported_extensions[suffix] += 1
        else:
            unsupported_extensions["<none>"] += 1

    if not recursive:
        visited_dir_count = 1
        try:
            iterator = list(folder.iterdir())
        except OSError:
            mark_inaccessible(folder)
            iterator = []
        for path in iterator:
            try:
                is_file = path.is_file()
            except OSError:
                mark_inaccessible(path)
                continue
            if is_file:
                visit_file(path)
        return ScanCollection(
            paths=sorted(paths),
            visited_dir_count=visited_dir_count,
            skipped_dir_count=0,
            skipped_dirs_by_name={},
            inaccessible_dir_count=sum(inaccessible_dirs.values()),
            inaccessible_dirs_by_name=sorted_counter_map(inaccessible_dirs),
            unsupported_file_count=sum(unsupported_extensions.values()),
            unsupported_extensions_by_suffix=sorted_counter_map(unsupported_extensions),
        )

    stack = [folder]
    while stack:
        current = stack.pop()
        visited_dir_count += 1
        try:
            iterator = list(current.iterdir())
        except OSError:
            mark_inaccessible(current)
            continue
        for path in iterator:
            if should_exclude_dir(path, excluded_keys):
                skipped_dirs[path.name] += 1
                continue
            try:
                is_dir = path.is_dir()
            except OSError:
                mark_inaccessible(path)
                continue
            if is_dir:
                try:
                    is_symlink = path.is_symlink()
                except OSError:
                    mark_inaccessible(path)
                    continue
                if not is_symlink:
                    stack.append(path)
                continue
            try:
                is_file = path.is_file()
            except OSError:
                mark_inaccessible(path)
                continue
            if is_file:
                visit_file(path)

    return ScanCollection(
        paths=sorted(paths),
        visited_dir_count=visited_dir_count,
        skipped_dir_count=sum(skipped_dirs.values()),
        skipped_dirs_by_name=sorted_counter_map(skipped_dirs),
        inaccessible_dir_count=sum(inaccessible_dirs.values()),
        inaccessible_dirs_by_name=sorted_counter_map(inaccessible_dirs),
        unsupported_file_count=sum(unsupported_extensions.values()),
        unsupported_extensions_by_suffix=sorted_counter_map(unsupported_extensions),
    )


def collect_supported_paths(
    folder_path: str,
    recursive: bool,
    excluded_folder_names: Optional[List[str]] = None,
) -> List[str]:
    return collect_supported_paths_with_stats(folder_path, recursive, excluded_folder_names).paths
