import io
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import pandas as pd

from ..models.schemas import JoinRequest, JoinResponse
from ..database import get_file_by_id
from ..core.joiner import join_files

router = APIRouter(prefix="/api/query", tags=["query"])


def order_join_files(files, base_file_id: int | None):
    if base_file_id is None:
        return list(files)
    return sorted(files, key=lambda item: 0 if item.file_id == base_file_id else 1)


def _build_file_specs(req: JoinRequest):
    """JoinRequest에서 file_specs 리스트 생성"""
    selected_ids = [fs.file_id for fs in req.files]
    if req.join_type == "left":
        if req.base_file_id is None:
            raise HTTPException(status_code=400, detail="LEFT JOIN 기준 파일을 선택해 주세요.")
        if req.base_file_id not in selected_ids:
            raise HTTPException(status_code=400, detail="LEFT JOIN 기준 파일이 선택 목록에 없습니다.")

    file_specs = []
    for fs in order_join_files(req.files, req.base_file_id):
        file_row = get_file_by_id(fs.file_id)
        if not file_row:
            raise HTTPException(
                status_code=404,
                detail=f"등록되지 않은 파일입니다. (id={fs.file_id})",
            )
        if not os.path.exists(file_row["path"]):
            raise HTTPException(
                status_code=404,
                detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {file_row['path']}",
            )
        file_specs.append({
            "file_id": file_row["id"],
            "file_name": file_row["name"],
            "path": file_row["path"],
            "key_column": file_row["key_column"],
            "columns": fs.columns,
        })
    return file_specs


@router.post("/join", response_model=JoinResponse)
def join_query(req: JoinRequest):
    """JOIN 쿼리 실행"""
    if len(req.files) < 1:
        raise HTTPException(status_code=400, detail="JOIN할 파일을 1개 이상 선택해 주세요.")

    if req.join_type not in ("left", "outer", "inner"):
        raise HTTPException(
            status_code=400,
            detail="join_type은 'left', 'outer', 'inner' 중 하나여야 합니다.",
        )

    try:
        file_specs = _build_file_specs(req)
        df = join_files(file_specs, join_type=req.join_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"JOIN 처리 중 오류가 발생했습니다: {e}")

    df = df.fillna("")
    columns = list(df.columns)
    data = df.values.tolist()
    # 모든 값을 문자열로 변환
    data = [[str(v) if v != "" else "" for v in row] for row in data]

    return JoinResponse(columns=columns, data=data, total_rows=len(data))


@router.post("/export")
def export_join(req: JoinRequest):
    """JOIN 결과를 Excel 파일로 다운로드"""
    if len(req.files) < 1:
        raise HTTPException(status_code=400, detail="내보낼 파일을 1개 이상 선택해 주세요.")

    try:
        file_specs = _build_file_specs(req)
        df = join_files(file_specs, join_type=req.join_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"JOIN 처리 중 오류가 발생했습니다: {e}")

    # Excel 파일로 변환 (한글 깨짐 방지: openpyxl 사용)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="JOIN결과")
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=join_result.xlsx"},
    )
