from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query

from ..core.library import (
    cancel_library_rescan,
    clear_group_latest_file,
    get_file_group_detail,
    get_library_rescan_status,
    list_file_groups,
    load_library_settings,
    rescan_library,
    save_library_settings,
    set_group_latest_file,
    start_library_rescan,
)
from ..models.schemas import (
    LibraryGroupDetail,
    LibraryGroupLatestFileRequest,
    LibraryGroupsResponse,
    LibraryRescanRequest,
    LibraryRescanResponse,
    LibraryRescanStatus,
    LibrarySettings,
)

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("/settings", response_model=LibrarySettings)
def get_library_settings():
    return load_library_settings()


@router.put("/settings", response_model=LibrarySettings)
def update_library_settings(settings: LibrarySettings):
    return save_library_settings(settings)


@router.post("/rescan", response_model=LibraryRescanResponse)
def trigger_library_rescan(request: Optional[LibraryRescanRequest] = None):
    return rescan_library(mode=(request.mode if request else "normal"))


@router.post("/rescan/start", response_model=LibraryRescanStatus)
def start_library_rescan_job(request: Optional[LibraryRescanRequest] = None):
    return start_library_rescan(mode=(request.mode if request else "normal"))


@router.get("/rescan/status", response_model=LibraryRescanStatus)
def get_library_rescan_job_status():
    return get_library_rescan_status()


@router.post("/rescan/cancel", response_model=LibraryRescanStatus)
def cancel_library_rescan_job():
    return cancel_library_rescan()


@router.get("/groups", response_model=LibraryGroupsResponse)
def get_library_groups(
    kind: Optional[str] = None,
    type: Annotated[Optional[str], Query(alias="type")] = None,
    q: Optional[str] = None,
    sort: str = "recent",
    limit: int = 50,
    offset: int = 0,
    include_duplicates: bool = False,
):
    return list_file_groups(
        kind=kind,
        file_type=type,
        query=q,
        sort=sort,
        limit=limit,
        offset=offset,
        include_duplicate_content=include_duplicates,
    )


@router.get("/groups/{group_id}", response_model=LibraryGroupDetail)
def get_library_group(group_id: str, limit: int = 200):
    group = get_file_group_detail(group_id, limit=limit)
    if not group:
        raise HTTPException(status_code=404, detail="문서 묶음을 찾을 수 없습니다.")
    return group


@router.put("/groups/{group_id}/latest-file", response_model=LibraryGroupDetail)
def update_library_group_latest_file(group_id: str, request: LibraryGroupLatestFileRequest):
    try:
        group = set_group_latest_file(group_id, request.file_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not group:
        raise HTTPException(status_code=404, detail="문서 묶음을 찾을 수 없습니다.")
    return group


@router.delete("/groups/{group_id}/latest-file", response_model=LibraryGroupDetail)
def clear_library_group_latest_file(group_id: str):
    group = clear_group_latest_file(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="문서 묶음을 찾을 수 없습니다.")
    return group
