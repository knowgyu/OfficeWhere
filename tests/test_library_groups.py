import pytest

from fastapi import HTTPException

from backend.database import init_db, register_file


def _setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()


def _register(path: str, name: str, file_type: str):
    return register_file(
        path=path,
        name=name,
        file_type=file_type,
        key_column="id" if file_type == "Excel" else "",
        column_count=3,
    )


def test_parse_document_identity_extracts_versions_dates_and_status():
    from backend.core.library import canonical_name, parse_document_identity

    parsed = parse_document_identity("보고서_v1.1_260426_수정본.docx")

    assert parsed["base_name"] == "보고서"
    assert canonical_name("보고서_v1.1_260426_수정본.docx") == "보고서"
    assert ("version", "1.1") in {(token["kind"], token["value"]) for token in parsed["tokens"]}
    assert ("date", "2026-04-26") in {(token["kind"], token["value"]) for token in parsed["tokens"]}
    assert ("status", "수정본") in {(token["kind"], token["value"]) for token in parsed["tokens"]}


def test_list_file_groups_separates_exact_name_and_version_family(tmp_path, monkeypatch):
    from backend.core.library import list_file_groups

    _setup_db(tmp_path, monkeypatch)
    _register("/tmp/a/동일.docx", "동일.docx", "Word")
    _register("/tmp/b/동일.docx", "동일.docx", "Word")
    _register("/tmp/a/보고서_v1.0.docx", "보고서_v1.0.docx", "Word")
    _register("/tmp/a/보고서_v1.1.docx", "보고서_v1.1.docx", "Word")
    _register("/tmp/a/보고서_260426.docx", "보고서_260426.docx", "Word")
    _register("/tmp/a/동일.bin", "동일.bin", "Unknown")
    _register("/tmp/b/동일.bin", "동일.bin", "Unknown")

    response = list_file_groups(limit=10)
    kinds = {group.group_kind for group in response.groups}

    assert kinds == {"exact_name_conflict", "version_family"}
    assert response.counts_by_kind == {"exact_name_conflict": 1, "version_family": 1}
    assert all(group.file_type == "Word" for group in response.groups)

    exact = next(group for group in response.groups if group.group_kind == "exact_name_conflict")
    version = next(group for group in response.groups if group.group_kind == "version_family")
    assert exact.file_count == 2
    assert "내용" not in exact.reason or "다름" not in exact.reason
    assert version.file_count == 3
    assert {"v1.0", "v1.1", "2026-04-26"}.issubset(set(version.tokens_summary))


def test_library_groups_response_is_summary_only_and_bounded(tmp_path, monkeypatch):
    from backend.core.library import get_file_group_detail
    from backend.api.library import get_library_groups

    _setup_db(tmp_path, monkeypatch)
    for index in range(4):
        _register(f"/tmp/a/문서{index}.docx", f"문서{index}.docx", "Word")
        _register(f"/tmp/b/문서{index}.docx", f"문서{index}.docx", "Word")

    response = get_library_groups(kind="exact_name_conflict", limit=2, offset=1)

    assert response.total == 4
    assert response.limit == 2
    assert response.offset == 1
    assert len(response.groups) == 2
    assert "files" not in response.groups[0].model_dump()

    detail = get_file_group_detail(response.groups[0].id)
    assert detail is not None
    assert detail.file_count == 2
    assert len(detail.files) == 2


def test_library_groups_type_filter_and_limit_cap(tmp_path, monkeypatch):
    from backend.api.library import get_library_groups

    _setup_db(tmp_path, monkeypatch)
    for index in range(120):
        _register(f"/tmp/a/엑셀{index}_v1.xlsx", f"엑셀{index}_v1.xlsx", "Excel")
        _register(f"/tmp/a/엑셀{index}_v2.xlsx", f"엑셀{index}_v2.xlsx", "Excel")
    _register("/tmp/a/워드_v1.docx", "워드_v1.docx", "Word")
    _register("/tmp/a/워드_v2.docx", "워드_v2.docx", "Word")

    response = get_library_groups(kind="version_family", type="Excel", limit=500)

    assert response.total == 120
    assert response.limit == 100
    assert len(response.groups) == 100
    assert {group.file_type for group in response.groups} == {"Excel"}


def test_library_group_cache_reuses_full_group_build_and_invalidates(tmp_path, monkeypatch):
    from backend.core import library
    from backend.core.library import list_file_groups

    _setup_db(tmp_path, monkeypatch)
    _register("/tmp/a/보고서_v1.docx", "보고서_v1.docx", "Word")
    _register("/tmp/a/보고서_v2.docx", "보고서_v2.docx", "Word")

    calls = 0
    real_get_all_files = library.get_all_files

    def counted_get_all_files():
        nonlocal calls
        calls += 1
        return real_get_all_files()

    monkeypatch.setattr(library, "get_all_files", counted_get_all_files)

    first = list_file_groups(kind="version_family", limit=10)
    second = list_file_groups(kind="version_family", limit=10)

    assert first.total == second.total == 1
    assert calls == 1

    _register("/tmp/a/보고서_v3.docx", "보고서_v3.docx", "Word")
    third = list_file_groups(kind="version_family", limit=10)

    assert third.total == 1
    assert third.groups[0].file_count == 3
    assert calls == 2


def test_library_groups_searches_names_paths_and_sorts(tmp_path, monkeypatch):
    from backend.api.library import get_library_groups

    _setup_db(tmp_path, monkeypatch)
    _register("/tmp/sales/예산_v1.xlsx", "예산_v1.xlsx", "Excel")
    _register("/tmp/sales/예산_v2.xlsx", "예산_v2.xlsx", "Excel")
    _register("/tmp/research/보고서_v1.docx", "보고서_v1.docx", "Word")
    _register("/tmp/research/보고서_v2.docx", "보고서_v2.docx", "Word")
    _register("/tmp/research/보고서_v3.docx", "보고서_v3.docx", "Word")
    _register("/tmp/marketing/홍보_v1.pptx", "홍보_v1.pptx", "PowerPoint")
    _register("/tmp/marketing/홍보_v2.pptx", "홍보_v2.pptx", "PowerPoint")

    response = get_library_groups(q="research", sort="count", limit=10)

    assert response.total == 1
    assert response.groups[0].base_name == "보고서"
    assert response.groups[0].file_count == 3

    response = get_library_groups(sort="name", limit=10)
    assert [group.base_name for group in response.groups] == ["보고서", "예산", "홍보"]


def test_set_group_latest_file_persists_manual_order(tmp_path, monkeypatch):
    from backend.core.library import (
        clear_group_latest_file,
        get_file_group_detail,
        list_file_groups,
        set_group_latest_file,
    )

    _setup_db(tmp_path, monkeypatch)
    v1_id = _register("/tmp/a/보고서_v1.docx", "보고서_v1.docx", "Word")
    v2_id = _register("/tmp/a/보고서_v2.docx", "보고서_v2.docx", "Word")
    v3_id = _register("/tmp/a/보고서_v3.docx", "보고서_v3.docx", "Word")

    group = list_file_groups(kind="version_family", limit=10).groups[0]
    original = get_file_group_detail(group.id)

    assert original is not None
    assert original.latest_file.id == v3_id
    assert [file.id for file in original.files] == [v3_id, v2_id, v1_id]
    assert original.manual_latest_file_id is None

    updated = set_group_latest_file(group.id, v1_id)
    reloaded = get_file_group_detail(group.id)

    assert updated is not None
    assert reloaded is not None
    assert updated.latest_file.id == v1_id
    assert updated.previous_file.id == v3_id
    assert updated.manual_latest_file_id == v1_id
    assert [file.id for file in updated.files] == [v1_id, v3_id, v2_id]
    assert reloaded.latest_file.id == v1_id
    assert reloaded.manual_latest_file_id == v1_id

    cleared = clear_group_latest_file(group.id)

    assert cleared is not None
    assert cleared.latest_file.id == v3_id
    assert cleared.previous_file.id == v2_id
    assert cleared.manual_latest_file_id is None
    assert [file.id for file in cleared.files] == [v3_id, v2_id, v1_id]


def test_set_group_latest_file_rejects_file_outside_group(tmp_path, monkeypatch):
    from backend.core.library import get_file_group_detail, list_file_groups, set_group_latest_file

    _setup_db(tmp_path, monkeypatch)
    v1_id = _register("/tmp/a/보고서_v1.docx", "보고서_v1.docx", "Word")
    v2_id = _register("/tmp/a/보고서_v2.docx", "보고서_v2.docx", "Word")
    other_id = _register("/tmp/a/다른문서_v1.docx", "다른문서_v1.docx", "Word")
    _register("/tmp/a/다른문서_v2.docx", "다른문서_v2.docx", "Word")

    group = next(group for group in list_file_groups(kind="version_family", limit=10).groups if group.base_name == "보고서")

    with pytest.raises(ValueError, match="포함되어 있지 않습니다"):
        set_group_latest_file(group.id, other_id)

    detail = get_file_group_detail(group.id)
    assert detail is not None
    assert detail.manual_latest_file_id is None
    assert {detail.latest_file.id, detail.previous_file.id} == {v1_id, v2_id}


def test_update_library_group_latest_file_api_errors(tmp_path, monkeypatch):
    from backend.api.library import clear_library_group_latest_file, update_library_group_latest_file
    from backend.core.library import list_file_groups
    from backend.models.schemas import LibraryGroupLatestFileRequest

    _setup_db(tmp_path, monkeypatch)
    _register("/tmp/a/보고서_v1.docx", "보고서_v1.docx", "Word")
    _register("/tmp/a/보고서_v2.docx", "보고서_v2.docx", "Word")
    other_id = _register("/tmp/a/다른문서_v1.docx", "다른문서_v1.docx", "Word")
    _register("/tmp/a/다른문서_v2.docx", "다른문서_v2.docx", "Word")
    group = next(group for group in list_file_groups(kind="version_family", limit=10).groups if group.base_name == "보고서")

    with pytest.raises(HTTPException) as missing:
        update_library_group_latest_file("missing-group", LibraryGroupLatestFileRequest(file_id=other_id))
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as missing_clear:
        clear_library_group_latest_file("missing-group")
    assert missing_clear.value.status_code == 404

    with pytest.raises(HTTPException) as invalid:
        update_library_group_latest_file(group.id, LibraryGroupLatestFileRequest(file_id=other_id))
    assert invalid.value.status_code == 400
