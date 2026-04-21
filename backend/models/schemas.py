from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


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


class JoinFileSpec(BaseModel):
    file_id: int
    columns: List[str]


class JoinRequest(BaseModel):
    files: List[JoinFileSpec]
    join_type: str = "outer"  # left | outer | inner


class JoinResponse(BaseModel):
    columns: List[str]
    data: List[List[Any]]
    total_rows: int


class CheckRequest(BaseModel):
    file_ids: List[int]


class ConflictEntry(BaseModel):
    file_id: int
    file_name: str
    column: str
    value: Any


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
