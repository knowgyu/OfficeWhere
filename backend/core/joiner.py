from typing import List, Dict, Any, Tuple
import pandas as pd
from .parser import parse_file
from .normalizer import normalize_key


def join_files(
    file_specs: List[Dict[str, Any]],
    join_type: str = "outer"
) -> pd.DataFrame:
    """
    여러 파일을 JOIN.

    file_specs 형식:
    [
        {
            "path": "/path/to/file.xlsx",
            "key_column": "과제명",
            "columns": ["담당자", "예산"],
            "file_id": 1,
            "file_name": "A.xlsx"
        },
        ...
    ]
    join_type: "outer" | "left" | "inner"
    """
    if not file_specs:
        raise ValueError("JOIN할 파일이 선택되지 않았습니다.")

    pandas_how = {
        "outer": "outer",
        "left": "left",
        "inner": "inner",
    }.get(join_type, "outer")

    dfs = []
    for spec in file_specs:
        df = parse_file(spec["path"])
        key_col = spec["key_column"]
        wanted_cols = spec.get("columns", [])

        if key_col not in df.columns:
            raise ValueError(
                f"파일 '{spec['file_name']}'에 key 컬럼 '{key_col}'이(가) 없습니다."
            )

        # key 정규화 컬럼 추가
        df["__key_normalized__"] = df[key_col].astype(str).apply(normalize_key)

        # 가져올 컬럼 선택 (key 컬럼 + 선택된 컬럼들)
        if wanted_cols:
            # 선택된 컬럼 중 실제 존재하는 것만
            existing = [c for c in wanted_cols if c in df.columns]
            select_cols = ["__key_normalized__"] + existing
        else:
            select_cols = ["__key_normalized__"] + [
                c for c in df.columns if c != key_col and c != "__key_normalized__"
            ]
        df_sub = df[select_cols].copy()

        # 컬럼명 충돌 방지: 파일명 suffix 추가 (key 컬럼 제외)
        file_suffix = f"__{spec['file_name']}__"
        rename_map = {}
        for col in df_sub.columns:
            if col != "__key_normalized__":
                rename_map[col] = f"{col}{file_suffix}"
        df_sub = df_sub.rename(columns=rename_map)

        dfs.append(df_sub)

    if len(dfs) == 1:
        result = dfs[0]
    else:
        result = dfs[0]
        for df_right in dfs[1:]:
            result = pd.merge(
                result,
                df_right,
                on="__key_normalized__",
                how=pandas_how,
                suffixes=("", "_dup")
            )
            # 중복 컬럼 제거
            dup_cols = [c for c in result.columns if c.endswith("_dup")]
            result = result.drop(columns=dup_cols)

    # __key_normalized__ 컬럼을 첫 번째 컬럼으로, 컬럼명 정리
    result = result.rename(columns={"__key_normalized__": "key(정규화)"})

    # suffix 제거해서 읽기 좋게 만들기
    clean_rename = {}
    for col in result.columns:
        if col == "key(정규화)":
            continue
        for spec in file_specs:
            suffix = f"__{spec['file_name']}__"
            if col.endswith(suffix):
                base = col[: -len(suffix)]
                # 다른 파일에 같은 이름 있으면 파일명 유지
                clean_rename[col] = f"{base} ({spec['file_name']})"
                break

    result = result.rename(columns=clean_rename)
    return result
