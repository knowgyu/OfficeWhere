from fastapi import APIRouter

from ..application.search_service import search_documents
from ..core.indexer import reindex_all
from ..database import get_setting, set_setting
from ..models.schemas import ReindexResponse, SchedulerSettings, SearchRequest, SearchResponse

router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("", response_model=SearchResponse)
def search_files(req: SearchRequest):
    return search_documents(req)


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
