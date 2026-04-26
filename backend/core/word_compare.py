from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any, Dict, List

from .word_analysis import extract_word_blocks


def compare_word_files(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(file_infos) != 2:
        raise ValueError("Word 정합성 검사는 2개 파일만 비교할 수 있습니다.")

    left_blocks = extract_word_blocks(file_infos[0]["path"])
    right_blocks = extract_word_blocks(file_infos[1]["path"])

    matcher = SequenceMatcher(
        None,
        [block["normalized_text"] for block in left_blocks],
        [block["normalized_text"] for block in right_blocks],
        autojunk=False,
    )

    changes: List[Dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        changes.append(
            {
                "change_type": tag,
                "before": [
                    {
                        "block_type": block["block_type"],
                        "location": block["location"],
                        "page_number": block.get("page_number"),
                        "text": block["text"],
                    }
                    for block in left_blocks[i1:i2]
                ],
                "after": [
                    {
                        "block_type": block["block_type"],
                        "location": block["location"],
                        "page_number": block.get("page_number"),
                        "text": block["text"],
                    }
                    for block in right_blocks[j1:j2]
                ],
            }
        )

    return {
        "files": [
            {"file_id": file_infos[0]["id"], "file_name": file_infos[0]["name"]},
            {"file_id": file_infos[1]["id"], "file_name": file_infos[1]["name"]},
        ],
        "changes": changes,
    }
