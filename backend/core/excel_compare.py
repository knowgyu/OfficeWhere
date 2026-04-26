from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:
    import pandas as pd

from .excel_analysis import extract_excel_table
from .normalizer import normalize_key, values_equal


def _is_missing(value: Any) -> bool:
    return isinstance(value, float) and value != value


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
        df = extract_excel_table(file_info["path"], file_info.get("parser_config"))
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

        columns = [column for column in df.columns if column != key_column]
        prepared_files.append(
            {
                "info": file_info,
                "df": df,
                "columns": columns,
                "key_rows": key_rows,
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
                values = _distinct_non_empty(item["key_rows"][key][column].tolist())
                distinct_values.append(
                    {
                        "file_id": item["info"]["id"],
                        "file_name": item["info"]["name"],
                        "values": values,
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
