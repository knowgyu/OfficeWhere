import os
from fastapi import APIRouter, HTTPException

from ..models.schemas import CheckRequest, CheckResponse
from ..database import get_file_by_id
from ..core.checker import run_consistency_check

router = APIRouter(prefix="/api/check", tags=["check"])


@router.post("", response_model=CheckResponse)
def consistency_check(req: CheckRequest):
    """정합성 검사 실행"""
    if len(req.file_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="정합성 검사는 최소 2개 파일을 선택해야 합니다.",
        )

    file_infos = []
    for fid in req.file_ids:
        file_row = get_file_by_id(fid)
        if not file_row:
            raise HTTPException(
                status_code=404,
                detail=f"등록되지 않은 파일입니다. (id={fid})",
            )
        if not os.path.exists(file_row["path"]):
            raise HTTPException(
                status_code=404,
                detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {file_row['path']}",
            )
        file_infos.append({
            "id": file_row["id"],
            "path": file_row["path"],
            "name": file_row["name"],
            "key_column": file_row["key_column"],
        })

    try:
        result = run_consistency_check(file_infos)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"정합성 검사 중 오류가 발생했습니다: {e}")

    return CheckResponse(
        total_keys=result["total_keys"],
        matched_keys=result["matched_keys"],
        issues=result["issues"],
    )
