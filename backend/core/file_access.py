import os
from pathlib import Path
from typing import Any, Dict, List

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
    file_type = get_file_type(normalized_path)
    return {
        "path": normalized_path,
        "name": Path(normalized_path).name,
        "file_type": file_type,
        "columns": columns,
        "sample": schema["sample"],
        "suggested_key_column": suggest_key_column(columns) if file_type == "Excel" else None,
        "parser_config": schema.get("parser_config", {}),
        "table_candidates": schema.get("table_candidates", []),
        "comparison_mode": file_type.lower().replace("powerpoint", "ppt"),
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


def scan_folder(folder_path: str, recursive: bool = True) -> List[Dict[str, Any]]:
    """폴더 내 지원 파일을 병렬로 스캔하여 파일 정보 목록 반환."""
    from concurrent.futures import ThreadPoolExecutor

    folder = Path(os.path.normpath(folder_path.strip()))
    if not folder.exists():
        raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
    if not folder.is_dir():
        raise ValueError(f"폴더가 아닙니다: {folder_path}")

    glob_pattern = "**/*" if recursive else "*"
    found: List[Path] = sorted(
        p for ext in SUPPORTED_EXTENSIONS
        for p in folder.glob(f"{glob_pattern}{ext}")
        if p.is_file() and not p.name.startswith("~$")
    )

    def _inspect_one(file_path: Path) -> Dict[str, Any]:
        try:
            info = inspect_file_path(str(file_path))
            info["error"] = None
            return info
        except Exception as e:
            return {
                "path": str(file_path),
                "name": file_path.name,
                "file_type": get_file_type(str(file_path)),
                "columns": [],
                "sample": [],
                "suggested_key_column": None,
                "parser_config": {},
                "table_candidates": [],
                "comparison_mode": get_file_type(str(file_path)).lower().replace("powerpoint", "ppt"),
                "error": str(e),
            }

    with ThreadPoolExecutor(max_workers=8) as executor:
        return list(executor.map(_inspect_one, found))


def pick_local_folder() -> str:
    """OS 폴더 선택창을 열고 선택된 폴더 경로 반환."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError("이 환경에서는 폴더 선택창을 열 수 없습니다.") from exc

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.lift()
        root.focus_force()
        path = filedialog.askdirectory(
            parent=root,
            title="스캔할 폴더 선택",
        )
        root.destroy()
    except Exception as exc:
        raise RuntimeError("폴더 선택창을 열지 못했습니다. 수동으로 경로를 입력해 주세요.") from exc

    return os.path.normpath(path) if path else ""
