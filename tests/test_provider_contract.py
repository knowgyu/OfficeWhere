from pathlib import Path

import pytest

import backend.database as database
from backend.application.provider_service import (
    build_provider_manifest,
    compare_provider_documents,
    get_provider_group_detail,
    list_provider_files,
    list_provider_groups,
    search_provider_documents,
)
from backend.database import init_db, mark_registered_files_missing, register_file, save_file_chunks
from backend.models.schemas import CheckRequest, FileInfo, LibraryGroupDetail, SearchRequest


@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()


def test_provider_manifest_declares_no_sqlite_direct_access():
    manifest = build_provider_manifest("test-version")

    assert manifest.provider == "OfficeWhere"
    assert manifest.contract_version == "v1"
    assert manifest.api_base_path == "/api/provider/v1"
    assert manifest.source_document_policy == "read_only"
    assert manifest.sqlite_access_policy == "forbidden"
    assert "document_search" in manifest.capabilities
    assert all(operation.safety != "state_changing" for operation in manifest.operations)
    assert any(operation.name == "legacy_reindex" for operation in manifest.maintenance_operations)


def test_provider_routes_are_registered():
    from backend.main import app

    paths = {route.path for route in app.routes}

    assert "/api/provider/v1/health" in paths
    assert "/api/provider/v1/manifest" in paths
    assert "/api/provider/v1/search" in paths
    assert "/api/provider/v1/compare" in paths


def test_provider_search_uses_existing_indexed_chunks(tmp_path):
    doc_path = tmp_path / "meeting.docx"
    file_id = register_file(str(doc_path), "meeting.docx", "Word", 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "주간 회의록 작성 후 공유"}])

    response = search_provider_documents(SearchRequest(query="회의", search_scope="content"))

    assert response.total == 1
    assert response.results[0].file_id == file_id
    assert response.results[0].name == "meeting.docx"
    assert "**회의**" in response.results[0].snippet


def test_provider_files_excludes_missing_by_default(tmp_path):
    available_path = tmp_path / "available.docx"
    missing_path = tmp_path / "missing.docx"
    register_file(str(available_path), "available.docx", "Word", 0)
    register_file(str(missing_path), "missing.docx", "Word", 0)
    mark_registered_files_missing([str(missing_path)], reason="test")

    response = list_provider_files()

    assert response.total == 1
    assert [item.name for item in response.items] == ["available.docx"]


def test_provider_group_list_is_cache_only_by_default(monkeypatch):
    captured = {}

    def fake_list_file_groups(**kwargs):
        captured.update(kwargs)
        return {
            "total": 0,
            "groups": [],
            "limit": kwargs["limit"],
            "offset": kwargs["offset"],
            "counts_by_kind": {},
            "derived_index_state": "missing",
            "derived_index_stale": True,
        }

    monkeypatch.setattr("backend.application.provider_service.list_file_groups", fake_list_file_groups)

    response = list_provider_groups()

    assert response["derived_index_state"] == "missing"
    assert captured["cache_only"] is True
    assert captured["allow_refresh"] is False
    assert captured["allow_state_write"] is False


def test_provider_group_detail_is_cache_only_by_default(monkeypatch):
    captured = {}

    def fake_get_file_group_detail(group_id, **kwargs):
        captured["group_id"] = group_id
        captured.update(kwargs)
        return {"id": group_id}

    monkeypatch.setattr("backend.application.provider_service.get_file_group_detail", fake_get_file_group_detail)

    response = get_provider_group_detail("group-1")

    assert response == {"id": "group-1"}
    assert captured["cache_only"] is True
    assert captured["allow_refresh"] is False
    assert captured["allow_state_write"] is False


def test_provider_group_list_does_not_schedule_refresh_on_missing_index(monkeypatch):
    def fail_refresh(**_kwargs):
        raise AssertionError("provider group list must not schedule or run index refresh")

    monkeypatch.setattr("backend.core.library.schedule_group_index_refresh", fail_refresh)
    monkeypatch.setattr("backend.core.library.refresh_group_index_now", fail_refresh)

    response = list_provider_groups()

    assert response.derived_index_state == "missing"
    assert response.derived_index_stale is True


def test_provider_group_detail_does_not_schedule_refresh_on_missing_index(monkeypatch):
    def fail_refresh(**_kwargs):
        raise AssertionError("provider group detail must not schedule or run index refresh")

    monkeypatch.setattr("backend.core.library.schedule_group_index_refresh", fail_refresh)
    monkeypatch.setattr("backend.core.library.refresh_group_index_now", fail_refresh)

    with pytest.raises(FileNotFoundError):
        get_provider_group_detail("missing-group")


def _sample_library_group_detail(group_id: str = "group-1") -> LibraryGroupDetail:
    file_info = FileInfo(
        id=1,
        name="proposal_v1.docx",
        path="/tmp/proposal_v1.docx",
        file_type="Word",
        column_count=0,
    )
    return LibraryGroupDetail(
        id=group_id,
        group_kind="version_family",
        file_type="Word",
        base_name="proposal",
        canonical_name="proposal",
        title="proposal_v1.docx",
        file_count=1,
        confidence="filename_tokens",
        reason="cached group",
        latest_file=file_info,
        previous_file=None,
        tokens_summary=["v1"],
        content_status="pending",
        fingerprint_coverage=0,
        fingerprint_unique_count=0,
        content_evidence="",
        files=[file_info],
    )


def test_provider_group_detail_reads_existing_fingerprints_without_generating(monkeypatch):
    captured = {}

    def fake_get_indexed_library_group(group_id, **kwargs):
        captured["lookup"] = kwargs
        return {"group": _sample_library_group_detail(group_id).model_dump()}

    def fail_ensure_file_fingerprints(_file_ids):
        raise AssertionError("provider group detail must not generate or write fingerprints")

    def fake_get_file_fingerprints(file_ids):
        captured["fingerprint_ids"] = file_ids
        return {}

    monkeypatch.setattr("backend.core.library.get_indexed_library_group", fake_get_indexed_library_group)
    monkeypatch.setattr("backend.core.library.ensure_file_fingerprints", fail_ensure_file_fingerprints)
    monkeypatch.setattr("backend.core.library.get_file_fingerprints", fake_get_file_fingerprints)

    response = get_provider_group_detail("group-1")

    assert response.id == "group-1"
    assert captured["lookup"]["allow_state_write"] is False
    assert captured["fingerprint_ids"] == [1]


def test_provider_group_detail_does_not_mark_invalid_cached_payload(monkeypatch):
    def fake_get_indexed_library_group(_group_id, **_kwargs):
        return {"group": {"id": "bad-group"}}

    def fail_state_write(*_args, **_kwargs):
        raise AssertionError("provider group detail must not mark repair state on passive reads")

    monkeypatch.setattr("backend.core.library.get_indexed_library_group", fake_get_indexed_library_group)
    monkeypatch.setattr("backend.core.library.set_library_group_index_state", fail_state_write)

    with pytest.raises(FileNotFoundError):
        get_provider_group_detail("bad-group")


def test_provider_group_list_does_not_mark_invalid_summary_payload(monkeypatch):
    captured = {}

    def fake_list_library_group_summaries(**kwargs):
        captured.update(kwargs)
        return {
            "total": 1,
            "counts_by_kind": {"version_family": 1},
            "rows": [
                {
                    "group_id": "group-1",
                    "group_kind": "version_family",
                    "file_type": "Word",
                    "base_name": "proposal",
                    "canonical_name": "proposal",
                    "title": "proposal_v1.docx",
                    "file_count": 2,
                    "confidence": "filename_tokens",
                    "reason": "cached group",
                    "latest_file": {"id": "not-an-int"},
                    "previous_file": None,
                    "manual_latest_file_id": None,
                    "tokens_summary": ["v1"],
                    "content_status": "pending",
                    "fingerprint_coverage": 0,
                    "fingerprint_unique_count": 0,
                    "content_evidence": "",
                }
            ],
        }

    def fail_state_write(*_args, **_kwargs):
        raise AssertionError("provider group list must not mark repair state on passive reads")

    monkeypatch.setattr("backend.core.library.list_library_group_summaries", fake_list_library_group_summaries)
    monkeypatch.setattr("backend.core.library.set_library_group_index_state", fail_state_write)

    response = list_provider_groups()

    assert captured["allow_state_write"] is False
    assert response.total == 1
    assert response.groups[0].latest_file is None


def test_database_read_only_group_summary_version_mismatch_does_not_mark_repair(monkeypatch):
    database.set_setting(database.LIBRARY_GROUP_INDEX_VERSION_KEY, "old-version")

    def fail_state_write(*_args, **_kwargs):
        raise AssertionError("read-only group summary query must not write repair state")

    monkeypatch.setattr("backend.database.set_library_group_index_state", fail_state_write)

    response = database.list_library_group_summaries(allow_state_write=False)

    assert response == {"total": 0, "counts_by_kind": {}, "rows": []}


def test_provider_compare_validation_stays_application_level():
    with pytest.raises(ValueError, match="최소 2개"):
        compare_provider_documents(CheckRequest(file_ids=[1]))


def test_provider_contract_document_mentions_sqlite_boundary():
    doc = Path("docs/provider-contract.md").read_text(encoding="utf-8")

    assert "SQLite" in doc
    assert "must not read or write" in doc
    assert "/api/provider/v1/manifest" in doc
    assert "cache-only snapshots" in doc
