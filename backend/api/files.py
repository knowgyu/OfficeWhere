import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Annotated, List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..core.file_access import inspect_file_path, pick_local_file, pick_local_folder, scan_folder
from ..core.file_scope import SUPPORTED_EXTENSIONS, SUPPORTED_EXTENSIONS_LABEL
from ..core.index_perf import elapsed_ms, log_index_perf, timed_ms
from ..core.indexer import inspect_and_chunk
from ..core.parser import get_file_schema
from ..database import (
    count_files,
    count_files_by_type,
    delete_all_files,
    delete_file,
    get_all_files,
    get_file_by_id,
    list_files_page,
    save_indexed_file,
)
from ..models.schemas import (
    BulkRegisterItem,
    BulkRegisterRequest,
    BulkRegisterResponse,
    BulkRegisterResult,
    FileInfo,
    FileInspectRequest,
    FileInspectResponse,
    FileListResponse,
    FilePickResponse,
    FileRegisterRequest,
    FileRegisterResponse,
    FilesDeleteAllResponse,
    FolderPickResponse,
    FolderScanRequest,
    FolderScanResponse,
    ScannedFileInfo,
    SchemaResponse,
)
from ..runtime import get_worker_count

router = APIRouter(prefix="/api/files", tags=["files"])

DEFAULT_FILE_PAGE_LIMIT = 50
MAX_FILE_PAGE_LIMIT = 100


def _normalize_file_page_limit(limit: int) -> int:
    if limit < 1:
        return DEFAULT_FILE_PAGE_LIMIT
    return min(limit, MAX_FILE_PAGE_LIMIT)


def _file_info_from_row(row: dict) -> FileInfo:
    return FileInfo(
        id=row["id"],
        name=row["name"],
        path=row["path"],
        file_type=row["file_type"],
        key_column=row.get("key_column", ""),
        column_count=row["column_count"],
        parser_config=row.get("parser_config", {}),
        created_at=row["created_at"],
        file_mtime=row.get("file_mtime"),
    )


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
    started = time.perf_counter()
    path = os.path.normpath(req.path)
    metrics = {
        "operation": "file_register",
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
    }
    if not os.path.exists(path):
        log_index_perf(
            "file_done",
            **metrics,
            action="failed",
            success=False,
            error_type="FileNotFoundError",
            error=f"파일을 찾을 수 없습니다: {path}",
            total_ms=elapsed_ms(started),
        )
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: {path}")

    ext = Path(path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        log_index_perf(
            "file_done",
            **metrics,
            action="failed",
            success=False,
            error_type="UnsupportedFileType",
            error=f"지원하지 않는 파일 형식입니다: {ext}",
            total_ms=elapsed_ms(started),
        )
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다: {ext}. 지원 형식: {SUPPORTED_EXTENSIONS_LABEL}",
        )

    try:
        stat_result = timed_ms(metrics, "stat_ms", lambda: os.stat(path))
        metrics["size_bytes"] = stat_result.st_size
        info, chunks = timed_ms(metrics, "inspect_chunk_ms", lambda: inspect_and_chunk(path))
    except FileNotFoundError as exc:
        log_index_perf(
            "file_done",
            **metrics,
            action="failed",
            success=False,
            error_type=exc.__class__.__name__,
            error=str(exc),
            total_ms=elapsed_ms(started),
        )
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        log_index_perf(
            "file_done",
            **metrics,
            action="failed",
            success=False,
            error_type=exc.__class__.__name__,
            error=str(exc),
            total_ms=elapsed_ms(started),
        )
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log_index_perf(
            "file_done",
            **metrics,
            action="failed",
            success=False,
            error_type=exc.__class__.__name__,
            error=str(exc),
            total_ms=elapsed_ms(started),
        )
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {exc}")

    file_id = timed_ms(
        metrics,
        "save_ms",
        lambda: save_indexed_file(
            path=path,
            name=info["name"],
            file_type=info["file_type"],
            key_column="",
            column_count=len(info["columns"]),
            chunks=chunks,
            file_mtime=stat_result.st_mtime,
            parser_config=None,
        ),
    )
    log_index_perf(
        "file_done",
        **metrics,
        action="registered",
        success=True,
        file_id=file_id,
        file_type=info["file_type"],
        chunk_count=len(chunks),
        column_count=len(info["columns"]),
        total_ms=elapsed_ms(started),
    )

    return FileRegisterResponse(
        id=file_id,
        name=info["name"],
        file_type=info["file_type"],
        columns=info["columns"],
        parser_config={},
    )


@router.get("", response_model=List[FileInfo])
def list_files():
    rows = get_all_files()
    return [_file_info_from_row(row) for row in rows]


@router.get("/page", response_model=FileListResponse)
def list_files_bounded(
    q: str = "",
    file_types: Annotated[Optional[List[str]], Query()] = None,
    limit: int = DEFAULT_FILE_PAGE_LIMIT,
    offset: int = 0,
    sort: str = "created_at_desc",
):
    safe_limit = _normalize_file_page_limit(limit)
    safe_offset = max(0, offset)
    filters = [file_type for file_type in (file_types or []) if file_type]
    rows = list_files_page(
        query=q,
        file_types=filters,
        limit=safe_limit,
        offset=safe_offset,
        sort=sort,
    )
    return FileListResponse(
        total=count_files(q, filters),
        items=[_file_info_from_row(row) for row in rows],
        counts_by_type=count_files_by_type(q, filters),
        limit=safe_limit,
        offset=safe_offset,
    )


@router.get("/{file_id}/schema", response_model=SchemaResponse)
def get_schema(file_id: int):
    file_row = get_file_by_id(file_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")

    path = file_row["path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"파일이 삭제되었거나 경로가 변경되었습니다: {path}")

    try:
        schema = get_file_schema(path)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {exc}")

    return SchemaResponse(columns=schema["columns"], sample=schema["sample"], parser_config={})


@router.delete("/{file_id}")
def remove_file(file_id: int):
    if not get_file_by_id(file_id):
        raise HTTPException(status_code=404, detail="등록되지 않은 파일입니다.")
    delete_file(file_id)
    return {"message": "파일 등록이 해제되었습니다."}


@router.delete("", response_model=FilesDeleteAllResponse)
@router.delete("/", response_model=FilesDeleteAllResponse)
def remove_all_files():
    deleted = delete_all_files()
    return {
        "deleted": deleted,
        "message": "전체 파일 등록이 해제되었습니다.",
    }


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
        schema = get_file_schema(file_row["path"])
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"파일 파싱 실패: {exc}")

    columns = schema["columns"]
    return {"columns": columns, "suggested_key_column": None}


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
        started = time.perf_counter()
        path = os.path.normpath(item.path)
        metrics = {
            "operation": "bulk_register",
            "path": path,
            "name": Path(path).name,
            "ext": Path(path).suffix.lower(),
        }
        try:
            stat_result = timed_ms(metrics, "stat_ms", lambda: os.stat(path))
            metrics["size_bytes"] = stat_result.st_size
            info, chunks = timed_ms(metrics, "inspect_chunk_ms", lambda: inspect_and_chunk(path))
            file_id = timed_ms(
                metrics,
                "save_ms",
                lambda: save_indexed_file(
                    path=path,
                    name=info["name"],
                    file_type=info["file_type"],
                    key_column="",
                    column_count=len(info["columns"]),
                    chunks=chunks,
                    file_mtime=stat_result.st_mtime,
                    parser_config=None,
                ),
            )
            log_index_perf(
                "file_done",
                **metrics,
                action="registered",
                success=True,
                file_id=file_id,
                file_type=info["file_type"],
                chunk_count=len(chunks),
                column_count=len(info["columns"]),
                total_ms=elapsed_ms(started),
            )
            return BulkRegisterResult(path=path, name=info["name"], success=True, file_id=file_id)
        except Exception as exc:
            log_index_perf(
                "file_done",
                **metrics,
                action="failed",
                success=False,
                error_type=exc.__class__.__name__,
                error=str(exc),
                total_ms=elapsed_ms(started),
            )
            return BulkRegisterResult(path=path, name=Path(path).name, success=False, error=str(exc))

    with ThreadPoolExecutor(max_workers=get_worker_count()) as executor:
        results = list(executor.map(_register_one, req.files))

    registered = sum(1 for result in results if result.success)
    return BulkRegisterResponse(registered=registered, failed=len(results) - registered, results=results)
