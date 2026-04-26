from backend.database import init_db, register_file


def _setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()


def _register(path: str, name: str, file_type: str):
    register_file(
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
    _register("/tmp/a/동일.txt", "동일.txt", "Text")
    _register("/tmp/b/동일.txt", "동일.txt", "Text")

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
