import pandas as pd

from backend.core.checker import run_consistency_check


def test_consistency_check_flags_duplicate_key_conflict(monkeypatch):
    df_a = pd.DataFrame(
        {
            "과제명": ["A", "A"],
            "담당자": ["Kim", "Lee"],
        }
    )
    df_b = pd.DataFrame(
        {
            "과제명": ["A"],
            "담당자": ["Kim"],
        }
    )

    def fake_parse(path: str):
        return {"a.xlsx": df_a, "b.xlsx": df_b}[path]

    monkeypatch.setattr("backend.core.checker.parse_file", fake_parse)

    result = run_consistency_check(
        [
            {"id": 1, "path": "a.xlsx", "name": "a.xlsx", "key_column": "과제명"},
            {"id": 2, "path": "b.xlsx", "name": "b.xlsx", "key_column": "과제명"},
        ]
    )

    assert len(result["issues"]) == 1
    issue = result["issues"][0]
    assert issue["severity"] == "conflict"
    conflict_map = {entry["file_name"]: entry for entry in issue["conflicts"]}
    assert conflict_map["a.xlsx"]["row_count"] == 2
    assert conflict_map["a.xlsx"]["values"] == ["Kim", "Lee"]


def test_consistency_check_warns_when_value_missing(monkeypatch):
    df_a = pd.DataFrame(
        {
            "과제명": ["A"],
            "예산": ["100"],
        }
    )
    df_b = pd.DataFrame(
        {
            "과제명": ["A"],
            "예산": [""],
        }
    )

    def fake_parse(path: str):
        return {"a.xlsx": df_a, "b.xlsx": df_b}[path]

    monkeypatch.setattr("backend.core.checker.parse_file", fake_parse)

    result = run_consistency_check(
        [
            {"id": 1, "path": "a.xlsx", "name": "a.xlsx", "key_column": "과제명"},
            {"id": 2, "path": "b.xlsx", "name": "b.xlsx", "key_column": "과제명"},
        ]
    )

    assert len(result["issues"]) == 1
    assert result["issues"][0]["severity"] == "warning"


def test_numeric_float_and_int_treated_as_equal(monkeypatch):
    """Excel에서 100이 100.0으로 읽히는 경우 이슈로 보지 않아야 한다."""
    df_a = pd.DataFrame({"과제명": ["A"], "예산": ["100.0"]})
    df_b = pd.DataFrame({"과제명": ["A"], "예산": ["100"]})

    def fake_parse(path: str):
        return {"a.xlsx": df_a, "b.xlsx": df_b}[path]

    monkeypatch.setattr("backend.core.checker.parse_file", fake_parse)

    result = run_consistency_check(
        [
            {"id": 1, "path": "a.xlsx", "name": "a.xlsx", "key_column": "과제명"},
            {"id": 2, "path": "b.xlsx", "name": "b.xlsx", "key_column": "과제명"},
        ]
    )
    assert len(result["issues"]) == 0


def test_numeric_small_difference_is_conflict(monkeypatch):
    """수치가 조금이라도 다르면 conflict로 처리해야 한다."""
    df_a = pd.DataFrame({"과제명": ["A"], "예산": ["100.5"]})
    df_b = pd.DataFrame({"과제명": ["A"], "예산": ["100.6"]})

    def fake_parse(path: str):
        return {"a.xlsx": df_a, "b.xlsx": df_b}[path]

    monkeypatch.setattr("backend.core.checker.parse_file", fake_parse)

    result = run_consistency_check(
        [
            {"id": 1, "path": "a.xlsx", "name": "a.xlsx", "key_column": "과제명"},
            {"id": 2, "path": "b.xlsx", "name": "b.xlsx", "key_column": "과제명"},
        ]
    )
    assert len(result["issues"]) == 1
    assert result["issues"][0]["severity"] == "conflict"


def test_whitespace_and_newline_in_value_ignored(monkeypatch):
    """값의 앞뒤 공백, 줄바꿈 차이는 이슈로 보지 않아야 한다."""
    df_a = pd.DataFrame({"과제명": ["A"], "담당자": ["  홍길동\n"]})
    df_b = pd.DataFrame({"과제명": ["A"], "담당자": ["홍길동"]})

    def fake_parse(path: str):
        return {"a.xlsx": df_a, "b.xlsx": df_b}[path]

    monkeypatch.setattr("backend.core.checker.parse_file", fake_parse)

    result = run_consistency_check(
        [
            {"id": 1, "path": "a.xlsx", "name": "a.xlsx", "key_column": "과제명"},
            {"id": 2, "path": "b.xlsx", "name": "b.xlsx", "key_column": "과제명"},
        ]
    )
    assert len(result["issues"]) == 0
