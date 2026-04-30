import pytest

from fastapi import HTTPException

from backend.api.files import list_files_bounded, remove_all_files, show_registered_file_in_folder
from backend.database import init_db, register_file


def _register_rows(count: int = 12):
    for index in range(count):
        file_type = "Excel" if index % 2 == 0 else "Word"
        suffix = "xlsx" if file_type == "Excel" else "docx"
        register_file(
            path=f"/tmp/project/{file_type.lower()}-{index}.{suffix}",
            name=f"{file_type} report {index}.{suffix}",
            file_type=file_type,
            key_column="id" if file_type == "Excel" else "",
            column_count=3,
        )


def test_files_page_returns_bounded_shape(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    _register_rows(12)

    response = list_files_bounded(limit=5, offset=0)

    assert response.total == 12
    assert response.limit == 5
    assert response.offset == 0
    assert len(response.items) == 5
    assert response.counts_by_type == {"Excel": 6, "Word": 6}


def test_files_page_caps_limit_and_supports_offset(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    _register_rows(150)

    response = list_files_bounded(limit=500, offset=25)

    assert response.total == 150
    assert response.limit == 100
    assert response.offset == 25
    assert len(response.items) == 100


def test_files_page_filters_by_query_and_file_type(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    _register_rows(8)
    register_file(
        path="/tmp/project/finance-special.xlsx",
        name="finance-special.xlsx",
        file_type="Excel",
        key_column="id",
        column_count=4,
    )

    response = list_files_bounded(q="finance", file_types=["Excel"], limit=10)

    assert response.total == 1
    assert response.items[0].name == "finance-special.xlsx"
    assert response.counts_by_type == {"Excel": 1}


def test_remove_all_files_returns_deleted_count(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    _register_rows(3)

    response = remove_all_files()

    assert response["deleted"] == 3
    assert list_files_bounded(limit=10).total == 0


def test_show_in_folder_rejects_unknown_or_missing_path(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    with pytest.raises(HTTPException) as unknown:
        show_registered_file_in_folder(999)
    assert unknown.value.status_code == 404

    file_id = register_file(
        path=str(tmp_path / "missing.docx"),
        name="missing.docx",
        file_type="Word",
        key_column="",
        column_count=1,
    )

    with pytest.raises(HTTPException) as missing:
        show_registered_file_in_folder(file_id)
    assert missing.value.status_code == 404


def test_show_in_folder_uses_platform_reveal_command(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    target = tmp_path / "docs" / "보고서.docx"
    target.parent.mkdir()
    target.write_text("demo", encoding="utf-8")
    file_id = register_file(
        path=str(target),
        name=target.name,
        file_type="Word",
        key_column="",
        column_count=1,
    )
    commands: list[list[str]] = []

    class DummyProcess:
        pass

    monkeypatch.setattr("backend.services.file_location_service.sys.platform", "darwin")
    monkeypatch.setattr(
        "backend.services.file_location_service.subprocess.Popen",
        lambda command: commands.append(command) or DummyProcess(),
    )

    response = show_registered_file_in_folder(file_id)

    assert response["message"] == "폴더 열기 요청을 보냈습니다."
    assert commands == [["open", "-R", str(target)]]


def test_show_in_folder_quotes_windows_select_command(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    target = tmp_path / "My Documents" / "보고서 최종.docx"
    target.parent.mkdir()
    target.write_text("demo", encoding="utf-8")
    file_id = register_file(
        path=str(target),
        name=target.name,
        file_type="Word",
        key_column="",
        column_count=1,
    )
    commands: list[list[str]] = []

    class DummyProcess:
        pass

    monkeypatch.setattr("backend.services.file_location_service.sys.platform", "win32")
    monkeypatch.setattr(
        "backend.services.file_location_service.subprocess.Popen",
        lambda command: commands.append(command) or DummyProcess(),
    )

    response = show_registered_file_in_folder(file_id)

    assert response["message"] == "폴더 열기 요청을 보냈습니다."
    assert commands == [["explorer.exe", f'/select,"{target}"']]
