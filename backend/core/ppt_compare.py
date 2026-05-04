from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

from ..database import (
    COMPARISON_ARTIFACT_VERSION,
    PPT_COMPARISON_ARTIFACT_KIND,
    PPT_COMPARISON_PARSER_VERSION,
    get_comparison_artifact,
)
from .ppt_analysis import extract_ppt_slides, slide_similarity


MATCH_THRESHOLD = 0.55
GAP_PENALTY = -0.35
PPT_ALIGNMENT_DP_CELL_BUDGET = 2500
SIMPLIFIED_LOOKAHEAD = 12


def _default_compare_metadata() -> Dict[str, Any]:
    return {
        "warnings": [],
        "used_last_index_snapshot": True,
        "simplified": False,
        "artifact_status": None,
    }


def _simplified_compare_metadata(left_count: int, right_count: int) -> Dict[str, Any]:
    cell_count = left_count * right_count
    return {
        "warnings": [
            {
                "type": "simplified_comparison",
                "severity": "warning",
                "message": (
                    "PowerPoint 슬라이드 수가 많아 전체 정렬 대신 빠른 비교로 처리했습니다. "
                    "일부 삽입/삭제 위치는 간소화되어 표시될 수 있습니다."
                ),
                "details": {
                    "left_slide_count": left_count,
                    "right_slide_count": right_count,
                    "dp_cell_count": cell_count,
                    "dp_cell_budget": PPT_ALIGNMENT_DP_CELL_BUDGET,
                    "strategy": "bounded_signature_title_alignment",
                },
            }
        ],
        "used_last_index_snapshot": True,
        "simplified": True,
        "artifact_status": None,
    }


def _merge_metadata(target: Dict[str, Any], source: Dict[str, Any]) -> Dict[str, Any]:
    target.setdefault("warnings", []).extend(source.get("warnings", []))
    for key, value in source.items():
        if key == "warnings" or value is None:
            continue
        if key == "simplified":
            target[key] = bool(target.get(key)) or bool(value)
        elif key == "used_last_index_snapshot":
            target[key] = bool(target.get(key, True)) and bool(value)
        elif key == "artifact_status" and target.get(key) not in {None, "ok"}:
            continue
        else:
            target[key] = value
    return target


def _artifact_warning(status: str, file_info: Dict[str, Any]) -> Dict[str, Any]:
    warning_type = "artifact_missing" if status == "missing" else "artifact_rebuilt_or_refresh_needed"
    if status == "artifact_version_mismatch":
        warning_type = "artifact_version_mismatch"
    return {
        "type": warning_type,
        "severity": "info" if status == "missing" else "warning",
        "message": (
            "PowerPoint 비교용 문서 데이터가 없어 원본에서 다시 읽었습니다."
            if status == "missing"
            else "PowerPoint 비교용 문서 데이터를 다시 만들 필요가 있어 원본에서 다시 읽었습니다."
        ),
        "file_ids": [int(file_info["id"])],
        "details": {"artifact_status": status, "artifact_kind": PPT_COMPARISON_ARTIFACT_KIND},
    }


def _ppt_slides_from_artifact(file_info: Dict[str, Any], metadata: Dict[str, Any]) -> List[Dict[str, Any]] | None:
    artifact = get_comparison_artifact(
        int(file_info["id"]),
        PPT_COMPARISON_ARTIFACT_KIND,
        expected_artifact_version=COMPARISON_ARTIFACT_VERSION,
        expected_parser_version=PPT_COMPARISON_PARSER_VERSION,
    )
    status = str(artifact.get("status") or "missing")
    metadata["artifact_status"] = "ok" if metadata.get("artifact_status") in {None, "ok"} and status == "ok" else status
    if status == "unavailable":
        return None
    if status == "ok":
        payload = artifact.get("payload")
        slides = payload.get("slides") if isinstance(payload, dict) else None
        if isinstance(slides, list):
            return [dict(slide) for slide in slides if isinstance(slide, dict)]
        status = "corrupt"
    metadata.setdefault("warnings", []).append(_artifact_warning(status, file_info))
    return None


def _ppt_slides(file_info: Dict[str, Any], metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    slides = _ppt_slides_from_artifact(file_info, metadata)
    if slides is not None:
        return slides
    metadata["used_last_index_snapshot"] = False
    return extract_ppt_slides(file_info["path"])


def _slides_fast_match(left_slide: Dict[str, Any], right_slide: Dict[str, Any]) -> bool:
    left_signature = str(left_slide.get("signature") or "").strip().lower()
    right_signature = str(right_slide.get("signature") or "").strip().lower()
    if left_signature and left_signature == right_signature:
        return True
    left_title = str(left_slide.get("title") or "").strip().lower()
    right_title = str(right_slide.get("title") or "").strip().lower()
    return bool(left_title and left_title == right_title)


def _find_fast_match(
    needle: Dict[str, Any],
    haystack: List[Dict[str, Any]],
    start: int,
    limit: int,
) -> int | None:
    end = min(len(haystack), start + limit + 1)
    for idx in range(start + 1, end):
        if _slides_fast_match(needle, haystack[idx]):
            return idx
    return None


def _align_slides_simplified(
    left_slides: List[Dict[str, Any]],
    right_slides: List[Dict[str, Any]],
) -> List[Tuple[int | None, int | None]]:
    """Return a deterministic bounded alignment for decks too large for full DP.

    The fast path deliberately avoids `slide_similarity`, which can be expensive
    when called for every cross-product DP cell.  It preserves obvious unchanged
    runs by signature/title and otherwise pairs by position so the caller can
    still report deterministic updates plus tail inserts/deletes.
    """
    alignment: List[Tuple[int | None, int | None]] = []
    left_idx = 0
    right_idx = 0

    while left_idx < len(left_slides) and right_idx < len(right_slides):
        left_slide = left_slides[left_idx]
        right_slide = right_slides[right_idx]

        if _slides_fast_match(left_slide, right_slide):
            alignment.append((left_idx, right_idx))
            left_idx += 1
            right_idx += 1
            continue

        next_right_match = _find_fast_match(left_slide, right_slides, right_idx, SIMPLIFIED_LOOKAHEAD)
        if next_right_match is not None:
            while right_idx < next_right_match:
                alignment.append((None, right_idx))
                right_idx += 1
            continue

        next_left_match = _find_fast_match(right_slide, left_slides, left_idx, SIMPLIFIED_LOOKAHEAD)
        if next_left_match is not None:
            while left_idx < next_left_match:
                alignment.append((left_idx, None))
                left_idx += 1
            continue

        alignment.append((left_idx, right_idx))
        left_idx += 1
        right_idx += 1

    while left_idx < len(left_slides):
        alignment.append((left_idx, None))
        left_idx += 1
    while right_idx < len(right_slides):
        alignment.append((None, right_idx))
        right_idx += 1

    return alignment


def _align_slides_dp(
    left_slides: List[Dict[str, Any]],
    right_slides: List[Dict[str, Any]],
) -> List[Tuple[int | None, int | None]]:
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


def _align_slides(
    left_slides: List[Dict[str, Any]],
    right_slides: List[Dict[str, Any]],
) -> Tuple[List[Tuple[int | None, int | None]], Dict[str, Any]]:
    cell_count = len(left_slides) * len(right_slides)
    if cell_count > PPT_ALIGNMENT_DP_CELL_BUDGET:
        return _align_slides_simplified(left_slides, right_slides), _simplified_compare_metadata(
            len(left_slides),
            len(right_slides),
        )
    return _align_slides_dp(left_slides, right_slides), _default_compare_metadata()


def compare_ppt_files(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(file_infos) != 2:
        raise ValueError("PowerPoint 정합성 검사는 2개 파일만 비교할 수 있습니다.")

    metadata = _default_compare_metadata()
    left_slides = _ppt_slides(file_infos[0], metadata)
    right_slides = _ppt_slides(file_infos[1], metadata)
    alignment, alignment_metadata = _align_slides(left_slides, right_slides)
    _merge_metadata(metadata, alignment_metadata)

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
        "metadata": metadata,
    }
