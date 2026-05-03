from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

CACHE_VERSION = 1
MAX_SNAPSHOT_REUSE_COUNT = 5
MAX_SNAPSHOT_AGE_SECONDS = 24 * 60 * 60


@dataclass(frozen=True)
class DirectorySignature:
    path: str
    mtime_ns: int
    size: int
    inode: int
    device: int


@dataclass(frozen=True)
class ScanCacheEntry:
    key: str
    root_path: str
    recursive: bool
    excluded_signature: str
    supported_signature: str
    paths: list[str]
    directories: list[DirectorySignature]
    created_at: str
    updated_at: str
    reuse_count: int = 0


def normalized_signature(values: Iterable[str]) -> str:
    payload = json.dumps(sorted(str(value).casefold() for value in values), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def cache_key(
    root_path: str,
    recursive: bool,
    excluded_signature: str,
    supported_signature: str,
) -> str:
    payload = {
        "version": CACHE_VERSION,
        "root_path": os.path.normcase(os.path.normpath(root_path)),
        "recursive": bool(recursive),
        "excluded_signature": excluded_signature,
        "supported_signature": supported_signature,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def is_high_confidence_root(path: str) -> bool:
    normalized = os.path.normpath(path)
    # UNC/network-looking roots can have directory timestamp semantics that are
    # controlled by the remote server. Keep snapshot reuse local by default.
    if normalized.startswith("\\\\") or normalized.startswith("//"):
        return False
    try:
        if os.path.islink(normalized):
            return False
    except OSError:
        return False
    if directory_signature(normalized) is None:
        return False
    return True


def directory_signature(path: str) -> DirectorySignature | None:
    try:
        stat_result = os.stat(path, follow_symlinks=False)
    except OSError:
        return None
    mtime_ns = getattr(stat_result, "st_mtime_ns", None)
    if mtime_ns is None:
        try:
            mtime_ns = int(float(stat_result.st_mtime) * 1_000_000_000)
        except (TypeError, ValueError, OverflowError):
            return None
    return DirectorySignature(
        path=os.path.normpath(path),
        mtime_ns=int(mtime_ns),
        size=int(getattr(stat_result, "st_size", 0) or 0),
        inode=int(getattr(stat_result, "st_ino", 0) or 0),
        device=int(getattr(stat_result, "st_dev", 0) or 0),
    )


def _cache_path() -> Path:
    from .. import database

    return Path(database.DB_DIR) / "library_scan_cache.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _read_cache() -> dict[str, Any]:
    path = _cache_path()
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {"version": CACHE_VERSION, "entries": {}}
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
        return {"version": CACHE_VERSION, "entries": {}}
    entries = data.get("entries")
    if not isinstance(entries, dict):
        return {"version": CACHE_VERSION, "entries": {}}
    return {"version": CACHE_VERSION, "entries": entries}


def _write_cache(data: dict[str, Any]) -> None:
    path = _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="library_scan_cache-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, sort_keys=True)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def _entry_from_json(key: str, data: Any) -> ScanCacheEntry | None:
    if not isinstance(data, dict):
        return None
    if data.get("version") != CACHE_VERSION:
        return None
    directories_raw = data.get("directories")
    paths_raw = data.get("paths")
    if not isinstance(directories_raw, list) or not isinstance(paths_raw, list):
        return None
    directories: list[DirectorySignature] = []
    for item in directories_raw:
        if not isinstance(item, dict):
            return None
        try:
            directories.append(
                DirectorySignature(
                    path=os.path.normpath(str(item["path"])),
                    mtime_ns=int(item["mtime_ns"]),
                    size=int(item.get("size", 0) or 0),
                    inode=int(item.get("inode", 0) or 0),
                    device=int(item.get("device", 0) or 0),
                )
            )
        except (KeyError, TypeError, ValueError):
            return None
    try:
        return ScanCacheEntry(
            key=key,
            root_path=os.path.normpath(str(data["root_path"])),
            recursive=bool(data["recursive"]),
            excluded_signature=str(data["excluded_signature"]),
            supported_signature=str(data["supported_signature"]),
            paths=sorted(os.path.normpath(str(path)) for path in paths_raw),
            directories=directories,
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
            reuse_count=int(data.get("reuse_count") or 0),
        )
    except (KeyError, TypeError, ValueError):
        return None


def load_entry(
    root_path: str,
    recursive: bool,
    excluded_signature: str,
    supported_signature: str,
) -> ScanCacheEntry | None:
    key = cache_key(root_path, recursive, excluded_signature, supported_signature)
    data = _read_cache()
    return _entry_from_json(key, data.get("entries", {}).get(key))


def save_entry(
    root_path: str,
    recursive: bool,
    excluded_signature: str,
    supported_signature: str,
    paths: Sequence[str],
    directories: Sequence[DirectorySignature],
) -> None:
    key = cache_key(root_path, recursive, excluded_signature, supported_signature)
    now = _now_iso()
    cache = _read_cache()
    entries = cache.setdefault("entries", {})
    previous = _entry_from_json(key, entries.get(key))
    created_at = previous.created_at if previous else now
    entries[key] = {
        "version": CACHE_VERSION,
        "root_path": os.path.normpath(root_path),
        "recursive": bool(recursive),
        "excluded_signature": excluded_signature,
        "supported_signature": supported_signature,
        "paths": sorted(os.path.normpath(str(path)) for path in paths),
        "directories": [signature.__dict__ for signature in directories],
        "created_at": created_at,
        "updated_at": now,
        "reuse_count": 0,
    }
    _write_cache(cache)


def mark_reused(entry: ScanCacheEntry) -> None:
    cache = _read_cache()
    entries = cache.setdefault("entries", {})
    raw = entries.get(entry.key)
    if not isinstance(raw, dict):
        return
    raw["reuse_count"] = int(raw.get("reuse_count") or 0) + 1
    raw["updated_at"] = _now_iso()
    _write_cache(cache)


def snapshot_age_seconds(entry: ScanCacheEntry, *, now: datetime | None = None) -> float | None:
    created = _parse_time(entry.created_at)
    if created is None:
        return None
    current = now or datetime.now(timezone.utc)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0.0, (current - created).total_seconds())


def should_force_full_scan(entry: ScanCacheEntry) -> str:
    if entry.reuse_count >= MAX_SNAPSHOT_REUSE_COUNT:
        return "reuse_limit"
    age = snapshot_age_seconds(entry)
    if age is None:
        return "invalid_age"
    if age > MAX_SNAPSHOT_AGE_SECONDS:
        return "age_limit"
    return ""
