"""
Backend-only entrypoint for Electron.

This script starts FastAPI without opening any desktop shell. Runtime settings
can be passed as flags or environment variables so Electron can choose a free
localhost port and a per-user data directory. Packaged builds run this file
through OfficeWhere's bundled backend runtime.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path


def _env_value(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def _guard_e2e() -> None:
    """Refuse to start when E2E env signals are inconsistent or point at real user data.

    Two distinct env signals are required:
    - OW_E2E=1 marks the process as part of an automated E2E run.
    - OW_E2E_ALLOW=1 confirms intent to bypass production startup protections.

    Splitting the signals lets developers set OW_E2E=1 to enable IPC determinism
    in dev (e.g. dialog automation for demos) without having the backend refuse
    to start. The harness sets both.
    """
    if os.environ.get("OW_E2E", "").strip() != "1":
        return
    if os.environ.get("OW_E2E_ALLOW", "").strip() != "1":
        sys.stderr.write(
            "OW_E2E=1 but OW_E2E_ALLOW not set. Refusing to start.\n"
            "If running tests, set OW_E2E_ALLOW=1.\n"
            "If this is a dev shell, run: unset OW_E2E\n"
        )
        sys.exit(78)  # EX_CONFIG
    data_dir = os.environ.get("OW_DATA_DIR", "").strip()
    # Markers identifying the user's real OfficeWhere data directory across OS.
    # macOS:   ~/Library/Application Support/OfficeWhere
    # Windows: %APPDATA%\OfficeWhere = C:\Users\<user>\AppData\Roaming\OfficeWhere
    # Linux:   ~/.config/OfficeWhere
    real_markers = (
        "Application Support/OfficeWhere",
        "AppData\\Roaming\\OfficeWhere",
        "AppData/Roaming/OfficeWhere",
        ".config/OfficeWhere",
    )
    if not data_dir or any(marker in data_dir for marker in real_markers):
        sys.stderr.write(
            f"OW_E2E refused: OW_DATA_DIR must point at a temp dir, got: {data_dir!r}\n"
        )
        sys.exit(78)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OfficeWhere backend server")
    parser.add_argument("--host", default=_env_value("OW_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(_env_value("OW_PORT", "18765")))
    parser.add_argument("--data-dir", default=_env_value("OW_DATA_DIR"))
    parser.add_argument("--log-level", default=_env_value("OW_LOG_LEVEL", "info"))
    return parser.parse_args()


def main():
    _guard_e2e()
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
