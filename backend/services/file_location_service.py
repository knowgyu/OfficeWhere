from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict


def windows_explorer_select_arg(path: Path) -> str:
    # Explorer supports /select,<path>.  Supplying a list-form executable plus a
    # single /select,"path" argument avoids shell execution while preserving the
    # Windows selection behavior for paths with spaces or Hangul.
    return f'/select,"{path}"'


def show_item_in_folder(path: Path) -> None:
    if sys.platform == "win32":
        subprocess.Popen(["explorer.exe", windows_explorer_select_arg(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent)])


def open_file_path(path: str) -> None:
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def require_registered_file_path(file_row: Dict[str, Any] | None) -> str:
    if not file_row:
        raise FileNotFoundError("등록되지 않은 파일입니다.")

    path = str(file_row["path"])
    if not os.path.exists(path):
        raise FileNotFoundError(f"파일이 삭제되었거나 경로가 변경되었습니다: {path}")
    return path


def open_registered_file(file_row: Dict[str, Any] | None) -> None:
    open_file_path(require_registered_file_path(file_row))


def show_registered_file_in_folder(file_row: Dict[str, Any] | None) -> None:
    show_item_in_folder(Path(require_registered_file_path(file_row)))
