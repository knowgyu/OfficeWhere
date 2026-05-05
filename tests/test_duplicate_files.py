from backend import database


def _setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.db")
    database.init_db()


def _save_file(tmp_path, *, name: str, body: str, mtime: float):
    return database.save_indexed_file(
        path=str(tmp_path / f"{int(mtime)}-{name}"),
        name=name,
        file_type="Word",
        column_count=0,
        chunks=[{"location": "문단", "content": body}],
        file_mtime=mtime,
    )


def test_list_duplicate_content_groups_requires_different_file_names(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)
    _save_file(tmp_path, name="계획서.docx", body="같은 본문입니다", mtime=100)
    _save_file(tmp_path, name="계획서_복사본.docx", body="같은 본문입니다", mtime=200)
    _save_file(tmp_path, name="같은이름.docx", body="다른 중복 본문", mtime=300)
    _save_file(tmp_path, name="같은이름.docx", body="다른 중복 본문", mtime=400)

    response = database.list_duplicate_content_groups()

    assert response["total"] == 1
    [group] = response["groups"]
    assert group["file_count"] == 2
    assert group["distinct_name_count"] == 2
    assert {file["name"] for file in group["files"]} == {"계획서.docx", "계획서_복사본.docx"}
    assert all(file["content_chars"] > 0 for file in group["files"])


def test_missing_files_are_hidden_from_search_duplicates_and_version_groups(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)
    available_id = _save_file(tmp_path, name="보고서_v2.docx", body="같은 본문 키워드", mtime=200)
    missing_id = _save_file(tmp_path, name="보고서_v1.docx", body="같은 본문 키워드", mtime=100)

    from backend.core.indexer import search
    from backend.core.library import list_file_groups

    database.mark_registered_files_missing([str(tmp_path / "100-보고서_v1.docx")])

    assert {row["file_id"] for row in search("같은 본문 키워드")} == {available_id}
    assert database.search_file_names("보고서_v1") == []
    assert database.list_duplicate_content_groups()["total"] == 0

    groups = list_file_groups(limit=10)
    assert groups.total == 0
    assert all(missing_id != file.id for group in groups.groups for file in [group.latest_file, group.previous_file] if file)
