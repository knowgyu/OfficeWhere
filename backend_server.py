"""
Backend-only entrypoint for Electron.

This process starts FastAPI without opening any desktop shell. Runtime settings
can be passed as flags or environment variables so Electron can choose a free
localhost port and a per-user data directory.
"""

from __future__ import annotations

import argparse
import asyncio
import multiprocessing
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Office Data Joiner backend server")
    parser.add_argument("--host", default=os.environ.get("ODJ_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("ODJ_PORT", "8765")))
    parser.add_argument("--data-dir", default=os.environ.get("ODJ_DATA_DIR", ""))
    parser.add_argument("--log-level", default=os.environ.get("ODJ_LOG_LEVEL", "info"))
    return parser.parse_args()


def main():
    args = parse_args()

    if args.data_dir:
        data_dir = str(Path(args.data_dir).expanduser())
        os.environ["ODJ_DATA_DIR"] = data_dir
        from backend.database import configure_database

        configure_database(data_dir)

    import uvicorn

    if getattr(sys, "frozen", False):
        from backend.main import app

        uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    else:
        uvicorn.run("backend.main:app", host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
