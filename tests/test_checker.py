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
