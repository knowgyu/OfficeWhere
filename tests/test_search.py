import os
import time
import tempfile
from datetime import datetime

import pandas as pd
import pytest

from backend.core.indexer import index_file, inspect_and_chunk, search, _sanitize_fts_query
from backend.database import init_db, register_file, delete_file, search_chunks


@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()


def _make_excel(path: str, data: dict):
    df = pd.DataFrame(data)
    df.to_excel(path, index=False)


def test_index_and_search_excel(tmp_path):
    xlsx = str(tmp_path / "sample.xlsx")
    _make_excel(xlsx, {"과제명": ["DFBA 챗봇", "스마트팜"], "담당자": ["홍길동", "김철수"]})

    file_id = register_file(xlsx, "sample.xlsx", "xlsx", "과제명", 2)
    chunk_count = index_file(file_id, xlsx)

    assert chunk_count > 0

    results = search("DFBA")
    assert len(results) > 0
    assert any("DFBA" in r["snippet"] or "DFBA" in r.get("content", "") for r in results)


def test_search_returns_location(tmp_path):
    xlsx = str(tmp_path / "loc.xlsx")
    _make_excel(xlsx, {"항목": ["알파", "베타"], "값": ["100", "200"]})

    file_id = register_file(xlsx, "loc.xlsx", "xlsx", "항목", 2)
    index_file(file_id, xlsx)

    results = search("알파")
    assert len(results) > 0
    assert results[0]["location"] == "Sheet1 시트 | 2행 A열"


def test_search_excel_header_uses_cell_location(tmp_path):
    xlsx = str(tmp_path / "header.xlsx")
    _make_excel(xlsx, {"항목": ["알파"], "담당자": ["홍길동"]})

    file_id = register_file(xlsx, "header.xlsx", "xlsx", "항목", 2)
    index_file(file_id, xlsx)

    results = search("담당자")

    assert len(results) > 0
    assert results[0]["location"] == "Sheet1 시트 | 1행 B열"


def test_index_excel_uses_used_range_when_parser_config_is_stale(tmp_path):
    xlsx = str(tmp_path / "stale.xlsx")
    _make_excel(xlsx, {"항목": ["알파"], "새열": ["범위밖키워드"]})
    stale_parser_config = {
        "sheet_name": "Sheet1",
        "header_row": 1,
        "start_col": 1,
        "end_col": 99,
        "end_row": 99,
    }

    file_id = register_file(
        xlsx,
        "stale.xlsx",
        "Excel",
        "항목",
        1,
        parser_config=stale_parser_config,
    )
    chunk_count = index_file(file_id, xlsx, parser_config=stale_parser_config)

    assert chunk_count > 0
    results = search("범위밖키워드")
    assert len(results) == 1
    assert results[0]["location"] == "Sheet1 시트 | 2행 B열"


def test_inspect_and_chunk_recovers_stale_excel_parser_config(tmp_path):
    xlsx = str(tmp_path / "recover.xlsx")
    _make_excel(xlsx, {"항목": ["알파"], "새열": ["복구키워드"]})
    stale_parser_config = {
        "sheet_name": "Sheet1",
        "header_row": 1,
        "start_col": 1,
        "end_col": 99,
        "end_row": 99,
    }

    info, chunks = inspect_and_chunk(xlsx, parser_config=stale_parser_config)

    assert info["parser_config"]["end_col"] == 2
    assert any(chunk["content"] == "복구키워드" for chunk in chunks)


def test_search_no_results_for_missing_term(tmp_path):
    xlsx = str(tmp_path / "empty.xlsx")
    _make_excel(xlsx, {"항목": ["ABC"], "값": ["123"]})

    file_id = register_file(xlsx, "empty.xlsx", "xlsx", "항목", 2)
    index_file(file_id, xlsx)

    results = search("존재하지않는단어XYZ")
    assert results == []


def test_search_matches_korean_substrings_inside_words(tmp_path):
    text_path = tmp_path / "meeting.txt"
    text_path.write_text("주간 회의록 작성 후 공유", encoding="utf-8")

    file_id = register_file(str(text_path), "meeting.txt", "Text", "", 0)
    index_file(file_id, str(text_path))

    results = search("회의")

    assert len(results) == 1
    assert results[0]["file_id"] == file_id
    assert "**회의**" in results[0]["snippet"]


def test_search_matches_hangul_choseong(tmp_path):
    text_path = tmp_path / "meeting.txt"
    text_path.write_text("주간 회의록 작성 후 공유", encoding="utf-8")

    file_id = register_file(str(text_path), "meeting.txt", "Text", "", 0)
    index_file(file_id, str(text_path))

    results = search("ㅎㅇㄹ")

    assert len(results) == 1
    assert results[0]["file_id"] == file_id
    assert "**회의록**" in results[0]["snippet"]


def test_reindex_on_file_change(tmp_path):
    xlsx = str(tmp_path / "change.xlsx")
    _make_excel(xlsx, {"항목": ["원래값"], "값": ["1"]})

    file_id = register_file(xlsx, "change.xlsx", "xlsx", "항목", 1)
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

    file_id = register_file(xlsx, "perf.xlsx", "xlsx", "과제명", 3)

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

    file_id = register_file(xlsx, "search_perf.xlsx", "xlsx", "항목", 2)
    index_file(file_id, xlsx)

    start = time.perf_counter()
    results = search("데이터")
    elapsed = time.perf_counter() - start

    assert elapsed < 0.5, f"검색 {elapsed:.3f}초 — 0.5초 초과"


def test_search_chunks_filters_file_type(tmp_path):
    from backend.database import save_file_chunks

    doc_id = register_file(str(tmp_path / "note.docx"), "note.docx", "Word", "", 0)
    txt_id = register_file(str(tmp_path / "note.txt"), "note.txt", "Text", "", 0)
    save_file_chunks(doc_id, [{"location": "본문", "content": "공통 키워드"}])
    save_file_chunks(txt_id, [{"location": "본문", "content": "공통 키워드"}])

    word_results = search_chunks('"공통"', file_types=["Word"])

    assert {item["file_type"] for item in word_results} == {"Word"}


def test_search_api_filters_filename_and_content(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    doc_id = register_file(str(tmp_path / "alpha.docx"), "alpha.docx", "Word", "", 0)
    txt_id = register_file(str(tmp_path / "alpha.txt"), "alpha.txt", "Text", "", 0)
    save_file_chunks(doc_id, [{"location": "본문", "content": "검색 대상"}])
    save_file_chunks(txt_id, [{"location": "본문", "content": "검색 대상"}])

    response = search_files(SearchRequest(query="alpha", file_types=["txt"]))

    assert response.total == 1
    assert response.results[0].file_type == "Text"


def test_search_api_default_scope_includes_filename_and_content(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    filename_id = register_file(str(tmp_path / "scope-key.docx"), "scope-key.docx", "Word", "", 0)
    content_id = register_file(str(tmp_path / "content.docx"), "content.docx", "Word", "", 0)
    save_file_chunks(filename_id, [{"location": "본문", "content": "다른 내용"}])
    save_file_chunks(content_id, [{"location": "본문", "content": "scope-key 본문"}])

    response = search_files(SearchRequest(query="scope-key"))

    assert response.total == 2
    assert {item.file_id for item in response.results} == {filename_id, content_id}


def test_search_api_filename_scope_excludes_content_only_matches(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    filename_id = register_file(str(tmp_path / "onlyname.docx"), "onlyname.docx", "Word", "", 0)
    content_id = register_file(str(tmp_path / "body.docx"), "body.docx", "Word", "", 0)
    save_file_chunks(filename_id, [{"location": "본문", "content": "다른 내용"}])
    save_file_chunks(content_id, [{"location": "본문", "content": "onlyname 본문"}])

    response = search_files(SearchRequest(query="onlyname", search_scope="filename"))

    assert response.total == 1
    assert response.results[0].file_id == filename_id
    assert response.results[0].location == "파일명"


def test_search_api_content_scope_excludes_filename_only_matches(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    filename_id = register_file(str(tmp_path / "bodyonly.docx"), "bodyonly.docx", "Word", "", 0)
    content_id = register_file(str(tmp_path / "note.docx"), "note.docx", "Word", "", 0)
    save_file_chunks(filename_id, [{"location": "본문", "content": "다른 내용"}])
    save_file_chunks(content_id, [{"location": "본문", "content": "bodyonly 본문"}])

    response = search_files(SearchRequest(query="bodyonly", search_scope="content"))

    assert response.total == 1
    assert response.results[0].file_id == content_id
    assert response.results[0].location == "본문"


def test_search_api_filename_scope_respects_file_type_filter(tmp_path):
    from backend.api.search import search_files
    from backend.models.schemas import SearchRequest

    register_file(str(tmp_path / "scope.docx"), "scope.docx", "Word", "", 0)
    text_id = register_file(str(tmp_path / "scope.txt"), "scope.txt", "Text", "", 0)

    response = search_files(SearchRequest(query="scope", file_types=["txt"], search_scope="filename"))

    assert response.total == 1
    assert response.results[0].file_id == text_id
    assert response.results[0].file_type == "Text"


def test_search_api_content_scope_supports_excel_filter(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks
    from backend.models.schemas import SearchRequest

    excel_id = register_file(str(tmp_path / "sheet.xlsx"), "sheet.xlsx", "Excel", "", 0)
    word_id = register_file(str(tmp_path / "sheet.docx"), "sheet.docx", "Word", "", 0)
    save_file_chunks(excel_id, [{"location": "Sheet1 행 1", "content": "엑셀검색 키워드"}])
    save_file_chunks(word_id, [{"location": "본문", "content": "엑셀검색 키워드"}])

    response = search_files(SearchRequest(query="엑셀검색", file_types=["xlsx"], search_scope="content"))

    assert response.total == 1
    assert response.results[0].file_id == excel_id
    assert response.results[0].file_type == "Excel"


def test_search_api_filters_by_file_modified_date(tmp_path):
    from backend.api.search import search_files
    from backend.database import save_file_chunks, update_file_mtime
    from backend.models.schemas import SearchRequest

    old_id = register_file(str(tmp_path / "old.docx"), "회의_old.docx", "Word", "", 0)
    new_id = register_file(str(tmp_path / "new.docx"), "회의_new.docx", "Word", "", 0)
    save_file_chunks(old_id, [{"location": "본문", "content": "회의 자료"}])
    save_file_chunks(new_id, [{"location": "본문", "content": "회의 자료"}])
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
