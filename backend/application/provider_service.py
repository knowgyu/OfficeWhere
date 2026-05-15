from __future__ import annotations

from typing import Literal, Optional, Sequence

from ..core.library import get_file_group_detail, list_file_groups
from ..database import count_files, count_files_by_type, list_duplicate_content_groups, list_files_page
from ..models.schemas import (
    CheckRequest,
    CheckResponse,
    DuplicateFilesResponse,
    FileInfo,
    FileListResponse,
    LibraryGroupDetail,
    LibraryGroupsResponse,
    ProviderHealth,
    ProviderManifest,
    ProviderOperation,
    SearchRequest,
    SearchResponse,
)
from .check_service import run_consistency_check_for_file_ids
from .search_service import search_documents

PROVIDER_API_BASE_PATH = "/api/provider/v1"
DEFAULT_PROVIDER_PAGE_LIMIT = 50
MAX_PROVIDER_PAGE_LIMIT = 100


def _bounded_limit(limit: int) -> int:
    if limit < 1:
        return DEFAULT_PROVIDER_PAGE_LIMIT
    return min(limit, MAX_PROVIDER_PAGE_LIMIT)


def _file_info_from_row(row: dict) -> FileInfo:
    return FileInfo(
        id=row["id"],
        name=row["name"],
        path=row["path"],
        file_type=row["file_type"],
        column_count=row["column_count"],
        created_at=row.get("created_at"),
        file_mtime=row.get("file_mtime"),
        availability_status=row.get("availability_status") or "available",
        last_seen_at=row.get("last_seen_at"),
        missing_since=row.get("missing_since"),
        missing_last_checked_at=row.get("missing_last_checked_at"),
        missing_reason=row.get("missing_reason"),
    )


def _operation(
    name: str,
    method: str,
    path: str,
    safety: Literal["read_only", "source_read_only_cache_write", "state_changing"],
    description: str,
) -> ProviderOperation:
    return ProviderOperation(
        name=name,
        method=method,
        path=f"{PROVIDER_API_BASE_PATH}{path}",
        safety=safety,
        description=description,
    )


def build_provider_health(app_version: str) -> ProviderHealth:
    return ProviderHealth(app_version=app_version)


def build_provider_manifest(app_version: str) -> ProviderManifest:
    return ProviderManifest(
        app_version=app_version,
        capabilities=[
            "document_search",
            "bounded_file_listing",
            "duplicate_detection",
            "version_group_exploration",
            "document_comparison",
        ],
        operations=[
            _operation("health", "GET", "/health", "read_only", "Check provider availability and version."),
            _operation("manifest", "GET", "/manifest", "read_only", "Read this automation contract."),
            _operation("search", "POST", "/search", "read_only", "Search indexed file names and content."),
            _operation("files", "GET", "/files", "read_only", "List registered files through a bounded provider view."),
            _operation("duplicates", "GET", "/duplicates", "read_only", "List same-content duplicate groups."),
            _operation("groups", "GET", "/groups", "read_only", "List cache-only library/version groups."),
            _operation("group_detail", "GET", "/groups/{group_id}", "read_only", "Inspect one cache-only library/version group."),
            _operation(
                "compare",
                "POST",
                "/compare",
                "source_read_only_cache_write",
                "Compare registered documents; may update app-owned comparison cache only.",
            ),
        ],
        maintenance_operations=[
            ProviderOperation(
                name="legacy_reindex",
                method="POST",
                path="/api/search/reindex",
                safety="state_changing",
                description="Rebuilds app-owned search indexes; not part of default provider-safe automation.",
            ),
            ProviderOperation(
                name="legacy_rescan",
                method="POST",
                path="/api/library/rescan/start",
                safety="state_changing",
                description="Starts filesystem rescan/index maintenance; call only on explicit user intent.",
            ),
            ProviderOperation(
                name="legacy_settings",
                method="PUT",
                path="/api/search/settings or /api/library/settings",
                safety="state_changing",
                description="Changes scheduler/library settings; not used by passive document exploration.",
            ),
        ],
        notes=[
            "Provider clients must use HTTP/API contracts, not OfficeWhere SQLite tables.",
            "Source Office/PDF documents are read-only; provider operations may read files or write app-owned caches only as documented.",
            "Packaged Electron uses a dynamic loopback port; external clients need discovery rather than a fixed-port assumption.",
        ],
    )


def search_provider_documents(req: SearchRequest) -> SearchResponse:
    return search_documents(req)


def compare_provider_documents(req: CheckRequest) -> CheckResponse:
    return run_consistency_check_for_file_ids(req.file_ids)


def list_provider_files(
    *,
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
    limit: int = DEFAULT_PROVIDER_PAGE_LIMIT,
    offset: int = 0,
    sort: str = "created_at_desc",
    include_missing: bool = False,
) -> FileListResponse:
    safe_limit = _bounded_limit(limit)
    safe_offset = max(0, offset)
    filters = [file_type for file_type in (file_types or []) if file_type]
    rows = list_files_page(
        query=query,
        file_types=filters,
        limit=safe_limit,
        offset=safe_offset,
        sort=sort,
        include_missing=include_missing,
    )
    return FileListResponse(
        total=count_files(query, filters, include_missing=include_missing),
        items=[_file_info_from_row(row) for row in rows],
        counts_by_type=count_files_by_type(query, filters, include_missing=include_missing),
        limit=safe_limit,
        offset=safe_offset,
    )


def list_provider_duplicates(
    *,
    limit: int = DEFAULT_PROVIDER_PAGE_LIMIT,
    offset: int = 0,
) -> DuplicateFilesResponse:
    groups = list_duplicate_content_groups(limit=_bounded_limit(limit), offset=max(0, offset))
    return DuplicateFilesResponse(**groups)


def list_provider_groups(
    *,
    kind: Optional[str] = None,
    file_type: Optional[str] = None,
    query: Optional[str] = None,
    sort: str = "recent",
    limit: int = DEFAULT_PROVIDER_PAGE_LIMIT,
    offset: int = 0,
    include_duplicates: bool = False,
    cache_only: bool = True,
) -> LibraryGroupsResponse:
    return list_file_groups(
        kind=kind,
        file_type=file_type,
        query=query,
        sort=sort,
        limit=_bounded_limit(limit),
        offset=max(0, offset),
        include_duplicate_content=include_duplicates,
        cache_only=cache_only,
        allow_refresh=False,
        allow_state_write=False,
    )


def get_provider_group_detail(
    group_id: str,
    *,
    limit: int = 200,
    cache_only: bool = True,
) -> LibraryGroupDetail:
    group = get_file_group_detail(
        group_id,
        limit=limit,
        cache_only=cache_only,
        allow_refresh=False,
        allow_state_write=False,
    )
    if not group:
        raise FileNotFoundError("문서 묶음을 찾을 수 없습니다.")
    return group
