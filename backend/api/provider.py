from typing import Annotated, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from ..application.check_service import CheckServiceProcessingError
from ..application.provider_service import (
    build_provider_health,
    build_provider_manifest,
    compare_provider_documents,
    get_provider_group_detail,
    list_provider_duplicates,
    list_provider_files,
    list_provider_groups,
    search_provider_documents,
)
from ..models.schemas import (
    CheckRequest,
    CheckResponse,
    DuplicateFilesResponse,
    FileListResponse,
    LibraryGroupDetail,
    LibraryGroupsResponse,
    ProviderHealth,
    ProviderManifest,
    SearchRequest,
    SearchResponse,
)

router = APIRouter(prefix="/api/provider/v1", tags=["provider"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, CheckServiceProcessingError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/health", response_model=ProviderHealth)
def provider_health(request: Request):
    return build_provider_health(request.app.version)


@router.get("/manifest", response_model=ProviderManifest)
def provider_manifest(request: Request):
    return build_provider_manifest(request.app.version)


@router.post("/search", response_model=SearchResponse)
def provider_search(req: SearchRequest):
    return search_provider_documents(req)


@router.get("/files", response_model=FileListResponse)
def provider_files(
    q: str = "",
    file_types: Annotated[Optional[List[str]], Query()] = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "created_at_desc",
    include_missing: bool = False,
):
    return list_provider_files(
        query=q,
        file_types=file_types,
        limit=limit,
        offset=offset,
        sort=sort,
        include_missing=include_missing,
    )


@router.get("/duplicates", response_model=DuplicateFilesResponse)
def provider_duplicates(limit: int = 50, offset: int = 0):
    return list_provider_duplicates(limit=limit, offset=offset)


@router.get("/groups", response_model=LibraryGroupsResponse)
def provider_groups(
    kind: Optional[str] = None,
    type: Annotated[Optional[str], Query(alias="type")] = None,
    q: Optional[str] = None,
    sort: str = "recent",
    limit: int = 50,
    offset: int = 0,
    include_duplicates: bool = False,
):
    return list_provider_groups(
        kind=kind,
        file_type=type,
        query=q,
        sort=sort,
        limit=limit,
        offset=offset,
        include_duplicates=include_duplicates,
        cache_only=True,
    )


@router.get("/groups/{group_id}", response_model=LibraryGroupDetail)
def provider_group_detail(group_id: str, limit: int = 200):
    try:
        return get_provider_group_detail(group_id, limit=limit, cache_only=True)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/compare", response_model=CheckResponse)
def provider_compare(req: CheckRequest):
    try:
        return compare_provider_documents(req)
    except Exception as exc:
        raise _to_http_error(exc) from exc
