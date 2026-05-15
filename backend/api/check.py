# Re-exported for older tests and downstream monkeypatches that targeted this
# API module before comparison orchestration moved to application/check_service.
import os

from fastapi import APIRouter, HTTPException

from ..application import check_service as _check_service
from ..application.check_service import (
    CheckServiceProcessingError,
    _comparison_cache_key,
    build_excel_diff_grid_for_file_ids,
    get_file_by_id,
    run_consistency_check,
    run_consistency_check_for_file_ids,
)
from ..models.schemas import CheckRequest, CheckResponse, ExcelDiffGridRequest, ExcelDiffGridResponse

router = APIRouter(prefix="/api/check", tags=["check"])


def _sync_service_test_overrides() -> None:
    """Preserve older tests that monkeypatch this API module's internals."""

    _check_service.get_file_by_id = get_file_by_id
    _check_service.run_consistency_check = run_consistency_check


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, CheckServiceProcessingError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.post("", response_model=CheckResponse)
def consistency_check(req: CheckRequest):
    try:
        _sync_service_test_overrides()
        return run_consistency_check_for_file_ids(req.file_ids)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/excel-grid", response_model=ExcelDiffGridResponse)
def excel_diff_grid(req: ExcelDiffGridRequest):
    try:
        _sync_service_test_overrides()
        return build_excel_diff_grid_for_file_ids(req.file_ids, req.focuses)
    except Exception as exc:
        raise _to_http_error(exc) from exc
