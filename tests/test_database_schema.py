import sqlite3
from datetime import datetime, timedelta

from backend.database import init_db, prune_comparison_cache


def test_init_db_resets_legacy_join_metadata_schema(tmp_path, monkeypatch):
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
            INSERT INTO comparison_cache (cache_key, file_ids, comparison_scope, result_json, created_at)
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
