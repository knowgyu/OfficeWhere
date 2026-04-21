from itertools import combinations
from typing import Any, Dict, List

import pandas as pd

from .normalizer import are_keys_similar, group_similar_columns, normalize_key
from .parser import parse_file


def _extract_distinct_values(rows: pd.DataFrame, columns: List[str]) -> List[str]:
    values: List[str] = []
    for col in columns:
        for raw_value in rows[col].tolist():
            if pd.isna(raw_value):
                continue
            text = str(raw_value).strip()
            if text:
                values.append(text)
    return sorted(set(values))


def _classify_issue(conflicts: List[Dict[str, Any]]) -> str | None:
    non_empty = [item for item in conflicts if item["values"]]
    if not non_empty:
        return None

    normalized_sets = [
        tuple(normalize_key(value) for value in conflict["values"])
        for conflict in conflicts
    ]
    non_empty_sets = [value_set for value_set in normalized_sets if value_set]
    unique_non_empty_sets = set(non_empty_sets)

    # Duplicate key rows inside a single file are allowed only when
    # they resolve to the same distinct value set for the compared column group.
    if any(len(value_set) > 1 for value_set in normalized_sets):
        return "conflict"

    if len(unique_non_empty_sets) == 1:
        if len(non_empty) == len(conflicts):
            return None
        return "warning"

    singleton_values = [item["values"][0] for item in non_empty if len(item["values"]) == 1]
    if len(singleton_values) == len(non_empty):
        if all(are_keys_similar(a, b) for a, b in combinations(singleton_values, 2)):
            return "warning"

    return "conflict"


def run_consistency_check(
    file_infos: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    정합성 검사 수행.

    duplicate key 규칙:
    - 같은 파일 안에서 동일 normalized key가 여러 행으로 나타날 수 있다.
    - 같은 column group 안의 값 집합이 동일하면 허용한다.
    - 값 집합이 여러 개로 갈리면 해당 파일 내부에서도 conflict로 본다.
    """
    if len(file_infos) < 2:
        raise ValueError("정합성 검사는 최소 2개 파일이 필요합니다.")

    file_dfs: List[Dict[str, Any]] = []
    for info in file_infos:
        df = parse_file(info["path"])
        key_col = info["key_column"]
        if key_col not in df.columns:
            raise ValueError(
                f"파일 '{info['name']}'에 key 컬럼 '{key_col}'이(가) 없습니다."
            )
        file_dfs.append({
            "id": info["id"],
            "name": info["name"],
            "key_column": key_col,
            "df": df,
        })

    all_raw_keys: List[str] = []
    for fd in file_dfs:
        all_raw_keys.extend(fd["df"][fd["key_column"]].astype(str).tolist())
    all_raw_keys = list(set(all_raw_keys))

    key_clusters: Dict[str, List[str]] = {}
    for raw_key in all_raw_keys:
        norm = normalize_key(raw_key)
        matched_cluster = None
        for existing_norm in list(key_clusters.keys()):
            if are_keys_similar(norm, existing_norm):
                matched_cluster = existing_norm
                break
        if matched_cluster:
            if raw_key not in key_clusters[matched_cluster]:
                key_clusters[matched_cluster].append(raw_key)
        else:
            key_clusters[norm] = [raw_key]

    total_keys = len(key_clusters)
    matched_keys = 0

    unique_cols = list({
        col
        for fd in file_dfs
        for col in fd["df"].columns
        if col != fd["key_column"]
    })
    col_groups = group_similar_columns(unique_cols)
    col_to_group: Dict[str, str] = {}
    for group in col_groups:
        rep = group[0]
        for col in group:
            col_to_group[col] = rep

    issues = []

    for norm_key, variants in key_clusters.items():
        files_with_key = []
        for fd in file_dfs:
            df = fd["df"]
            key_col = fd["key_column"]
            mask = df[key_col].astype(str).apply(normalize_key).apply(
                lambda nk: are_keys_similar(nk, norm_key)
            )
            matched_rows = df[mask]
            if matched_rows.empty:
                continue
            files_with_key.append({
                "fd": fd,
                "rows": matched_rows,
            })

        if len(files_with_key) == len(file_dfs):
            matched_keys += 1

        if len(files_with_key) < 2:
            continue

        group_conflicts: Dict[str, List[Dict[str, Any]]] = {}
        for item in files_with_key:
            fd = item["fd"]
            rows = item["rows"]
            key_col = fd["key_column"]

            grouped_columns: Dict[str, List[str]] = {}
            for col in rows.columns:
                if col == key_col:
                    continue
                group_rep = col_to_group.get(col, col)
                grouped_columns.setdefault(group_rep, []).append(col)

            for group_rep, columns in grouped_columns.items():
                group_conflicts.setdefault(group_rep, []).append({
                    "file_id": fd["id"],
                    "file_name": fd["name"],
                    "columns": columns,
                    "values": _extract_distinct_values(rows, columns),
                    "row_count": len(rows),
                })

        for group_rep, conflicts in group_conflicts.items():
            if len(conflicts) < 2:
                continue
            severity = _classify_issue(conflicts)
            if severity is None:
                continue

            issues.append({
                "key_normalized": norm_key,
                "key_variants": variants,
                "column_group": group_rep,
                "conflicts": conflicts,
                "severity": severity,
            })

    issues.sort(key=lambda item: 0 if item["severity"] == "conflict" else 1)

    return {
        "total_keys": total_keys,
        "matched_keys": matched_keys,
        "issues": issues,
    }
