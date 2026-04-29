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
EXCEL_HIGH_CHANGE_MIN_COUNT = 100
EXCEL_HIGH_CHANGE_RATIO = 0.35


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


def _default_compare_metadata() -> Dict[str, Any]:
    return {
        "warnings": [],
        "used_last_index_snapshot": True,
        "source_stat_checked": False,
        "source_stat_error_count": 0,
        "compared_cell_count": None,
        "changed_cell_count": None,
        "total_candidate_cell_count": None,
        "simplified": False,
        "artifact_status": None,
    }


def _compare_warning(
    warning_type: str,
    message: str,
    *,
    severity: str = "warning",
    file_ids: List[int] | None = None,
    details: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return {
        "type": warning_type,
        "severity": severity,
        "message": message,
        "file_ids": file_ids or [],
        "details": details or {},
    }


def _merge_compare_metadata(target: Dict[str, Any], source: Dict[str, Any]) -> Dict[str, Any]:
    warnings = target.setdefault("warnings", [])
    incoming = source.get("warnings")
    if isinstance(incoming, list):
        warnings.extend(incoming)

    for key, value in source.items():
        if key == "warnings" or value is None:
            continue
        if key == "source_stat_checked":
            target[key] = bool(target.get(key)) or bool(value)
        elif key == "source_stat_error_count":
            target[key] = int(target.get(key) or 0) + int(value or 0)
        else:
            target[key] = value
    return target


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


def _indexed_excel_payloads(file_infos: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]] | None, Dict[str, Any]]:
    metadata = _default_compare_metadata()
    file_ids = [int(info["id"]) for info in file_infos]

    newer_file_ids: List[int] = []
    for info in file_infos:
        try:
            current_mtime = os.path.getmtime(info["path"])
        except OSError:
            metadata["source_stat_checked"] = True
            metadata["source_stat_error_count"] = int(metadata["source_stat_error_count"] or 0) + 1
            continue
        metadata["source_stat_checked"] = True
        stored_mtime = info.get("file_mtime")
        if stored_mtime is None:
            continue
        try:
            if float(current_mtime) > float(stored_mtime) + 1.0:
                newer_file_ids.append(int(info["id"]))
        except (TypeError, ValueError):
            continue

    try:
        sheet_rows = get_excel_sheet_index(file_ids)
    except Exception:
        return None, metadata
    if not all(sheet_rows.get(file_id) for file_id in file_ids):
        return None, metadata

    try:
        cell_rows = get_excel_cell_index(file_ids)
    except Exception:
        return None, metadata
    payloads: List[Dict[str, Any]] = []
    for info in file_infos:
        file_id = int(info["id"])
        sheets = {str(row["sheet_name"]): dict(row) for row in sheet_rows.get(file_id, [])}
        cells: Dict[tuple[str, int, int], str] = {}
        for row in cell_rows.get(file_id, []):
            cells[(str(row["sheet_name"]), int(row["row_number"]), int(row["column_index"]))] = str(row["content"])
        payloads.append({"info": info, "sheets": sheets, "cells": cells})
    if newer_file_ids:
        metadata["warnings"].append(
            _compare_warning(
                "source_may_be_newer",
                "원본 파일이 마지막 색인 이후 수정된 것으로 보입니다. 현재 Excel 비교는 마지막 색인 기준입니다.",
                file_ids=newer_file_ids,
                details={"source": "excel_indexed_payload"},
            )
        )
    return payloads, metadata


def _excel_payloads(file_infos: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    indexed, metadata = _indexed_excel_payloads(file_infos)
    if indexed is not None:
        return indexed, metadata
    return [_source_excel_payload(info) for info in file_infos], metadata


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

    payloads, metadata = _excel_payloads(file_infos)
    before_payload, after_payload = payloads
    before_info = before_payload["info"]
    after_info = after_payload["info"]
    sheet_names = _ordered_sheet_names(payloads)
    include_sheet_in_ref = len(sheet_names) > 1
    issues: List[Dict[str, Any]] = []
    changed_rows: set[tuple[str, int]] = set()
    candidate_rows: set[tuple[str, int]] = set()
    compared_cell_count = 0
    changed_cell_count = 0

    for sheet_name in sheet_names:
        sheet_label = sheet_name if include_sheet_in_ref else ""
        before_keys = {key for key in before_payload["cells"] if key[0] == sheet_name}
        after_keys = {key for key in after_payload["cells"] if key[0] == sheet_name}
        candidate_keys = sorted(before_keys | after_keys, key=lambda key: (key[1], key[2]))
        compared_cell_count += len(candidate_keys)
        candidate_rows.update((key[0], key[1]) for key in candidate_keys)

        for _sheet_name, row_number, column_number in candidate_keys:
            column_letter = _column_letter(column_number)
            before = before_payload["cells"].get((sheet_name, row_number, column_number), "")
            after = after_payload["cells"].get((sheet_name, row_number, column_number), "")
            if values_equal(before, after):
                continue

            changed_cell_count += 1
            changed_rows.add((sheet_name, row_number))

            if len(issues) < EXCEL_VERSION_CELL_ISSUE_LIMIT:
                issue_type = _version_cell_issue_type(before, after)
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

    total_rows = len(candidate_rows)
    metadata["compared_cell_count"] = compared_cell_count
    metadata["changed_cell_count"] = changed_cell_count
    metadata["total_candidate_cell_count"] = compared_cell_count
    if changed_cell_count > EXCEL_VERSION_CELL_ISSUE_LIMIT:
        metadata["warnings"].append(
            _compare_warning(
                "truncated",
                f"변경점이 많아 처음 {EXCEL_VERSION_CELL_ISSUE_LIMIT}개 셀만 표시했습니다.",
                file_ids=[int(info["id"]) for info in file_infos],
                details={
                    "displayed_issue_count": len(issues),
                    "changed_cell_count": changed_cell_count,
                    "limit": EXCEL_VERSION_CELL_ISSUE_LIMIT,
                },
            )
        )
    change_ratio = changed_cell_count / max(compared_cell_count, 1)
    if changed_cell_count >= EXCEL_HIGH_CHANGE_MIN_COUNT and change_ratio >= EXCEL_HIGH_CHANGE_RATIO:
        metadata["warnings"].append(
            _compare_warning(
                "high_change_ratio",
                "변경된 셀이 많아 같은 버전의 문서가 아닐 수도 있습니다. 비교 대상이 맞는지 확인해 주세요.",
                file_ids=[int(info["id"]) for info in file_infos],
                details={
                    "changed_cell_count": changed_cell_count,
                    "compared_cell_count": compared_cell_count,
                    "change_ratio": change_ratio,
                },
            )
        )

    return {
        "total_keys": total_rows,
        "matched_keys": max(total_rows - len(changed_rows), 0),
        "issues": issues,
        "metadata": metadata,
    }


def compare_excel_files(file_infos: List[Dict[str, Any]], comparison_scope: str = "version_history") -> Dict[str, Any]:
    """Compare Excel versions by source cell coordinates.

    The previous registered-table/key-column comparison belonged to the
    disabled Excel Join flow.  Version Management now always uses the visible
    used range so stale table metadata cannot block comparisons.
    """
    return compare_excel_versions_by_cells(file_infos)
