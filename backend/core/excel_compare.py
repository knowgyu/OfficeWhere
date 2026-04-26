from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:
    import pandas as pd

from .excel_analysis import extract_excel_table, normalize_excel_parser_config
from .normalizer import normalize_key, values_equal


EXCEL_PREVIEW_ROW_LIMIT = 25
EMPTY_VALUE_LABEL = "(빈 값)"


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


def compare_excel_files(file_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    prepared_files: List[Dict[str, Any]] = []
    all_keys: set[str] = set()

    for file_info in file_infos:
        parser_config = normalize_excel_parser_config(
            file_info["path"], file_info.get("parser_config")
        )
        df = extract_excel_table(file_info["path"], parser_config)
        key_column = file_info["key_column"]
        if not key_column:
            raise ValueError(f"Excel 파일 '{file_info['name']}'의 key_column 이 비어 있습니다.")
        if key_column not in df.columns:
            raise ValueError(
                f"파일 '{file_info['name']}'에 key 컬럼 '{key_column}'이(가) 없습니다."
            )

        normalized_keys = df[key_column].astype(str).apply(normalize_key)
        key_rows: Dict[str, "pd.DataFrame"] = {}
        for key in sorted(set(normalized_keys.tolist())):
            if not key:
                continue
            key_rows[key] = df[normalized_keys == key]
            all_keys.add(key)

        column_positions = {
            str(column): position for position, column in enumerate(df.columns)
        }
        columns = [column for column in df.columns if column != key_column]
        prepared_files.append(
            {
                "info": file_info,
                "df": df,
                "columns": columns,
                "key_rows": key_rows,
                "parser_config": parser_config,
                "column_positions": column_positions,
            }
        )

    issues: List[Dict[str, Any]] = []

    all_columns = sorted(
        set().union(*(set(item["columns"]) for item in prepared_files))
    ) if prepared_files else []
    for column in all_columns:
        present_files = [item for item in prepared_files if column in item["columns"]]
        if len(present_files) == len(prepared_files):
            continue
        statuses = _presence_status_by_file(prepared_files, present_files)
        values = []
        for item in prepared_files:
            has_column = item in present_files
            values.append(
                {
                    "file_id": item["info"]["id"],
                    "file_name": item["info"]["name"],
                    "values": [statuses[item["info"]["id"]]],
                    **(
                        _excel_column_metadata(
                            item["df"],
                            column,
                            item["info"]["key_column"],
                            item["parser_config"],
                            item["column_positions"],
                        )
                        if has_column
                        else {
                            "columns": [item["info"]["key_column"], column]
                            if item["info"].get("key_column")
                            else [column],
                            "row_numbers": [],
                            "column_letters": [],
                            "cell_refs": [],
                            "row_count": 0,
                            "row_values": [],
                        }
                    ),
                }
            )
        issues.append(
            {
                "issue_type": "missing_column",
                "severity": "warning",
                "column": column,
                "message": _missing_column_message(column, prepared_files, present_files),
                "values": values,
            }
        )

    matched_keys = 0
    for key in sorted(all_keys):
        present_files = [item for item in prepared_files if key in item["key_rows"]]
        if len(present_files) == len(prepared_files):
            matched_keys += 1
        if len(present_files) != len(prepared_files):
            missing_ids = {
                item["info"]["id"] for item in prepared_files if item not in present_files
            }
            statuses = _presence_status_by_file(prepared_files, present_files)
            values: List[Dict[str, Any]] = []
            for item in prepared_files:
                if item["info"]["id"] in missing_ids:
                    values.append(
                        {
                            "file_id": item["info"]["id"],
                            "file_name": item["info"]["name"],
                            "columns": [],
                            "values": [statuses[item["info"]["id"]]],
                            "row_numbers": [],
                            "column_letters": [],
                            "cell_refs": [],
                            "row_count": 0,
                            "row_values": [],
                        }
                    )
                    continue
                rows = item["key_rows"][key]
                values.append(
                    {
                        "file_id": item["info"]["id"],
                        "file_name": item["info"]["name"],
                        "values": [statuses[item["info"]["id"]]],
                        **_excel_row_metadata(rows, item["parser_config"]),
                    }
                )
            issues.append(
                {
                    "issue_type": "missing_key",
                    "severity": "warning",
                    "key": key,
                    "message": _missing_row_message(key, prepared_files, present_files),
                    "values": values,
                }
            )

        shared_columns = sorted(
            set.intersection(
                *(set(item["columns"]) for item in present_files)
            )
        ) if present_files else []
        for column in shared_columns:
            distinct_values: List[Dict[str, Any]] = []
            for item in present_files:
                rows = item["key_rows"][key]
                values = _distinct_non_empty(rows[column].tolist())
                distinct_values.append(
                    {
                        "file_id": item["info"]["id"],
                        "file_name": item["info"]["name"],
                        "columns": [column],
                        "values": values or [EMPTY_VALUE_LABEL],
                        "_has_value": bool(values),
                        **_excel_location_metadata(
                            rows,
                            column,
                            item["parser_config"],
                            item["column_positions"],
                        ),
                    }
                )
            non_empty_entries = [entry for entry in distinct_values if entry["_has_value"]]
            empty_entries = [entry for entry in distinct_values if not entry["_has_value"]]
            if not non_empty_entries:
                continue
            canonical_values: List[str] = []
            for entry in non_empty_entries:
                representative = entry["values"][0]
                if not any(values_equal(representative, value) for value in canonical_values):
                    canonical_values.append(representative)
            if len(canonical_values) > 1:
                issues.append(
                    {
                        "issue_type": "value_conflict",
                        "severity": "conflict",
                        "key": key,
                        "column": column,
                        "message": f"{column} 값이 파일마다 다릅니다.",
                        "values": _public_entries(distinct_values),
                    }
                )
            elif empty_entries:
                issue_type = "value_presence"
                message = f"{column} 값이 일부 파일에만 있습니다."
                if len(distinct_values) == 2:
                    left_has = bool(distinct_values[0]["_has_value"])
                    right_has = bool(distinct_values[1]["_has_value"])
                    if not left_has and right_has:
                        issue_type = "value_added"
                        message = f"{column} 값이 추가되었습니다."
                    elif left_has and not right_has:
                        issue_type = "value_removed"
                        message = f"{column} 값이 삭제되었습니다."
                issues.append(
                    {
                        "issue_type": issue_type,
                        "severity": "warning",
                        "key": key,
                        "column": column,
                        "message": message,
                        "values": _public_entries(distinct_values),
                    }
                )

    return {
        "total_keys": len(all_keys),
        "matched_keys": matched_keys,
        "issues": issues,
    }
