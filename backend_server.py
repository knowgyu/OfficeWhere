"""
Backend-only entrypoint for Electron.

This script starts FastAPI without opening any desktop shell. Runtime settings
can be passed as flags or environment variables so Electron can choose a free
localhost port and a per-user data directory. Packaged Windows builds run this
file through OfficeWhere's bundled embedded Python runtime.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path


def _env_value(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OfficeWhere backend server")
    parser.add_argument("--host", default=_env_value("OW_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(_env_value("OW_PORT", "18765")))
    parser.add_argument("--data-dir", default=_env_value("OW_DATA_DIR"))
    parser.add_argument("--log-level", default=_env_value("OW_LOG_LEVEL", "info"))
    return parser.parse_args()


def main():
    args = parse_args()

    if args.data_dir:
        data_dir = str(Path(args.data_dir).expanduser())
        os.environ["OW_DATA_DIR"] = data_dir
        from backend.database import configure_database

        configure_database(data_dir)

    import uvicorn

    uvicorn.run("backend.main:app", host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
