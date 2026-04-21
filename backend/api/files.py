import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from typing import List

from ..models.schemas import (
    FileRegisterRequest,
    FileRegisterResponse,
    FileInfo,
    SchemaResponse,
)
from ..database import register_file, get_all_files, get_file_by_id, delete_file
from ..core.parser import parse_file, get_file_schema, get_file_type, SUPPORTED_EXTENSIONS
from ..core.normalizer import suggest_key_column

router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("", response_model=FileRegisterResponse)
def register(req: FileRegisterRequest):
    """파일 등록"""
    path = os.path.normpath(req.path)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: {path}")

    ext = Path(path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다: {ext}. 지원 형식: .xlsx, .xls, .docx, .pptx",
        )

    try:
        schema = get_file_schema(path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {e}")

    columns = schema["columns"]
    if req.key_column not in columns:
        # key 컬럼 자동 추천
        suggested = suggest_key_column(columns)
        raise HTTPException(
            status_code=400,
            detail=(
                f"key 컬럼 '{req.key_column}'이(가) 파일에 없습니다. "
                f"사용 가능한 컬럼: {columns}. "
                f"추천 key 컬럼: {suggested}"
            ),
        )

    name = Path(path).name
    file_type = get_file_type(path)
    file_id = register_file(
        path=path,
        name=name,
        file_type=file_type,
        key_column=req.key_column,
        column_count=len(columns),
    )

    return FileRegisterResponse(id=file_id, name=name, columns=columns)


@router.get("", response_model=List[FileInfo])
def list_files():
    """등록된 파일 목록 조회"""
    rows = get_all_files()
    result = []
    for row in rows:
        result.append(
            FileInfo(
                id=row["id"],
                name=row["name"],
                path=row["path"],
                file_type=row["file_type"],
                key_column=row["key_column"],
                column_count=row["column_count"],
                created_at=row["created_at"],
            )
        )
    return result


@router.get("/{file_id}/schema", response_model=SchemaResponse)
def get_schema(file_id: int):
    """파일 스키마(컬럼 목록 + 샘플) 조회"""
    file_row = get_file_by_id(file_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")

    path = file_row["path"]
    if not os.path.exists(path):
        raise HTTPException(
            status_code=404,
            detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {path}",
        )

    try:
        schema = get_file_schema(path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {e}")

    return SchemaResponse(columns=schema["columns"], sample=schema["sample"])


@router.delete("/{file_id}")
def remove_file(file_id: int):
    """파일 등록 해제"""
    if not get_file_by_id(file_id):
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")
    delete_file(file_id)
    return {"message": "파일 등록이 해제되었습니다."}


@router.get("/{file_id}/suggest-key")
def suggest_key(file_id: int):
    """파일의 key 컬럼 추천"""
    file_row = get_file_by_id(file_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")

    path = file_row["path"]
    try:
        schema = get_file_schema(path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {e}")

    columns = schema["columns"]
    suggested = suggest_key_column(columns)
    return {"columns": columns, "suggested_key_column": suggested}
