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


@router.post("", response_model=SearchResponse)
def search_files(req: SearchRequest):
    normalized_query = req.query.strip().lower()
    file_types = normalize_file_type_filters(req.file_types)
    active_filter = set(file_types)
    name_matches = []
    if normalized_query:
        for file_info in get_all_files():
            if active_filter and file_info["file_type"] not in active_filter:
                continue
            if normalized_query in file_info["name"].lower():
                name_matches.append(
                    {
                        "file_id": file_info["id"],
                        "name": file_info["name"],
                        "path": file_info["path"],
                        "file_type": file_info["file_type"],
                        "location": "파일명",
                        "snippet": file_info["name"],
                    }
                )

    seen = {(item["file_id"], item["location"], item["snippet"]) for item in name_matches}
    content_results = []
    for item in search(req.query, limit=req.limit, file_types=file_types):
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
