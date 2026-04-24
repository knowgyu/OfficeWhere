import os
import subprocess
import sys
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException

from ..core.file_access import inspect_file_path, pick_local_file, pick_local_folder, scan_folder
from ..core.indexer import inspect_and_chunk
from ..core.normalizer import suggest_key_column
from ..core.parser import SUPPORTED_EXTENSIONS, get_file_schema
from ..database import (
    delete_file,
    get_all_files,
    get_file_by_id,
    register_file,
    save_file_chunks,
    update_file_mtime,
)
from ..models.schemas import (
    BulkRegisterItem,
    BulkRegisterRequest,
    BulkRegisterResponse,
    BulkRegisterResult,
    FileInfo,
    FileInspectRequest,
    FileInspectResponse,
    FilePickResponse,
    FileRegisterRequest,
    FileRegisterResponse,
    FolderPickResponse,
    FolderScanRequest,
    FolderScanResponse,
    ScannedFileInfo,
    SchemaResponse,
)

router = APIRouter(prefix="/api/files", tags=["files"])


def _validate_registration_payload(
    path: str,
    file_type: str,
    columns: List[str],
    requested_key_column: str,
) -> str:
    if file_type == "Excel":
        if not requested_key_column:
            raise HTTPException(status_code=400, detail="Excel 등록에는 key_column 이 필요합니다.")
        if requested_key_column not in columns:
            suggested = suggest_key_column(columns)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"key 컬럼 '{requested_key_column}'이(가) 파일에 없습니다. "
                    f"사용 가능한 컬럼: {columns}. 추천 key 컬럼: {suggested}"
                ),
            )
        return requested_key_column
    return requested_key_column or ""


@router.post("/inspect", response_model=FileInspectResponse)
def inspect_file(req: FileInspectRequest):
    try:
        info = inspect_file_path(req.path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 검사 실패: {exc}")

    return FileInspectResponse(**info)


@router.post("/pick", response_model=FilePickResponse)
def pick_file():
    try:
        path = pick_local_file()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    if not path:
        return FilePickResponse(cancelled=True, file=None)

    try:
        info = inspect_file_path(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 검사 실패: {exc}")

    return FilePickResponse(cancelled=False, file=FileInspectResponse(**info))


@router.post("", response_model=FileRegisterResponse)
def register(req: FileRegisterRequest):
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
        info, chunks = inspect_and_chunk(path, parser_config=req.parser_config)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {exc}")

    key_column = _validate_registration_payload(path, info["file_type"], info["columns"], req.key_column)
    file_id = register_file(
        path=path,
        name=info["name"],
        file_type=info["file_type"],
        key_column=key_column,
        column_count=len(info["columns"]),
        parser_config=info["parser_config"],
    )

    try:
        save_file_chunks(file_id, chunks)
        update_file_mtime(file_id, os.path.getmtime(path))
    except Exception:
        pass

    return FileRegisterResponse(
        id=file_id,
        name=info["name"],
        file_type=info["file_type"],
        columns=info["columns"],
        parser_config=info["parser_config"],
    )


@router.get("", response_model=List[FileInfo])
def list_files():
    rows = get_all_files()
    return [
        FileInfo(
            id=row["id"],
            name=row["name"],
            path=row["path"],
            file_type=row["file_type"],
            key_column=row["key_column"],
            column_count=row["column_count"],
            parser_config=row.get("parser_config", {}),
            created_at=row["created_at"],
            file_mtime=row.get("file_mtime"),
        )
        for row in rows
    ]


@router.get("/{file_id}/schema", response_model=SchemaResponse)
def get_schema(file_id: int):
    file_row = get_file_by_id(file_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")

    path = file_row["path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {path}")

    try:
        schema = get_file_schema(path, parser_config=file_row.get("parser_config"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {exc}")

    return SchemaResponse(
        columns=schema["columns"],
        sample=schema["sample"],
        parser_config=schema.get("parser_config", {}),
    )


@router.delete("/{file_id}")
def remove_file(file_id: int):
    if not get_file_by_id(file_id):
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")
    delete_file(file_id)
    return {"message": "파일 등록이 해제되었습니다."}


@router.post("/{file_id}/open")
def open_registered_file(file_id: int):
    file_row = get_file_by_id(file_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")

    path = file_row["path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {path}")

    try:
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"파일을 열지 못했습니다: {exc}")

    return {"message": "파일 열기 요청을 보냈습니다."}


@router.get("/{file_id}/suggest-key")
def suggest_key(file_id: int):
    file_row = get_file_by_id(file_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")

    try:
        schema = get_file_schema(file_row["path"], parser_config=file_row.get("parser_config"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {exc}")

    columns = schema["columns"]
    suggested = suggest_key_column(columns) if file_row["file_type"] == "Excel" else None
    return {"columns": columns, "suggested_key_column": suggested}


@router.post("/pick-folder", response_model=FolderPickResponse)
def pick_folder():
    try:
        path = pick_local_folder()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if not path:
        return FolderPickResponse(cancelled=True, folder_path="")
    return FolderPickResponse(cancelled=False, folder_path=path)


@router.post("/scan-folder", response_model=FolderScanResponse)
def scan_folder_endpoint(req: FolderScanRequest):
    try:
        files = scan_folder(req.folder_path, req.recursive)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"폴더 스캔 실패: {exc}")
    return FolderScanResponse(
        folder_path=req.folder_path,
        total_found=len(files),
        files=[ScannedFileInfo(**info) for info in files],
    )


@router.post("/bulk-register", response_model=BulkRegisterResponse)
def bulk_register(req: BulkRegisterRequest):
    from concurrent.futures import ThreadPoolExecutor

    def _register_one(item: BulkRegisterItem) -> BulkRegisterResult:
        path = os.path.normpath(item.path)
        try:
            info, chunks = inspect_and_chunk(path, parser_config=item.parser_config)
            key_column = _validate_registration_payload(path, info["file_type"], info["columns"], item.key_column)
            file_id = register_file(
                path=path,
                name=info["name"],
                file_type=info["file_type"],
                key_column=key_column,
                column_count=len(info["columns"]),
                parser_config=info["parser_config"],
            )
            try:
                save_file_chunks(file_id, chunks)
                update_file_mtime(file_id, os.path.getmtime(path))
            except Exception:
                pass
            return BulkRegisterResult(path=path, name=info["name"], success=True, file_id=file_id)
        except Exception as exc:
            return BulkRegisterResult(path=path, name=Path(path).name, success=False, error=str(exc))

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(_register_one, req.files))

    registered = sum(1 for result in results if result.success)
    return BulkRegisterResponse(registered=registered, failed=len(results) - registered, results=results)
