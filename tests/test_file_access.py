import pandas as pd

from backend.core.file_access import inspect_file_path


def test_inspect_file_path_returns_schema(tmp_path):
    file_path = tmp_path / "sample.xlsx"
    pd.DataFrame(
        {
            "과제명": ["A"],
            "담당자": ["Kim"],
        }
    ).to_excel(file_path, index=False)

    result = inspect_file_path(str(file_path))

    assert result["path"] == str(file_path)
    assert result["name"] == "sample.xlsx"
    assert result["suggested_key_column"] == "과제명"
    assert result["columns"] == ["과제명", "담당자"]
    assert result["sample"] == [["A", "Kim"]]
