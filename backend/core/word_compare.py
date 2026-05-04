from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any, Dict, List

from ..database import (
    COMPARISON_ARTIFACT_VERSION,
    WORD_COMPARISON_ARTIFACT_KIND,
    WORD_COMPARISON_PARSER_VERSION,
    get_comparison_artifact,
)
from .word_analysis import extract_word_blocks


def _default_compare_metadata() -> Dict[str, Any]:
    return {
        "warnings": [],
        "used_last_index_snapshot": True,
        "artifact_status": None,
    }


def _artifact_warning(status: str, file_info: Dict[str, Any]) -> Dict[str, Any]:
    warning_type = "artifact_missing" if status == "missing" else "artifact_rebuilt_or_refresh_needed"
    if status == "artifact_version_mismatch":
        warning_type = "artifact_version_mismatch"
    return {
        "type": warning_type,
        "severity": "info" if status == "missing" else "warning",
        "message": (
            "Word 비교용 문서 데이터가 없어 원본에서 다시 읽었습니다."
            if status == "missing"
            else "Word 비교용 문서 데이터를 다시 만들 필요가 있어 원본에서 다시 읽었습니다."
        ),
        "file_ids": [int(file_info["id"])],
        "details": {"artifact_status": status, "artifact_kind": WORD_COMPARISON_ARTIFACT_KIND},
    }


def _word_blocks_from_artifact(file_info: Dict[str, Any], metadata: Dict[str, Any]) -> List[Dict[str, Any]] | None:
    artifact = get_comparison_artifact(
        int(file_info["id"]),
        WORD_COMPARISON_ARTIFACT_KIND,
        expected_artifact_version=COMPARISON_ARTIFACT_VERSION,
        expected_parser_version=WORD_COMPARISON_PARSER_VERSION,
    )
    status = str(artifact.get("status") or "missing")
    metadata["artifact_status"] = "ok" if metadata.get("artifact_status") in {None, "ok"} and status == "ok" else status
    if status == "unavailable":
        return None
    if status == "ok":
        payload = artifact.get("payload")
        blocks = payload.get("blocks") if isinstance(payload, dict) else None
        if isinstance(blocks, list):
            return [dict(block) for block in blocks if isinstance(block, dict)]
        status = "corrupt"
    metadata.setdefault("warnings", []).append(_artifact_warning(status, file_info))
    return None


def _word_blocks(file_info: Dict[str, Any], metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    blocks = _word_blocks_from_artifact(file_info, metadata)
    if blocks is not None:
        return blocks
    metadata["used_last_index_snapshot"] = False
    return extract_word_blocks(file_info["path"])


def compare_word_files(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(file_infos) != 2:
        raise ValueError("Word 정합성 검사는 2개 파일만 비교할 수 있습니다.")

    metadata = _default_compare_metadata()
    left_blocks = _word_blocks(file_infos[0], metadata)
    right_blocks = _word_blocks(file_infos[1], metadata)

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
        "metadata": metadata,
    }
