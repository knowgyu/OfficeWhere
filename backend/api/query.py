import io
import os

import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..core.joiner import join_files
from ..database import get_file_by_id
from ..models.schemas import JoinRequest, JoinResponse

router = APIRouter(prefix="/api/query", tags=["query"])


def order_join_files(files, base_file_id: int | None):
    if base_file_id is None:
        return list(files)
    return sorted(files, key=lambda item: 0 if item.file_id == base_file_id else 1)


def _build_file_specs(req: JoinRequest):
    selected_ids = [item.file_id for item in req.files]
    if req.join_type == "left":
        if req.base_file_id is None:
            raise HTTPException(status_code=400, detail="LEFT JOIN 기준 파일을 선택해 주세요.")
        if req.base_file_id not in selected_ids:
            raise HTTPException(status_code=400, detail="LEFT JOIN 기준 파일이 선택 목록에 없습니다.")

    file_specs = []
    for item in order_join_files(req.files, req.base_file_id):
        file_row = get_file_by_id(item.file_id)
        if not file_row:
            raise HTTPException(status_code=404, detail=f"등록되지 않은 파일입니다. (id={item.file_id})")
        if not os.path.exists(file_row["path"]):
            raise HTTPException(
                status_code=404,
                detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {file_row['path']}",
            )
        if file_row["file_type"] != "Excel":
            raise HTTPException(status_code=400, detail="JOIN은 Excel 파일만 선택할 수 있습니다.")
        file_specs.append(
            {
                "file_id": file_row["id"],
                "file_name": file_row["name"],
                "file_type": file_row["file_type"],
                "path": file_row["path"],
                "key_column": file_row["key_column"],
                "parser_config": file_row.get("parser_config", {}),
                "columns": item.columns,
            }
        )
    return file_specs


@router.post("/join", response_model=JoinResponse)
def join_query(req: JoinRequest):
    if len(req.files) < 1:
        raise HTTPException(status_code=400, detail="JOIN할 파일을 1개 이상 선택해 주세요.")
    if req.join_type not in {"left", "outer", "inner"}:
        raise HTTPException(status_code=400, detail="join_type은 'left', 'outer', 'inner' 중 하나여야 합니다.")

    try:
        df = join_files(_build_file_specs(req), join_type=req.join_type)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"JOIN 처리 중 오류가 발생했습니다: {exc}")

    df = df.fillna("")
    data = [[str(value) if value != "" else "" for value in row] for row in df.values.tolist()]
    return JoinResponse(columns=list(df.columns), data=data, total_rows=len(data))


@router.post("/export")
def export_join(req: JoinRequest):
    if len(req.files) < 1:
        raise HTTPException(status_code=400, detail="내보낼 파일을 1개 이상 선택해 주세요.")

    try:
        df = join_files(_build_file_specs(req), join_type=req.join_type)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"JOIN 처리 중 오류가 발생했습니다: {exc}")

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="JOIN결과")
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=join_result.xlsx"},
    )
