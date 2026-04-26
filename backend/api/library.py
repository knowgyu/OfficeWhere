from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query

from ..core.library import (
    cancel_library_rescan,
    get_file_group_detail,
    get_library_rescan_status,
    list_file_groups,
    load_library_settings,
    rescan_library,
    save_library_settings,
    start_library_rescan,
)
from ..models.schemas import (
    LibraryGroupDetail,
    LibraryGroupsResponse,
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
def trigger_library_rescan():
    return rescan_library()


@router.post("/rescan/start", response_model=LibraryRescanStatus)
def start_library_rescan_job():
    return start_library_rescan()


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
    limit: int = 50,
    offset: int = 0,
):
    return list_file_groups(kind=kind, file_type=type, limit=limit, offset=offset)


@router.get("/groups/{group_id}", response_model=LibraryGroupDetail)
def get_library_group(group_id: str, limit: int = 200):
    group = get_file_group_detail(group_id, limit=limit)
    if not group:
        raise HTTPException(status_code=404, detail="문서 묶음을 찾을 수 없습니다.")
    return group
