from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

from .ppt_analysis import extract_ppt_slides, slide_similarity


MATCH_THRESHOLD = 0.55
GAP_PENALTY = -0.35


def _align_slides(left_slides: List[Dict[str, Any]], right_slides: List[Dict[str, Any]]) -> List[Tuple[int | None, int | None]]:
    rows = len(left_slides)
    cols = len(right_slides)
    dp = [[0.0 for _ in range(cols + 1)] for _ in range(rows + 1)]
    backtrack: List[List[Tuple[str, int | None, int | None]]] = [
        [("", None, None) for _ in range(cols + 1)] for _ in range(rows + 1)
    ]

    for i in range(1, rows + 1):
        dp[i][0] = dp[i - 1][0] + GAP_PENALTY
        backtrack[i][0] = ("delete", i - 1, None)
    for j in range(1, cols + 1):
        dp[0][j] = dp[0][j - 1] + GAP_PENALTY
        backtrack[0][j] = ("insert", None, j - 1)

    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            similarity = slide_similarity(left_slides[i - 1], right_slides[j - 1])
            match_score = dp[i - 1][j - 1] + (similarity if similarity >= MATCH_THRESHOLD else -1.0)
            delete_score = dp[i - 1][j] + GAP_PENALTY
            insert_score = dp[i][j - 1] + GAP_PENALTY

            best_score = match_score
            best_step: Tuple[str, int | None, int | None] = ("match", i - 1, j - 1)
            if delete_score > best_score:
                best_score = delete_score
                best_step = ("delete", i - 1, None)
            if insert_score > best_score:
                best_score = insert_score
                best_step = ("insert", None, j - 1)

            dp[i][j] = best_score
            backtrack[i][j] = best_step

    alignment: List[Tuple[int | None, int | None]] = []
    i, j = rows, cols
    while i > 0 or j > 0:
        step, left_idx, right_idx = backtrack[i][j]
        if step == "match":
            alignment.append((left_idx, right_idx))
            i -= 1
            j -= 1
        elif step == "delete":
            alignment.append((left_idx, None))
            i -= 1
        else:
            alignment.append((None, right_idx))
            j -= 1

    alignment.reverse()
    return alignment


def _diff_slide_items(left_slide: Dict[str, Any], right_slide: Dict[str, Any]) -> List[Dict[str, Any]]:
    matcher = SequenceMatcher(
        None,
        [item["normalized_text"] for item in left_slide["items"]],
        [item["normalized_text"] for item in right_slide["items"]],
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
                        "item_type": item["item_type"],
                        "location": item["location"],
                        "text": item["text"],
                    }
                    for item in left_slide["items"][i1:i2]
                ],
                "after": [
                    {
                        "item_type": item["item_type"],
                        "location": item["location"],
                        "text": item["text"],
                    }
                    for item in right_slide["items"][j1:j2]
                ],
            }
        )
    return changes


def compare_ppt_files(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(file_infos) != 2:
        raise ValueError("PowerPoint 정합성 검사는 2개 파일만 비교할 수 있습니다.")

    left_slides = extract_ppt_slides(file_infos[0]["path"])
    right_slides = extract_ppt_slides(file_infos[1]["path"])
    alignment = _align_slides(left_slides, right_slides)

    changes: List[Dict[str, Any]] = []
    for left_idx, right_idx in alignment:
        if left_idx is None and right_idx is not None:
            slide = right_slides[right_idx]
            changes.append(
                {
                    "change_type": "slide_insert",
                    "slide_number_before": None,
                    "slide_number_after": slide["slide_number"],
                    "title_before": None,
                    "title_after": slide["title"],
                    "item_changes": [],
                }
            )
            continue

        if right_idx is None and left_idx is not None:
            slide = left_slides[left_idx]
            changes.append(
                {
                    "change_type": "slide_delete",
                    "slide_number_before": slide["slide_number"],
                    "slide_number_after": None,
                    "title_before": slide["title"],
                    "title_after": None,
                    "item_changes": [],
                }
            )
            continue

        left_slide = left_slides[left_idx]
        right_slide = right_slides[right_idx]
        item_changes = _diff_slide_items(left_slide, right_slide)
        title_changed = left_slide["title"] != right_slide["title"]
        if title_changed or item_changes:
            changes.append(
                {
                    "change_type": "slide_update",
                    "slide_number_before": left_slide["slide_number"],
                    "slide_number_after": right_slide["slide_number"],
                    "title_before": left_slide["title"],
                    "title_after": right_slide["title"],
                    "item_changes": item_changes,
                }
            )

    return {
        "files": [
            {"file_id": file_infos[0]["id"], "file_name": file_infos[0]["name"]},
            {"file_id": file_infos[1]["id"], "file_name": file_infos[1]["name"]},
        ],
        "changes": changes,
    }
