import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .database import get_db_path, init_db
from .api.files import router as files_router
from .api.query import router as query_router
from .api.check import router as check_router
from .api.search import router as search_router
from .api.library import router as library_router
from .core.indexer import start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    yield


app = FastAPI(title="officewhere", version="0.5.1", lifespan=lifespan)

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
app.include_router(query_router)
app.include_router(check_router)
app.include_router(search_router)
app.include_router(library_router)


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
