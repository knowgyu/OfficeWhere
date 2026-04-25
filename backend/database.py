import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


def _default_db_dir() -> Path:
    configured = os.environ.get("ODJ_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".officewhere"


DB_DIR = _default_db_dir()
DB_PATH = DB_DIR / "data.db"


def configure_database(data_dir: str | os.PathLike[str]):
    global DB_DIR, DB_PATH
    DB_DIR = Path(data_dir).expanduser()
    DB_PATH = DB_DIR / "data.db"


def get_db_path() -> str:
    return str(DB_PATH)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-32000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA mmap_size=134217728")
    return conn


def _ensure_registered_files_columns(cursor: sqlite3.Cursor):
    cursor.execute("PRAGMA table_info(registered_files)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    if "file_mtime" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN file_mtime REAL")
    if "parser_config" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN parser_config TEXT NOT NULL DEFAULT '{}'")


def _decode_parser_config(row: Dict[str, Any]) -> Dict[str, Any]:
    raw_value = row.get("parser_config", "{}")
    if isinstance(raw_value, dict):
        row["parser_config"] = raw_value
        return row
    try:
        row["parser_config"] = json.loads(raw_value or "{}")
    except json.JSONDecodeError:
        row["parser_config"] = {}
    return row


def init_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = _connect()
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS registered_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            key_column TEXT NOT NULL,
            column_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    _ensure_registered_files_columns(cursor)

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS file_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            location TEXT NOT NULL,
            content TEXT NOT NULL
        )
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON file_chunks(file_id)")

    cursor.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(
            content,
            content='file_chunks',
            content_rowid='id',
            tokenize='unicode61'
        )
        """
    )

    cursor.execute(
        """
        CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON file_chunks BEGIN
            INSERT INTO file_search(rowid, content) VALUES (new.id, new.content);
        END
        """
    )
    cursor.execute(
        """
        CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON file_chunks BEGIN
            INSERT INTO file_search(file_search, rowid, content)
            VALUES ('delete', old.id, old.content);
        END
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )

    conn.commit()
    conn.close()


def register_file(
    path: str,
    name: str,
    file_type: str,
    key_column: str,
    column_count: int,
    parser_config: Optional[Dict[str, Any]] = None,
) -> int:
    conn = _connect()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    parser_config_json = json.dumps(parser_config or {}, ensure_ascii=False)

    try:
        cursor.execute(
            """
            INSERT INTO registered_files (
                path, name, file_type, key_column, column_count, created_at, parser_config
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (path, name, file_type, key_column, column_count, now, parser_config_json),
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        cursor.execute(
            """
            UPDATE registered_files
            SET name=?, file_type=?, key_column=?, column_count=?, created_at=?, parser_config=?
            WHERE path=?
            """,
            (name, file_type, key_column, column_count, now, parser_config_json, path),
        )
        conn.commit()
        cursor.execute("SELECT id FROM registered_files WHERE path=?", (path,))
        row = cursor.fetchone()
        return row[0] if row else -1
    finally:
        conn.close()


def get_all_files() -> List[Dict[str, Any]]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [_decode_parser_config(dict(row)) for row in rows]


def get_file_by_id(file_id: int) -> Optional[Dict[str, Any]]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files WHERE id=?", (file_id,))
    row = cursor.fetchone()
    conn.close()
    return _decode_parser_config(dict(row)) if row else None


def delete_file(file_id: int) -> bool:
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM file_chunks WHERE file_id=?", (file_id,))
    cursor.execute("DELETE FROM registered_files WHERE id=?", (file_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def save_file_chunks(file_id: int, chunks: List[Dict[str, str]]):
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
    cursor.executemany(
        "INSERT INTO file_chunks (file_id, location, content) VALUES (?, ?, ?)",
        [(file_id, chunk["location"], chunk["content"]) for chunk in chunks],
    )
    conn.commit()
    conn.close()


def update_file_mtime(file_id: int, mtime: float):
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("UPDATE registered_files SET file_mtime = ? WHERE id = ?", (mtime, file_id))
    conn.commit()
    conn.close()


def search_chunks(
    fts_query: str,
    limit: int = 100,
    file_types: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    filters = [file_type for file_type in (file_types or []) if file_type]
    type_clause = ""
    params: List[Any] = [fts_query]
    if filters:
        placeholders = ",".join("?" for _ in filters)
        type_clause = f" AND rf.file_type IN ({placeholders})"
        params.extend(filters)
    params.append(limit)
    cursor.execute(
        f"""
        SELECT fc.file_id, rf.name, rf.path, rf.file_type, fc.location,
               snippet(file_search, 0, '**', '**', '...', 15) AS snippet
        FROM file_search
        JOIN file_chunks fc ON fc.id = file_search.rowid
        JOIN registered_files rf ON rf.id = fc.file_id
        WHERE file_search MATCH ?{type_clause}
        ORDER BY rank
        LIMIT ?
        """,
        params,
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_setting(key: str, default: str = "") -> str:
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else default


def set_setting(key: str, value: str):
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()
