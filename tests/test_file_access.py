import pandas as pd
import pytest

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
    assert result["comparison_mode"] == "excel"
    assert result["parser_config"] == {
        "sheet_name": "Sheet1",
        "header_row": 1,
        "start_col": 1,
        "end_col": 2,
        "end_row": 2,
    }


def test_inspect_file_path_rejects_text_files(tmp_path):
    file_path = tmp_path / "notes.txt"
    file_path.write_text("plain text", encoding="utf-8")

    with pytest.raises(ValueError, match=".xlsx, .xls, .docx, .pptx"):
        inspect_file_path(str(file_path))
