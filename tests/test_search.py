import os
import time
import tempfile

import pandas as pd
import pytest

from backend.core.indexer import index_file, search, _sanitize_fts_query
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
    assert results[0]["location"] != ""


def test_search_no_results_for_missing_term(tmp_path):
    xlsx = str(tmp_path / "empty.xlsx")
    _make_excel(xlsx, {"항목": ["ABC"], "값": ["123"]})

    file_id = register_file(xlsx, "empty.xlsx", "xlsx", "항목", 2)
    index_file(file_id, xlsx)

    results = search("존재하지않는단어XYZ")
    assert results == []


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
