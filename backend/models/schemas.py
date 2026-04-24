from pydantic import BaseModel
from typing import Optional, List, Any


class FileRegisterRequest(BaseModel):
    path: str
    key_column: str


class FileInfo(BaseModel):
    id: int
    name: str
    path: str
    file_type: str
    key_column: str
    column_count: int
    created_at: Optional[str] = None


class FileRegisterResponse(BaseModel):
    id: int
    name: str
    columns: List[str]


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
    suggested_key_column: Optional[str] = None


class FilePickResponse(BaseModel):
    cancelled: bool
    file: Optional[FileInspectResponse] = None


class JoinFileSpec(BaseModel):
    file_id: int
    columns: List[str]


class JoinRequest(BaseModel):
    files: List[JoinFileSpec]
    join_type: str = "outer"  # left | outer | inner
    base_file_id: Optional[int] = None


class JoinResponse(BaseModel):
    columns: List[str]
    data: List[List[Any]]
    total_rows: int


class CheckRequest(BaseModel):
    file_ids: List[int]


class ConflictEntry(BaseModel):
    file_id: int
    file_name: str
    columns: List[str]
    values: List[Any]
    row_count: int


class CheckIssue(BaseModel):
    key_normalized: str
    key_variants: List[str]
    column_group: str
    conflicts: List[ConflictEntry]
    severity: str  # conflict | warning


class CheckResponse(BaseModel):
    total_keys: int
    matched_keys: int
    issues: List[CheckIssue]


# --- 폴더 스캔 ---

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
    key_column: str


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


# --- 파일 검색 ---

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
    mode: str = "manual"          # manual | interval | daily
    interval_hours: float = 24.0
    daily_time: str = "03:00"     # HH:MM
    last_reindex_at: Optional[str] = None


class ReindexResponse(BaseModel):
    success: int
    failed: int
    skipped: int
