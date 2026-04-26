from backend.api.files import list_files_bounded
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
