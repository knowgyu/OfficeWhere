from __future__ import annotations

from typing import Any, Dict, List, Optional

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


class FileRef(BaseModel):
    file_id: int
    file_name: str


class ExcelConflictValue(BaseModel):
    file_id: int
    file_name: str
    values: List[str]


class ExcelCheckIssue(BaseModel):
    issue_type: str
    key: Optional[str] = None
    column: Optional[str] = None
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


class SchedulerSettings(BaseModel):
    mode: str = "manual"
    interval_hours: float = 24.0
    daily_time: str = "03:00"
    last_reindex_at: Optional[str] = None


class ReindexResponse(BaseModel):
    success: int
    failed: int
    skipped: int
