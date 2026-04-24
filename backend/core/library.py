from __future__ import annotations

import json
import os
import re
import threading
import time
from concurrent.futures import as_completed
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..database import (
    get_all_files,
    get_setting,
    register_file,
    save_file_chunks,
    set_setting,
    update_file_mtime,
)
from ..models.schemas import (
    FileInfo,
    LibraryFileGroup,
    LibraryRescanResponse,
    LibraryRescanResult,
    LibraryRescanStatus,
    LibrarySettings,
)
from .file_access import scan_folder
from .indexer import inspect_and_chunk
from .normalizer import suggest_key_column
from ..runtime import get_worker_count

SETTINGS_KEY = "library_settings"
LAST_RESCAN_KEY = "library_last_rescan_at"
MAX_WORKERS = get_worker_count()
ProgressCallback = Callable[[Dict[str, Any]], None]

_rescan_status_lock = threading.Lock()
_rescan_status: Dict[str, Any] = LibraryRescanStatus().dict()


def _now_iso() -> str:
    return datetime.now().isoformat()


def _status_snapshot() -> LibraryRescanStatus:
    with _rescan_status_lock:
        return LibraryRescanStatus(**_rescan_status)


def get_library_rescan_status() -> LibraryRescanStatus:
    return _status_snapshot()


def _update_rescan_status(patch: Dict[str, Any]) -> LibraryRescanStatus:
    with _rescan_status_lock:
        _rescan_status.update(patch)
        _rescan_status["updated_at"] = _now_iso()
        return LibraryRescanStatus(**_rescan_status)


def _estimate_eta_seconds(started_monotonic: float, processed: int, total: int) -> Optional[int]:
    if processed <= 0 or total <= 0 or processed >= total:
        return None
    elapsed = max(time.monotonic() - started_monotonic, 0.0)
    seconds_per_item = elapsed / processed
    return int(max((total - processed) * seconds_per_item, 0.0))


def _result_counts(results: List[LibraryRescanResult]) -> Dict[str, int]:
    return {
        "registered": sum(1 for item in results if item.action == "registered" and item.success),
        "updated": sum(1 for item in results if item.action == "updated" and item.success),
        "skipped": sum(1 for item in results if item.action == "skipped" and item.success),
        "failed": sum(1 for item in results if not item.success),
    }


def file_info_from_row(row: Dict[str, Any]) -> FileInfo:
    return FileInfo(
        id=row["id"],
        name=row["name"],
        path=row["path"],
        file_type=row["file_type"],
        key_column=row["key_column"],
        column_count=row["column_count"],
        parser_config=row.get("parser_config", {}),
        created_at=row.get("created_at"),
        file_mtime=row.get("file_mtime"),
    )


def load_library_settings() -> LibrarySettings:
    raw = get_setting(SETTINGS_KEY, "")
    if not raw:
        return LibrarySettings()
    try:
        settings = LibrarySettings(**json.loads(raw))
        settings.last_rescan_at = get_setting(LAST_RESCAN_KEY) or None
        return settings
    except Exception:
        return LibrarySettings()


def save_library_settings(settings: LibrarySettings) -> LibrarySettings:
    normalized = LibrarySettings(
        watched_folders=[
            {
                "path": os.path.normpath(folder.path.strip()),
                "recursive": folder.recursive,
            }
            for folder in settings.watched_folders
            if folder.path.strip()
        ],
        auto_rescan_mode=settings.auto_rescan_mode,
        auto_rescan_interval_hours=settings.auto_rescan_interval_hours,
        auto_rescan_daily_time=settings.auto_rescan_daily_time,
        last_rescan_at=settings.last_rescan_at,
    )
    set_setting(SETTINGS_KEY, normalized.json())
    normalized.last_rescan_at = get_setting(LAST_RESCAN_KEY) or None
    return normalized


def canonical_name(name: str) -> str:
    stem = Path(name).stem.lower()
    stem = re.sub(r"[\[\]\(\)\{\}]", " ", stem)
    stem = re.sub(r"[_\-.]+", " ", stem)
    stem = re.sub(r"\b(20\d{2})[ ._-]?(0[1-9]|1[0-2])[ ._-]?([0-2]\d|3[01])\b", " ", stem)
    stem = re.sub(r"\b\d{6,8}\b", " ", stem)
    stem = re.sub(r"\b(v|ver|version|rev|revision)\s*\d+\b", " ", stem)
    stem = re.sub(r"\b(final|draft|copy|new|old)\b", " ", stem)
    stem = re.sub(r"(최종|수정본|개정본|복사본|초안|구버전|신버전)", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem or Path(name).stem.lower()


def file_sort_key(file_info: FileInfo) -> Tuple[float, str]:
    if file_info.file_mtime is not None:
        return (file_info.file_mtime, file_info.name)
    if file_info.created_at:
        try:
            return (datetime.fromisoformat(file_info.created_at).timestamp(), file_info.name)
        except ValueError:
            pass
    return (0, file_info.name)


def rescan_library(progress_callback: Optional[ProgressCallback] = None) -> LibraryRescanResponse:
    settings = load_library_settings()
    if not settings.watched_folders:
        if progress_callback:
            progress_callback(
                {
                    "stage": "completed",
                    "message": "등록된 대상 폴더가 없습니다.",
                    "percent": 100.0,
                    "total": 0,
                    "processed": 0,
                }
            )
        return LibraryRescanResponse(registered=0, updated=0, skipped=0, failed=0, results=[])

    started_monotonic = time.monotonic()
    found_paths: Dict[str, str] = {}
    scan_errors: List[LibraryRescanResult] = []
    folders_total = len(settings.watched_folders)
    if progress_callback:
        progress_callback(
            {
                "stage": "scanning",
                "message": "대상 폴더를 확인하는 중입니다.",
                "folders_total": folders_total,
                "folders_processed": 0,
                "found": 0,
                "total": 0,
                "processed": 0,
                "percent": 0.0,
                "eta_seconds": None,
            }
        )

    for folder_index, folder in enumerate(settings.watched_folders, start=1):
        try:
            for item in scan_folder(folder.path, folder.recursive):
                normalized_path = os.path.normpath(item["path"])
                if item.get("error"):
                    scan_errors.append(
                        LibraryRescanResult(
                            path=normalized_path,
                            name=item["name"],
                            success=False,
                            action="failed",
                            error=item["error"],
                        )
                    )
                else:
                    found_paths[normalized_path] = item["name"]
        except Exception as exc:
            scan_errors.append(
                LibraryRescanResult(
                    path=os.path.normpath(folder.path),
                    name=Path(folder.path).name or folder.path,
                    success=False,
                    action="failed",
                    error=str(exc),
                )
            )
        if progress_callback:
            progress_callback(
                {
                    "stage": "scanning",
                    "message": f"대상 폴더 스캔 중 · {folder_index}/{folders_total}",
                    "folders_total": folders_total,
                    "folders_processed": folder_index,
                    "found": len(found_paths),
                    "failed": len(scan_errors),
                    "total": 0,
                    "processed": 0,
                    "percent": 0.0,
                    "eta_seconds": None,
                }
            )

    existing_by_path = {os.path.normpath(row["path"]): row for row in get_all_files()}

    def _register_or_update(path: str) -> LibraryRescanResult:
        name = Path(path).name
        existing = existing_by_path.get(path)
        try:
            current_mtime = os.path.getmtime(path)
            if existing and existing.get("file_mtime") is not None:
                if abs(float(existing["file_mtime"]) - current_mtime) < 1.0:
                    return LibraryRescanResult(
                        path=path,
                        name=name,
                        success=True,
                        action="skipped",
                        file_id=existing["id"],
                    )

            info, chunks = inspect_and_chunk(path, parser_config=existing.get("parser_config") if existing else None)
            key_column = suggest_key_column(info["columns"]) if info["file_type"] == "Excel" else ""
            if info["file_type"] == "Excel" and not key_column:
                raise ValueError("Excel 자동 등록에 사용할 key 컬럼을 찾지 못했습니다.")

            file_id = register_file(
                path=path,
                name=info["name"],
                file_type=info["file_type"],
                key_column=key_column,
                column_count=len(info["columns"]),
                parser_config=info["parser_config"],
            )
            save_file_chunks(file_id, chunks)
            update_file_mtime(file_id, current_mtime)
            return LibraryRescanResult(
                path=path,
                name=info["name"],
                success=True,
                action="updated" if existing else "registered",
                file_id=file_id,
            )
        except Exception as exc:
            return LibraryRescanResult(
                path=path,
                name=name,
                success=False,
                action="failed",
                file_id=existing["id"] if existing else None,
                error=str(exc),
            )

    sorted_paths = sorted(found_paths)
    total = len(sorted_paths)
    results: List[LibraryRescanResult] = []

    if progress_callback:
        progress_callback(
            {
                "stage": "indexing" if total > 0 else "completed",
                "message": f"검색 색인 생성 중 · 파일 {total}개 발견",
                "found": total,
                "total": total,
                "processed": 0,
                "percent": 0.0 if total > 0 else 100.0,
                "eta_seconds": None,
                **_result_counts(scan_errors),
            }
        )

    if total > 0:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_path = {executor.submit(_register_or_update, path): path for path in sorted_paths}
            for processed, future in enumerate(as_completed(future_to_path), start=1):
                try:
                    result = future.result()
                except Exception as exc:
                    path = future_to_path[future]
                    result = LibraryRescanResult(
                        path=path,
                        name=Path(path).name,
                        success=False,
                        action="failed",
                        error=str(exc),
                    )
                results.append(result)
                if progress_callback:
                    counts = _result_counts([*results, *scan_errors])
                    progress_callback(
                        {
                            "stage": "indexing",
                            "message": f"검색 색인 생성 중 · {processed}/{total}",
                            "found": total,
                            "total": total,
                            "processed": processed,
                            "percent": round((processed / total) * 100, 1),
                            "eta_seconds": _estimate_eta_seconds(started_monotonic, processed, total),
                            "current_file": result.name,
                            **counts,
                        }
                    )

    results.extend(scan_errors)
    set_setting(LAST_RESCAN_KEY, datetime.now().isoformat())
    counts = _result_counts(results)
    response = LibraryRescanResponse(results=results, **counts)
    if progress_callback:
        progress_callback(
            {
                "stage": "completed",
                "message": "대상 폴더 색인이 완료되었습니다.",
                "found": total,
                "total": total,
                "processed": total,
                "percent": 100.0,
                "eta_seconds": None,
                "current_file": None,
                "summary": response,
                **counts,
            }
        )
    return response


def _run_rescan_job() -> None:
    try:
        summary = rescan_library(progress_callback=_update_rescan_status)
        _update_rescan_status(
            {
                "running": False,
                "stage": "completed",
                "message": "대상 폴더 색인이 완료되었습니다.",
                "percent": 100.0,
                "eta_seconds": None,
                "summary": summary,
                "error": None,
            }
        )
    except Exception as exc:
        _update_rescan_status(
            {
                "running": False,
                "stage": "failed",
                "message": "대상 폴더 색인에 실패했습니다.",
                "eta_seconds": None,
                "error": str(exc),
            }
        )


def start_library_rescan() -> LibraryRescanStatus:
    with _rescan_status_lock:
        if _rescan_status.get("running"):
            return LibraryRescanStatus(**_rescan_status)

        _rescan_status.clear()
        _rescan_status.update(
            LibraryRescanStatus(
                running=True,
                stage="queued",
                message="대상 폴더 색인을 준비하는 중입니다.",
                started_at=_now_iso(),
                updated_at=_now_iso(),
            ).dict()
        )

    thread = threading.Thread(target=_run_rescan_job, daemon=True, name="library-rescan")
    thread.start()
    return _status_snapshot()


def build_file_groups() -> List[LibraryFileGroup]:
    buckets: Dict[Tuple[str, str], List[FileInfo]] = {}
    for row in get_all_files():
        file_info = file_info_from_row(row)
        buckets.setdefault((file_info.file_type, canonical_name(file_info.name)), []).append(file_info)

    groups: List[LibraryFileGroup] = []
    for (file_type, canonical), files in buckets.items():
        if len(files) < 2:
            continue
        ordered = sorted(files, key=file_sort_key, reverse=True)
        group_id = re.sub(r"[^a-z0-9가-힣]+", "-", f"{file_type}-{canonical}".lower()).strip("-")
        groups.append(
            LibraryFileGroup(
                id=group_id,
                file_type=file_type,
                canonical_name=canonical,
                title=ordered[0].name,
                confidence="filename",
                files=ordered,
                recommended_action="excel_integrate" if file_type == "Excel" else "compare_latest",
            )
        )

    groups.sort(key=lambda group: (file_sort_key(group.files[0]), len(group.files)), reverse=True)
    return groups


def should_auto_rescan(now: datetime | None = None) -> bool:
    settings = load_library_settings()
    if not settings.watched_folders or settings.auto_rescan_mode == "manual":
        return False

    current = now or datetime.now()
    last_str = get_setting(LAST_RESCAN_KEY, "")
    last_dt = None
    if last_str:
        try:
            last_dt = datetime.fromisoformat(last_str)
        except ValueError:
            last_dt = None

    if settings.auto_rescan_mode == "interval":
        if last_dt is None:
            return True
        elapsed_hours = (current - last_dt).total_seconds() / 3600
        return elapsed_hours >= settings.auto_rescan_interval_hours

    if settings.auto_rescan_mode == "daily":
        try:
            target_h, target_m = map(int, settings.auto_rescan_daily_time.split(":"))
        except ValueError:
            return False
        target_today = current.replace(hour=target_h, minute=target_m, second=0, microsecond=0)
        if current < target_today:
            return False
        return last_dt is None or last_dt.date() < current.date()

    return False
