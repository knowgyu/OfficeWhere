from fastapi import APIRouter, HTTPException

from ..models.schemas import JoinRequest, JoinResponse

router = APIRouter(prefix="/api/query", tags=["query"])

JOIN_DISABLED_MESSAGE = (
    "Excel 통합 기능은 검색과 버전 관리 안정화를 위해 잠시 비활성화되었습니다. "
    "원본 문서는 그대로 유지됩니다."
)


def order_join_files(files, base_file_id: int | None):
    """Keep the old helper for lightweight compatibility tests."""
    if base_file_id is None:
        return list(files)
    return sorted(files, key=lambda item: 0 if item.file_id == base_file_id else 1)


@router.post("/join", response_model=JoinResponse)
def join_query(req: JoinRequest):
    raise HTTPException(status_code=410, detail=JOIN_DISABLED_MESSAGE)


@router.post("/export")
def export_join(req: JoinRequest):
    raise HTTPException(status_code=410, detail=JOIN_DISABLED_MESSAGE)
