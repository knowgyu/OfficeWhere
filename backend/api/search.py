from datetime import datetime, time
from typing import Optional

from fastapi import APIRouter

from ..models.schemas import (
    SearchRequest,
    SearchResponse,
    SearchResult,
    SchedulerSettings,
    ReindexResponse,
)
from ..core.indexer import search, reindex_all
from ..core.hangul_search import make_search_snippet
from ..database import get_setting, search_file_names, set_setting

router = APIRouter(prefix="/api/search", tags=["search"])


FILE_TYPE_ALIASES = {
    "word": "Word",
    "docx": "Word",
    "ppt": "PowerPoint",
    "pptx": "PowerPoint",
    "powerpoint": "PowerPoint",
    "excel": "Excel",
    "xlsx": "Excel",
}
DEFAULT_SEARCH_FILE_LIMIT = 20
MAX_SEARCH_FILE_LIMIT = 100
CONTENT_MATCHES_PER_FILE = 3


def normalize_file_type_filters(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        canonical = FILE_TYPE_ALIASES.get(value.strip().lower())
        if canonical and canonical not in normalized:
            normalized.append(canonical)
    return normalized


def _parse_modified_bound(value: Optional[str], *, end_of_day: bool = False) -> Optional[float]:
    if not value:
        return None

    stripped = value.strip()
    if not stripped:
        return None

    try:
        if len(stripped) == 10:
            parsed_date = datetime.strptime(stripped, "%Y-%m-%d").date()
            parsed = datetime.combine(parsed_date, time.max if end_of_day else time.min)
        else:
            parsed = datetime.fromisoformat(stripped)
    except ValueError:
        return None

    return parsed.timestamp()


def _file_matches_modified_range(
    file_info: dict,
    modified_from: Optional[float],
    modified_to: Optional[float],
) -> bool:
    if modified_from is None and modified_to is None:
        return True

    file_mtime = file_info.get("file_mtime")
    if file_mtime is None:
        return False

    if modified_from is not None and file_mtime < modified_from:
        return False
    if modified_to is not None and file_mtime > modified_to:
        return False
    return True


def _bounded_file_limit(value: int) -> int:
    if value < 1:
        return DEFAULT_SEARCH_FILE_LIMIT
    return min(value, MAX_SEARCH_FILE_LIMIT)


def _unique_file_count(results: list[dict]) -> int:
    return len({int(item["file_id"]) for item in results})


def _cap_unique_files(results: list[dict], file_limit: int) -> tuple[list[dict], bool]:
    capped: list[dict] = []
    seen: set[int] = set()
    has_more = False
    for item in results:
        file_id = int(item["file_id"])
        if file_id not in seen and len(seen) >= file_limit:
            has_more = True
            continue
        seen.add(file_id)
        capped.append(item)
    return capped, has_more


def _filename_matches(
    query: str,
    file_types: list[str],
    limit: int,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
) -> list[dict]:
    normalized_query = query.strip()
    if not normalized_query:
        return []

    matches: list[dict] = []
    for file_info in search_file_names(
        normalized_query,
        file_types=file_types,
        modified_from=modified_from,
        modified_to=modified_to,
        limit=limit,
    ):
        matches.append(
            {
                "file_id": file_info["id"],
                "name": file_info["name"],
                "path": file_info["path"],
                "file_type": file_info["file_type"],
                "location": "파일명",
                "snippet": make_search_snippet(file_info["name"], normalized_query, context=80),
                "normalized_hash": file_info.get("normalized_hash"),
                "content_hash": file_info.get("content_hash"),
                "content_chars": file_info.get("content_chars"),
                "chunk_count": file_info.get("chunk_count"),
            }
        )
    return matches


def _content_matches(
    query: str,
    limit: int,
    file_types: list[str],
    file_limit: int,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
) -> list[dict]:
    return search(
        query,
        limit=limit,
        file_types=file_types,
        modified_from=modified_from,
        modified_to=modified_to,
        file_limit=file_limit,
        per_file_limit=CONTENT_MATCHES_PER_FILE,
    )


@router.post("", response_model=SearchResponse)
def search_files(req: SearchRequest):
    file_types = normalize_file_type_filters(req.file_types)
    modified_from = _parse_modified_bound(req.modified_from, end_of_day=False)
    modified_to = _parse_modified_bound(req.modified_to, end_of_day=True)
    file_limit = _bounded_file_limit(req.file_limit)
    query_limit = min(max(req.limit, file_limit * CONTENT_MATCHES_PER_FILE), file_limit * (CONTENT_MATCHES_PER_FILE + 1))
    fetch_file_limit = file_limit + 1

    if req.search_scope == "filename":
        name_matches = _filename_matches(req.query, file_types, fetch_file_limit, modified_from, modified_to)
        results, has_more = _cap_unique_files(name_matches, file_limit)
    elif req.search_scope == "content":
        results = _content_matches(
            req.query,
            limit=query_limit,
            file_types=file_types,
            file_limit=fetch_file_limit,
            modified_from=modified_from,
            modified_to=modified_to,
        )
        results, has_more = _cap_unique_files(results, file_limit)
    else:
        name_matches = _filename_matches(req.query, file_types, fetch_file_limit, modified_from, modified_to)
        seen = {(item["file_id"], item["location"], item["snippet"]) for item in name_matches}
        content_results = []
        for item in _content_matches(
            req.query,
            limit=query_limit,
            file_types=file_types,
            file_limit=fetch_file_limit,
            modified_from=modified_from,
            modified_to=modified_to,
        ):
            key = (item["file_id"], item["location"], item["snippet"])
            if key in seen:
                continue
            seen.add(key)
            content_results.append(item)
        results, has_more = _cap_unique_files(name_matches + content_results, file_limit)

    return SearchResponse(
        query=req.query,
        total=len(results),
        results=[SearchResult(**r) for r in results],
        file_count=_unique_file_count(results),
        file_limit=file_limit,
        has_more=has_more and file_limit < MAX_SEARCH_FILE_LIMIT,
    )


@router.post("/reindex", response_model=ReindexResponse)
def trigger_reindex():
    stats = reindex_all()
    return ReindexResponse(**stats)


@router.get("/settings", response_model=SchedulerSettings)
def get_scheduler_settings():
    return SchedulerSettings(
        mode=get_setting("reindex_mode", "manual"),
        interval_hours=float(get_setting("reindex_interval_hours", "24")),
        daily_time=get_setting("reindex_daily_time", "03:00"),
        last_reindex_at=get_setting("last_reindex_at") or None,
    )


@router.put("/settings", response_model=SchedulerSettings)
def update_scheduler_settings(settings: SchedulerSettings):
    set_setting("reindex_mode", settings.mode)
    set_setting("reindex_interval_hours", str(settings.interval_hours))
    set_setting("reindex_daily_time", settings.daily_time)
    return SchedulerSettings(
        mode=settings.mode,
        interval_hours=settings.interval_hours,
        daily_time=settings.daily_time,
        last_reindex_at=get_setting("last_reindex_at") or None,
    )
