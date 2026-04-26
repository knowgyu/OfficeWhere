import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .core.hangul_search import build_search_text, make_search_snippet


def _default_db_dir() -> Path:
    configured = os.environ.get("ODJ_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".officewhere"


DB_DIR = _default_db_dir()
DB_PATH = DB_DIR / "data.db"
FINGERPRINT_VERSION = 1
SEARCH_INDEX_VERSION = "2"


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


def _ensure_file_chunks_columns(cursor: sqlite3.Cursor):
    cursor.execute("PRAGMA table_info(file_chunks)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    if "search_text" not in existing_columns:
        cursor.execute("ALTER TABLE file_chunks ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")


def _refresh_search_text(cursor: sqlite3.Cursor):
    cursor.execute("SELECT id, content FROM file_chunks")
    rows = cursor.fetchall()
    cursor.executemany(
        "UPDATE file_chunks SET search_text = ? WHERE id = ?",
        [(build_search_text(row[1]), row[0]) for row in rows],
    )


def _get_setting_with_cursor(cursor: sqlite3.Cursor, key: str, default: str = "") -> str:
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    return row[0] if row else default


def _set_setting_with_cursor(cursor: sqlite3.Cursor, key: str, value: str):
    cursor.execute(
        """
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
        """,
        (key, value),
    )


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


def _normalize_fingerprint_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def _build_document_fingerprint(
    chunks: Sequence[Dict[str, str]],
    source_mtime: Optional[float] = None,
) -> Dict[str, Any]:
    raw_lines: List[str] = []
    normalized_lines: List[str] = []
    content_chars = 0

    for chunk in chunks:
        location = str(chunk.get("location", ""))
        content = str(chunk.get("content", ""))
        normalized_content = _normalize_fingerprint_text(content)
        normalized_location = _normalize_fingerprint_text(location)
        raw_lines.append(f"{location}\n{content}")
        if normalized_content:
            normalized_lines.append(f"{normalized_location}\t{normalized_content}")
            content_chars += len(normalized_content)

    raw_payload = "\n".join(raw_lines)
    normalized_payload = "\n".join(normalized_lines)
    return {
        "content_hash": hashlib.sha256(raw_payload.encode("utf-8")).hexdigest(),
        "normalized_hash": hashlib.sha256(normalized_payload.encode("utf-8")).hexdigest(),
        "content_chars": content_chars,
        "chunk_count": len(chunks),
        "fingerprint_version": FINGERPRINT_VERSION,
        "source_mtime": source_mtime,
        "fingerprinted_at": datetime.now().isoformat(),
    }


def _upsert_document_fingerprint(
    cursor: sqlite3.Cursor,
    file_id: int,
    chunks: Sequence[Dict[str, str]],
    source_mtime: Optional[float] = None,
):
    fingerprint = _build_document_fingerprint(chunks, source_mtime)
    cursor.execute(
        """
        INSERT INTO document_fingerprints (
            file_id, normalized_hash, content_hash, content_chars, chunk_count,
            fingerprint_version, source_mtime, fingerprinted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
            normalized_hash=excluded.normalized_hash,
            content_hash=excluded.content_hash,
            content_chars=excluded.content_chars,
            chunk_count=excluded.chunk_count,
            fingerprint_version=excluded.fingerprint_version,
            source_mtime=excluded.source_mtime,
            fingerprinted_at=excluded.fingerprinted_at
        """,
        (
            file_id,
            fingerprint["normalized_hash"],
            fingerprint["content_hash"],
            fingerprint["content_chars"],
            fingerprint["chunk_count"],
            fingerprint["fingerprint_version"],
            fingerprint["source_mtime"],
            fingerprint["fingerprinted_at"],
        ),
    )


def _batched_values(values: Sequence[int], size: int = 900):
    for index in range(0, len(values), size):
        yield values[index : index + size]


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
    _ensure_file_chunks_columns(cursor)

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

    cursor.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search_ko USING fts5(
            search_text,
            content='file_chunks',
            content_rowid='id',
            tokenize='unicode61'
        )
        """
    )
    cursor.execute(
        """
        CREATE TRIGGER IF NOT EXISTS chunks_ai_ko AFTER INSERT ON file_chunks BEGIN
            INSERT INTO file_search_ko(rowid, search_text) VALUES (new.id, new.search_text);
        END
        """
    )
    cursor.execute(
        """
        CREATE TRIGGER IF NOT EXISTS chunks_ad_ko AFTER DELETE ON file_chunks BEGIN
            INSERT INTO file_search_ko(file_search_ko, rowid, search_text)
            VALUES ('delete', old.id, old.search_text);
        END
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS document_fingerprints (
            file_id INTEGER PRIMARY KEY,
            normalized_hash TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content_chars INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            fingerprint_version INTEGER NOT NULL,
            source_mtime REAL,
            fingerprinted_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_document_fingerprints_normalized_hash
        ON document_fingerprints(normalized_hash)
        """
    )

    if _get_setting_with_cursor(cursor, "search_index_version") != SEARCH_INDEX_VERSION:
        _refresh_search_text(cursor)
        cursor.execute("INSERT INTO file_search_ko(file_search_ko) VALUES ('rebuild')")
        _set_setting_with_cursor(cursor, "search_index_version", SEARCH_INDEX_VERSION)

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


def _build_file_list_filters(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
) -> Tuple[str, List[Any]]:
    clauses: List[str] = []
    params: List[Any] = []
    normalized_query = query.strip()
    if normalized_query:
        like_query = f"%{normalized_query}%"
        clauses.append("(name LIKE ? OR path LIKE ?)")
        params.extend([like_query, like_query])

    filters = [file_type for file_type in (file_types or []) if file_type]
    if filters:
        placeholders = ",".join("?" for _ in filters)
        clauses.append(f"file_type IN ({placeholders})")
        params.extend(filters)

    if not clauses:
        return "", params
    return f" WHERE {' AND '.join(clauses)}", params


def _file_list_order_by(sort: str) -> str:
    sort_options = {
        "created_at_desc": "created_at DESC, id DESC",
        "created_at_asc": "created_at ASC, id ASC",
        "name_asc": "name COLLATE NOCASE ASC, id DESC",
        "name_desc": "name COLLATE NOCASE DESC, id DESC",
        "file_mtime_desc": "file_mtime DESC, created_at DESC, id DESC",
    }
    return sort_options.get(sort, sort_options["created_at_desc"])


def list_files_page(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "created_at_desc",
) -> List[Dict[str, Any]]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    where_clause, params = _build_file_list_filters(query, file_types)
    cursor.execute(
        f"""
        SELECT *
        FROM registered_files
        {where_clause}
        ORDER BY {_file_list_order_by(sort)}
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    )
    rows = cursor.fetchall()
    conn.close()
    return [_decode_parser_config(dict(row)) for row in rows]


def count_files(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
) -> int:
    conn = _connect()
    cursor = conn.cursor()
    where_clause, params = _build_file_list_filters(query, file_types)
    cursor.execute(f"SELECT COUNT(*) FROM registered_files{where_clause}", params)
    total = int(cursor.fetchone()[0])
    conn.close()
    return total


def count_files_by_type(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
) -> Dict[str, int]:
    conn = _connect()
    cursor = conn.cursor()
    where_clause, params = _build_file_list_filters(query, file_types)
    cursor.execute(
        f"""
        SELECT file_type, COUNT(*) AS count
        FROM registered_files
        {where_clause}
        GROUP BY file_type
        """,
        params,
    )
    counts = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
    conn.close()
    return counts


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
    cursor.execute("DELETE FROM document_fingerprints WHERE file_id=?", (file_id,))
    cursor.execute("DELETE FROM registered_files WHERE id=?", (file_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def save_file_chunks(file_id: int, chunks: List[Dict[str, str]]):
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("SELECT file_mtime FROM registered_files WHERE id = ?", (file_id,))
    row = cursor.fetchone()
    source_mtime = row[0] if row else None
    cursor.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
    cursor.executemany(
        "INSERT INTO file_chunks (file_id, location, content, search_text) VALUES (?, ?, ?, ?)",
        [
            (
                file_id,
                chunk["location"],
                chunk["content"],
                build_search_text(chunk["content"]),
            )
            for chunk in chunks
        ],
    )
    _upsert_document_fingerprint(cursor, file_id, chunks, source_mtime=source_mtime)
    conn.commit()
    conn.close()


def update_file_mtime(file_id: int, mtime: float):
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("UPDATE registered_files SET file_mtime = ? WHERE id = ?", (mtime, file_id))
    cursor.execute("UPDATE document_fingerprints SET source_mtime = ? WHERE file_id = ?", (mtime, file_id))
    conn.commit()
    conn.close()


def get_file_fingerprints(file_ids: Optional[Sequence[int]] = None) -> Dict[int, Dict[str, Any]]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    rows: List[sqlite3.Row] = []
    ids = [int(file_id) for file_id in file_ids] if file_ids is not None else None

    if ids is None:
        cursor.execute("SELECT * FROM document_fingerprints")
        rows = cursor.fetchall()
    elif ids:
        for batch in _batched_values(ids):
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(f"SELECT * FROM document_fingerprints WHERE file_id IN ({placeholders})", batch)
            rows.extend(cursor.fetchall())

    conn.close()
    return {int(row["file_id"]): dict(row) for row in rows}


def ensure_file_fingerprints(file_ids: Sequence[int]) -> Dict[int, Dict[str, Any]]:
    unique_ids = sorted({int(file_id) for file_id in file_ids})
    if not unique_ids:
        return {}

    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    registered: Dict[int, Optional[float]] = {}
    existing: Dict[int, Dict[str, Any]] = {}

    for batch in _batched_values(unique_ids):
        placeholders = ",".join("?" for _ in batch)
        cursor.execute(f"SELECT id, file_mtime FROM registered_files WHERE id IN ({placeholders})", batch)
        registered.update({int(row["id"]): row["file_mtime"] for row in cursor.fetchall()})
        cursor.execute(f"SELECT * FROM document_fingerprints WHERE file_id IN ({placeholders})", batch)
        existing.update({int(row["file_id"]): dict(row) for row in cursor.fetchall()})

    stale_ids: List[int] = []
    for file_id, source_mtime in registered.items():
        current = existing.get(file_id)
        if not current:
            stale_ids.append(file_id)
            continue
        if current.get("fingerprint_version") != FINGERPRINT_VERSION:
            stale_ids.append(file_id)
            continue
        if current.get("source_mtime") != source_mtime:
            stale_ids.append(file_id)

    if stale_ids:
        chunks_by_file: Dict[int, List[Dict[str, str]]] = {file_id: [] for file_id in stale_ids}
        for batch in _batched_values(stale_ids):
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(
                f"""
                SELECT file_id, location, content
                FROM file_chunks
                WHERE file_id IN ({placeholders})
                ORDER BY file_id, id
                """,
                batch,
            )
            for row in cursor.fetchall():
                chunks_by_file[int(row["file_id"])].append(
                    {"location": row["location"], "content": row["content"]}
                )

        for file_id in stale_ids:
            _upsert_document_fingerprint(
                cursor,
                file_id,
                chunks_by_file.get(file_id, []),
                source_mtime=registered.get(file_id),
            )
        conn.commit()

    rows: List[sqlite3.Row] = []
    for batch in _batched_values(unique_ids):
        placeholders = ",".join("?" for _ in batch)
        cursor.execute(f"SELECT * FROM document_fingerprints WHERE file_id IN ({placeholders})", batch)
        rows.extend(cursor.fetchall())

    conn.close()
    return {int(row["file_id"]): dict(row) for row in rows}


def search_chunks(
    fts_query: str,
    limit: int = 100,
    file_types: Optional[Sequence[str]] = None,
    raw_query: Optional[str] = None,
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
        SELECT fc.file_id, rf.name, rf.path, rf.file_type, fc.location, fc.content
        FROM file_search_ko
        JOIN file_chunks fc ON fc.id = file_search_ko.rowid
        JOIN registered_files rf ON rf.id = fc.file_id
        WHERE file_search_ko MATCH ?{type_clause}
        ORDER BY rank
        LIMIT ?
        """,
        params,
    )
    rows = cursor.fetchall()
    conn.close()
    query_for_snippet = raw_query or fts_query
    return [
        {
            **{key: row[key] for key in ("file_id", "name", "path", "file_type", "location")},
            "snippet": make_search_snippet(row["content"], query_for_snippet),
        }
        for row in rows
    ]


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
