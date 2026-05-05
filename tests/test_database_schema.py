import sqlite3
from datetime import datetime, timedelta

from backend.database import get_all_files, init_db, prune_comparison_cache, register_file, save_file_chunks


def test_init_db_resets_legacy_excel_table_metadata_schema(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    source = tmp_path / "source.xlsx"
    source.write_text("source", encoding="utf-8")

    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE registered_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            key_column TEXT NOT NULL,
            column_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            file_mtime REAL,
            parser_config TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO registered_files
            (path, name, file_type, key_column, column_count, created_at, parser_config)
        VALUES (?, 'source.xlsx', 'Excel', 'id', 1, '2026-04-29T00:00:00', '{}')
        """,
        (str(source),),
    )
    conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute("INSERT INTO settings (key, value) VALUES ('library_settings', '{\"watched_folders\": []}')")
    conn.commit()
    conn.close()

    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)

    init_db()

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(registered_files)").fetchall()}
    count = conn.execute("SELECT COUNT(*) FROM registered_files").fetchone()[0]
    settings = dict(conn.execute("SELECT key, value FROM settings").fetchall())
    conn.close()

    assert "key_column" not in columns
    assert "parser_config" not in columns
    assert count == 0
    assert source.exists()
    assert "library_settings" in settings
    assert "last_schema_reset" in settings


def test_init_db_prunes_legacy_xls_records_without_touching_source(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "legacy.xls"
    source.write_text("legacy binary placeholder", encoding="utf-8")
    file_id = register_file(str(source), "legacy.xls", "Excel", 1)
    save_file_chunks(file_id, [{"location": "Sheet1 시트 | 1행 A열", "content": "legacy"}])

    init_db()

    assert get_all_files() == []
    assert source.exists()
    assert source.read_text(encoding="utf-8") == "legacy binary placeholder"


def test_comparison_cache_prune_keeps_newest_floor(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    conn = sqlite3.connect(db_path)
    old_base = datetime.now() - timedelta(days=120)
    for index in range(5):
        conn.execute(
            """
            INSERT INTO comparison_cache (cache_key, file_ids, comparison_mode, result_json, created_at)
            VALUES (?, '[]', 'version_history', ?, ?)
            """,
            (f"cache-{index}", '{"ok": true}', (old_base + timedelta(seconds=index)).isoformat()),
        )
    conn.commit()
    conn.close()

    result = prune_comparison_cache(max_age_days=90, max_bytes=0, min_keep_rows=2)

    conn = sqlite3.connect(db_path)
    remaining = [row[0] for row in conn.execute("SELECT cache_key FROM comparison_cache ORDER BY created_at").fetchall()]
    conn.close()

    assert result["deleted_age"] == 3
    assert remaining == ["cache-3", "cache-4"]


def test_init_db_creates_library_group_index_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)

    init_db()

    conn = sqlite3.connect(db_path)
    tables = {
        row[0]
        for row in conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type='table'
            """
        ).fetchall()
    }
    conn.close()

    assert {
        "library_group_index_files",
        "library_group_index",
        "library_group_members",
        "library_group_dirty_keys",
        "excel_sheet_index",
        "excel_cell_index",
    }.issubset(tables)


def test_init_db_creates_missing_file_lifecycle_columns_and_indexes(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)

    init_db()

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(registered_files)").fetchall()}
    indexes = {
        row[1]
        for row in conn.execute("PRAGMA index_list(registered_files)").fetchall()
    }
    conn.close()

    assert {
        "availability_status",
        "last_seen_at",
        "missing_since",
        "missing_last_checked_at",
        "missing_reason",
    }.issubset(columns)
    assert "idx_registered_files_availability_status" in indexes
    assert "idx_registered_files_missing_since" in indexes
