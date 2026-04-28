from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import threading
import time
import uuid
from concurrent.futures import as_completed
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..database import (
    ensure_file_fingerprints,
    get_all_files,
    get_setting,
    save_indexed_file,
    set_setting,
)
from ..models.schemas import (
    FileInfo,
    LibraryFileGroup,
    LibraryGroupDetail,
    LibraryGroupsResponse,
    LibraryGroupSummary,
    LibraryRescanResponse,
    LibraryRescanResult,
    LibraryRescanStatus,
    LibrarySettings,
)
from .indexer import inspect_and_chunk
from .parser import SUPPORTED_EXTENSIONS
from .normalizer import suggest_key_column
from .excel_analysis import normalize_excel_parser_config
from ..runtime import get_fast_worker_count, get_worker_count, normalize_fast_worker_count

SETTINGS_KEY = "library_settings"
LAST_RESCAN_KEY = "library_last_rescan_at"
MANUAL_LATEST_SETTING_KEY = "library_manual_latest_files"
logger = logging.getLogger(__name__)
ProgressCallback = Callable[[Dict[str, Any]], None]
OFFICE_FILE_TYPES = {"Excel", "Word", "PowerPoint"}
DEFAULT_GROUP_LIMIT = 50
MAX_GROUP_LIMIT = 100
MAX_GROUP_DETAIL_LIMIT = 200
MAX_GROUP_SUMMARY_FINGERPRINT_FILES = 5

_rescan_status_lock = threading.Lock()
_rescan_status: Dict[str, Any] = LibraryRescanStatus().model_dump()
_cancel_event = threading.Event()


def _normalize_rescan_mode(mode: str = "normal") -> str:
    return "fast" if mode == "fast" else "normal"


def _rescan_worker_count(mode: str, settings: Optional[LibrarySettings] = None) -> int:
    configured = settings.fast_worker_count if settings else None
    return get_fast_worker_count(configured) if mode == "fast" else get_worker_count()


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
        "cancelled": sum(1 for item in results if item.action == "cancelled"),
        "failed": sum(1 for item in results if not item.success and item.action != "cancelled"),
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


def _normalize_interval_hours(value: float) -> int:
    if not math.isfinite(float(value)) or value < 1:
        return 1
    return max(1, int(math.floor(float(value))))


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
        auto_rescan_interval_hours=_normalize_interval_hours(settings.auto_rescan_interval_hours),
        auto_rescan_daily_time=settings.auto_rescan_daily_time,
        fast_worker_count=normalize_fast_worker_count(settings.fast_worker_count),
        last_rescan_at=settings.last_rescan_at,
    )
    set_setting(SETTINGS_KEY, normalized.model_dump_json())
    normalized.last_rescan_at = get_setting(LAST_RESCAN_KEY) or None
    return normalized


def _load_manual_latest_map() -> Dict[str, int]:
    raw = get_setting(MANUAL_LATEST_SETTING_KEY, "{}")
    try:
        payload = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}

    manual_latest: Dict[str, int] = {}
    for group_id, file_id in payload.items():
        try:
            normalized_file_id = int(file_id)
        except (TypeError, ValueError):
            continue
        if normalized_file_id > 0:
            manual_latest[str(group_id)] = normalized_file_id
    return manual_latest


def _save_manual_latest_map(manual_latest: Dict[str, int]) -> None:
    cleaned = {
        str(group_id): int(file_id)
        for group_id, file_id in manual_latest.items()
        if str(group_id) and int(file_id) > 0
    }
    set_setting(MANUAL_LATEST_SETTING_KEY, json.dumps(cleaned, ensure_ascii=False, sort_keys=True))


def _normalize_name_part(value: str) -> str:
    normalized = value.lower()
    normalized = re.sub(r"[\[\]\(\)\{\}]", " ", normalized)
    normalized = re.sub(r"[_\-.]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _parse_date_token(raw: str) -> Optional[Tuple[str, int]]:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 6:
        year = 2000 + int(digits[:2])
        month = int(digits[2:4])
        day = int(digits[4:6])
    elif len(digits) == 8:
        year = int(digits[:4])
        month = int(digits[4:6])
        day = int(digits[6:8])
    else:
        return None

    if year < 1900 or not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}", year * 10000 + month * 100 + day


def _version_sort_value(value: str) -> Tuple[int, ...]:
    return tuple(int(part) for part in value.split(".") if part.isdigit())


def _token_display(token: Dict[str, Any]) -> str:
    if token["kind"] == "version":
        return f"v{token['value']}"
    return str(token["value"])


def parse_document_identity(name: str) -> Dict[str, Any]:
    """Parse conservative document identity tokens from an Office filename.

    The parser intentionally returns explainable tokens only. It is used for
    grouping candidates, not for deleting/merging files or claiming content
    differences.
    """

    original_stem = Path(name).stem
    working = original_stem
    tokens: List[Dict[str, Any]] = []

    def replace_with_token(pattern: str, value_fn: Callable[[re.Match[str]], Optional[Dict[str, Any]]]):
        nonlocal working

        def repl(match: re.Match[str]) -> str:
            token = value_fn(match)
            if token:
                token.setdefault("raw", match.group(0))
                tokens.append(token)
            return " "

        working = re.sub(pattern, repl, working, flags=re.IGNORECASE)

    replace_with_token(
        r"(?<!\d)(20\d{2})[._-](0[1-9]|1[0-2])[._-]([0-2]\d|3[01])(?!\d)",
        lambda match: (
            {"kind": "date", "value": parsed[0], "sort_value": parsed[1]}
            if (parsed := _parse_date_token(match.group(0)))
            else None
        ),
    )
    replace_with_token(
        r"(?<!\d)(?:20\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])|\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01]))(?!\d)",
        lambda match: (
            {"kind": "date", "value": parsed[0], "sort_value": parsed[1]}
            if (parsed := _parse_date_token(match.group(0)))
            else None
        ),
    )
    replace_with_token(
        r"(?<![A-Za-z0-9가-힣])(?:v|ver|version|rev|revision)\s*\.?\s*(\d+(?:\.\d+)*)(?![A-Za-z0-9가-힣])",
        lambda match: {
            "kind": "version",
            "value": match.group(1),
            "sort_value": _version_sort_value(match.group(1)),
        },
    )
    replace_with_token(
        r"(최종본?|수정본|개정본|복사본|초안|구버전|신버전)|(?<![A-Za-z0-9가-힣])(final|draft|copy|new|old)(?![A-Za-z0-9가-힣])",
        lambda match: {
            "kind": "status",
            "value": (match.group(1) or match.group(2) or "").lower(),
            "sort_value": {
                "old": 10,
                "구버전": 10,
                "draft": 20,
                "초안": 20,
                "copy": 30,
                "복사본": 30,
                "수정본": 40,
                "개정본": 45,
                "new": 50,
                "신버전": 50,
                "final": 60,
                "최종": 60,
                "최종본": 60,
            }.get((match.group(1) or match.group(2) or "").lower(), 0),
        },
    )

    base_name = _normalize_name_part(working) or _normalize_name_part(original_stem)
    latest_date = max((token.get("sort_value", 0) for token in tokens if token["kind"] == "date"), default=0)
    latest_version = max((token.get("sort_value", ()) for token in tokens if token["kind"] == "version"), default=())
    latest_status = max((token.get("sort_value", 0) for token in tokens if token["kind"] == "status"), default=0)
    token_kinds = sorted({token["kind"] for token in tokens})
    reason = "파일명에서 " + ", ".join(token_kinds) + " 표시를 감지했습니다." if token_kinds else "파일명 기준"
    return {
        "base_name": base_name,
        "tokens": tokens,
        "sort_key": (latest_date, latest_version, latest_status),
        "confidence_reason": reason,
    }


def canonical_name(name: str) -> str:
    return parse_document_identity(name)["base_name"]


def file_sort_key(file_info: FileInfo) -> Tuple[float, str]:
    if file_info.file_mtime is not None:
        return (file_info.file_mtime, file_info.name)
    if file_info.created_at:
        try:
            return (datetime.fromisoformat(file_info.created_at).timestamp(), file_info.name)
        except ValueError:
            pass
    return (0, file_info.name)


def _collect_supported_paths(folder_path: str, recursive: bool) -> List[str]:
    folder = Path(os.path.normpath(folder_path.strip()))
    if not folder.exists():
        raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
    if not folder.is_dir():
        raise ValueError(f"폴더가 아닙니다: {folder_path}")

    iterator = folder.rglob("*") if recursive else folder.glob("*")
    supported = {extension.lower() for extension in SUPPORTED_EXTENSIONS}
    return sorted(
        os.path.normpath(str(path))
        for path in iterator
        if path.is_file()
        and not path.name.startswith("~$")
        and path.suffix.lower() in supported
    )


def _cancelled_result(path: str) -> LibraryRescanResult:
    return LibraryRescanResult(
        path=path,
        name=Path(path).name,
        success=False,
        action="cancelled",
        error="사용자가 문서 새로고침을 정지했습니다.",
    )


def _is_excel_path(path: str) -> bool:
    return Path(path).suffix.lower() in {".xls", ".xlsx"}


def _saved_excel_config_is_valid(path: str, parser_config: Optional[Dict[str, Any]]) -> bool:
    if not parser_config:
        return False
    try:
        normalize_excel_parser_config(path, parser_config)
        return True
    except ValueError:
        return False


def classify_index_error(exc: Exception, path: str = "") -> Dict[str, str]:
    message = str(exc)
    lower = message.lower()
    suffix = Path(path).suffix.lower()
    error_type = exc.__class__.__name__

    if "bad crc-32" in lower or "crc" in lower:
        return {
            "error_code": "embedded_media_or_package_corrupt",
            "error_stage": "office_package",
            "error_type": error_type,
            "error_hint": "문서 패키지 안의 일부 미디어/첨부 데이터가 손상되어 이 파일만 건너뛰었습니다. Office에서 열어 다른 이름으로 저장하면 복구될 수 있습니다.",
        }
    if "custom" in lower and "property" in lower:
        return {
            "error_code": "office_metadata_invalid",
            "error_stage": "office_metadata",
            "error_type": error_type,
            "error_hint": "문서의 부가 메타데이터가 비정상이라 이 파일만 건너뛰었습니다. 본문 파일은 수정하지 않았습니다.",
        }
    if "parser_config" in message and ("row 범위" in message or "column 범위" in message):
        return {
            "error_code": "parser_config_out_of_range",
            "error_stage": "parser_config",
            "error_type": error_type,
            "error_hint": "저장된 Excel 표 범위가 현재 시트 크기와 맞지 않습니다. 일반 문서 새로고침으로 자동 복구를 시도합니다.",
        }
    if "parser_config" in message and ("정수" in message or "invalid" in lower):
        return {
            "error_code": "parser_config_invalid_number",
            "error_stage": "parser_config",
            "error_type": error_type,
            "error_hint": "저장된 Excel 표 범위 설정에 숫자가 아닌 값이 있습니다. 파일 관리에서 표 범위를 다시 선택해 주세요.",
        }
    if isinstance(exc, IndexError) or "list index out of range" in lower:
        return {
            "error_code": "unsupported_or_corrupt_file",
            "error_stage": "office_parser",
            "error_type": error_type,
            "error_hint": "파일 내부 구조를 파서가 읽지 못했습니다. Office에서 파일을 열어 다시 저장하거나 손상/암호화 여부를 확인해 주세요.",
        }
    if "invalid literal" in lower and "int" in lower:
        return {
            "error_code": "parser_config_invalid_number" if suffix in {".xls", ".xlsx"} else "office_parser_error",
            "error_stage": "parser_config" if suffix in {".xls", ".xlsx"} else "office_parser",
            "error_type": error_type,
            "error_hint": "문서 파서가 숫자 필드를 처리하지 못했습니다. 파일을 다시 저장한 뒤 새로고침하고, 반복되면 진단 ID와 함께 로그를 확인해 주세요.",
        }
    if "database is locked" in lower:
        return {
            "error_code": "database_locked",
            "error_stage": "database",
            "error_type": error_type,
            "error_hint": "다른 OfficeWhere 프로세스나 백그라운드 색인이 DB를 쓰는 중일 수 있습니다. 잠시 뒤 문서 새로고침을 다시 실행해 주세요.",
        }
    if error_type in {"ValueError", "TypeError", "KeyError"}:
        return {
            "error_code": "office_parser_error",
            "error_stage": "office_parser",
            "error_type": error_type,
            "error_hint": "문서 파서가 파일 내용을 처리하지 못했습니다. 파일을 다시 저장하거나 지원 형식인지 확인해 주세요.",
        }
    return {
        "error_code": "unknown",
        "error_stage": "unknown",
        "error_type": error_type,
        "error_hint": "원인을 단정할 수 없습니다. 진단 ID와 backend 로그의 traceback을 함께 확인해 주세요.",
    }


def _failed_result(
    path: str,
    name: str,
    action: str,
    exc: Exception,
    *,
    file_id: Optional[int] = None,
    log_message: str = "library indexing failure",
) -> LibraryRescanResult:
    diagnostic_id = uuid.uuid4().hex[:8]
    diagnostic = classify_index_error(exc, path)
    logger.exception(
        "%s diagnostic_id=%s path=%s error_code=%s",
        log_message,
        diagnostic_id,
        path,
        diagnostic["error_code"],
    )
    return LibraryRescanResult(
        path=path,
        name=name,
        success=False,
        action=action,
        file_id=file_id,
        error=str(exc),
        diagnostic_id=diagnostic_id,
        **diagnostic,
    )


def rescan_library(
    progress_callback: Optional[ProgressCallback] = None,
    mode: str = "normal",
) -> LibraryRescanResponse:
    mode = _normalize_rescan_mode(mode)
    settings = load_library_settings()
    worker_count = _rescan_worker_count(mode, settings)
    if not settings.watched_folders:
        if progress_callback:
            progress_callback(
                {
                    "stage": "completed",
                    "message": "등록된 대상 폴더가 없습니다.",
                    "mode": mode,
                    "worker_count": worker_count,
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
                "message": "대상 폴더를 확인하는 중입니다." if mode == "normal" else "고속 색인을 위해 대상 폴더를 확인하는 중입니다.",
                "mode": mode,
                "worker_count": worker_count,
                "folders_total": folders_total,
                "folders_processed": 0,
                "found": 0,
                "total": 0,
                "processed": 0,
                "percent": 0.0,
                "eta_seconds": None,
                "cancel_requested": False,
            }
        )

    for folder_index, folder in enumerate(settings.watched_folders, start=1):
        if _cancel_event.is_set():
            break
        try:
            for path in _collect_supported_paths(folder.path, folder.recursive):
                if _cancel_event.is_set():
                    break
                found_paths[path] = Path(path).name
        except Exception as exc:
            scan_path = os.path.normpath(folder.path)
            scan_errors.append(
                _failed_result(
                    scan_path,
                    Path(folder.path).name or folder.path,
                    "failed",
                    exc,
                    log_message="library folder scan failed",
                )
            )
        if progress_callback:
            progress_callback(
                {
                    "stage": "cancelling" if _cancel_event.is_set() else "scanning",
                    "message": "정지 요청을 처리하는 중입니다." if _cancel_event.is_set() else f"파일 경로 확인 중 · 폴더 {folder_index}/{folders_total}",
                    "mode": mode,
                    "worker_count": worker_count,
                    "folders_total": folders_total,
                    "folders_processed": folder_index,
                    "found": len(found_paths),
                    "failed": len(scan_errors),
                    "total": 0,
                    "processed": 0,
                    "percent": 0.0,
                    "eta_seconds": None,
                    "cancel_requested": _cancel_event.is_set(),
                }
            )

    existing_by_path = {os.path.normpath(row["path"]): row for row in get_all_files()}

    def _register_or_update(path: str) -> LibraryRescanResult:
        if _cancel_event.is_set():
            return _cancelled_result(path)

        name = Path(path).name
        existing = existing_by_path.get(path)
        try:
            current_mtime = os.path.getmtime(path)
            if existing and existing.get("file_mtime") is not None:
                if abs(float(existing["file_mtime"]) - current_mtime) < 1.0:
                    if mode == "fast" or not _is_excel_path(path) or _saved_excel_config_is_valid(path, existing.get("parser_config")):
                        return LibraryRescanResult(
                            path=path,
                            name=name,
                            success=True,
                            action="skipped",
                            file_id=existing["id"],
                        )

            if _cancel_event.is_set():
                return _cancelled_result(path)

            if _is_excel_path(path):
                parser_config = None
            else:
                parser_config = existing.get("parser_config") if existing else None
            info, chunks = inspect_and_chunk(path, parser_config=parser_config)
            key_column = ""
            if info["file_type"] == "Excel":
                key_column = suggest_key_column(info["columns"]) or ""

            file_id = save_indexed_file(
                path=path,
                name=info["name"],
                file_type=info["file_type"],
                key_column=key_column,
                column_count=len(info["columns"]),
                chunks=chunks,
                file_mtime=current_mtime,
                parser_config=info["parser_config"],
            )
            return LibraryRescanResult(
                path=path,
                name=info["name"],
                success=True,
                action="updated" if existing else "registered",
                file_id=file_id,
            )
        except Exception as exc:
            return _failed_result(
                path,
                name,
                "failed",
                exc,
                file_id=existing["id"] if existing else None,
                log_message="library file indexing failed",
            )

    sorted_paths = sorted(found_paths)
    total = len(sorted_paths)
    results: List[LibraryRescanResult] = []

    if progress_callback:
        progress_callback(
            {
                "stage": "cancelling" if _cancel_event.is_set() else ("indexing" if total > 0 else "completed"),
                "message": (
                    "정지 요청을 처리하는 중입니다."
                    if _cancel_event.is_set()
                    else f"{'고속 ' if mode == 'fast' else ''}변경 여부 확인 및 색인 준비 중 · 파일 {total}개 발견"
                ),
                "mode": mode,
                "worker_count": worker_count,
                "found": total,
                "total": total,
                "processed": 0,
                "percent": 0.0 if total > 0 else 100.0,
                "eta_seconds": None,
                "cancel_requested": _cancel_event.is_set(),
                **_result_counts(scan_errors),
            }
        )

    if _cancel_event.is_set():
        results.extend(scan_errors)
        response = LibraryRescanResponse(results=results, **_result_counts(results))
        if progress_callback:
            progress_callback(
                {
                    "stage": "cancelled",
                    "message": "문서 새로고침이 정지되었습니다.",
                    "mode": mode,
                    "worker_count": worker_count,
                    "found": total,
                    "total": total,
                    "processed": 0,
                    "percent": 0.0,
                    "eta_seconds": None,
                    "summary": response,
                    "cancel_requested": True,
                    **_result_counts(results),
                }
            )
        return response

    if total > 0:
        pending_paths = iter(sorted_paths)
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures: Dict[Any, str] = {}
            for _ in range(min(worker_count, total)):
                path = next(pending_paths, None)
                if path is None:
                    break
                futures[executor.submit(_register_or_update, path)] = path

            processed = 0
            while futures:
                for future in as_completed(list(futures)):
                    path = futures.pop(future)
                    try:
                        result = future.result()
                    except Exception as exc:
                        result = _failed_result(
                            path,
                            Path(path).name,
                            "failed",
                            exc,
                            log_message="library worker future failed",
                        )
                    results.append(result)
                    processed += 1

                    if not _cancel_event.is_set():
                        next_path = next(pending_paths, None)
                        if next_path is not None:
                            futures[executor.submit(_register_or_update, next_path)] = next_path

                    if progress_callback:
                        counts = _result_counts([*results, *scan_errors])
                        progress_callback(
                            {
                                "stage": "cancelling" if _cancel_event.is_set() else "indexing",
                                "message": (
                                    "정지 요청을 처리하는 중입니다."
                                    if _cancel_event.is_set()
                                    else f"{'고속 ' if mode == 'fast' else ''}변경 확인 및 색인 중 · {processed}/{total}"
                                ),
                                "mode": mode,
                                "worker_count": worker_count,
                                "found": total,
                                "total": total,
                                "processed": processed,
                                "percent": round((processed / total) * 100, 1),
                                "eta_seconds": _estimate_eta_seconds(started_monotonic, processed, total),
                                "current_file": result.name,
                                "cancel_requested": _cancel_event.is_set(),
                                **counts,
                            }
                        )
                    break

                if _cancel_event.is_set():
                    for future in futures:
                        future.cancel()
                    for future, path in list(futures.items()):
                        if future.cancelled():
                            results.append(_cancelled_result(path))
                            processed += 1
                            continue
                        try:
                            results.append(future.result())
                        except Exception as exc:
                            results.append(
                                _failed_result(
                                    path,
                                    Path(path).name,
                                    "failed",
                                    exc,
                                    log_message="library worker future failed during cancel",
                                )
                            )
                        processed += 1
                    futures.clear()
                    break

    results.extend(scan_errors)
    set_setting(LAST_RESCAN_KEY, datetime.now().isoformat())
    counts = _result_counts(results)
    response = LibraryRescanResponse(results=results, **counts)
    cancelled = _cancel_event.is_set()
    if progress_callback:
        progress_callback(
            {
                "stage": "cancelled" if cancelled else "completed",
                "message": "문서 새로고침이 정지되었습니다." if cancelled else "대상 폴더 색인이 완료되었습니다.",
                "mode": mode,
                "worker_count": worker_count,
                "found": total,
                "total": total,
                "processed": len(results) - len(scan_errors),
                "percent": round((len(results) - len(scan_errors)) / total * 100, 1) if total else 100.0,
                "eta_seconds": None,
                "current_file": None,
                "summary": response,
                "cancel_requested": cancelled,
                **counts,
            }
        )
    return response


def _run_rescan_job(mode: str) -> None:
    mode = _normalize_rescan_mode(mode)
    try:
        summary = rescan_library(progress_callback=_update_rescan_status, mode=mode)
        cancelled = _cancel_event.is_set()
        _update_rescan_status(
            {
                "running": False,
                "stage": "cancelled" if cancelled else "completed",
                "message": "문서 새로고침이 정지되었습니다." if cancelled else "대상 폴더 색인이 완료되었습니다.",
                "mode": mode,
                "percent": _rescan_status.get("percent", 100.0),
                "eta_seconds": None,
                "summary": summary,
                "cancel_requested": cancelled,
                "error": None,
            }
        )
    except Exception as exc:
        logger.exception("library rescan job failed")
        _update_rescan_status(
            {
                "running": False,
                "stage": "failed",
                "message": "대상 폴더 색인에 실패했습니다.",
                "mode": mode,
                "eta_seconds": None,
                "error": str(exc),
            }
        )
    finally:
        _cancel_event.clear()


def start_library_rescan(mode: str = "normal") -> LibraryRescanStatus:
    mode = _normalize_rescan_mode(mode)
    settings = load_library_settings()
    worker_count = _rescan_worker_count(mode, settings)
    with _rescan_status_lock:
        if _rescan_status.get("running"):
            return LibraryRescanStatus(**_rescan_status)

        _cancel_event.clear()
        _rescan_status.clear()
        _rescan_status.update(
            LibraryRescanStatus(
                running=True,
                stage="queued",
                message="대상 폴더 색인을 준비하는 중입니다." if mode == "normal" else "고속 색인을 준비하는 중입니다.",
                mode=mode,
                worker_count=worker_count,
                started_at=_now_iso(),
                updated_at=_now_iso(),
            ).model_dump()
        )

    thread = threading.Thread(target=_run_rescan_job, args=(mode,), daemon=True, name="library-rescan")
    thread.start()
    return _status_snapshot()


def cancel_library_rescan() -> LibraryRescanStatus:
    with _rescan_status_lock:
        if not _rescan_status.get("running"):
            return LibraryRescanStatus(**_rescan_status)
        _cancel_event.set()
        _rescan_status.update(
            {
                "stage": "cancelling",
                "message": "정지 요청을 처리하는 중입니다.",
                "cancel_requested": True,
                "updated_at": _now_iso(),
            }
        )
        return LibraryRescanStatus(**_rescan_status)

def _bounded_limit(limit: int, *, default: int = DEFAULT_GROUP_LIMIT, maximum: int = MAX_GROUP_LIMIT) -> int:
    if limit < 1:
        return default
    return min(limit, maximum)


def _slug(value: str) -> str:
    base = re.sub(r"[^a-z0-9가-힣]+", "-", value.lower()).strip("-") or "group"
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]
    return f"{base}-{digest}"


def _recommended_action(file_type: str) -> str:
    return "excel_integrate" if file_type == "Excel" else "compare_latest"


def _tokens_summary(identities: List[Dict[str, Any]]) -> List[str]:
    seen: set[str] = set()
    summary: List[str] = []
    for identity in identities:
        for token in identity["tokens"]:
            display = _token_display(token)
            if display in seen:
                continue
            seen.add(display)
            summary.append(display)
    return summary


def _content_evidence(
    files: List[FileInfo],
    fingerprint_by_id: Dict[int, Dict[str, Any]],
    expected_count: Optional[int] = None,
) -> Dict[str, Any]:
    total_count = expected_count if expected_count is not None else len(files)
    fingerprints = [fingerprint_by_id[file.id] for file in files if file.id in fingerprint_by_id]
    usable = [
        fingerprint
        for fingerprint in fingerprints
        if int(fingerprint.get("chunk_count") or 0) > 0 and int(fingerprint.get("content_chars") or 0) > 0
    ]
    unique_hashes = {str(fingerprint["normalized_hash"]) for fingerprint in usable}

    if not fingerprints:
        status = "pending"
        evidence = "내용 fingerprint가 아직 준비되지 않았습니다. 재색인 후 더 정확히 판단합니다."
    elif not usable:
        status = "not_enough_content"
        evidence = "추출된 본문이 부족해 내용 동일 여부를 판단하지 않습니다."
    elif len(usable) < total_count:
        status = "partial"
        evidence = f"{total_count}개 중 {len(usable)}개 파일만 내용 fingerprint가 있어 단정하지 않습니다."
    elif len(unique_hashes) == 1:
        status = "same_content"
        evidence = f"{len(usable)}개 파일의 추출 내용 fingerprint가 같습니다."
    else:
        status = "content_differs"
        evidence = f"{len(usable)}개 파일에서 {len(unique_hashes)}가지 추출 내용 fingerprint가 발견되었습니다."

    return {
        "content_status": status,
        "fingerprint_coverage": len(usable),
        "fingerprint_unique_count": len(unique_hashes),
        "content_evidence": evidence,
    }


def _reason_with_content_evidence(reason: str, content: Dict[str, Any]) -> str:
    status = content["content_status"]
    if status == "same_content":
        return f"{reason} 내용 fingerprint 기준으로는 같은 내용으로 보입니다."
    if status == "content_differs":
        return f"{reason} 내용 fingerprint가 달라 실제 변경 가능성이 있습니다."
    return reason


def _with_content_evidence(
    group: LibraryGroupDetail,
    evidence_files: List[FileInfo],
) -> LibraryGroupDetail:
    fingerprint_by_id = ensure_file_fingerprints([file.id for file in evidence_files])
    content = _content_evidence(
        evidence_files,
        fingerprint_by_id,
        expected_count=group.file_count,
    )
    return LibraryGroupDetail(
        **{
            **group.model_dump(
                exclude={
                    "content_status",
                    "fingerprint_coverage",
                    "fingerprint_unique_count",
                    "content_evidence",
                    "reason",
                }
            ),
            "reason": _reason_with_content_evidence(group.reason, content),
            **content,
        }
    )


def _version_file_sort_key(file_info: FileInfo) -> Tuple[Any, ...]:
    identity = parse_document_identity(file_info.name)
    return (*identity["sort_key"], *file_sort_key(file_info))


def _group_detail(
    *,
    group_kind: str,
    file_type: str,
    base_name: str,
    files: List[FileInfo],
    confidence: str,
    reason: str,
    tokens_summary: Optional[List[str]] = None,
    fingerprint_by_id: Optional[Dict[int, Dict[str, Any]]] = None,
    manual_latest_by_group: Optional[Dict[str, int]] = None,
) -> LibraryGroupDetail:
    group_id = _slug(f"{group_kind}-{file_type}-{base_name}")
    ordered = sorted(
        files,
        key=_version_file_sort_key if group_kind == "version_family" else file_sort_key,
        reverse=True,
    )
    manual_latest_file_id: Optional[int] = None
    manual_file_id = (manual_latest_by_group or {}).get(group_id)
    if manual_file_id is not None:
        manual_file = next((file for file in ordered if file.id == manual_file_id), None)
        if manual_file:
            ordered = [manual_file, *(file for file in ordered if file.id != manual_file_id)]
            manual_latest_file_id = manual_file.id

    content = _content_evidence(ordered, fingerprint_by_id or {}, expected_count=len(ordered))
    return LibraryGroupDetail(
        id=group_id,
        group_kind=group_kind,
        file_type=file_type,
        base_name=base_name,
        canonical_name=base_name,
        title=ordered[0].name,
        file_count=len(ordered),
        confidence=confidence,
        reason=_reason_with_content_evidence(reason, content),
        latest_file=ordered[0] if ordered else None,
        previous_file=ordered[1] if len(ordered) > 1 else None,
        tokens_summary=tokens_summary or [],
        content_status=content["content_status"],
        fingerprint_coverage=content["fingerprint_coverage"],
        fingerprint_unique_count=content["fingerprint_unique_count"],
        content_evidence=content["content_evidence"],
        recommended_action=_recommended_action(file_type),
        manual_latest_file_id=manual_latest_file_id,
        files=ordered,
    )


def _all_file_group_details() -> List[LibraryGroupDetail]:
    exact_buckets: Dict[Tuple[str, str], List[FileInfo]] = {}
    version_buckets: Dict[Tuple[str, str], List[Tuple[FileInfo, Dict[str, Any]]]] = {}
    manual_latest_by_group = _load_manual_latest_map()

    for row in get_all_files():
        file_info = file_info_from_row(row)
        if file_info.file_type not in OFFICE_FILE_TYPES:
            continue

        exact_buckets.setdefault((file_info.file_type, file_info.name.lower()), []).append(file_info)

        identity = parse_document_identity(file_info.name)
        if identity["tokens"]:
            version_buckets.setdefault((file_info.file_type, identity["base_name"]), []).append((file_info, identity))

    groups: List[LibraryGroupDetail] = []
    for (file_type, _name_key), files in exact_buckets.items():
        paths = {os.path.normpath(file.path) for file in files}
        if len(files) < 2 or len(paths) < 2:
            continue
        groups.append(
            _group_detail(
                group_kind="exact_name_conflict",
                file_type=file_type,
                base_name=files[0].name.lower(),
                files=files,
                confidence="exact_filename",
                reason="같은 파일명이 여러 위치에 있습니다. 내용을 확인해 보세요.",
                manual_latest_by_group=manual_latest_by_group,
            )
        )

    for (file_type, base_name), items in version_buckets.items():
        files = [file for file, _identity in items]
        if len(files) < 2:
            continue
        token_signatures = {
            tuple((token["kind"], str(token["value"])) for token in identity["tokens"])
            for _file, identity in items
        }
        if len(token_signatures) < 2:
            continue
        groups.append(
            _group_detail(
                group_kind="version_family",
                file_type=file_type,
                base_name=base_name,
                files=files,
                confidence="filename_tokens",
                reason="파일명에서 버전/날짜/상태 표시를 감지했습니다. 같은 문서 계열 후보로 확인해 보세요.",
                tokens_summary=_tokens_summary([identity for _file, identity in items]),
                manual_latest_by_group=manual_latest_by_group,
            )
        )

    groups.sort(
        key=lambda group: (
            file_sort_key(group.latest_file) if group.latest_file else (0, ""),
            group.file_count,
            group.group_kind == "exact_name_conflict",
        ),
        reverse=True,
    )
    return groups


def _group_summary(group: LibraryGroupDetail) -> LibraryGroupSummary:
    return LibraryGroupSummary(
        id=group.id,
        group_kind=group.group_kind,
        file_type=group.file_type,
        base_name=group.base_name,
        canonical_name=group.canonical_name,
        title=group.title,
        file_count=group.file_count,
        confidence=group.confidence,
        reason=group.reason,
        latest_file=group.latest_file,
        previous_file=group.previous_file,
        manual_latest_file_id=group.manual_latest_file_id,
        tokens_summary=group.tokens_summary,
        content_status=group.content_status,
        fingerprint_coverage=group.fingerprint_coverage,
        fingerprint_unique_count=group.fingerprint_unique_count,
        content_evidence=group.content_evidence,
        recommended_action=group.recommended_action,
    )


def list_file_groups(
    *,
    kind: Optional[str] = None,
    file_type: Optional[str] = None,
    query: Optional[str] = None,
    sort: str = "recent",
    limit: int = DEFAULT_GROUP_LIMIT,
    offset: int = 0,
) -> LibraryGroupsResponse:
    safe_limit = _bounded_limit(limit)
    safe_offset = max(0, offset)
    groups = _all_file_group_details()
    if kind:
        groups = [group for group in groups if group.group_kind == kind]
    if file_type:
        groups = [group for group in groups if group.file_type == file_type]
    normalized_query = (query or "").strip().lower()
    if normalized_query:
        groups = [
            group
            for group in groups
            if normalized_query in " ".join(
                [
                    group.base_name,
                    group.title,
                    group.file_type,
                    group.group_kind,
                    *(group.tokens_summary or []),
                    *(file.name for file in group.files),
                    *(file.path for file in group.files),
                ]
            ).lower()
        ]

    if sort == "name":
        groups.sort(key=lambda group: (group.base_name.lower(), group.file_type, group.group_kind))
    elif sort == "count":
        groups.sort(key=lambda group: (-group.file_count, group.base_name.lower(), group.file_type, group.group_kind))
    elif sort == "content":
        content_rank = {
            "content_differs": 4,
            "partial": 3,
            "pending": 2,
            "not_enough_content": 1,
            "same_content": 0,
        }
        groups.sort(key=lambda group: (content_rank.get(group.content_status, 0), group.file_count), reverse=True)

    counts_by_kind: Dict[str, int] = {}
    for group in groups:
        counts_by_kind[group.group_kind] = counts_by_kind.get(group.group_kind, 0) + 1

    page = [
        _with_content_evidence(
            group,
            group.files[:MAX_GROUP_SUMMARY_FINGERPRINT_FILES],
        )
        for group in groups[safe_offset : safe_offset + safe_limit]
    ]
    return LibraryGroupsResponse(
        total=len(groups),
        groups=[_group_summary(group) for group in page],
        limit=safe_limit,
        offset=safe_offset,
        counts_by_kind=counts_by_kind,
    )


def get_file_group_detail(group_id: str, *, limit: int = MAX_GROUP_DETAIL_LIMIT) -> Optional[LibraryGroupDetail]:
    safe_limit = _bounded_limit(limit, default=MAX_GROUP_DETAIL_LIMIT, maximum=MAX_GROUP_DETAIL_LIMIT)
    for group in _all_file_group_details():
        if group.id != group_id:
            continue
        page_files = group.files[:safe_limit]
        enriched = _with_content_evidence(group, page_files)
        return LibraryGroupDetail(
            **{
                **enriched.model_dump(exclude={"files"}),
                "files": page_files,
            }
        )
    return None


def set_group_latest_file(group_id: str, file_id: int) -> Optional[LibraryGroupDetail]:
    target_group = next((group for group in _all_file_group_details() if group.id == group_id), None)
    if not target_group:
        return None

    try:
        safe_file_id = int(file_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("파일 ID가 올바르지 않습니다.") from exc

    if safe_file_id <= 0 or all(file.id != safe_file_id for file in target_group.files):
        raise ValueError("선택한 파일이 이 문서 묶음에 포함되어 있지 않습니다.")

    manual_latest = _load_manual_latest_map()
    manual_latest[group_id] = safe_file_id
    _save_manual_latest_map(manual_latest)

    return get_file_group_detail(group_id)


def clear_group_latest_file(group_id: str) -> Optional[LibraryGroupDetail]:
    target_group = next((group for group in _all_file_group_details() if group.id == group_id), None)
    if not target_group:
        return None

    manual_latest = _load_manual_latest_map()
    if group_id in manual_latest:
        manual_latest.pop(group_id, None)
        _save_manual_latest_map(manual_latest)

    return get_file_group_detail(group_id)


def build_file_groups() -> List[LibraryFileGroup]:
    return [
        LibraryFileGroup(
            **group.model_dump(),
        )
        for group in _all_file_group_details()
    ]


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
