from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from ..file_constants import DEFAULT_EXCLUDED_FOLDER_NAMES


class FileRegisterRequest(BaseModel):
    path: str


class FileInfo(BaseModel):
    id: int
    name: str
    path: str
    file_type: str
    column_count: int
    created_at: Optional[str] = None
    file_mtime: Optional[float] = None
    availability_status: str = "available"
    last_seen_at: Optional[str] = None
    missing_since: Optional[str] = None
    missing_last_checked_at: Optional[str] = None
    missing_reason: Optional[str] = None


class FileListResponse(BaseModel):
    total: int
    items: List[FileInfo]
    counts_by_type: Dict[str, int] = Field(default_factory=dict)
    limit: int
    offset: int


class DuplicateFileItem(FileInfo):
    content_chars: int = 0
    chunk_count: int = 0


class DuplicateFileGroup(BaseModel):
    content_signature: str
    file_count: int
    distinct_name_count: int
    total_content_chars: int
    latest_mtime: Optional[float] = None
    file_types: List[str] = Field(default_factory=list)
    files: List[DuplicateFileItem] = Field(default_factory=list)


class DuplicateFilesResponse(BaseModel):
    total: int
    groups: List[DuplicateFileGroup]
    limit: int
    offset: int


class FileRegisterResponse(BaseModel):
    id: int
    name: str
    file_type: str
    columns: List[str]


class FilesDeleteAllResponse(BaseModel):
    deleted: int
    message: str


class SchemaResponse(BaseModel):
    columns: List[str]
    sample: List[List[Any]]


class FileInspectRequest(BaseModel):
    path: str


class FileInspectResponse(BaseModel):
    path: str
    name: str
    file_type: str
    columns: List[str]
    sample: List[List[Any]]
    comparison_mode: str


class FilePickResponse(BaseModel):
    cancelled: bool
    file: Optional[FileInspectResponse] = None


class CheckRequest(BaseModel):
    file_ids: List[int]


class ExcelDiffFocusHistory(BaseModel):
    change_type: str
    from_file_id: Optional[int] = None
    from_file_name: str = ""
    to_file_id: Optional[int] = None
    to_file_name: str = ""
    before: str = ""
    after: str = ""
    label: str = ""


class ExcelDiffGridFocus(BaseModel):
    sheet_name: str = ""
    key: str = ""
    column: str = ""
    change_type: str = "changed"
    histories: List[ExcelDiffFocusHistory] = Field(default_factory=list)


class ExcelDiffGridRequest(BaseModel):
    file_ids: List[int]
    focuses: List[ExcelDiffGridFocus] = Field(default_factory=list)


class FileRef(BaseModel):
    file_id: int
    file_name: str


class ExcelDiffGridColumn(BaseModel):
    index: int
    letter: str
    name: str


class ExcelDiffGridCell(BaseModel):
    sheet_name: str = ""
    row_index: int
    row_number: int
    column_index: int
    column_letter: str
    column_name: str
    value: str
    highlight: Optional[str] = None
    histories: List[ExcelDiffFocusHistory] = Field(default_factory=list)


class ExcelDiffGridRow(BaseModel):
    sheet_name: str = ""
    row_index: int
    row_number: int
    cells: List[ExcelDiffGridCell]


class ExcelDiffGridSection(BaseModel):
    id: str
    sheet_name: str = ""
    title: str
    description: str
    partial: bool = False
    row_start: int
    row_end: int
    col_start: int
    col_end: int
    columns: List[ExcelDiffGridColumn]
    rows: List[ExcelDiffGridRow]


class ExcelDiffGridResponse(BaseModel):
    latest_file: FileRef
    row_count: int
    column_count: int
    sheet_name: str
    partial: bool = False
    omitted_focus_count: int = 0
    sections: List[ExcelDiffGridSection]


class ExcelConflictValue(BaseModel):
    file_id: int
    file_name: str
    sheet_name: str = ""
    columns: List[str] = Field(default_factory=list)
    values: List[str]
    row_numbers: List[int] = Field(default_factory=list)
    column_letters: List[str] = Field(default_factory=list)
    cell_refs: List[str] = Field(default_factory=list)
    row_count: int = 0
    row_values: List[List[str]] = Field(default_factory=list)


class ExcelCheckIssue(BaseModel):
    issue_type: str
    severity: Optional[str] = None
    sheet_name: str = ""
    key: Optional[str] = None
    column: Optional[str] = None
    message: Optional[str] = None
    values: List[ExcelConflictValue] = Field(default_factory=list)
    present_in: List[FileRef] = Field(default_factory=list)
    missing_in: List[FileRef] = Field(default_factory=list)


class ExcelCheckResult(BaseModel):
    total_keys: int
    matched_keys: int
    issues: List[ExcelCheckIssue]


class CompareWarning(BaseModel):
    type: Literal[
        "truncated",
        "high_change_ratio",
        "source_may_be_newer",
        "simplified_comparison",
        "artifact_missing",
        "artifact_version_mismatch",
        "artifact_rebuilt_or_refresh_needed",
    ]
    severity: Literal["info", "warning"] = "warning"
    message: str
    file_ids: List[int] = Field(default_factory=list)
    details: Dict[str, Any] = Field(default_factory=dict)


class CompareMetadata(BaseModel):
    warnings: List[CompareWarning] = Field(default_factory=list)
    used_last_index_snapshot: bool = True
    source_stat_checked: bool = False
    source_stat_error_count: int = 0
    compared_cell_count: Optional[int] = None
    changed_cell_count: Optional[int] = None
    total_candidate_cell_count: Optional[int] = None
    simplified: bool = False
    artifact_status: Optional[str] = None


class DiffBlock(BaseModel):
    block_type: Optional[str] = None
    item_type: Optional[str] = None
    location: str
    page_number: Optional[int] = None
    text: str


class WordDiffChange(BaseModel):
    change_type: str
    before: List[DiffBlock] = Field(default_factory=list)
    after: List[DiffBlock] = Field(default_factory=list)


class WordCheckResult(BaseModel):
    files: List[FileRef]
    changes: List[WordDiffChange]


class PptItemChange(BaseModel):
    change_type: str
    before: List[DiffBlock] = Field(default_factory=list)
    after: List[DiffBlock] = Field(default_factory=list)


class PptSlideChange(BaseModel):
    change_type: str
    slide_number_before: Optional[int] = None
    slide_number_after: Optional[int] = None
    title_before: Optional[str] = None
    title_after: Optional[str] = None
    item_changes: List[PptItemChange] = Field(default_factory=list)


class PptCheckResult(BaseModel):
    files: List[FileRef]
    changes: List[PptSlideChange]


class CheckResponse(BaseModel):
    mode: str
    metadata: CompareMetadata = Field(default_factory=CompareMetadata)
    excel: Optional[ExcelCheckResult] = None
    word: Optional[WordCheckResult] = None
    ppt: Optional[PptCheckResult] = None


class FolderScanRequest(BaseModel):
    folder_path: str
    recursive: bool = True


class ScannedFileInfo(BaseModel):
    path: str
    name: str
    file_type: str
    columns: List[str]
    sample: List[List[Any]]
    comparison_mode: str
    error: Optional[str] = None


class FolderScanResponse(BaseModel):
    folder_path: str
    total_found: int
    files: List[ScannedFileInfo]


class FolderPickResponse(BaseModel):
    cancelled: bool
    folder_path: str


class BulkRegisterItem(BaseModel):
    path: str


class BulkRegisterRequest(BaseModel):
    files: List[BulkRegisterItem]


class BulkRegisterResult(BaseModel):
    path: str
    name: str
    success: bool
    file_id: Optional[int] = None
    error: Optional[str] = None


class BulkRegisterResponse(BaseModel):
    registered: int
    failed: int
    results: List[BulkRegisterResult]


class SearchRequest(BaseModel):
    query: str
    limit: int = 100
    file_limit: int = 20
    file_types: List[str] = Field(default_factory=list)
    search_scope: Literal["filename_content", "filename", "content"] = "filename_content"
    modified_from: Optional[str] = None
    modified_to: Optional[str] = None
    excluded_folder_paths: List[str] = Field(default_factory=list)


class SearchResult(BaseModel):
    file_id: int
    name: str
    path: str
    file_type: str
    location: str
    snippet: str
    normalized_hash: Optional[str] = None
    content_hash: Optional[str] = None
    content_chars: Optional[int] = None
    chunk_count: Optional[int] = None


class SearchResponse(BaseModel):
    query: str
    total: int
    results: List[SearchResult]
    file_count: int = 0
    file_limit: int = 20
    has_more: bool = False


class SchedulerSettings(BaseModel):
    mode: str = "manual"
    interval_hours: float = 24.0
    daily_time: str = "03:00"
    last_reindex_at: Optional[str] = None


class ReindexResponse(BaseModel):
    success: int
    failed: int
    skipped: int


class ProviderHealth(BaseModel):
    status: Literal["ok"] = "ok"
    provider: str = "OfficeWhere"
    app_version: str
    contract_version: str = "v1"


class ProviderOperation(BaseModel):
    name: str
    method: str
    path: str
    safety: Literal["read_only", "source_read_only_cache_write", "state_changing"]
    description: str


class ProviderManifest(BaseModel):
    provider: str = "OfficeWhere"
    contract_version: str = "v1"
    app_version: str
    api_base_path: str = "/api/provider/v1"
    transport: str = "local_http_loopback"
    source_document_policy: Literal["read_only"] = "read_only"
    sqlite_access_policy: Literal["forbidden"] = "forbidden"
    capabilities: List[str] = Field(default_factory=list)
    operations: List[ProviderOperation] = Field(default_factory=list)
    maintenance_operations: List[ProviderOperation] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)


class WatchedFolder(BaseModel):
    path: str
    recursive: bool = True


class LibrarySettings(BaseModel):
    watched_folders: List[WatchedFolder] = Field(default_factory=list)
    excluded_folder_names: List[str] = Field(default_factory=lambda: list(DEFAULT_EXCLUDED_FOLDER_NAMES))
    auto_rescan_mode: str = "interval"
    auto_rescan_interval_hours: float = 24.0
    auto_rescan_daily_time: str = "03:00"
    fast_worker_count: int = 24
    last_rescan_at: Optional[str] = None


class LibraryRescanResult(BaseModel):
    path: str
    name: str
    success: bool
    action: str
    file_id: Optional[int] = None
    error: Optional[str] = None
    diagnostic_id: Optional[str] = None
    error_code: Optional[str] = None
    error_stage: Optional[str] = None
    error_type: Optional[str] = None
    error_hint: Optional[str] = None


class LibraryRescanResponse(BaseModel):
    registered: int
    updated: int
    skipped: int
    failed: int
    results: List[LibraryRescanResult]
    cancelled: int = 0
    pruned_unsupported: int = 0
    missing: int = 0
    recovered: int = 0
    purged_missing: int = 0


class LibraryRescanRequest(BaseModel):
    mode: Literal["normal", "fast"] = "normal"


class LibraryRescanStatus(BaseModel):
    running: bool = False
    stage: str = "idle"
    message: str = ""
    mode: Literal["normal", "fast"] = "normal"
    worker_count: int = 0
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    folders_total: int = 0
    folders_processed: int = 0
    found: int = 0
    total: int = 0
    processed: int = 0
    percent: float = 0.0
    eta_seconds: Optional[int] = None
    registered: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    cancelled: int = 0
    pruned_unsupported: int = 0
    missing: int = 0
    recovered: int = 0
    purged_missing: int = 0
    cancel_requested: bool = False
    current_file: Optional[str] = None
    summary: Optional[LibraryRescanResponse] = None
    error: Optional[str] = None


class LibraryFileGroup(BaseModel):
    id: str
    group_kind: str = "version_family"
    file_type: str
    base_name: str = ""
    canonical_name: str
    title: str
    confidence: str = "filename"
    reason: str = ""
    file_count: int = 0
    latest_file: Optional[FileInfo] = None
    previous_file: Optional[FileInfo] = None
    manual_latest_file_id: Optional[int] = None
    tokens_summary: List[str] = Field(default_factory=list)
    content_status: str = "pending"
    fingerprint_coverage: int = 0
    fingerprint_unique_count: int = 0
    content_evidence: str = ""
    files: List[FileInfo] = Field(default_factory=list)


class LibraryGroupSummary(BaseModel):
    id: str
    group_kind: str
    file_type: str
    base_name: str
    canonical_name: str
    title: str
    file_count: int
    confidence: str
    reason: str
    latest_file: Optional[FileInfo] = None
    previous_file: Optional[FileInfo] = None
    manual_latest_file_id: Optional[int] = None
    tokens_summary: List[str] = Field(default_factory=list)
    content_status: str = "pending"
    fingerprint_coverage: int = 0
    fingerprint_unique_count: int = 0
    content_evidence: str = ""


class LibraryGroupDetail(LibraryGroupSummary):
    files: List[FileInfo]


class LibraryGroupLatestFileRequest(BaseModel):
    file_id: int


class LibraryGroupsResponse(BaseModel):
    total: int = 0
    groups: List[LibraryGroupSummary]
    limit: int = 50
    offset: int = 0
    counts_by_kind: Dict[str, int] = Field(default_factory=dict)
    derived_index_state: str = "ready"
    derived_index_stale: bool = False
    derived_index_updated_at: Optional[str] = None
    derived_index_error: Optional[str] = None
