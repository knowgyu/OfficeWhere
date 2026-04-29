from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:
    import pandas as pd

from ..database import get_excel_cell_index, get_excel_sheet_index
from .excel_analysis import extract_excel_used_ranges
from .normalizer import normalize_key, values_equal


EXCEL_PREVIEW_ROW_LIMIT = 25
EMPTY_VALUE_LABEL = "(빈 값)"
EXCEL_VERSION_CELL_ISSUE_LIMIT = 500


def _is_missing(value: Any) -> bool:
    return isinstance(value, float) and value != value


def _stringify_cell(value: Any) -> str:
    if value is None or _is_missing(value):
        return ""
    return str(value)


def _column_letter(index: int) -> str:
    if index < 1:
        return ""
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _unique_in_order(values: List[Any]) -> List[Any]:
    unique: List[Any] = []
    for value in values:
        if value not in unique:
            unique.append(value)
    return unique


def _public_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {key: value for key, value in entry.items() if not key.startswith("_")}
        for entry in entries
    ]


def _presence_status_by_file(
    prepared_files: List[Dict[str, Any]],
    present_files: List[Dict[str, Any]],
) -> Dict[int, str]:
    present_ids = {item["info"]["id"] for item in present_files}
    if len(prepared_files) == 2:
        left, right = prepared_files
        left_has = left["info"]["id"] in present_ids
        right_has = right["info"]["id"] in present_ids
        if not left_has and right_has:
            return {
                left["info"]["id"]: "이전에는 없음",
                right["info"]["id"]: "추가된 내용",
            }
        if left_has and not right_has:
            return {
                left["info"]["id"]: "삭제된 내용",
                right["info"]["id"]: "변경 후 없음",
            }
    return {
        item["info"]["id"]: "내용 있음" if item["info"]["id"] in present_ids else "내용 없음"
        for item in prepared_files
    }


def _excel_location_metadata(
    rows: "pd.DataFrame",
    column: str,
    parser_config: Dict[str, Any],
    column_positions: Dict[str, int],
) -> Dict[str, Any]:
    """Return best-effort Excel coordinates for the compared column cells.

    `extract_excel_table` resets the raw table slice index before dropping blank
    rows, so the remaining DataFrame index preserves each row's data offset
    below the header even when blank rows were filtered out.
    """
    if column not in column_positions or column not in rows.columns:
        return {
            "row_numbers": [],
            "column_letters": [],
            "cell_refs": [],
            "row_count": 0,
        }

    excel_col = int(parser_config["start_col"]) + column_positions[column]
    column_letter = _column_letter(excel_col)

    row_numbers: List[int] = []
    cell_refs: List[str] = []
    for dataframe_index, _ in rows.iterrows():
        excel_row = int(parser_config["header_row"]) + 1 + int(dataframe_index)
        row_numbers.append(excel_row)
        cell_refs.append(f"{column_letter}{excel_row}")

    return {
        "row_numbers": _unique_in_order(row_numbers),
        "column_letters": [column_letter] if cell_refs else [],
        "cell_refs": _unique_in_order(cell_refs),
        "row_count": len(row_numbers),
    }


def _excel_row_metadata(
    rows: "pd.DataFrame",
    parser_config: Dict[str, Any],
) -> Dict[str, Any]:
    row_numbers: List[int] = []
    row_values: List[List[str]] = []
    for dataframe_index, row in rows.iterrows():
        excel_row = int(parser_config["header_row"]) + 1 + int(dataframe_index)
        row_numbers.append(excel_row)
        row_values.append([_stringify_cell(row[column]) for column in rows.columns])

    return {
        "columns": [str(column) for column in rows.columns],
        "row_numbers": _unique_in_order(row_numbers),
        "column_letters": [],
        "cell_refs": [],
        "row_count": len(row_numbers),
        "row_values": row_values,
    }


def _excel_column_metadata(
    rows: "pd.DataFrame",
    column: str,
    key_column: str,
    parser_config: Dict[str, Any],
    column_positions: Dict[str, int],
) -> Dict[str, Any]:
    if column not in column_positions or column not in rows.columns:
        return {
            "columns": [key_column, column] if key_column else [column],
            "row_numbers": [],
            "column_letters": [],
            "cell_refs": [],
            "row_count": 0,
            "row_values": [],
        }

    excel_col = int(parser_config["start_col"]) + column_positions[column]
    column_letter = _column_letter(excel_col)
    row_numbers: List[int] = []
    cell_refs: List[str] = []
    row_values: List[List[str]] = []
    value_count = 0

    for dataframe_index, row in rows.iterrows():
        key_value = _stringify_cell(row[key_column]) if key_column in rows.columns else ""
        cell_value = _stringify_cell(row[column])
        if not key_value and not cell_value:
            continue
        value_count += 1
        if len(row_values) >= EXCEL_PREVIEW_ROW_LIMIT:
            continue
        excel_row = int(parser_config["header_row"]) + 1 + int(dataframe_index)
        row_numbers.append(excel_row)
        cell_refs.append(f"{column_letter}{excel_row}")
        row_values.append([key_value or EMPTY_VALUE_LABEL, cell_value or EMPTY_VALUE_LABEL])

    return {
        "columns": [key_column, column] if key_column else [column],
        "row_numbers": _unique_in_order(row_numbers),
        "column_letters": [column_letter] if row_values else [],
        "cell_refs": _unique_in_order(cell_refs),
        "row_count": value_count,
        "row_values": row_values,
    }


def _distinct_non_empty(values: List[Any]) -> List[str]:
    distinct: List[str] = []
    for value in values:
        if _is_missing(value):
            continue
        text = str(value).strip()
        if not text:
            continue
        if not any(values_equal(text, existing) for existing in distinct):
            distinct.append(text)
    return distinct


def _missing_row_message(key: str, prepared_files: List[Dict[str, Any]], present_files: List[Dict[str, Any]]) -> str:
    present_ids = {item["info"]["id"] for item in present_files}
    if len(prepared_files) == 2:
        left, right = prepared_files
        left_has = left["info"]["id"] in present_ids
        right_has = right["info"]["id"] in present_ids
        if not left_has and right_has:
            return f'기준값 "{key}" 관련 내용이 추가되었습니다.'
        if left_has and not right_has:
            return f'기준값 "{key}" 관련 내용이 삭제되었습니다.'
    return f'기준값 "{key}" 관련 내용이 일부 파일에만 있습니다.'


def _missing_column_message(
    column: str,
    prepared_files: List[Dict[str, Any]],
    present_files: List[Dict[str, Any]],
) -> str:
    present_ids = {item["info"]["id"] for item in present_files}
    if len(prepared_files) == 2:
        left, right = prepared_files
        left_has = left["info"]["id"] in present_ids
        right_has = right["info"]["id"] in present_ids
        if not left_has and right_has:
            return f'"{column}" 관련 내용이 추가되었습니다.'
        if left_has and not right_has:
            return f'"{column}" 관련 내용이 삭제되었습니다.'
    return f'"{column}" 관련 내용이 일부 파일에만 있습니다.'


def _cell_value_at(rows: "pd.DataFrame", row_index: int, column_index: int) -> str:
    if row_index >= len(rows.index) or column_index >= len(rows.columns):
        return ""
    return _stringify_cell(rows.iat[row_index, column_index])


def _version_cell_issue_type(before: str, after: str) -> str:
    before_empty = not before.strip()
    after_empty = not after.strip()
    if before_empty and not after_empty:
        return "value_added"
    if not before_empty and after_empty:
        return "value_removed"
    return "value_conflict"


def _version_cell_message(row_number: int, column_letter: str, issue_type: str, sheet_name: str = "") -> str:
    location = f"{row_number}행 {column_letter}열"
    if sheet_name:
        location = f"{sheet_name} 시트 | {location}"
    if issue_type == "value_added":
        return f"{location} 값이 추가되었습니다."
    if issue_type == "value_removed":
        return f"{location} 값이 삭제되었습니다."
    return f"{location} 값이 변경되었습니다."


def _version_cell_entry(
    file_info: Dict[str, Any],
    row_number: int,
    column_letter: str,
    value: str,
    *,
    sheet_name: str = "",
    include_sheet_in_ref: bool = False,
) -> Dict[str, Any]:
    cell_ref = f"{column_letter}{row_number}"
    if include_sheet_in_ref and sheet_name:
        cell_ref = f"{sheet_name}!{cell_ref}"
    return {
        "file_id": file_info["id"],
        "file_name": file_info["name"],
        "sheet_name": sheet_name,
        "columns": [column_letter],
        "values": [value or EMPTY_VALUE_LABEL],
        "row_numbers": [row_number],
        "column_letters": [column_letter],
        "cell_refs": [cell_ref],
        "row_count": 1,
        "row_values": [[value]],
    }


def _source_excel_payload(file_info: Dict[str, Any]) -> Dict[str, Any]:
    used_ranges = extract_excel_used_ranges(file_info["path"])
    sheets: Dict[str, Dict[str, Any]] = {}
    cells: Dict[tuple[str, int, int], str] = {}
    for used_range in used_ranges:
        summary = used_range.sheet_summary()
        sheets[used_range.sheet_name] = summary
        for dataframe_index, row in used_range.dataframe.iterrows():
            row_number = int(dataframe_index) + 1
            for column_index, (_column, value) in enumerate(row.items(), start=1):
                text = _stringify_cell(value)
                if text.strip():
                    cells[(used_range.sheet_name, row_number, column_index)] = text
    return {
        "info": file_info,
        "sheets": sheets,
        "cells": cells,
    }


def _indexed_excel_payloads(file_infos: List[Dict[str, Any]]) -> List[Dict[str, Any]] | None:
    file_ids = [int(info["id"]) for info in file_infos]
    if not all("file_mtime" in info for info in file_infos):
        return None

    for info in file_infos:
        try:
            current_mtime = os.path.getmtime(info["path"])
        except OSError:
            return None
        stored_mtime = info.get("file_mtime")
        if stored_mtime is None or abs(float(current_mtime) - float(stored_mtime)) >= 1.0:
            return None

    sheet_rows = get_excel_sheet_index(file_ids)
    if not all(sheet_rows.get(file_id) for file_id in file_ids):
        return None

    cell_rows = get_excel_cell_index(file_ids)
    payloads: List[Dict[str, Any]] = []
    for info in file_infos:
        file_id = int(info["id"])
        sheets = {str(row["sheet_name"]): dict(row) for row in sheet_rows.get(file_id, [])}
        cells: Dict[tuple[str, int, int], str] = {}
        for row in cell_rows.get(file_id, []):
            cells[(str(row["sheet_name"]), int(row["row_number"]), int(row["column_index"]))] = str(row["content"])
        payloads.append({"info": info, "sheets": sheets, "cells": cells})
    return payloads


def _excel_payloads(file_infos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    indexed = _indexed_excel_payloads(file_infos)
    if indexed is not None:
        return indexed
    return [_source_excel_payload(info) for info in file_infos]


def _ordered_sheet_names(payloads: List[Dict[str, Any]]) -> List[str]:
    order: Dict[str, int] = {}
    for payload in payloads:
        for sheet_name, sheet in payload["sheets"].items():
            sheet_index = int(sheet.get("sheet_index") or 999_999)
            if sheet_name not in order or sheet_index < order[sheet_name]:
                order[sheet_name] = sheet_index
    return sorted(order, key=lambda name: (order[name], name))


def compare_excel_versions_by_cells(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(file_infos) != 2:
        raise ValueError("Excel 버전 관리는 두 버전씩 순서대로 비교합니다.")

    payloads = _excel_payloads(file_infos)
    before_payload, after_payload = payloads
    before_info = before_payload["info"]
    after_info = after_payload["info"]
    sheet_names = _ordered_sheet_names(payloads)
    include_sheet_in_ref = len(sheet_names) > 1
    total_rows = 0
    issues: List[Dict[str, Any]] = []
    changed_rows: set[tuple[str, int]] = set()
    truncated = False

    for sheet_name in sheet_names:
        before_sheet = before_payload["sheets"].get(sheet_name, {})
        after_sheet = after_payload["sheets"].get(sheet_name, {})
        row_count = max(int(before_sheet.get("row_count") or 0), int(after_sheet.get("row_count") or 0))
        column_count = max(int(before_sheet.get("column_count") or 0), int(after_sheet.get("column_count") or 0))
        total_rows += row_count
        sheet_label = sheet_name if include_sheet_in_ref else ""
        for row_index in range(row_count):
            for column_index in range(column_count):
                row_number = row_index + 1
                column_number = column_index + 1
                column_letter = _column_letter(column_number)
                before = before_payload["cells"].get((sheet_name, row_number, column_number), "")
                after = after_payload["cells"].get((sheet_name, row_number, column_number), "")
                if values_equal(before, after):
                    continue

                if len(issues) >= EXCEL_VERSION_CELL_ISSUE_LIMIT:
                    truncated = True
                    break

                issue_type = _version_cell_issue_type(before, after)
                changed_rows.add((sheet_name, row_number))
                issues.append(
                    {
                        "issue_type": issue_type,
                        "severity": "warning" if issue_type != "value_conflict" else "conflict",
                        "sheet_name": sheet_name,
                        "key": f"{sheet_name}!{row_number}" if include_sheet_in_ref else str(row_number),
                        "column": column_letter,
                        "message": _version_cell_message(row_number, column_letter, issue_type, sheet_label),
                        "values": [
                            _version_cell_entry(
                                before_info,
                                row_number,
                                column_letter,
                                before,
                                sheet_name=sheet_name,
                                include_sheet_in_ref=include_sheet_in_ref,
                            ),
                            _version_cell_entry(
                                after_info,
                                row_number,
                                column_letter,
                                after,
                                sheet_name=sheet_name,
                                include_sheet_in_ref=include_sheet_in_ref,
                            ),
                        ],
                    }
                )
            if truncated:
                break
        if truncated:
            break

    if truncated:
        issues.append(
            {
                "issue_type": "missing_key",
                "severity": "warning",
                "key": "truncated",
                "column": "",
                "message": f"변경점이 많아 처음 {EXCEL_VERSION_CELL_ISSUE_LIMIT}개 셀만 표시했습니다.",
                "values": [],
            }
        )

    return {
        "total_keys": total_rows,
        "matched_keys": max(total_rows - len(changed_rows), 0),
        "issues": issues,
    }


def compare_excel_files(file_infos: List[Dict[str, Any]], comparison_scope: str = "version_history") -> Dict[str, Any]:
    """Compare Excel versions by source cell coordinates.

    The previous registered-table/key-column comparison belonged to the
    disabled Excel Join flow.  Version Management now always uses the visible
    used range so stale table metadata cannot block comparisons.
    """
    return compare_excel_versions_by_cells(file_infos)
