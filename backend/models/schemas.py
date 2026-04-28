from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class FileRegisterRequest(BaseModel):
    path: str
    key_column: str = ""
    parser_config: Dict[str, Any] = Field(default_factory=dict)


class FileInfo(BaseModel):
    id: int
    name: str
    path: str
    file_type: str
    key_column: str
    column_count: int
    parser_config: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    file_mtime: Optional[float] = None


class FileListResponse(BaseModel):
    total: int
    items: List[FileInfo]
    counts_by_type: Dict[str, int] = Field(default_factory=dict)
    limit: int
    offset: int


class FileRegisterResponse(BaseModel):
    id: int
    name: str
    file_type: str
    columns: List[str]
    parser_config: Dict[str, Any] = Field(default_factory=dict)


class SchemaResponse(BaseModel):
    columns: List[str]
    sample: List[List[Any]]
    parser_config: Dict[str, Any] = Field(default_factory=dict)


class FileInspectRequest(BaseModel):
    path: str


class FileInspectResponse(BaseModel):
    path: str
    name: str
    file_type: str
    columns: List[str]
    sample: List[List[Any]]
    suggested_key_column: Optional[str] = None
    parser_config: Dict[str, Any] = Field(default_factory=dict)
    table_candidates: List[Dict[str, Any]] = Field(default_factory=list)
    comparison_mode: str


class FilePickResponse(BaseModel):
    cancelled: bool
    file: Optional[FileInspectResponse] = None


class JoinFileSpec(BaseModel):
    file_id: int
    columns: List[str]


class JoinRequest(BaseModel):
    files: List[JoinFileSpec]
    join_type: str = "outer"
    base_file_id: Optional[int] = None


class JoinResponse(BaseModel):
    columns: List[str]
    data: List[List[Any]]
    total_rows: int


class CheckRequest(BaseModel):
    file_ids: List[int]
    comparison_scope: Literal["registered_table", "version_history"] = "registered_table"


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
    is_key: bool = False


class ExcelDiffGridCell(BaseModel):
    row_index: int
    row_number: int
    column_index: int
    column_letter: str
    column_name: str
    value: str
    highlight: Optional[str] = None
    histories: List[ExcelDiffFocusHistory] = Field(default_factory=list)


class ExcelDiffGridRow(BaseModel):
    row_index: int
    row_number: int
    key_value: str = ""
    cells: List[ExcelDiffGridCell]


class ExcelDiffGridSection(BaseModel):
    id: str
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
    key_column: str
    sheet_name: str
    partial: bool = False
    omitted_focus_count: int = 0
    sections: List[ExcelDiffGridSection]


class ExcelConflictValue(BaseModel):
    file_id: int
    file_name: str
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
    suggested_key_column: Optional[str] = None
    parser_config: Dict[str, Any] = Field(default_factory=dict)
    table_candidates: List[Dict[str, Any]] = Field(default_factory=list)
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
    key_column: str = ""
    parser_config: Dict[str, Any] = Field(default_factory=dict)


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


class SearchResult(BaseModel):
    file_id: int
    name: str
    path: str
    file_type: str
    location: str
    snippet: str


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


class WatchedFolder(BaseModel):
    path: str
    recursive: bool = True


class LibrarySettings(BaseModel):
    watched_folders: List[WatchedFolder] = Field(default_factory=list)
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
    recommended_action: str


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
    recommended_action: str


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
