from __future__ import annotations

from typing import Any, Dict, Iterable, List, Sequence, Tuple

from .excel_analysis import extract_excel_used_range
from .excel_compare import _column_letter, _stringify_cell
from .normalizer import normalize_key, values_equal


FULL_GRID_CELL_LIMIT = 12_000
TOP_LEFT_CELL_LIMIT = 12_000
DISPLAY_ROW_MARGIN = 2
DISPLAY_COL_MARGIN = 2
LOCAL_ROW_BUFFER = 20
LOCAL_COL_BUFFER = 20
CLUSTER_ROW_GAP = 80
CLUSTER_COL_GAP = 80
NO_FOCUS_ROW_LIMIT = 80
NO_FOCUS_COL_LIMIT = 40
MAX_SECTIONS = 8


Position = Tuple[int, int]
Range = Tuple[int, int, int, int]


def _coerce_history(history: Any) -> Dict[str, Any]:
    if hasattr(history, "model_dump"):
        return history.model_dump()
    if isinstance(history, dict):
        return history
    return {}


def _coerce_focus(focus: Any) -> Dict[str, Any]:
    if hasattr(focus, "model_dump"):
        return focus.model_dump()
    if isinstance(focus, dict):
        return focus
    return {}


def _highlight_rank(change_type: str) -> int:
    return {"removed": 3, "changed": 2, "added": 1}.get(change_type, 0)


def _normalize_change_type(change_type: str) -> str:
    text = str(change_type or "").strip().lower()
    if "remove" in text or "delete" in text or "삭제" in text:
        return "removed"
    if "add" in text or "insert" in text or "추가" in text:
        return "added"
    return "changed"


def _add_row_alias(lookup: Dict[str, int], value: Any, row_index: int) -> None:
    key = normalize_key(str(value or ""))
    if key and key not in lookup:
        lookup[key] = row_index


def _add_column_alias(lookup: Dict[str, int], value: Any, column_index: int) -> None:
    key = normalize_key(str(value or ""))
    if key and key not in lookup:
        lookup[key] = column_index


def _diff_change_type(before: str, after: str) -> str:
    before_empty = not before.strip()
    after_empty = not after.strip()
    if before_empty and not after_empty:
        return "added"
    if not before_empty and after_empty:
        return "removed"
    return "changed"


def _bounded_range(start: int, end: int, maximum: int) -> Tuple[int, int]:
    if maximum <= 0:
        return 0, -1
    return max(0, start), min(maximum - 1, end)


def _range_cell_count(row_start: int, row_end: int, col_start: int, col_end: int) -> int:
    if row_end < row_start or col_end < col_start:
        return 0
    return (row_end - row_start + 1) * (col_end - col_start + 1)


def _cluster_positions(positions: Sequence[Position]) -> List[List[Position]]:
    clusters: List[List[Position]] = []
    bounds: List[Range] = []

    for row_index, col_index in sorted(positions):
        matched_index = -1
        for index, (row_start, row_end, col_start, col_end) in enumerate(bounds):
            if (
                row_start - CLUSTER_ROW_GAP <= row_index <= row_end + CLUSTER_ROW_GAP
                and col_start - CLUSTER_COL_GAP <= col_index <= col_end + CLUSTER_COL_GAP
            ):
                matched_index = index
                break

        if matched_index < 0:
            clusters.append([(row_index, col_index)])
            bounds.append((row_index, row_index, col_index, col_index))
            continue

        clusters[matched_index].append((row_index, col_index))
        row_start, row_end, col_start, col_end = bounds[matched_index]
        bounds[matched_index] = (
            min(row_start, row_index),
            max(row_end, row_index),
            min(col_start, col_index),
            max(col_end, col_index),
        )

    return clusters


def _merge_ranges(ranges: Iterable[Range]) -> List[Range]:
    merged: List[Range] = []
    for candidate in ranges:
        row_start, row_end, col_start, col_end = candidate
        merged_index = -1
        for index, (existing_row_start, existing_row_end, existing_col_start, existing_col_end) in enumerate(merged):
            overlaps = not (
                row_end < existing_row_start
                or row_start > existing_row_end
                or col_end < existing_col_start
                or col_start > existing_col_end
            )
            if overlaps:
                merged_index = index
                break
        if merged_index < 0:
            merged.append(candidate)
            continue
        existing = merged[merged_index]
        merged[merged_index] = (
            min(existing[0], row_start),
            max(existing[1], row_end),
            min(existing[2], col_start),
            max(existing[3], col_end),
        )
    return merged


def _choose_ranges(
    positions: Sequence[Position],
    row_count: int,
    column_count: int,
) -> Tuple[List[Range], bool]:
    total_cells = row_count * column_count
    if row_count == 0 or column_count == 0:
        return [], False
    if total_cells <= FULL_GRID_CELL_LIMIT:
        return [(0, row_count - 1, 0, column_count - 1)], False
    if not positions:
        row_start, row_end = _bounded_range(0, NO_FOCUS_ROW_LIMIT - 1, row_count)
        col_start, col_end = _bounded_range(0, NO_FOCUS_COL_LIMIT - 1, column_count)
        return [(row_start, row_end, col_start, col_end)], True

    max_row = max(row for row, _ in positions)
    max_col = max(col for _, col in positions)
    top_left_row_end = min(row_count - 1, max_row + LOCAL_ROW_BUFFER)
    top_left_col_end = min(column_count - 1, max_col + LOCAL_COL_BUFFER)
    if _range_cell_count(0, top_left_row_end, 0, top_left_col_end) <= TOP_LEFT_CELL_LIMIT:
        return [(0, top_left_row_end, 0, top_left_col_end)], True

    ranges: List[Range] = []
    for cluster in _cluster_positions(positions):
        min_row = min(row for row, _ in cluster)
        max_row = max(row for row, _ in cluster)
        min_col = min(col for _, col in cluster)
        max_col = max(col for _, col in cluster)
        row_start, row_end = _bounded_range(min_row - LOCAL_ROW_BUFFER, max_row + LOCAL_ROW_BUFFER, row_count)
        col_start, col_end = _bounded_range(min_col - LOCAL_COL_BUFFER, max_col + LOCAL_COL_BUFFER, column_count)
        ranges.append((row_start, row_end, col_start, col_end))

    return _merge_ranges(ranges)[:MAX_SECTIONS], True


def _build_excel_diff_grid_for_sheet(
    file_infos: List[Dict[str, Any]],
    focuses: List[Any],
    *,
    target_sheet: str | None = None,
    section_id_prefix: str = "section",
) -> Dict[str, Any]:
    if len(file_infos) < 2:
        raise ValueError("표로 보기는 최소 2개 Excel 파일이 필요합니다.")

    latest_info = file_infos[0]
    used_ranges = []
    for info in file_infos:
        used_range, parser = extract_excel_used_range(info["path"], sheet_name=target_sheet)
        used_ranges.append((info, used_range, parser))
    latest_range = used_ranges[0][1]
    range_config = used_ranges[0][2]

    used_row_count = max((used_range.row_count for _info, used_range, _config in used_ranges), default=0)
    used_column_count = max((used_range.column_count for _info, used_range, _config in used_ranges), default=0)
    row_count = used_row_count + DISPLAY_ROW_MARGIN if used_row_count > 0 else 0
    column_count = used_column_count + DISPLAY_COL_MARGIN if used_column_count > 0 else 0
    columns = [_column_letter(index) for index in range(1, column_count + 1)]
    column_lookup: Dict[str, int] = {}
    row_number_lookup: Dict[str, int] = {}

    for column_index, column in enumerate(columns):
        _add_column_alias(column_lookup, column, column_index)
    for row_index in range(row_count):
        _add_row_alias(row_number_lookup, row_index + 1, row_index)

    def value_at(used_range: Any, row_index: int, column_index: int) -> str:
        return _stringify_cell(used_range.value_at(row_index, column_index))

    def latest_value(row_index: int, column_index: int) -> str:
        return value_at(latest_range, row_index, column_index)

    def register_header_aliases(used_range: Any) -> None:
        scan_rows = min(used_range.row_count, 30)
        scan_cols = min(used_range.column_count, column_count)
        for row_index in range(scan_rows):
            row_values = [value_at(used_range, row_index, column_index) for column_index in range(scan_cols)]
            if sum(1 for value in row_values if value.strip()) < 2:
                continue
            for column_index, value in enumerate(row_values):
                _add_column_alias(column_lookup, value, column_index)

    for _info, used_range, _config in used_ranges:
        register_header_aliases(used_range)

    context_col_index = 0

    def resolve_focus_position(key: str, column: str) -> Position | None:
        normalized_key = normalize_key(key)
        column_ref = column_lookup.get(normalize_key(column))
        if not normalized_key or not column_ref:
            return None

        column_index = column_ref
        row_index = row_number_lookup.get(normalized_key)
        if row_index is None:
            return None
        return (row_index, column_index)

    histories_by_position: Dict[Position, List[Dict[str, Any]]] = {}
    highlight_by_position: Dict[Position, str] = {}
    omitted_focus_count = 0
    latest_pair_from_id = used_ranges[1][0]["id"] if len(used_ranges) > 1 else None
    latest_pair_to_id = used_ranges[0][0]["id"] if len(used_ranges) > 1 else None

    def is_same_file_id(value: Any, expected: Any) -> bool:
        if value is None or expected is None:
            return False
        try:
            return int(value) == int(expected)
        except (TypeError, ValueError):
            return str(value) == str(expected)

    def is_latest_pair_history(history: Dict[str, Any]) -> bool:
        return is_same_file_id(history.get("from_file_id"), latest_pair_from_id) and is_same_file_id(
            history.get("to_file_id"),
            latest_pair_to_id,
        )

    def set_latest_highlight(position: Position, change_type: str) -> None:
        normalized_change_type = _normalize_change_type(change_type)
        existing = highlight_by_position.get(position)
        if existing is None or _highlight_rank(normalized_change_type) > _highlight_rank(existing):
            highlight_by_position[position] = normalized_change_type

    for raw_focus in focuses:
        focus = _coerce_focus(raw_focus)
        focus_sheet = str(focus.get("sheet_name", "") or "")
        if target_sheet and focus_sheet and focus_sheet != target_sheet:
            continue
        key = str(focus.get("key", "") or "")
        if target_sheet and "!" in key:
            maybe_sheet, maybe_key = key.rsplit("!", 1)
            if maybe_sheet == target_sheet:
                key = maybe_key
        column = str(focus.get("column", "") or "")
        position = resolve_focus_position(key, column)
        if position is None:
            omitted_focus_count += 1
            continue

        histories = [_coerce_history(history) for history in focus.get("histories", [])]
        if histories:
            histories_by_position.setdefault(position, []).extend(histories)
            for history in histories:
                if is_latest_pair_history(history):
                    set_latest_highlight(position, str(history.get("change_type", focus.get("change_type", ""))))
        else:
            histories_by_position.setdefault(position, []).append(
                {
                    "change_type": _normalize_change_type(str(focus.get("change_type", ""))),
                    "label": "변경 이력",
                }
            )
            if len(used_ranges) == 2:
                set_latest_highlight(position, str(focus.get("change_type", "")))

    if row_count * column_count <= FULL_GRID_CELL_LIMIT:
        for newer_index in range(0, len(used_ranges) - 1):
            newer_info, newer_range, _newer_config = used_ranges[newer_index]
            older_info, older_range, _older_config = used_ranges[newer_index + 1]
            history_label = f"{older_info['name']} → {newer_info['name']}"

            for row_index in range(row_count):
                for column_index in range(column_count):
                    before = value_at(older_range, row_index, column_index)
                    after = value_at(newer_range, row_index, column_index)
                    if values_equal(before, after):
                        continue

                    position = (row_index, column_index)
                    change_type = _diff_change_type(before, after)
                    existing_histories = histories_by_position.setdefault(position, [])
                    if not any(history.get("label") == history_label for history in existing_histories):
                        existing_histories.append(
                            {
                                "change_type": change_type,
                                "from_file_id": older_info["id"],
                                "from_file_name": older_info["name"],
                                "to_file_id": newer_info["id"],
                                "to_file_name": newer_info["name"],
                                "before": before,
                                "after": after,
                                "label": history_label,
                            }
                        )

                    if newer_index == 0:
                        set_latest_highlight(position, change_type)

    focus_positions = list(histories_by_position.keys())
    ranges, partial = _choose_ranges(focus_positions, row_count, column_count)
    sections = []

    for section_index, (row_start, row_end, col_start, col_end) in enumerate(ranges, start=1):
        if row_end < row_start or col_end < col_start:
            continue

        column_range = list(range(col_start, col_end + 1))
        if context_col_index not in column_range:
            column_range = [context_col_index, *column_range]

        section_columns = [
            {
                "index": column_index,
                "letter": _column_letter(column_index + 1),
                "name": columns[column_index],
            }
            for column_index in column_range
        ]

        rows = []
        for row_index in range(row_start, row_end + 1):
            row_number = row_index + 1
            cells = []
            for column_index in column_range:
                column_name = columns[column_index]
                position = (row_index, column_index)
                cells.append(
                    {
                        "sheet_name": str(range_config["sheet_name"]),
                        "row_index": row_index,
                        "row_number": row_number,
                        "column_index": column_index,
                        "column_letter": _column_letter(column_index + 1),
                        "column_name": column_name,
                        "value": latest_value(row_index, column_index),
                        "highlight": highlight_by_position.get(position),
                        "histories": histories_by_position.get(position, []),
                    }
                )
            rows.append(
                {
                    "sheet_name": str(range_config["sheet_name"]),
                    "row_index": row_index,
                    "row_number": row_number,
                    "cells": cells,
                }
            )

        section_focus_count = sum(
            1
            for row_index, column_index in focus_positions
            if row_start <= row_index <= row_end and col_start <= column_index <= col_end
        )
        title = "전체 표" if not partial else f"변경 구간 {section_index}"
        if partial and section_focus_count:
            title = f"변경 구간 {section_index} · 변경 셀 {section_focus_count}개 포함"
        description = (
            "표가 작아 전체 사용 범위와 여유 2행/열을 표시합니다."
            if not partial
            else "변경 셀을 중심으로 필요한 범위만 표시합니다. 첫 열은 함께 보여줍니다."
        )
        sections.append(
            {
                "id": f"{section_id_prefix}-{section_index}",
                "sheet_name": str(range_config["sheet_name"]),
                "title": title,
                "description": description,
                "partial": partial,
                "row_start": row_start + 1,
                "row_end": row_end + 1,
                "col_start": col_start + 1,
                "col_end": col_end + 1,
                "columns": section_columns,
                "rows": rows,
            }
        )

    return {
        "latest_file": {
            "file_id": latest_info["id"],
            "file_name": latest_info["name"],
        },
        "row_count": row_count,
        "column_count": column_count,
        "sheet_name": str(range_config["sheet_name"]),
        "partial": partial,
        "omitted_focus_count": omitted_focus_count,
        "sections": sections,
    }


def build_excel_diff_grid(file_infos: List[Dict[str, Any]], focuses: List[Any]) -> Dict[str, Any]:
    focus_sheet_names: List[str] = []
    for raw_focus in focuses:
        focus = _coerce_focus(raw_focus)
        sheet_name = str(focus.get("sheet_name", "") or "")
        if sheet_name and sheet_name not in focus_sheet_names:
            focus_sheet_names.append(sheet_name)

    if len(focus_sheet_names) <= 1:
        return _build_excel_diff_grid_for_sheet(
            file_infos,
            focuses,
            target_sheet=focus_sheet_names[0] if focus_sheet_names else None,
        )

    combined_sections: List[Dict[str, Any]] = []
    row_count = 0
    column_count = 0
    partial = False
    omitted_focus_count = 0
    latest_file: Dict[str, Any] | None = None

    for sheet_index, sheet_name in enumerate(focus_sheet_names[:MAX_SECTIONS], start=1):
        sheet_focuses = [
            raw_focus
            for raw_focus in focuses
            if str(_coerce_focus(raw_focus).get("sheet_name", "") or "") == sheet_name
        ]
        sheet_result = _build_excel_diff_grid_for_sheet(
            file_infos,
            sheet_focuses,
            target_sheet=sheet_name,
            section_id_prefix=f"sheet-{sheet_index}",
        )
        latest_file = latest_file or sheet_result["latest_file"]
        row_count = max(row_count, int(sheet_result["row_count"]))
        column_count = max(column_count, int(sheet_result["column_count"]))
        partial = partial or bool(sheet_result["partial"])
        omitted_focus_count += int(sheet_result["omitted_focus_count"])
        for section in sheet_result["sections"]:
            section["title"] = f"{sheet_name} 시트 · {section['title']}"
            combined_sections.append(section)

    if len(focus_sheet_names) > MAX_SECTIONS:
        partial = True
        omitted_focus_count += len(focus_sheet_names) - MAX_SECTIONS

    return {
        "latest_file": latest_file
        or {
            "file_id": file_infos[0]["id"],
            "file_name": file_infos[0]["name"],
        },
        "row_count": row_count,
        "column_count": column_count,
        "sheet_name": "여러 시트",
        "partial": partial,
        "omitted_focus_count": omitted_focus_count,
        "sections": combined_sections,
    }
