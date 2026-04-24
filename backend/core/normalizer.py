import re
from typing import List, Optional, Tuple
from rapidfuzz import fuzz

SIMILARITY_THRESHOLD = 85


def normalize_key(value: str) -> str:
    """
    key 정규화 규칙:
    1. 앞뒤 공백 제거
    2. 앞뒤 '-', '_', '.' 제거
    3. 내부 연속 공백 → 단일 공백
    4. 소문자 변환
    """
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    value = value.strip("-_.")
    value = re.sub(r"\s+", " ", value)
    value = value.lower()
    return value


def normalize_value(value: str) -> str:
    """데이터 값 정규화: 공백·줄바꿈 정규화만, 대소문자 유지"""
    if not isinstance(value, str):
        value = str(value)
    return re.sub(r"\s+", " ", value.strip())


def values_equal(a: str, b: str) -> bool:
    """두 데이터 값이 실질적으로 동일한지 비교.
    수치형은 float exact 비교(100.0 == 100), 문자형은 공백 정규화 후 exact 비교.
    """
    na = normalize_value(a)
    nb = normalize_value(b)
    if na == nb:
        return True
    try:
        return float(na.replace(",", "")) == float(nb.replace(",", ""))
    except ValueError:
        return False


def are_keys_similar(key1: str, key2: str) -> bool:
    """두 key가 유사한지 확인 (rapidfuzz ratio >= 85)"""
    norm1 = normalize_key(key1)
    norm2 = normalize_key(key2)
    if norm1 == norm2:
        return True
    score = fuzz.ratio(norm1, norm2)
    return score >= SIMILARITY_THRESHOLD


def are_columns_similar(col1: str, col2: str) -> bool:
    """두 컬럼명이 유사한지 확인 (동일 threshold 사용)"""
    norm1 = normalize_key(col1)
    norm2 = normalize_key(col2)
    if norm1 == norm2:
        return True
    score = fuzz.ratio(norm1, norm2)
    return score >= SIMILARITY_THRESHOLD


def group_similar_columns(columns: List[str]) -> List[List[str]]:
    """
    유사한 컬럼명들을 그룹으로 묶어 반환.
    반환: [[col1, col2], [col3], ...]
    """
    groups: List[List[str]] = []
    used = [False] * len(columns)

    for i, col in enumerate(columns):
        if used[i]:
            continue
        group = [col]
        used[i] = True
        for j in range(i + 1, len(columns)):
            if not used[j] and are_columns_similar(col, columns[j]):
                group.append(columns[j])
                used[j] = True
        groups.append(group)

    return groups


def find_canonical_key(variants: List[str]) -> str:
    """
    여러 변형 key 중 정규화된 대표 key 반환.
    정규화 후 가장 짧은 것을 대표로 사용.
    """
    if not variants:
        return ""
    normalized = [normalize_key(v) for v in variants]
    # 가장 짧은 정규화 결과를 canonical로 사용
    return min(normalized, key=len)


def suggest_key_column(columns: List[str]) -> Optional[str]:
    """
    파일 등록 시 key 컬럼 자동 추천.
    컬럼명에 '과제', 'key', 'id', '번호' 포함된 것 우선 추천.
    """
    priority_keywords = ["과제", "key", "id", "번호", "name", "이름", "코드", "code"]
    for keyword in priority_keywords:
        for col in columns:
            if keyword.lower() in col.lower():
                return col
    return columns[0] if columns else None
