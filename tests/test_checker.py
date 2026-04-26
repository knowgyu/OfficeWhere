from pathlib import Path

import pandas as pd
import pytest
from docx import Document
from fastapi import HTTPException
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches

from backend.api.check import consistency_check
from backend.core.checker import run_consistency_check
from backend.core.file_access import inspect_file_path
from backend.models.schemas import CheckRequest


def _write_excel_with_offset_table(path: Path):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "사업현황"
    worksheet["A1"] = "2026 사업 목록"
    worksheet["C3"] = "과제명"
    worksheet["D3"] = "담당자"
    worksheet["E3"] = "예산"
    worksheet["C4"] = "A"
    worksheet["D4"] = "Kim"
    worksheet["E4"] = "100"
    worksheet["C5"] = "B"
    worksheet["D5"] = "Lee"
    worksheet["E5"] = "200"
    workbook.save(path)


def _write_excel_with_offset_conflict_table(path: Path, budget: str):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "사업현황"
    worksheet["A1"] = "2026 사업 목록"
    worksheet["C3"] = "과제명"
    worksheet["D3"] = "담당자"
    worksheet["E3"] = "예산"
    # Row 4 is intentionally blank. The parser drops it after reset_index, so
    # location metadata must preserve the remaining DataFrame index offset.
    worksheet["C5"] = "A"
    worksheet["D5"] = "Kim"
    worksheet["E5"] = budget
    worksheet["C6"] = "B"
    worksheet["D6"] = "Lee"
    worksheet["E6"] = "200"
    workbook.save(path)


def _write_dataframe_excel(path: Path, data: dict):
    pd.DataFrame(data).to_excel(path, index=False)


def _make_parser_config(columns: int, rows: int) -> dict:
    return {
        "sheet_name": "Sheet1",
        "header_row": 1,
        "start_col": 1,
        "end_col": columns,
        "end_row": rows + 1,
    }


def _write_word(path: Path, paragraph_text: str, table_value: str):
    document = Document()
    document.add_paragraph("공통 서론")
    document.add_paragraph(paragraph_text)
    table = document.add_table(rows=2, cols=2)
    table.rows[0].cells[0].text = "ID"
    table.rows[0].cells[1].text = "Value"
    table.rows[1].cells[0].text = "1"
    table.rows[1].cells[1].text = table_value
    document.save(path)


def _write_word_with_second_page_change(path: Path, second_page_text: str):
    document = Document()
    document.add_paragraph("첫 페이지 공통")
    document.add_page_break()
    document.add_paragraph(second_page_text)
    document.save(path)


def _add_textbox(slide, left: float, top: float, text: str):
    textbox = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(4), Inches(1))
    textbox.text_frame.text = text


def _write_ppt(path: Path, first_body: str, include_inserted_slide: bool):
    presentation = Presentation()
    layout = presentation.slide_layouts[5]

    slide1 = presentation.slides.add_slide(layout)
    slide1.shapes.title.text = "Overview"
    _add_textbox(slide1, 1, 1.5, first_body)

    if include_inserted_slide:
        inserted = presentation.slides.add_slide(layout)
        inserted.shapes.title.text = "Inserted"
        _add_textbox(inserted, 1, 1.5, "추가된 슬라이드")

    slide2 = presentation.slides.add_slide(layout)
    slide2.shapes.title.text = "Plan"
    _add_textbox(slide2, 1, 1.5, "기존 슬라이드")

    presentation.save(path)


def test_excel_inspect_detects_table_not_at_top_left(tmp_path):
    file_path = tmp_path / "offset.xlsx"
    _write_excel_with_offset_table(file_path)

    result = inspect_file_path(str(file_path))

    assert result["columns"] == ["과제명", "담당자", "예산"]
    assert result["sample"] == [["A", "Kim", "100"], ["B", "Lee", "200"]]
    assert result["parser_config"] == {
        "sheet_name": "사업현황",
        "header_row": 3,
        "start_col": 3,
        "end_col": 5,
        "end_row": 5,
    }


def test_excel_consistency_reports_missing_key_and_value_conflict(tmp_path):
    file_a = tmp_path / "a.xlsx"
    file_b = tmp_path / "b.xlsx"
    _write_dataframe_excel(file_a, {"과제명": ["A", "B"], "예산": ["100", "200"], "담당자": ["Kim", "Lee"]})
    _write_dataframe_excel(file_b, {"과제명": ["A", "C"], "예산": ["999", "300"]})

    result = run_consistency_check(
        [
            {
                "id": 1,
                "path": str(file_a),
                "name": "a.xlsx",
                "file_type": "Excel",
                "key_column": "과제명",
                "parser_config": _make_parser_config(columns=3, rows=2),
            },
            {
                "id": 2,
                "path": str(file_b),
                "name": "b.xlsx",
                "file_type": "Excel",
                "key_column": "과제명",
                "parser_config": _make_parser_config(columns=2, rows=2),
            },
        ]
    )

    assert result["mode"] == "excel"
    issue_types = {issue["issue_type"] for issue in result["excel"]["issues"]}
    assert {"missing_column", "missing_key", "value_conflict"} <= issue_types

    conflict = next(issue for issue in result["excel"]["issues"] if issue["issue_type"] == "value_conflict")
    assert conflict["key"] == "a"
    assert conflict["column"] == "예산"
    values_by_file = {entry["file_id"]: entry for entry in conflict["values"]}
    assert values_by_file[1]["row_numbers"] == [2]
    assert values_by_file[1]["column_letters"] == ["B"]
    assert values_by_file[1]["cell_refs"] == ["B2"]
    assert values_by_file[1]["row_count"] == 1
    assert values_by_file[2]["row_numbers"] == [2]
    assert values_by_file[2]["column_letters"] == ["B"]
    assert values_by_file[2]["cell_refs"] == ["B2"]
    assert values_by_file[2]["row_count"] == 1

    missing_column = next(issue for issue in result["excel"]["issues"] if issue["issue_type"] == "missing_column")
    assert missing_column["column"] == "담당자"
    assert "관련 내용" in missing_column["message"]
    column_rows = [entry for entry in missing_column["values"] if entry["row_values"]]
    assert column_rows
    assert column_rows[0]["columns"] == ["과제명", "담당자"]
    assert column_rows[0]["values"] == ["삭제된 내용"]

    missing_key = next(issue for issue in result["excel"]["issues"] if issue["issue_type"] == "missing_key")
    assert "관련 내용" in missing_key["message"]
    present_rows = [entry for entry in missing_key["values"] if entry["row_values"]]
    assert present_rows
    assert present_rows[0]["columns"]
    assert present_rows[0]["values"] == ["삭제된 내용"]


def test_excel_consistency_reports_cell_value_added_and_removed(tmp_path):
    file_a = tmp_path / "cell-a.xlsx"
    file_b = tmp_path / "cell-b.xlsx"
    _write_dataframe_excel(
        file_a,
        {"과제명": ["A", "B"], "담당자": ["", "Kim"], "예산": ["100", "200"]},
    )
    _write_dataframe_excel(
        file_b,
        {"과제명": ["A", "B"], "담당자": ["Lee", ""], "예산": ["100", "200"]},
    )

    result = run_consistency_check(
        [
            {
                "id": 1,
                "path": str(file_a),
                "name": "cell-a.xlsx",
                "file_type": "Excel",
                "key_column": "과제명",
                "parser_config": _make_parser_config(columns=3, rows=2),
            },
            {
                "id": 2,
                "path": str(file_b),
                "name": "cell-b.xlsx",
                "file_type": "Excel",
                "key_column": "과제명",
                "parser_config": _make_parser_config(columns=3, rows=2),
            },
        ]
    )

    issues = result["excel"]["issues"]
    added = next(issue for issue in issues if issue["issue_type"] == "value_added")
    removed = next(issue for issue in issues if issue["issue_type"] == "value_removed")

    assert added["key"] == "a"
    assert added["column"] == "담당자"
    assert added["message"] == "담당자 값이 추가되었습니다."
    assert [entry["values"] for entry in added["values"]] == [["(빈 값)"], ["Lee"]]
    assert added["values"][1]["cell_refs"] == ["B2"]

    assert removed["key"] == "b"
    assert removed["column"] == "담당자"
    assert removed["message"] == "담당자 값이 삭제되었습니다."
    assert [entry["values"] for entry in removed["values"]] == [["Kim"], ["(빈 값)"]]
    assert removed["values"][0]["cell_refs"] == ["B3"]


def test_excel_consistency_reports_offset_cell_refs_after_blank_rows(tmp_path):
    file_a = tmp_path / "offset-a.xlsx"
    file_b = tmp_path / "offset-b.xlsx"
    _write_excel_with_offset_conflict_table(file_a, "100")
    _write_excel_with_offset_conflict_table(file_b, "999")

    parser_config = {
        "sheet_name": "사업현황",
        "header_row": 3,
        "start_col": 3,
        "end_col": 5,
        "end_row": 6,
    }
    result = run_consistency_check(
        [
            {
                "id": 1,
                "path": str(file_a),
                "name": "offset-a.xlsx",
                "file_type": "Excel",
                "key_column": "과제명",
                "parser_config": parser_config,
            },
            {
                "id": 2,
                "path": str(file_b),
                "name": "offset-b.xlsx",
                "file_type": "Excel",
                "key_column": "과제명",
                "parser_config": parser_config,
            },
        ]
    )

    conflict = next(issue for issue in result["excel"]["issues"] if issue["issue_type"] == "value_conflict")
    assert conflict["key"] == "a"
    assert conflict["column"] == "예산"
    for entry in conflict["values"]:
        assert entry["row_numbers"] == [5]
        assert entry["column_letters"] == ["E"]
        assert entry["cell_refs"] == ["E5"]
        assert entry["row_count"] == 1


def test_word_diff_reports_paragraph_and_table_changes(tmp_path):
    left = tmp_path / "left.docx"
    right = tmp_path / "right.docx"
    _write_word(left, "본문 버전 A", "Alpha")
    _write_word(right, "본문 버전 B", "Beta")

    result = run_consistency_check(
        [
            {"id": 1, "path": str(left), "name": "left.docx", "file_type": "Word", "key_column": "", "parser_config": {}},
            {"id": 2, "path": str(right), "name": "right.docx", "file_type": "Word", "key_column": "", "parser_config": {}},
        ]
    )

    assert result["mode"] == "word"
    assert any(change["change_type"] == "replace" for change in result["word"]["changes"])
    before_types = {
        block["block_type"]
        for change in result["word"]["changes"]
        for block in change["before"]
    }
    assert {"paragraph", "table_row"} <= before_types


def test_word_diff_reports_best_effort_page_numbers(tmp_path):
    left = tmp_path / "left-page.docx"
    right = tmp_path / "right-page.docx"
    _write_word_with_second_page_change(left, "두 번째 페이지 원본")
    _write_word_with_second_page_change(right, "두 번째 페이지 수정")

    result = run_consistency_check(
        [
            {"id": 1, "path": str(left), "name": "left-page.docx", "file_type": "Word", "key_column": "", "parser_config": {}},
            {"id": 2, "path": str(right), "name": "right-page.docx", "file_type": "Word", "key_column": "", "parser_config": {}},
        ]
    )

    change = next(change for change in result["word"]["changes"] if change["change_type"] == "replace")
    assert change["before"][0]["page_number"] == 2
    assert change["after"][0]["page_number"] == 2


def test_ppt_diff_reports_slide_insert_and_update(tmp_path):
    left = tmp_path / "left.pptx"
    right = tmp_path / "right.pptx"
    _write_ppt(left, first_body="원본 본문", include_inserted_slide=False)
    _write_ppt(right, first_body="수정된 본문", include_inserted_slide=True)

    result = run_consistency_check(
        [
            {"id": 1, "path": str(left), "name": "left.pptx", "file_type": "PowerPoint", "key_column": "", "parser_config": {}},
            {"id": 2, "path": str(right), "name": "right.pptx", "file_type": "PowerPoint", "key_column": "", "parser_config": {}},
        ]
    )

    assert result["mode"] == "ppt"
    change_types = {change["change_type"] for change in result["ppt"]["changes"]}
    assert {"slide_insert", "slide_update"} <= change_types


def test_check_api_rejects_mixed_file_types(monkeypatch):
    rows = {
        1: {"id": 1, "path": "/tmp/a.xlsx", "name": "a.xlsx", "file_type": "Excel", "key_column": "과제명", "parser_config": {}},
        2: {"id": 2, "path": "/tmp/b.docx", "name": "b.docx", "file_type": "Word", "key_column": "", "parser_config": {}},
    }
    monkeypatch.setattr("backend.api.check.get_file_by_id", lambda file_id: rows[file_id])
    monkeypatch.setattr("backend.api.check.os.path.exists", lambda _: True)

    with pytest.raises(HTTPException) as exc_info:
        consistency_check(CheckRequest(file_ids=[1, 2]))

    assert exc_info.value.status_code == 400
