import os
import sqlite3
import time
import tempfile
from datetime import datetime

import pytest
from openpyxl import Workbook

from backend.core.indexer import index_file, inspect_and_chunk, reindex_all, search, _sanitize_fts_query
from backend.database import (
    init_db,
    register_file,
    delete_file,
    get_all_files,
    search_chunks,
    save_file_chunks,
    update_file_mtime,
)


@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()


def _make_excel(path: str, data: dict):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Sheet1"
    headers = list(data.keys())
    worksheet.append(headers)
    row_count = max((len(values) for values in data.values()), default=0)
    for row_index in range(row_count):
        worksheet.append([
            values[row_index] if row_index < len(values) else ""
            for values in data.values()
        ])
    workbook.save(path)


def test_index_and_search_excel(tmp_path):
    xlsx = str(tmp_path / "sample.xlsx")
    _make_excel(xlsx, {"과제명": ["DFBA 챗봇", "스마트팜"], "담당자": ["홍길동", "김철수"]})

    file_id = register_file(xlsx, 'sample.xlsx', 'xlsx', 2)
    chunk_count = index_file(file_id, xlsx)

    assert chunk_count > 0

    results = search("DFBA")
    assert len(results) > 0
    assert any("DFBA" in r["snippet"] or "DFBA" in r.get("content", "") for r in results)



def test_reindex_all_prunes_legacy_text_rows(tmp_path):
    txt = tmp_path / "legacy.txt"
    txt.write_text("old text", encoding="utf-8")
    register_file(str(txt), 'legacy.txt', 'Text', 0)

    stats = reindex_all()

    assert stats == {"success": 0, "failed": 0, "skipped": 1}
    assert get_all_files() == []
    assert txt.exists()


def test_search_returns_location(tmp_path):
    xlsx = str(tmp_path / "loc.xlsx")
    _make_excel(xlsx, {"항목": ["알파", "베타"], "값": ["100", "200"]})

    file_id = register_file(xlsx, 'loc.xlsx', 'xlsx', 2)
    index_file(file_id, xlsx)

    results = search("알파")
    assert len(results) > 0
    assert results[0]["location"] == "Sheet1 시트 | 2행 A열"


def test_index_and_search_excel_all_visible_sheets(tmp_path):
    xlsx = tmp_path / "multi-sheet.xlsx"
    workbook = Workbook()
    workbook.active.title = "요약"
    workbook.active["A1"] = "요약내용"
    detail = workbook.create_sheet("세부")
    detail["C3"] = "세컨드시트키워드"
    workbook.save(xlsx)

    file_id = register_file(str(xlsx), 'multi-sheet.xlsx', 'Excel', 0)
    chunk_count = index_file(file_id, str(xlsx))

    assert chunk_count == 2
    results = search("세컨드시트키워드")
    assert any(result["location"] == "세부 시트 | 3행 C열" for result in results)


def test_search_excel_header_uses_cell_location(tmp_path):
    xlsx = str(tmp_path / "header.xlsx")
    _make_excel(xlsx, {"항목": ["알파"], "담당자": ["홍길동"]})

    file_id = register_file(xlsx, 'header.xlsx', 'xlsx', 2)
    index_file(file_id, xlsx)

    results = search("담당자")

    assert len(results) > 0
    assert results[0]["location"] == "Sheet1 시트 | 1행 B열"


def test_index_excel_uses_used_range(tmp_path):
    xlsx = str(tmp_path / "stale.xlsx")
    _make_excel(xlsx, {"항목": ["알파"], "새열": ["범위밖키워드"]})
    file_id = register_file(xlsx, 'stale.xlsx', 'Excel', 1)
    chunk_count = index_file(file_id, xlsx)

    assert chunk_count > 0
    results = search("범위밖키워드")
    assert len(results) == 1
    assert results[0]["location"] == "Sheet1 시트 | 2행 B열"


def test_inspect_and_chunk_indexes_used_range(tmp_path):
    xlsx = str(tmp_path / "recover.xlsx")
    _make_excel(xlsx, {"항목": ["알파"], "새열": ["복구키워드"]})
    info, chunks = inspect_and_chunk(xlsx)

    assert info["columns"] == ["항목", "새열"]
    assert any(chunk["content"] == "복구키워드" for chunk in chunks)


def test_search_no_results_for_missing_term(tmp_path):
    xlsx = str(tmp_path / "empty.xlsx")
    _make_excel(xlsx, {"항목": ["ABC"], "값": ["123"]})

    file_id = register_file(xlsx, 'empty.xlsx', 'xlsx', 2)
    index_file(file_id, xlsx)

    results = search("존재하지않는단어XYZ")
    assert results == []


def test_search_matches_korean_substrings_inside_words(tmp_path):
    doc_path = tmp_path / "meeting.docx"

    file_id = register_file(str(doc_path), 'meeting.docx', 'Word', 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "주간 회의록 작성 후 공유"}])

    results = search("회의")

    assert len(results) == 1
    assert results[0]["file_id"] == file_id
    assert "**회의**" in results[0]["snippet"]


def test_search_no_longer_guarantees_hangul_choseong(tmp_path):
    doc_path = tmp_path / "meeting.docx"

    file_id = register_file(str(doc_path), 'meeting.docx', 'Word', 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "주간 회의록 작성 후 공유"}])

    results = search("ㅎㅇㄹ")

    assert results == []


def test_search_matches_long_korean_substring_with_fast_path(tmp_path):
    doc_path = tmp_path / "project.docx"

    file_id = register_file(str(doc_path), 'project.docx', 'Word', 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "프로젝트 상태 보고서"}])

    results = search("프로젝")

    assert len(results) == 1
    assert results[0]["file_id"] == file_id
    assert "**프로젝**" in results[0]["snippet"]


def test_init_db_removes_unused_base_file_search():
    from backend.database import DB_PATH

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE name = 'file_search'")
    assert cursor.fetchone() is None
    cursor.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('chunks_ai', 'chunks_ad')")
    assert cursor.fetchall() == []
    cursor.execute("SELECT name FROM sqlite_master WHERE name = 'file_search_ko'")
    assert cursor.fetchone() == ("file_search_ko",)
    cursor.execute(
        """
        SELECT name FROM sqlite_master
        WHERE name IN ('file_search_ko_docsize', 'file_search_trigram_docsize')
        """
    )
    assert cursor.fetchall() == []
    conn.close()


def test_init_db_migrates_legacy_base_file_search(tmp_path, monkeypatch):
    from backend.database import DB_PATH, init_db, register_file, save_file_chunks

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE VIRTUAL TABLE file_search USING fts5(
            content,
            content='file_chunks',
            content_rowid='id',
            tokenize='unicode61'
        )
        """
    )
    cursor.execute(
        """
        CREATE TRIGGER chunks_ai AFTER INSERT ON file_chunks BEGIN
            INSERT INTO file_search(rowid, content) VALUES (new.id, new.content);
        END
        """
    )
    cursor.execute(
        """
        CREATE TRIGGER chunks_ad AFTER DELETE ON file_chunks BEGIN
            INSERT INTO file_search(file_search, rowid, content)
            VALUES ('delete', old.id, old.content);
        END
        """
    )
    conn.commit()
    conn.close()

    init_db()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE name = 'file_search'")
    assert cursor.fetchone() is None
    cursor.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('chunks_ai', 'chunks_ad')")
    assert cursor.fetchall() == []
    conn.close()

    file_id = register_file(str(tmp_path / 'meeting.docx'), 'meeting.docx', 'Word', 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "주간 회의록"}])

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT rowid FROM file_search_ko WHERE file_search_ko MATCH ?", ('"회의"',))
    assert cursor.fetchone() is not None
    conn.close()


def test_init_db_recreates_search_indexes_with_columnsize_zero(tmp_path):
    from backend.database import DB_PATH, set_setting

    file_id = register_file(str(tmp_path / 'meeting.docx'), 'meeting.docx', 'Word', 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "주간 회의록"}])

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ai_ko")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ad_ko")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ai_trigram")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ad_trigram")
    cursor.execute("DROP TABLE IF EXISTS file_search_ko")
    cursor.execute("DROP TABLE IF EXISTS file_search_trigram")
    cursor.execute(
        """
        CREATE VIRTUAL TABLE file_search_ko USING fts5(
            search_text,
            content='file_chunks',
            content_rowid='id',
            tokenize='unicode61'
        )
        """
    )
    cursor.execute("INSERT INTO file_search_ko(file_search_ko) VALUES ('rebuild')")
    conn.commit()
    conn.close()
    set_setting("search_index_version", "4")

    init_db()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT name FROM sqlite_master
        WHERE name IN ('file_search_ko_docsize', 'file_search_trigram_docsize')
        """
    )
    assert cursor.fetchall() == []
    cursor.execute("SELECT rowid FROM file_search_ko WHERE file_search_ko MATCH ?", ('"회의"',))
    assert cursor.fetchone() is not None
    conn.close()


def test_reindex_on_file_change(tmp_path):
    xlsx = str(tmp_path / "change.xlsx")
    _make_excel(xlsx, {"항목": ["원래값"], "값": ["1"]})

    file_id = register_file(xlsx, 'change.xlsx', 'xlsx', 1)
    index_file(file_id, xlsx)

    assert search("원래값") != []
    assert search("수정값") == []

    # 파일 수정 후 재인덱싱
    _make_excel(xlsx, {"항목": ["수정값"], "값": ["2"]})
    index_file(file_id, xlsx)

    assert search("수정값") != []


def test_sanitize_fts_query():
    assert _sanitize_fts_query("hello world") == '"hello" "world"'
    assert _sanitize_fts_query('foo "bar"') == '"foo" "bar"'
    assert _sanitize_fts_query("  ") == '""'


def test_index_performance_excel(tmp_path):
    """500행 Excel 인덱싱이 5초 내 완료."""
    xlsx = str(tmp_path / "perf.xlsx")
    _make_excel(xlsx, {
        "과제명": [f"과제_{i}" for i in range(500)],
        "담당자": [f"담당자_{i}" for i in range(500)],
        "예산": [str(i * 1000) for i in range(500)],
    })

    file_id = register_file(xlsx, 'perf.xlsx', 'xlsx', 3)
    start = time.perf_counter()
    chunk_count = index_file(file_id, xlsx)
    elapsed = time.perf_counter() - start

    assert chunk_count > 0
    assert elapsed < 5.0, f"인덱싱 {elapsed:.2f}초 — 5초 초과"


def test_search_performance(tmp_path):
    """1000청크 인덱싱 후 검색이 0.5초 내 완료."""
    xlsx = str(tmp_path / "search_perf.xlsx")
    _make_excel(xlsx, {
        "항목": [f"항목_{i}" for i in range(1000)],
        "내용": [f"내용 데이터 {i} 테스트" for i in range(1000)],
    })

    file_id = register_file(xlsx, 'search_perf.xlsx', 'xlsx', 2)
    index_file(file_id, xlsx)

    start = time.perf_counter()
    results = search("데이터")
    elapsed = time.perf_counter() - start

    assert elapsed < 0.5, f"검색 {elapsed:.3f}초 — 0.5초 초과"


def test_search_chunks_filters_file_type(tmp_path):
    from backend.database import save_file_chunks

    doc_id = register_file(str(tmp_path / 'note.docx'), 'note.docx', 'Word', 0)
    ppt_id = register_file(str(tmp_path / 'note.pptx'), 'note.pptx', 'PowerPoint', 0)
    save_file_chunks(doc_id, [{"location": "문단", "content": "공통 키워드"}])
    save_file_chunks(ppt_id, [{"location": "슬라이드 1", "content": "공통 키워드"}])

    word_results = search_chunks('"공통"', file_types=["Word"])

    assert {item["file_type"] for item in word_results} == {"Word"}


def test_search_api_filters_filename_and_content(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    doc_id = register_file(str(tmp_path / 'alpha.docx'), 'alpha.docx', 'Word', 0)
    ppt_id = register_file(str(tmp_path / 'alpha.pptx'), 'alpha.pptx', 'PowerPoint', 0)
    save_file_chunks(doc_id, [{"location": "문단", "content": "검색 대상"}])
    save_file_chunks(ppt_id, [{"location": "슬라이드 1", "content": "검색 대상"}])

    response = search_files(SearchRequest(query="alpha", file_types=["pptx"]))

    assert response.total == 1
    assert response.results[0].file_type == "PowerPoint"


def test_search_api_default_scope_includes_filename_and_content(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    filename_id = register_file(str(tmp_path / 'scope-key.docx'), 'scope-key.docx', 'Word', 0)
    content_id = register_file(str(tmp_path / 'content.docx'), 'content.docx', 'Word', 0)
    save_file_chunks(filename_id, [{"location": "문단", "content": "다른 내용"}])
    save_file_chunks(content_id, [{"location": "문단", "content": "scope-key 본문"}])

    response = search_files(SearchRequest(query="scope-key"))

    assert response.total == 2
    assert {item.file_id for item in response.results} == {filename_id, content_id}


def test_search_api_filename_scope_excludes_content_only_matches(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    filename_id = register_file(str(tmp_path / 'onlyname.docx'), 'onlyname.docx', 'Word', 0)
    content_id = register_file(str(tmp_path / 'body.docx'), 'body.docx', 'Word', 0)
    save_file_chunks(filename_id, [{"location": "문단", "content": "다른 내용"}])
    save_file_chunks(content_id, [{"location": "문단", "content": "onlyname 본문"}])

    response = search_files(SearchRequest(query="onlyname", search_scope="filename"))

    assert response.total == 1
    assert response.results[0].file_id == filename_id
    assert response.results[0].location == "파일명"
    assert "**onlyname**" in response.results[0].snippet


def test_search_api_content_scope_excludes_filename_only_matches(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    filename_id = register_file(str(tmp_path / 'bodyonly.docx'), 'bodyonly.docx', 'Word', 0)
    content_id = register_file(str(tmp_path / 'note.docx'), 'note.docx', 'Word', 0)
    save_file_chunks(filename_id, [{"location": "문단", "content": "다른 내용"}])
    save_file_chunks(content_id, [{"location": "문단", "content": "bodyonly 본문"}])

    response = search_files(SearchRequest(query="bodyonly", search_scope="content"))

    assert response.total == 1
    assert response.results[0].file_id == content_id
    assert response.results[0].location == "문단"


def test_search_api_filename_scope_respects_file_type_filter(tmp_path):
    from backend.api.search import search_files
    from backend.models.schemas import SearchRequest

    register_file(str(tmp_path / 'scope.docx'), 'scope.docx', 'Word', 0)
    ppt_id = register_file(str(tmp_path / 'scope.pptx'), 'scope.pptx', 'PowerPoint', 0)

    response = search_files(SearchRequest(query="scope", file_types=["pptx"], search_scope="filename"))

    assert response.total == 1
    assert response.results[0].file_id == ppt_id
    assert response.results[0].file_type == "PowerPoint"


def test_search_api_content_scope_supports_excel_filter(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    excel_id = register_file(str(tmp_path / 'sheet.xlsx'), 'sheet.xlsx', 'Excel', 0)
    word_id = register_file(str(tmp_path / 'sheet.docx'), 'sheet.docx', 'Word', 0)
    save_file_chunks(excel_id, [{"location": "Sheet1 행 1", "content": "엑셀검색 키워드"}])
    save_file_chunks(word_id, [{"location": "문단", "content": "엑셀검색 키워드"}])

    response = search_files(SearchRequest(query="엑셀검색", file_types=["xlsx"], search_scope="content"))

    assert response.total == 1
    assert response.results[0].file_id == excel_id
    assert response.results[0].file_type == "Excel"


def test_word_search_locations_use_page_labels(tmp_path):
    from docx import Document

    doc_path = tmp_path / "paged.docx"
    document = Document()
    document.add_paragraph("첫 페이지")
    document.add_page_break()
    document.add_paragraph("두 번째 페이지 검색키워드")
    document.save(doc_path)

    file_id = register_file(str(doc_path), 'paged.docx', 'Word', 0)
    index_file(file_id, str(doc_path))

    results = search("검색키워드")

    assert len(results) == 1
    assert results[0]["location"] == "쪽 2"


def test_ppt_search_locations_hide_shape_details(tmp_path):
    from pptx import Presentation
    from pptx.util import Inches

    ppt_path = tmp_path / "slides.pptx"
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    textbox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    textbox.text = "프로젝트 검색키워드"
    presentation.save(ppt_path)

    file_id = register_file(str(ppt_path), 'slides.pptx', 'PowerPoint', 0)
    index_file(file_id, str(ppt_path))

    results = search("검색키워드")

    assert len(results) >= 1
    assert {result["location"] for result in results} == {"슬라이드 1"}
    assert all("shape" not in result["location"] for result in results)


def test_search_api_filters_by_file_modified_date(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks, update_file_mtime
    from backend.models.schemas import SearchRequest

    old_id = register_file(str(tmp_path / 'old.docx'), '회의_old.docx', 'Word', 0)
    new_id = register_file(str(tmp_path / 'new.docx'), '회의_new.docx', 'Word', 0)
    save_file_chunks(old_id, [{"location": "문단", "content": "회의 자료"}])
    save_file_chunks(new_id, [{"location": "문단", "content": "회의 자료"}])
    update_file_mtime(old_id, datetime(2026, 3, 15).timestamp())
    update_file_mtime(new_id, datetime(2026, 4, 15).timestamp())

    response = search_files(
        SearchRequest(
            query="회의",
            modified_from="2026-04-01",
            modified_to="2026-04-30",
        )
    )

    matched_ids = {item.file_id for item in response.results}
    assert matched_ids == {new_id}


def test_search_api_caps_results_by_file_first(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    for index in range(25):
        file_id = register_file(str(tmp_path / f'note-{index}.docx'), f'note-{index}.docx', 'Word', 0)
        save_file_chunks(file_id, [{"location": "문단", "content": f"프로젝트 공통키워드 {index}"}])

    response = search_files(SearchRequest(query="공통키워드", search_scope="content", file_limit=20))

    assert response.file_limit == 20
    assert response.file_count == 20
    assert len({item.file_id for item in response.results}) == 20
    assert response.has_more is True


def test_content_search_orders_files_by_recent_mtime_and_chunks_by_document_order(tmp_path):
    first_id = register_file(str(tmp_path / 'old.docx'), 'old.docx', 'Word', 0)
    second_id = register_file(str(tmp_path / 'new.docx'), 'new.docx', 'Word', 0)
    third_id = register_file(str(tmp_path / 'middle.docx'), 'middle.docx', 'Word', 0)
    save_file_chunks(first_id, [{"location": "문단 1", "content": "프로젝트 공통키워드"}])
    save_file_chunks(
        second_id,
        [
            {"location": "슬라이드 1", "content": "프로젝트 공통키워드"},
            {"location": "슬라이드 2", "content": "프로젝트 공통키워드 프로젝트 공통키워드"},
            {"location": "슬라이드 5", "content": "프로젝트 공통키워드"},
        ],
    )
    save_file_chunks(third_id, [{"location": "문단 1", "content": "프로젝트 공통키워드"}])
    update_file_mtime(first_id, 1_000)
    update_file_mtime(second_id, 3_000)
    update_file_mtime(third_id, 2_000)

    results = search("공통키워드", file_limit=3, per_file_limit=3)

    ordered_file_ids = []
    for item in results:
        if item["file_id"] not in ordered_file_ids:
            ordered_file_ids.append(item["file_id"])
    assert ordered_file_ids == [second_id, third_id, first_id]
    assert [item["location"] for item in results if item["file_id"] == second_id] == [
        "슬라이드 1",
        "슬라이드 2",
        "슬라이드 5",
    ]


def test_search_api_allows_more_files_up_to_max(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    for index in range(105):
        file_id = register_file(str(tmp_path / f'bulk-{index}.docx'), f'bulk-{index}.docx', 'Word', 0)
        save_file_chunks(file_id, [{"location": "문단", "content": f"프로젝트 대량검색 {index}"}])
        update_file_mtime(file_id, float(index))

    response = search_files(SearchRequest(query="대량검색", search_scope="content", file_limit=120))

    assert response.file_limit == 100
    assert response.file_count == 100
    assert len({item.file_id for item in response.results}) == 100
    assert response.has_more is False
