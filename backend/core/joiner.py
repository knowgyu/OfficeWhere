from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:
    import pandas as pd

from .excel_analysis import extract_excel_table
from .normalizer import normalize_key


def join_files(file_specs: List[Dict[str, Any]], join_type: str = "outer") -> "pd.DataFrame":
    import pandas as pd

    if not file_specs:
        raise ValueError("JOIN할 파일이 선택되지 않았습니다.")

    pandas_how = {"outer": "outer", "left": "left", "inner": "inner"}.get(join_type, "outer")
    dataframes: List[pd.DataFrame] = []

    for spec in file_specs:
        if spec.get("file_type") != "Excel":
            raise ValueError("JOIN은 Excel 파일만 지원합니다.")

        df = extract_excel_table(spec["path"], spec.get("parser_config"))
        key_column = spec["key_column"]
        if not key_column:
            raise ValueError(f"파일 '{spec['file_name']}'의 key_column 이 비어 있습니다.")
        if key_column not in df.columns:
            raise ValueError(
                f"파일 '{spec['file_name']}'에 key 컬럼 '{key_column}'이(가) 없습니다."
            )

        df = df.copy()
        df["__key_normalized__"] = df[key_column].astype(str).apply(normalize_key)
        requested_columns = spec.get("columns", [])
        if requested_columns:
            selected_columns = ["__key_normalized__"] + [column for column in requested_columns if column in df.columns]
        else:
            selected_columns = ["__key_normalized__"] + [
                column for column in df.columns if column not in {key_column, "__key_normalized__"}
            ]

        subset = df[selected_columns].copy()
        suffix = f"__{spec['file_name']}__"
        subset = subset.rename(
            columns={
                column: f"{column}{suffix}"
                for column in subset.columns
                if column != "__key_normalized__"
            }
        )
        dataframes.append(subset)

    result = dataframes[0]
    for right_df in dataframes[1:]:
        result = pd.merge(result, right_df, on="__key_normalized__", how=pandas_how, suffixes=("", "_dup"))
        duplicate_columns = [column for column in result.columns if column.endswith("_dup")]
        if duplicate_columns:
            result = result.drop(columns=duplicate_columns)

    result = result.rename(columns={"__key_normalized__": "key(정규화)"})
    renamed_columns: Dict[str, str] = {}
    for column in result.columns:
        if column == "key(정규화)":
            continue
        for spec in file_specs:
            suffix = f"__{spec['file_name']}__"
            if column.endswith(suffix):
                renamed_columns[column] = f"{column[:-len(suffix)]} ({spec['file_name']})"
                break
    return result.rename(columns=renamed_columns)
