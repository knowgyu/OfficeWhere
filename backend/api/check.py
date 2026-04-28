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


def _comparison_cache_key(file_infos: List[Dict[str, Any]], comparison_scope: str) -> str:
    files: List[Dict[str, Any]] = []
    for info in file_infos:
        stat_result = os.stat(info["path"])
        files.append(
            {
                "id": info["id"],
                "path": info["path"],
                "file_type": info["file_type"],
                "key_column": info.get("key_column", ""),
                "parser_config": info.get("parser_config", {}),
                "mtime_ns": stat_result.st_mtime_ns,
                "size": stat_result.st_size,
            }
        )
    payload = {
        "version": COMPARISON_CACHE_VERSION,
        "comparison_scope": comparison_scope,
        "files": files,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


@router.post("", response_model=CheckResponse)
def consistency_check(req: CheckRequest):
    if len(req.file_ids) < 2:
        raise HTTPException(status_code=400, detail="정합성 검사는 최소 2개 파일을 선택해야 합니다.")

    file_infos = []
    for file_id in req.file_ids:
        file_row = get_file_by_id(file_id)
        if not file_row:
            raise HTTPException(status_code=404, detail=f"등록되지 않은 파일입니다. (id={file_id})")
        if not os.path.exists(file_row["path"]):
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
                "key_column": file_row["key_column"],
                "parser_config": file_row.get("parser_config", {}),
            }
        )

    file_types = {info["file_type"] for info in file_infos}
    if len(file_types) != 1:
        raise HTTPException(status_code=400, detail="서로 다른 파일 형식은 함께 비교할 수 없습니다.")

    cache_key = _comparison_cache_key(file_infos, req.comparison_scope)
    cached = get_cached_comparison_result(cache_key)
    if cached is not None:
        try:
            return CheckResponse(**cached)
        except Exception:
            cached = None

    try:
        result = run_consistency_check(file_infos, comparison_scope=req.comparison_scope)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"정합성 검사 중 오류가 발생했습니다: {exc}")

    response = CheckResponse(**result)
    save_cached_comparison_result(cache_key, req.file_ids, req.comparison_scope, response.model_dump())
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
        if not os.path.exists(file_row["path"]):
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
                "key_column": file_row["key_column"],
                "parser_config": file_row.get("parser_config", {}),
            }
        )

    try:
        result = build_excel_diff_grid(file_infos, req.focuses)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Excel 표를 만드는 중 오류가 발생했습니다: {exc}")

    return ExcelDiffGridResponse(**result)
