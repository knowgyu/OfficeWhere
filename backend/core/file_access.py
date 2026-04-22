import os
from pathlib import Path
from typing import Any, Dict

from .normalizer import suggest_key_column
from .parser import SUPPORTED_EXTENSIONS, get_file_schema, get_file_type


def inspect_file_path(path: str) -> Dict[str, Any]:
    """Inspect a local file path before registration."""
    normalized_path = os.path.normpath(path.strip())
    if not normalized_path:
        raise ValueError("파일 경로를 입력해 주세요.")
    if not os.path.exists(normalized_path):
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {normalized_path}")

    ext = Path(normalized_path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"지원하지 않는 파일 형식입니다: {ext}. 지원 형식: .xlsx, .xls, .docx, .pptx"
        )

    schema = get_file_schema(normalized_path)
    columns = schema["columns"]
    return {
        "path": normalized_path,
        "name": Path(normalized_path).name,
        "file_type": get_file_type(normalized_path),
        "columns": columns,
        "sample": schema["sample"],
        "suggested_key_column": suggest_key_column(columns),
    }


def pick_local_file() -> str:
    """
    Open a native file picker on the host machine.
    This is used because browser file inputs do not expose absolute paths.
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError("이 환경에서는 파일 선택창을 열 수 없습니다.") from exc

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.lift()
        root.focus_force()
        path = filedialog.askopenfilename(
            parent=root,
            title="등록할 파일 선택",
            filetypes=[
                ("지원 파일", "*.xlsx *.xls *.docx *.pptx"),
                ("Excel", "*.xlsx *.xls"),
                ("Word", "*.docx"),
                ("PowerPoint", "*.pptx"),
                ("모든 파일", "*.*"),
            ],
        )
        root.destroy()
    except Exception as exc:
        raise RuntimeError(
            "파일 선택창을 열지 못했습니다. 수동으로 경로를 입력해 주세요."
        ) from exc

    return os.path.normpath(path) if path else ""
