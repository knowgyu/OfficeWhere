from __future__ import annotations

import os
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .file_scope import (
    DEFAULT_EXCLUDED_FOLDER_NAMES,
    SUPPORTED_EXTENSIONS,
    excluded_folder_key_set,
    sorted_counter_map,
)
from .library_scan_cache import (
    DirectorySignature,
    directory_signature,
    is_high_confidence_root,
    load_entry,
    mark_reused,
    normalized_signature,
    save_entry,
    should_force_full_scan,
)
from .everything_scanner import discover_supported_paths


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
    discovery_source: str = "filesystem"
    discovery_hint: str = ""
    discovery_help_url: str = ""
    discovery_fallback_reason: str = ""
    cache_hit: bool = False
    cache_fallback_reason: str = ""
    cache_hit_dir_count: int = 0
    modified_time_by_path: Dict[str, float] = field(default_factory=dict)
    mtime_metadata_trusted: bool = False


@dataclass
class _ScanState:
    supported: set[str]
    excluded_keys: set[str]
    paths: List[str] = field(default_factory=list)
    skipped_dirs: Counter[str] = field(default_factory=Counter)
    inaccessible_dirs: Counter[str] = field(default_factory=Counter)
    unsupported_extensions: Counter[str] = field(default_factory=Counter)
    visited_dir_count: int = 0
    directory_signatures: List[DirectorySignature] = field(default_factory=list)

    def mark_inaccessible(self, path: str) -> None:
        name = os.path.basename(os.path.normpath(path)) or os.path.normpath(path)
        self.inaccessible_dirs[name] += 1

    def visit_file(self, path: str, name: str) -> None:
        if name.startswith("~$"):
            return
        suffix = os.path.splitext(name)[1].lower()
        if suffix in self.supported:
            self.paths.append(os.path.normpath(path))
        elif suffix:
            self.unsupported_extensions[suffix] += 1
        else:
            self.unsupported_extensions["<none>"] += 1

    def to_collection(
        self,
        *,
        cache_fallback_reason: str = "",
        discovery_hint: str = "",
        discovery_help_url: str = "",
        discovery_fallback_reason: str = "",
    ) -> ScanCollection:
        return ScanCollection(
            paths=sorted(self.paths),
            visited_dir_count=self.visited_dir_count,
            skipped_dir_count=sum(self.skipped_dirs.values()),
            skipped_dirs_by_name=sorted_counter_map(self.skipped_dirs),
            inaccessible_dir_count=sum(self.inaccessible_dirs.values()),
            inaccessible_dirs_by_name=sorted_counter_map(self.inaccessible_dirs),
            unsupported_file_count=sum(self.unsupported_extensions.values()),
            unsupported_extensions_by_suffix=sorted_counter_map(self.unsupported_extensions),
            discovery_hint=discovery_hint,
            discovery_help_url=discovery_help_url,
            discovery_fallback_reason=discovery_fallback_reason,
            cache_fallback_reason=cache_fallback_reason,
        )


def _supported_extension_set() -> set[str]:
    return {extension.lower() for extension in SUPPORTED_EXTENSIONS}


def _excluded_key_set(excluded_folder_names: Optional[List[str]]) -> set[str]:
    return excluded_folder_key_set(
        DEFAULT_EXCLUDED_FOLDER_NAMES if excluded_folder_names is None else excluded_folder_names
    )


def _is_excluded_dir_name(name: str, excluded_keys: set[str]) -> bool:
    return name.casefold() in excluded_keys


def _validate_cached_paths(paths: Iterable[str], supported: set[str]) -> bool:
    for path in paths:
        name = os.path.basename(path)
        if name.startswith("~$"):
            return False
        if os.path.splitext(name)[1].lower() not in supported:
            return False
        try:
            if not os.path.isfile(path):
                return False
        except OSError:
            return False
    return True


def _validate_cached_directories(directories: Iterable[DirectorySignature]) -> bool:
    for cached in directories:
        current = directory_signature(cached.path)
        if current is None:
            return False
        if (
            current.mtime_ns != cached.mtime_ns
            or current.size != cached.size
            or current.inode != cached.inode
            or current.device != cached.device
        ):
            return False
    return True


def _collection_from_cache(
    folder: Path,
    recursive: bool,
    supported: set[str],
    excluded_keys: set[str],
) -> tuple[ScanCollection | None, str]:
    root_path = os.path.normpath(str(folder))
    if not is_high_confidence_root(root_path):
        return None, "low_confidence_root"

    entry = load_entry(
        root_path,
        recursive,
        normalized_signature(excluded_keys),
        normalized_signature(supported),
    )
    if entry is None:
        return None, "missing_cache"

    force_reason = should_force_full_scan(entry)
    if force_reason:
        return None, force_reason

    if not _validate_cached_directories(entry.directories):
        return None, "directory_signature_changed"

    if not _validate_cached_paths(entry.paths, supported):
        return None, "cached_path_invalid"

    collection = ScanCollection(
        paths=sorted(entry.paths),
        visited_dir_count=0,
        skipped_dir_count=0,
        skipped_dirs_by_name={},
        inaccessible_dir_count=0,
        inaccessible_dirs_by_name={},
        unsupported_file_count=0,
        unsupported_extensions_by_suffix={},
        discovery_source="snapshot_cache",
        cache_hit=True,
        cache_hit_dir_count=len(entry.directories),
    )
    try:
        mark_reused(entry)
    except OSError:
        # Snapshot reuse is an optimization. A temporary cache write failure must
        # not turn a validated read-only discovery result into a rescan failure.
        collection.cache_fallback_reason = "cache_reuse_write_failed"
    return collection, ""


def _scan_directory(folder: Path, recursive: bool, supported: set[str], excluded_keys: set[str]) -> _ScanState:
    state = _ScanState(supported=supported, excluded_keys=excluded_keys)
    stack = [os.path.normpath(str(folder))]

    while stack:
        current = stack.pop()
        state.visited_dir_count += 1
        signature = directory_signature(current)
        if signature is not None:
            state.directory_signatures.append(signature)

        try:
            with os.scandir(current) as iterator:
                for entry in iterator:
                    name = entry.name
                    path = os.path.normpath(entry.path)
                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                    except OSError:
                        state.mark_inaccessible(path)
                        continue

                    if is_dir:
                        if _is_excluded_dir_name(name, excluded_keys):
                            state.skipped_dirs[name] += 1
                            continue
                        if recursive:
                            stack.append(path)
                        continue

                    try:
                        # Preserve the previous Path.is_file() behavior for
                        # symlinked files while still refusing to descend into
                        # symlinked directories above.
                        is_file = entry.is_file()
                    except OSError:
                        state.mark_inaccessible(path)
                        continue
                    if is_file:
                        state.visit_file(path, name)
        except OSError:
            state.mark_inaccessible(current)
            continue

    return state


def _collection_from_everything(
    folder: Path,
    recursive: bool,
    supported: set[str],
    excluded_keys: set[str],
) -> tuple[ScanCollection | None, str, str, str]:
    discovery = discover_supported_paths(str(folder), recursive, supported, excluded_keys)
    if discovery.available:
        if not discovery.paths:
            return None, "", "", "everything_empty_result"
        return (
            ScanCollection(
                paths=discovery.paths,
                discovery_source="everything_sdk",
                discovery_hint="",
                discovery_help_url="",
                discovery_fallback_reason="",
                modified_time_by_path=discovery.modified_time_by_path,
                mtime_metadata_trusted=bool(discovery.modified_time_by_path),
            ),
            "",
            "",
            "",
        )
    if discovery.unavailable_reason in {"non_windows", "disabled"}:
        return None, "", "", discovery.unavailable_reason
    return None, discovery.hint, discovery.help_url, discovery.unavailable_reason


def collect_supported_paths_with_stats(
    folder_path: str,
    recursive: bool,
    excluded_folder_names: Optional[List[str]] = None,
    *,
    use_cache: bool = True,
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
            cache_fallback_reason="start_permission_error",
        )

    supported = _supported_extension_set()
    excluded_keys = _excluded_key_set(excluded_folder_names)
    cache_fallback_reason = ""

    if use_cache:
        cached, cache_fallback_reason = _collection_from_cache(folder, recursive, supported, excluded_keys)
        if cached is not None:
            return cached

    everything_hint = ""
    everything_help_url = ""
    everything_fallback_reason = ""
    everything_collection, everything_hint, everything_help_url, everything_fallback_reason = _collection_from_everything(
        folder,
        recursive,
        supported,
        excluded_keys,
    )
    if everything_collection is not None:
        return everything_collection

    state = _scan_directory(folder, recursive, supported, excluded_keys)
    collection = state.to_collection(
        cache_fallback_reason=cache_fallback_reason,
        discovery_hint=everything_hint,
        discovery_help_url=everything_help_url,
        discovery_fallback_reason=everything_fallback_reason,
    )

    if use_cache and is_high_confidence_root(os.path.normpath(str(folder))) and state.directory_signatures:
        try:
            save_entry(
                os.path.normpath(str(folder)),
                recursive,
                normalized_signature(excluded_keys),
                normalized_signature(supported),
                collection.paths,
                state.directory_signatures,
            )
        except OSError:
            # Cache is an app-owned optimization only. Discovery results remain valid
            # even if the cache cannot be written.
            collection.cache_fallback_reason = collection.cache_fallback_reason or "cache_write_failed"

    return collection


def collect_supported_paths(
    folder_path: str,
    recursive: bool,
    excluded_folder_names: Optional[List[str]] = None,
) -> List[str]:
    return collect_supported_paths_with_stats(folder_path, recursive, excluded_folder_names).paths
