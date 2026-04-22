import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .database import init_db
from .api.files import router as files_router
from .api.query import router as query_router
from .api.check import router as check_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="office-data-joiner", version="0.1.0", lifespan=lifespan)

# CORS 설정 (개발 시 localhost:5173 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8765",
        "http://127.0.0.1:8765",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(files_router)
app.include_router(query_router)
app.include_router(check_router)


# 프론트엔드 static 파일 serve
# PyInstaller 패키징 여부에 따라 경로 자동 분기
if getattr(sys, "frozen", False):
    base = sys._MEIPASS
else:
    base = Path(__file__).parent.parent

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
