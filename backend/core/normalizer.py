import re


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
