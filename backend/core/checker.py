from __future__ import annotations

from typing import Any, Dict, List

from .excel_compare import compare_excel_files
from .ppt_compare import compare_ppt_files
from .word_compare import compare_word_files


def run_consistency_check(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(file_infos) < 2:
        raise ValueError("정합성 검사는 최소 2개 파일이 필요합니다.")

    file_types = {info["file_type"] for info in file_infos}
    if len(file_types) != 1:
        raise ValueError("서로 다른 파일 형식은 함께 비교할 수 없습니다.")

    file_type = next(iter(file_types))
    if file_type == "Excel":
        return {
            "mode": "excel",
            "excel": compare_excel_files(file_infos),
            "word": None,
            "ppt": None,
        }
    if file_type == "Word":
        if len(file_infos) != 2:
            raise ValueError("Word 정합성 검사는 2개 파일만 비교할 수 있습니다.")
        return {
            "mode": "word",
            "excel": None,
            "word": compare_word_files(file_infos),
            "ppt": None,
        }
    if file_type == "PowerPoint":
        if len(file_infos) != 2:
            raise ValueError("PowerPoint 정합성 검사는 2개 파일만 비교할 수 있습니다.")
        return {
            "mode": "ppt",
            "excel": None,
            "word": None,
            "ppt": compare_ppt_files(file_infos),
        }

    raise ValueError(f"지원하지 않는 파일 형식입니다: {file_type}")
