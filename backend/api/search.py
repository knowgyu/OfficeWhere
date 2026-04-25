from fastapi import APIRouter

from ..models.schemas import (
    SearchRequest,
    SearchResponse,
    SearchResult,
    SchedulerSettings,
    ReindexResponse,
)
from ..core.indexer import search, reindex_all
from ..database import get_all_files, get_setting, set_setting

router = APIRouter(prefix="/api/search", tags=["search"])


FILE_TYPE_ALIASES = {
    "word": "Word",
    "docx": "Word",
    "ppt": "PowerPoint",
    "pptx": "PowerPoint",
    "powerpoint": "PowerPoint",
    "md": "Markdown",
    "markdown": "Markdown",
    "txt": "Text",
    "text": "Text",
    "excel": "Excel",
    "xlsx": "Excel",
    "xls": "Excel",
}


def normalize_file_type_filters(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        canonical = FILE_TYPE_ALIASES.get(value.strip().lower())
        if canonical and canonical not in normalized:
            normalized.append(canonical)
    return normalized


def _filename_matches(query: str, file_types: list[str]) -> list[dict]:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []

    active_filter = set(file_types)
    matches: list[dict] = []
    for file_info in get_all_files():
        if active_filter and file_info["file_type"] not in active_filter:
            continue
        if normalized_query in file_info["name"].lower():
            matches.append(
                {
                    "file_id": file_info["id"],
                    "name": file_info["name"],
                    "path": file_info["path"],
                    "file_type": file_info["file_type"],
                    "location": "파일명",
                    "snippet": file_info["name"],
                }
            )
    return matches


def _content_matches(query: str, limit: int, file_types: list[str]) -> list[dict]:
    return search(query, limit=limit, file_types=file_types)


@router.post("", response_model=SearchResponse)
def search_files(req: SearchRequest):
    file_types = normalize_file_type_filters(req.file_types)
    name_matches = _filename_matches(req.query, file_types)

    if req.search_scope == "filename":
        results = name_matches[: req.limit]
    else:
        seen = {(item["file_id"], item["location"], item["snippet"]) for item in name_matches}
        content_results = []
        for item in _content_matches(req.query, limit=req.limit, file_types=file_types):
            key = (item["file_id"], item["location"], item["snippet"])
            if key in seen:
                continue
            seen.add(key)
            content_results.append(item)
        results = (name_matches + content_results)[: req.limit]

    return SearchResponse(
        query=req.query,
        total=len(results),
        results=[SearchResult(**r) for r in results],
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
