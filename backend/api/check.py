import hashlib
import json
import os
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from ..core.checker import run_consistency_check
from ..core.excel_diff_grid import build_excel_diff_grid
from ..database import (
    COMPARISON_CACHE_VERSION,
    get_cached_comparison_result,
    get_file_by_id,
    save_cached_comparison_result,
)
from ..models.schemas import CheckRequest, CheckResponse, ExcelDiffGridRequest, ExcelDiffGridResponse

router = APIRouter(prefix="/api/check", tags=["check"])


def _comparison_cache_key(file_infos: List[Dict[str, Any]], comparison_mode: str) -> str:
    files: List[Dict[str, Any]] = []
    for info in file_infos:
        files.append(
            {
                "id": info["id"],
                "path": info["path"],
                "file_type": info["file_type"],
                "file_mtime": info.get("file_mtime"),
            }
        )
    payload = {
        "version": COMPARISON_CACHE_VERSION,
        "comparison_mode": comparison_mode,
        "files": files,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def _path_is_accessible(path: str) -> bool:
    try:
        return os.path.exists(path)
    except OSError:
        return True


def _source_stat_metadata(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    warnings: List[Dict[str, Any]] = []
    newer_file_ids: List[int] = []
    stat_errors = 0
    checked = False

    for info in file_infos:
        try:
            stat_result = os.stat(info["path"])
            checked = True
        except FileNotFoundError:
            stat_errors += 1
            checked = True
            continue
        except OSError:
            stat_errors += 1
            checked = True
            continue

        stored_mtime = info.get("file_mtime")
        if stored_mtime is None:
            continue
        try:
            if float(stat_result.st_mtime) > float(stored_mtime) + 1.0:
                newer_file_ids.append(int(info["id"]))
        except (TypeError, ValueError):
            continue

    if newer_file_ids:
        warnings.append(
            {
                "type": "source_may_be_newer",
                "severity": "warning",
                "message": "원본 파일이 마지막 색인 이후 수정된 것으로 보입니다. 현재 결과는 마지막 색인 기준일 수 있습니다.",
                "file_ids": newer_file_ids,
                "details": {"source": "api_check_stat"},
            }
        )

    return {
        "warnings": warnings,
        "used_last_index_snapshot": True,
        "source_stat_checked": checked,
        "source_stat_error_count": stat_errors,
    }


def _merge_metadata(base: Dict[str, Any] | None, addition: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base or {})
    existing_warnings = merged.get("warnings")
    warnings = list(existing_warnings) if isinstance(existing_warnings, list) else []
    added_warnings = addition.get("warnings")
    if isinstance(added_warnings, list):
        warnings.extend(added_warnings)
    merged["warnings"] = warnings

    for key, value in addition.items():
        if key == "warnings" or value is None:
            continue
        if key == "source_stat_error_count":
            merged[key] = int(merged.get(key) or 0) + int(value or 0)
        elif key == "source_stat_checked":
            merged[key] = bool(merged.get(key)) or bool(value)
        elif key == "used_last_index_snapshot":
            merged[key] = bool(merged.get(key, True)) and bool(value)
        else:
            merged[key] = value
    return merged


@router.post("", response_model=CheckResponse)
def consistency_check(req: CheckRequest):
    if len(req.file_ids) < 2:
        raise HTTPException(status_code=400, detail="정합성 검사는 최소 2개 파일을 선택해야 합니다.")

    comparison_mode = "version_history"
    file_infos = []
    for file_id in req.file_ids:
        file_row = get_file_by_id(file_id)
        if not file_row:
            raise HTTPException(status_code=404, detail=f"등록되지 않은 파일입니다. (id={file_id})")
        if not _path_is_accessible(file_row["path"]):
            raise HTTPException(
                status_code=404,
                detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {file_row['path']}",
            )
        file_infos.append(
            {
                "id": file_row["id"],
                "path": file_row["path"],
                "name": file_row["name"],
                "file_type": file_row["file_type"],
                "file_mtime": file_row.get("file_mtime"),
            }
        )

    file_types = {info["file_type"] for info in file_infos}
    if len(file_types) != 1:
        raise HTTPException(status_code=400, detail="서로 다른 파일 형식은 함께 비교할 수 없습니다.")

    cache_key = _comparison_cache_key(file_infos, comparison_mode)
    source_metadata = _source_stat_metadata(file_infos)
    cached = get_cached_comparison_result(cache_key)
    if cached is not None:
        try:
            cached["metadata"] = _merge_metadata(cached.get("metadata"), source_metadata)
            return CheckResponse(**cached)
        except Exception:
            cached = None

    try:
        result = run_consistency_check(file_infos)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"정합성 검사 중 오류가 발생했습니다: {exc}")

    result["metadata"] = _merge_metadata(result.get("metadata"), source_metadata)
    response = CheckResponse(**result)
    save_cached_comparison_result(cache_key, req.file_ids, comparison_mode, response.model_dump())
    return response



@router.post("/excel-grid", response_model=ExcelDiffGridResponse)
def excel_diff_grid(req: ExcelDiffGridRequest):
    if len(req.file_ids) < 2:
        raise HTTPException(status_code=400, detail="표로 보기는 최소 2개 Excel 파일이 필요합니다.")

    file_infos = []
    for file_id in req.file_ids:
        file_row = get_file_by_id(file_id)
        if not file_row:
            raise HTTPException(status_code=404, detail=f"등록되지 않은 파일입니다. (id={file_id})")
        if not _path_is_accessible(file_row["path"]):
            raise HTTPException(
                status_code=404,
                detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {file_row['path']}",
            )
        if file_row["file_type"] != "Excel":
            raise HTTPException(status_code=400, detail="표로 보기는 Excel 파일만 지원합니다.")
        file_infos.append(
            {
                "id": file_row["id"],
                "path": file_row["path"],
                "name": file_row["name"],
                "file_type": file_row["file_type"],
                "file_mtime": file_row.get("file_mtime"),
            }
        )

    try:
        result = build_excel_diff_grid(file_infos, req.focuses)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Excel 표를 만드는 중 오류가 발생했습니다: {exc}")

    return ExcelDiffGridResponse(**result)
