from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:
    import pandas as pd

from .excel_analysis import extract_excel_table, normalize_excel_parser_config
from .normalizer import normalize_key, values_equal


def _is_missing(value: Any) -> bool:
    return isinstance(value, float) and value != value


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


def _file_ref(file_info: Dict[str, Any]) -> Dict[str, Any]:
    return {"file_id": file_info["id"], "file_name": file_info["name"]}


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

    matched_keys = 0
    for key in sorted(all_keys):
        present_files = [item for item in prepared_files if key in item["key_rows"]]
        if len(present_files) == len(prepared_files):
            matched_keys += 1
        if len(present_files) != len(prepared_files):
            issues.append(
                {
                    "issue_type": "missing_key",
                    "key": key,
                    "present_in": [_file_ref(item["info"]) for item in present_files],
                    "missing_in": [_file_ref(item["info"]) for item in prepared_files if item not in present_files],
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
                        "values": values,
                        **_excel_location_metadata(
                            rows,
                            column,
                            item["parser_config"],
                            item["column_positions"],
                        ),
                    }
                )
            comparable = [entry for entry in distinct_values if entry["values"]]
            if len(comparable) < 2:
                continue
            canonical_values: List[str] = []
            for entry in comparable:
                representative = entry["values"][0]
                if not any(values_equal(representative, value) for value in canonical_values):
                    canonical_values.append(representative)
            if len(canonical_values) > 1:
                issues.append(
                    {
                        "issue_type": "value_conflict",
                        "key": key,
                        "column": column,
                        "values": distinct_values,
                    }
                )

    return {
        "total_keys": len(all_keys),
        "matched_keys": matched_keys,
        "issues": issues,
    }
