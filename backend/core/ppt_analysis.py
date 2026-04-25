from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any, Dict, List

from .normalizer import normalize_value


def _coerce_position(value: Any) -> int:
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(str(value)))
        except (TypeError, ValueError):
            return 0


def _slide_title(slide) -> str:
    if slide.shapes.title and slide.shapes.title.text:
        return slide.shapes.title.text.strip()
    for shape in slide.shapes:
        if getattr(shape, "has_text_frame", False):
            text = shape.text_frame.text.strip()
            if text:
                return text
    return ""


def extract_ppt_slides(path: str) -> List[Dict[str, Any]]:
    from pptx import Presentation

    presentation = Presentation(path)
    slides: List[Dict[str, Any]] = []

    for slide_number, slide in enumerate(presentation.slides, start=1):
        items: List[Dict[str, Any]] = []
        sortable_items: List[tuple[int, int, Dict[str, Any]]] = []
        for shape_idx, shape in enumerate(slide.shapes, start=1):
            top = _coerce_position(getattr(shape, "top", 0))
            left = _coerce_position(getattr(shape, "left", 0))
            if getattr(shape, "has_text_frame", False):
                text = shape.text_frame.text.strip()
                if text:
                    sortable_items.append(
                        (
                            top,
                            left,
                            {
                                "item_type": "text",
                                "location": f"shape:{shape_idx}",
                                "text": text,
                                "normalized_text": normalize_value(text),
                            },
                        )
                    )
            if getattr(shape, "has_table", False):
                for row_idx, row in enumerate(shape.table.rows, start=1):
                    row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                    if not row_text:
                        continue
                    sortable_items.append(
                        (
                            top,
                            left,
                            {
                                "item_type": "table_row",
                                "location": f"shape:{shape_idx}/row:{row_idx}",
                                "text": row_text,
                                "normalized_text": normalize_value(row_text),
                            },
                        )
                    )

        sortable_items.sort(key=lambda item: (item[0], item[1], item[2]["location"]))
        items = [item[2] for item in sortable_items]
        title = _slide_title(slide)
        signature_source = " ".join([title] + [item["text"] for item in items])
        slides.append(
            {
                "slide_number": slide_number,
                "title": title,
                "signature": normalize_value(signature_source).lower(),
                "items": items,
            }
        )

    return slides


def slide_similarity(left_slide: Dict[str, Any], right_slide: Dict[str, Any]) -> float:
    if left_slide["title"] and left_slide["title"] == right_slide["title"]:
        return 1.0
    return SequenceMatcher(None, left_slide["signature"], right_slide["signature"]).ratio()


def inspect_ppt_file(path: str) -> Dict[str, Any]:
    slides = extract_ppt_slides(path)
    sample = [[slide["slide_number"], slide["title"], len(slide["items"])] for slide in slides[:5]]
    return {
        "parser_config": {},
        "table_candidates": [],
        "columns": ["slide_number", "title", "item_count"],
        "sample": sample,
        "slide_count": len(slides),
    }
