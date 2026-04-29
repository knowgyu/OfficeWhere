from __future__ import annotations

from typing import Any, Dict, List

from backend.core import ppt_compare


def _slide(number: int, title: str, body: str | None = None) -> Dict[str, Any]:
    text = body if body is not None else title
    return {
        "slide_number": number,
        "title": title,
        "signature": f"{title} {text}".strip().lower(),
        "items": [
            {
                "item_type": "text",
                "location": "shape:1",
                "text": text,
                "normalized_text": text.lower(),
            }
        ],
    }


def _file_infos() -> List[Dict[str, Any]]:
    return [
        {"id": 1, "path": "/tmp/left.pptx", "name": "left.pptx", "file_type": "PowerPoint"},
        {"id": 2, "path": "/tmp/right.pptx", "name": "right.pptx", "file_type": "PowerPoint"},
    ]


def test_small_deck_uses_full_dp_alignment(monkeypatch):
    left_slides = [_slide(1, "Overview"), _slide(2, "Plan")]
    right_slides = [_slide(1, "Overview"), _slide(2, "Inserted"), _slide(3, "Plan")]

    def fake_extract(path: str):
        return left_slides if path.endswith("left.pptx") else right_slides

    similarity_calls: list[tuple[str, str]] = []

    def fake_similarity(left: Dict[str, Any], right: Dict[str, Any]) -> float:
        similarity_calls.append((left["title"], right["title"]))
        return 1.0 if left["signature"] == right["signature"] else 0.0

    monkeypatch.setattr(ppt_compare, "extract_ppt_slides", fake_extract)
    monkeypatch.setattr(ppt_compare, "slide_similarity", fake_similarity)

    result = ppt_compare.compare_ppt_files(_file_infos())

    assert len(similarity_calls) == len(left_slides) * len(right_slides)
    assert result["metadata"]["warnings"] == []
    assert result["metadata"]["simplified"] is False
    assert result["changes"] == [
        {
            "change_type": "slide_insert",
            "slide_number_before": None,
            "slide_number_after": 2,
            "title_before": None,
            "title_after": "Inserted",
            "item_changes": [],
        }
    ]


def test_large_deck_skips_full_dp_and_emits_simplified_warning(monkeypatch):
    left_slides = [_slide(number, f"Slide {number}") for number in range(1, 52)]
    right_slides = [_slide(number, f"Slide {number}") for number in range(1, 51)]
    right_slides[24] = _slide(25, "Changed", "changed body")

    assert len(left_slides) * len(right_slides) > ppt_compare.PPT_ALIGNMENT_DP_CELL_BUDGET

    def fake_extract(path: str):
        return left_slides if path.endswith("left.pptx") else right_slides

    def fail_similarity(_left: Dict[str, Any], _right: Dict[str, Any]) -> float:
        raise AssertionError("large PowerPoint comparisons must not run full DP similarity")

    monkeypatch.setattr(ppt_compare, "extract_ppt_slides", fake_extract)
    monkeypatch.setattr(ppt_compare, "slide_similarity", fail_similarity)

    result = ppt_compare.compare_ppt_files(_file_infos())

    assert result["metadata"]["simplified"] is True
    warning = result["metadata"]["warnings"][0]
    assert warning["type"] == "simplified_comparison"
    assert warning["details"]["dp_cell_count"] == 51 * 50
    assert warning["details"]["dp_cell_budget"] == ppt_compare.PPT_ALIGNMENT_DP_CELL_BUDGET
    assert any(change["change_type"] == "slide_update" for change in result["changes"])


def test_large_deck_similarity_calls_are_bounded_to_zero(monkeypatch):
    left_slides = [_slide(number, f"Slide {number}") for number in range(1, 101)]
    right_slides = [_slide(number, f"Slide {number}") for number in range(1, 101)]

    def fake_extract(path: str):
        return left_slides if path.endswith("left.pptx") else right_slides

    similarity_call_count = 0

    def count_similarity(_left: Dict[str, Any], _right: Dict[str, Any]) -> float:
        nonlocal similarity_call_count
        similarity_call_count += 1
        return 1.0

    monkeypatch.setattr(ppt_compare, "extract_ppt_slides", fake_extract)
    monkeypatch.setattr(ppt_compare, "slide_similarity", count_similarity)

    result = ppt_compare.compare_ppt_files(_file_infos())

    assert similarity_call_count == 0
    assert result["metadata"]["simplified"] is True
    assert result["changes"] == []
