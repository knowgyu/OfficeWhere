import pytest
from openpyxl import Workbook

from backend.core.file_access import inspect_file_path


def test_inspect_file_path_returns_schema(tmp_path):
    file_path = tmp_path / "sample.xlsx"
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Sheet1"
    worksheet.append(["과제명", "담당자"])
    worksheet.append(["A", "Kim"])
    workbook.save(file_path)

    result = inspect_file_path(str(file_path))

    assert result["path"] == str(file_path)
    assert result["name"] == "sample.xlsx"
    assert result["columns"] == ["과제명", "담당자"]
    assert result["sample"] == [["A", "Kim"]]
    assert result["comparison_mode"] == "excel"


def test_inspect_file_path_rejects_text_files(tmp_path):
    file_path = tmp_path / "notes.txt"
    file_path.write_text("plain text", encoding="utf-8")

    with pytest.raises(ValueError, match=".xlsx, .docx, .pptx"):
        inspect_file_path(str(file_path))


def test_inspect_file_path_rejects_legacy_xls_files(tmp_path):
    file_path = tmp_path / "legacy.xls"
    file_path.write_text("legacy", encoding="utf-8")

    with pytest.raises(ValueError, match="지원하지 않는 파일 형식"):
        inspect_file_path(str(file_path))


def test_scan_supported_paths_reuses_shared_scanner_semantics(tmp_path):
    from pathlib import Path

    from backend.core.file_access import _scan_supported_paths

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    keep = scan_root / "report.xlsx"
    keep.write_text("x")
    (scan_root / "notes.txt").write_text("x")
    (scan_root / "~$temp.xlsx").write_text("x")
    nested = scan_root / "nested"
    nested.mkdir()
    nested_keep = nested / "deck.pptx"
    nested_keep.write_text("x")
    excluded = scan_root / "node_modules"
    excluded.mkdir()
    (excluded / "hidden.docx").write_text("x")

    recursive = _scan_supported_paths(scan_root, recursive=True)
    flat = _scan_supported_paths(scan_root, recursive=False)

    assert {Path(path) for path in recursive} == {keep, nested_keep}
    assert {Path(path) for path in flat} == {keep}
