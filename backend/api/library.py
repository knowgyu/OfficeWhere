from fastapi import APIRouter

from ..core.library import (
    build_file_groups,
    load_library_settings,
    rescan_library,
    save_library_settings,
)
from ..models.schemas import (
    LibraryGroupsResponse,
    LibraryRescanResponse,
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


@router.get("/groups", response_model=LibraryGroupsResponse)
def get_library_groups():
    return LibraryGroupsResponse(groups=build_file_groups())
