import sqlite3

from backend.database import (
    delete_all_files,
    delete_file,
    get_all_files,
    get_file_fingerprints,
    init_db,
    register_file,
    save_file_chunks,
)


def _setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()


def _register_word(path: str, name: str = "보고서.docx") -> int:
    return register_file(
        path=path,
        name=name,
        file_type="Word",
        key_column="",
        column_count=0,
    )


def test_init_db_creates_document_fingerprint_table_and_index(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)

    conn = sqlite3.connect(tmp_path / "test.db")
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='document_fingerprints'")
    assert cursor.fetchone() == ("document_fingerprints",)
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_document_fingerprints_normalized_hash'"
    )
    assert cursor.fetchone() == ("idx_document_fingerprints_normalized_hash",)
    conn.close()


def test_save_file_chunks_upserts_file_level_fingerprint_and_normalizes_whitespace(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)
    first_id = _register_word(str(tmp_path / "a" / "보고서.docx"))
    second_id = _register_word(str(tmp_path / "b" / "보고서.docx"))

    save_file_chunks(first_id, [{"location": "본문", "content": "Alpha\nBeta"}])
    save_file_chunks(second_id, [{"location": "본문", "content": "Alpha   Beta"}])

    fingerprints = get_file_fingerprints([first_id, second_id])
    assert fingerprints[first_id]["normalized_hash"] == fingerprints[second_id]["normalized_hash"]
    assert fingerprints[first_id]["content_hash"] != fingerprints[second_id]["content_hash"]
    assert fingerprints[first_id]["chunk_count"] == 1
    assert fingerprints[first_id]["content_chars"] == len("Alpha Beta")

    save_file_chunks(second_id, [{"location": "본문", "content": "Alpha Gamma"}])
    updated = get_file_fingerprints([first_id, second_id])
    assert updated[first_id]["normalized_hash"] != updated[second_id]["normalized_hash"]


def test_delete_file_removes_fingerprint(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)
    file_id = _register_word(str(tmp_path / "보고서.docx"))
    save_file_chunks(file_id, [{"location": "본문", "content": "삭제 테스트"}])

    assert file_id in get_file_fingerprints([file_id])
    assert delete_file(file_id) is True
    assert get_file_fingerprints([file_id]) == {}


def test_delete_all_files_removes_registrations_indexes_and_fingerprints(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)
    first_id = _register_word(str(tmp_path / "first.docx"), "first.docx")
    second_id = _register_word(str(tmp_path / "second.docx"), "second.docx")
    save_file_chunks(first_id, [{"location": "본문", "content": "첫 번째"}])
    save_file_chunks(second_id, [{"location": "본문", "content": "두 번째"}])

    deleted = delete_all_files()

    assert deleted == 2
    assert get_all_files() == []
    assert get_file_fingerprints([first_id, second_id]) == {}


def test_group_content_status_uses_fingerprint_evidence(tmp_path, monkeypatch):
    from backend.core.library import list_file_groups

    _setup_db(tmp_path, monkeypatch)
    first_id = _register_word(str(tmp_path / "a" / "동일.docx"), "동일.docx")
    second_id = _register_word(str(tmp_path / "b" / "동일.docx"), "동일.docx")
    save_file_chunks(first_id, [{"location": "본문", "content": "첫 번째 내용"}])
    save_file_chunks(second_id, [{"location": "본문", "content": "두 번째 내용"}])

    response = list_file_groups(kind="exact_name_conflict", limit=10)
    group = response.groups[0]

    assert group.content_status == "content_differs"
    assert group.fingerprint_coverage == 2
    assert group.fingerprint_unique_count == 2
    assert "fingerprint" in group.content_evidence
    assert "내용 fingerprint가 달라" in group.reason


def test_group_fingerprints_backfill_from_existing_chunks(tmp_path, monkeypatch):
    from backend.core.library import list_file_groups

    _setup_db(tmp_path, monkeypatch)
    first_id = _register_word(str(tmp_path / "a" / "복사본.docx"), "복사본.docx")
    second_id = _register_word(str(tmp_path / "b" / "복사본.docx"), "복사본.docx")
    save_file_chunks(first_id, [{"location": "본문", "content": "같은 내용"}])
    save_file_chunks(second_id, [{"location": "본문", "content": "같은   내용"}])

    conn = sqlite3.connect(tmp_path / "test.db")
    conn.execute("DELETE FROM document_fingerprints")
    conn.commit()
    conn.close()

    response = list_file_groups(kind="exact_name_conflict", limit=10)
    group = response.groups[0]

    assert group.content_status == "same_content"
    assert group.fingerprint_coverage == 2
    assert group.fingerprint_unique_count == 1
    assert "같은 내용" in group.reason
    assert set(get_file_fingerprints([first_id, second_id])) == {first_id, second_id}


def test_group_list_backfills_fingerprints_for_visible_page_only(tmp_path, monkeypatch):
    from backend.api.library import get_library_groups

    _setup_db(tmp_path, monkeypatch)
    file_ids: list[int] = []
    for index in range(3):
        first_id = _register_word(str(tmp_path / "a" / f"문서{index}.docx"), f"문서{index}.docx")
        second_id = _register_word(str(tmp_path / "b" / f"문서{index}.docx"), f"문서{index}.docx")
        file_ids.extend([first_id, second_id])
        save_file_chunks(first_id, [{"location": "본문", "content": f"내용 {index} A"}])
        save_file_chunks(second_id, [{"location": "본문", "content": f"내용 {index} B"}])

    conn = sqlite3.connect(tmp_path / "test.db")
    conn.execute("DELETE FROM document_fingerprints")
    conn.commit()
    conn.close()

    response = get_library_groups(kind="exact_name_conflict", limit=1)

    assert response.total == 3
    assert len(response.groups) == 1
    assert len(get_file_fingerprints(file_ids)) == 2


def test_large_group_detail_is_fingerprint_partial_when_detail_is_capped(tmp_path, monkeypatch):
    from backend.core.library import get_file_group_detail, list_file_groups

    _setup_db(tmp_path, monkeypatch)
    for index in range(205):
        file_id = _register_word(
            str(tmp_path / "versions" / f"보고서_v{index}.docx"),
            f"보고서_v{index}.docx",
        )
        save_file_chunks(file_id, [{"location": "본문", "content": "같은 본문"}])

    response = list_file_groups(kind="version_family", limit=1)
    group = response.groups[0]
    detail = get_file_group_detail(group.id)

    assert detail is not None
    assert detail.file_count == 205
    assert len(detail.files) == 200
    assert detail.content_status == "partial"
    assert detail.fingerprint_coverage == 200
    assert "내용 fingerprint 기준으로는 같은 내용" not in detail.reason


def test_group_without_chunks_does_not_claim_content_difference(tmp_path, monkeypatch):
    from backend.core.library import list_file_groups

    _setup_db(tmp_path, monkeypatch)
    _register_word(str(tmp_path / "a" / "미색인.docx"), "미색인.docx")
    _register_word(str(tmp_path / "b" / "미색인.docx"), "미색인.docx")

    response = list_file_groups(kind="exact_name_conflict", limit=10)
    group = response.groups[0]

    assert group.content_status == "not_enough_content"
    assert group.fingerprint_coverage == 0
    assert "내용 fingerprint가 달라" not in group.reason
