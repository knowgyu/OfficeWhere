import sys
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from time import perf_counter
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .database import get_db_path, init_db, pop_setting
from .api.files import router as files_router
from .api.check import router as check_router
from .api.search import router as search_router
from .api.library import router as library_router
from .api.provider import router as provider_router
from .core.indexer import start_scheduler
from .core.tutorial_examples import cleanup_tutorial_library, create_tutorial_library


logger = logging.getLogger(__name__)


class TutorialLibraryCleanupRequest(BaseModel):
    path: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup_started = perf_counter()
    logger.info("backend startup: init_db start db_path=%s", get_db_path())
    init_db()
    logger.info(
        "backend startup: init_db done duration_ms=%s db_path=%s",
        int(round((perf_counter() - startup_started) * 1000)),
        get_db_path(),
    )
    try:
        cleanup_started = perf_counter()
        cleanup_tutorial_library()
        logger.info(
            "backend startup: tutorial cleanup done duration_ms=%s",
            int(round((perf_counter() - cleanup_started) * 1000)),
        )
    except Exception:
        logger.warning("failed to clean stale tutorial library", exc_info=True)
    start_scheduler()
    yield


app = FastAPI(title="officewhere", version="0.9.0", lifespan=lifespan)

# CORS 설정 (개발 Vite, Electron file renderer, packaged backend static hosting 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(files_router)
app.include_router(check_router)
app.include_router(search_router)
app.include_router(library_router)
app.include_router(provider_router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": app.version,
        "db_path": get_db_path(),
    }


@app.get("/api/app/example-library-path")
async def example_library_path():
    executable_dir = Path(sys.executable).resolve().parent
    candidates = [
        executable_dir / "examples" / "officewhere_test_library",
        executable_dir.parent / "examples" / "officewhere_test_library",
        Path(__file__).resolve().parent.parent / "examples" / "officewhere_test_library",
        Path.cwd() / "examples" / "officewhere_test_library",
    ]
    for candidate in candidates:
        if candidate.exists():
            return {"available": True, "path": str(candidate)}
    return {
        "available": False,
        "path": "",
        "reason": "examples/officewhere_test_library 폴더를 찾지 못했습니다.",
    }


@app.post("/api/app/tutorial-library")
async def create_tutorial_library_endpoint():
    try:
        return create_tutorial_library()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"튜토리얼 예제 파일을 만들지 못했습니다: {exc}") from exc


@app.delete("/api/app/tutorial-library")
async def cleanup_tutorial_library_endpoint(request: Optional[TutorialLibraryCleanupRequest] = None):
    try:
        return cleanup_tutorial_library(request.path if request else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"튜토리얼 예제 파일을 정리하지 못했습니다: {exc}") from exc


@app.get("/api/app/schema-reset-state")
async def schema_reset_state():
    raw = pop_setting("last_schema_reset", "")
    return {
        "resetPending": bool(raw),
        "detail": raw,
        "message": (
            "검색/변경 이력용 문서 데이터 구조가 정리되어 등록 목록을 새로 만들었습니다. "
            "원본 문서는 삭제되지 않았으며, 대상 폴더를 다시 추가하거나 새로고침해 주세요."
            if raw
            else ""
        ),
    }


# 프론트엔드 static 파일 serve
# Electron packaged releases load the renderer directly, but direct backend
# execution in development can still serve frontend/dist when present.
base = Path(__file__).resolve().parent.parent
static_dir = Path(base) / "frontend" / "dist"

if static_dir.exists():
    # SPA 라우팅을 위해 catch-all을 설정하기 전에 static assets 먼저 mount
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(static_dir / "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # API 경로는 제외
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        file_path = static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(static_dir / "index.html"))
