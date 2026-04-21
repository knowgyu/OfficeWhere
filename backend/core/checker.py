from typing import List, Dict, Any
import pandas as pd
from .parser import parse_file
from .normalizer import normalize_key, are_keys_similar, are_columns_similar, group_similar_columns


def run_consistency_check(
    file_infos: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    정합성 검사 수행.

    file_infos 형식:
    [
        {
            "id": 1,
            "path": "/path/to/file.xlsx",
            "name": "A.xlsx",
            "key_column": "과제명"
        },
        ...
    ]
    """
    if len(file_infos) < 2:
        raise ValueError("정합성 검사는 최소 2개 파일이 필요합니다.")

    # 각 파일 파싱
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

    # 모든 key 수집 (파일별)
    all_keys_by_file: List[List[str]] = []
    for fd in file_dfs:
        keys = fd["df"][fd["key_column"]].astype(str).tolist()
        all_keys_by_file.append(keys)

    # 전체 unique key 정규화 및 그룹화
    all_raw_keys = []
    for keys in all_keys_by_file:
        all_raw_keys.extend(keys)
    all_raw_keys = list(set(all_raw_keys))

    # key 클러스터링: 정규화된 key 기준으로 그룹화
    key_clusters: Dict[str, List[str]] = {}  # normalized_key -> [raw variants]
    for raw_key in all_raw_keys:
        norm = normalize_key(raw_key)
        # 기존 클러스터 중 유사한 것 찾기
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
    matched_keys = 0  # 모든 파일에 존재하는 key 수

    # 모든 컬럼명 수집 (파일 전체)
    all_columns_with_source: List[Dict[str, str]] = []
    for fd in file_dfs:
        for col in fd["df"].columns:
            if col != fd["key_column"]:
                all_columns_with_source.append({
                    "col": col,
                    "file_id": fd["id"],
                    "file_name": fd["name"],
                })

    # 유사 컬럼 그룹 생성
    unique_cols = list(set(item["col"] for item in all_columns_with_source))
    col_groups = group_similar_columns(unique_cols)
    # col -> group representative 매핑
    col_to_group: Dict[str, str] = {}
    for group in col_groups:
        rep = group[0]
        for col in group:
            col_to_group[col] = rep

    issues = []

    for norm_key, variants in key_clusters.items():
        # 이 key가 존재하는 파일 수 체크
        files_with_key = []
        for fd in file_dfs:
            raw_keys_in_file = fd["df"][fd["key_column"]].astype(str).tolist()
            norm_keys_in_file = [normalize_key(k) for k in raw_keys_in_file]
            matching_raws = [
                raw_keys_in_file[i]
                for i, nk in enumerate(norm_keys_in_file)
                if are_keys_similar(nk, norm_key)
            ]
            if matching_raws:
                files_with_key.append({
                    "fd": fd,
                    "matching_raw": matching_raws[0],
                })

        if len(files_with_key) == len(file_dfs):
            matched_keys += 1

        if len(files_with_key) < 2:
            continue

        # 유사 컬럼 그룹별로 값 비교
        checked_groups: Dict[str, bool] = {}

        for item in files_with_key:
            fd = item["fd"]
            raw_key = item["matching_raw"]
            df = fd["df"]
            key_col = fd["key_column"]

            # 해당 key의 행 추출 (첫 번째 매칭 행)
            mask = df[key_col].astype(str).apply(normalize_key).apply(
                lambda nk: are_keys_similar(nk, norm_key)
            )
            matched_rows = df[mask]
            if matched_rows.empty:
                continue

            row = matched_rows.iloc[0]

            for col in df.columns:
                if col == key_col:
                    continue
                group_rep = col_to_group.get(col, col)
                if group_rep in checked_groups:
                    continue

            # 그룹별로 충돌 수집
        group_conflicts: Dict[str, List[Dict[str, Any]]] = {}
        for item in files_with_key:
            fd = item["fd"]
            raw_key = item["matching_raw"]
            df = fd["df"]
            key_col = fd["key_column"]

            mask = df[key_col].astype(str).apply(normalize_key).apply(
                lambda nk: are_keys_similar(nk, norm_key)
            )
            matched_rows = df[mask]
            if matched_rows.empty:
                continue
            row = matched_rows.iloc[0]

            for col in df.columns:
                if col == key_col:
                    continue
                group_rep = col_to_group.get(col, col)
                if group_rep not in group_conflicts:
                    group_conflicts[group_rep] = []
                group_conflicts[group_rep].append({
                    "file_id": fd["id"],
                    "file_name": fd["name"],
                    "column": col,
                    "value": str(row[col]) if pd.notna(row[col]) else "",
                })

        # 그룹 내 값이 다른 경우 이슈 생성
        for group_rep, conflicts in group_conflicts.items():
            if len(conflicts) < 2:
                continue
            values = [c["value"] for c in conflicts]
            unique_values = set(v for v in values if v != "")
            if len(unique_values) <= 1:
                continue

            # severity 판단: 완전히 다른 값이면 conflict, 유사하면 warning
            all_pairs_similar = True
            vals = list(unique_values)
            for i in range(len(vals)):
                for j in range(i + 1, len(vals)):
                    if not are_keys_similar(vals[i], vals[j]):
                        all_pairs_similar = False
                        break

            severity = "warning" if all_pairs_similar else "conflict"

            issues.append({
                "key_normalized": norm_key,
                "key_variants": variants,
                "column_group": group_rep,
                "conflicts": conflicts,
                "severity": severity,
            })

    # severity 순 정렬 (conflict 먼저)
    issues.sort(key=lambda x: 0 if x["severity"] == "conflict" else 1)

    return {
        "total_keys": total_keys,
        "matched_keys": matched_keys,
        "issues": issues,
    }
