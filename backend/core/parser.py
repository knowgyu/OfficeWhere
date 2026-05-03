from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict

if TYPE_CHECKING:
    import pandas as pd

from .excel_analysis import extract_excel_used_range, inspect_excel_file
from .file_scope import SUPPORTED_EXTENSIONS
from .ppt_analysis import inspect_ppt_file
from .word_analysis import inspect_word_file


def get_file_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    mapping = {
        ".xlsx": "Excel",
        ".xls": "Excel",
        ".docx": "Word",
        ".pptx": "PowerPoint",
    }
    return mapping.get(ext, "Unknown")


def parse_excel(path: str) -> "pd.DataFrame":
    try:
        dataframe, _range_config = extract_excel_used_range(path)
        return dataframe
    except Exception as exc:
        raise ValueError(f"Excel 파일 파싱 실패: {exc}") from exc


def parse_file(path: str) -> "pd.DataFrame":
    if not os.path.exists(path):
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {path}")
    ext = Path(path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {ext}")
    if ext in (".xlsx", ".xls"):
        return parse_excel(path)
    raise ValueError("표 형태 파싱은 Excel 파일만 지원합니다.")


def get_file_schema(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {path}")

    file_type = get_file_type(path)
    if file_type == "Excel":
        return inspect_excel_file(path)
    if file_type == "Word":
        return inspect_word_file(path)
    if file_type == "PowerPoint":
        return inspect_ppt_file(path)
    raise ValueError(f"지원하지 않는 파일 형식입니다: {Path(path).suffix.lower()}")
