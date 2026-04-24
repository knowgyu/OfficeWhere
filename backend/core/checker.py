from typing import Any, Dict, List

import pandas as pd

from .normalizer import are_keys_similar, group_similar_columns, normalize_key, values_equal
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


def _distinct_value_count(values: List[str]) -> int:
    """실질적으로 다른 값의 수 (values_equal 기준)"""
    canonical: List[str] = []
    for v in values:
        if not any(values_equal(v, c) for c in canonical):
            canonical.append(v)
    return len(canonical)


def _classify_issue(conflicts: List[Dict[str, Any]]) -> str | None:
    non_empty = [item for item in conflicts if item["values"]]
    if not non_empty:
        return None

    # 한 파일 안에 실질적으로 다른 값이 여러 개 → conflict
    if any(_distinct_value_count(item["values"]) > 1 for item in non_empty):
        return "conflict"

    # 파일 간 대표값 비교 (fuzzy 없이 exact)
    rep_values = [item["values"][0] for item in non_empty]
    all_equal = all(values_equal(rep_values[0], v) for v in rep_values[1:])

    if all_equal:
        return None if len(non_empty) == len(conflicts) else "warning"
    return "conflict"


def run_consistency_check(
    file_infos: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    정합성 검사 수행.

    성능 최적화:
    - 키 정규화 파일당 1회 사전 계산
    - exact-first 키 클러스터링 후 그룹 대표끼리만 fuzzy 비교
    - 행 필터링 시 벡터화 딕셔너리 조회 (O(1) per row)
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

    # 키 정규화 사전 계산 (파일당 1회)
    for fd in file_dfs:
        fd["norm_keys"] = fd["df"][fd["key_column"]].astype(str).apply(normalize_key)

    # 키 클러스터링: Step1 exact 그룹 → Step2 그룹 대표끼리만 fuzzy 비교
    all_raw_keys = list({
        key
        for fd in file_dfs
        for key in fd["df"][fd["key_column"]].astype(str).tolist()
    })

    exact_groups: Dict[str, List[str]] = {}
    for raw_key in all_raw_keys:
        norm = normalize_key(raw_key)
        exact_groups.setdefault(norm, []).append(raw_key)

    group_norms = list(exact_groups.keys())
    key_clusters: Dict[str, List[str]] = {}
    merged: set = set()
    for i, norm_a in enumerate(group_norms):
        if norm_a in merged:
            continue
        cluster_variants = list(exact_groups[norm_a])
        for norm_b in group_norms[i + 1:]:
            if norm_b in merged:
                continue
            if are_keys_similar(norm_a, norm_b):
                cluster_variants.extend(exact_groups[norm_b])
                merged.add(norm_b)
        key_clusters[norm_a] = cluster_variants

    # 행 조회용 인덱스: normalized_raw_key → cluster representative
    variant_to_cluster: Dict[str, str] = {}
    for norm_key, variants in key_clusters.items():
        for raw_v in variants:
            variant_to_cluster[normalize_key(raw_v)] = norm_key

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
            # 벡터화 딕셔너리 조회: per-row fuzzy 호출 없음
            mask = fd["norm_keys"].map(variant_to_cluster) == norm_key
            matched_rows = fd["df"][mask]
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
