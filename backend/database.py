import hashlib
import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .core.hangul_search import build_search_text, build_trigram_search_text, make_search_snippet
from .core.index_perf import elapsed_ms, log_index_perf


def _default_db_dir() -> Path:
    configured = os.environ.get("OW_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".officewhere"


DB_DIR = _default_db_dir()
DB_PATH = DB_DIR / "data.db"
FINGERPRINT_VERSION = 1
SEARCH_INDEX_VERSION = "5"
COMPARISON_CACHE_VERSION = 1
_DB_WRITE_LOCK = threading.RLock()
_FTS5_TRIGRAM_SUPPORTED: Optional[bool] = None


@dataclass(frozen=True)
class PreparedIndexedFile:
    """DB-ready index payload prepared outside the SQLite writer lock."""

    path: str
    name: str
    file_type: str
    key_column: str
    column_count: int
    file_mtime: float
    parser_config_json: str
    chunk_values: List[Tuple[str, str, str, str]]
    fingerprint: Dict[str, Any]
    chunk_count: int


@dataclass
class InitialIndexStagingDatabase:
    """Temporary DB used to bulk-build a first index before copying it in."""

    path: Path
    conn: sqlite3.Connection
    file_count: int = 0
    chunk_count: int = 0
    closed: bool = False

    def save_indexed_files_batch(self, payloads: Sequence[PreparedIndexedFile]) -> List[int]:
        file_ids = _save_indexed_files_batch_on_connection(
            self.conn,
            payloads,
            db_target="initial_staging",
            search_trigger_mode="deferred",
        )
        self.file_count += len(payloads)
        self.chunk_count += sum(payload.chunk_count for payload in payloads)
        return file_ids

    def set_setting(self, key: str, value: str) -> None:
        cursor = self.conn.cursor()
        _set_setting_with_cursor(cursor, key, value)
        self.conn.commit()

    def finalize_to_main(self) -> Dict[str, Any]:
        """Build deferred FTS indexes, verify the temp DB, then copy into DB_PATH."""
        if self.closed:
            raise RuntimeError("Initial index staging database is already closed")

        metrics: Dict[str, Any] = {
            "db_target": "initial_staging",
            "temp_db_path": str(self.path),
            "file_count": self.file_count,
            "chunk_count": self.chunk_count,
        }
        cursor = self.conn.cursor()
        finalize_started = perf_counter()
        try:
            search_metrics = _rebuild_search_indexes(cursor, optimize=True)
            metrics.update(search_metrics)
            trigger_started = perf_counter()
            _create_fts_triggers(cursor)
            metrics["create_triggers_ms"] = elapsed_ms(trigger_started)

            quick_check_started = perf_counter()
            cursor.execute("PRAGMA quick_check")
            quick_check = str(cursor.fetchone()[0])
            metrics["quick_check_ms"] = elapsed_ms(quick_check_started)
            metrics["quick_check"] = quick_check
            if quick_check.lower() != "ok":
                raise RuntimeError(f"staging DB quick_check failed: {quick_check}")

            commit_started = perf_counter()
            self.conn.commit()
            metrics["staging_commit_ms"] = elapsed_ms(commit_started)
            metrics["staging_finalize_ms"] = elapsed_ms(finalize_started)
            self.close(remove_files=False)

            backup_started = perf_counter()
            with _DB_WRITE_LOCK:
                source = sqlite3.connect(str(self.path))
                target = _connect()
                try:
                    source.backup(target)
                    target.execute("PRAGMA journal_mode=WAL")
                    target.commit()
                finally:
                    source.close()
                    target.close()
            metrics["backup_to_main_ms"] = elapsed_ms(backup_started)
            metrics["temp_db_bytes"] = self.path.stat().st_size if self.path.exists() else 0
            metrics["total_ms"] = elapsed_ms(finalize_started)
            metrics["success"] = True
            log_index_perf("initial_index_staging_finalized", **metrics)
            _remove_sqlite_sidecar_files(self.path)
            return metrics
        except Exception as exc:
            if not self.closed:
                self.conn.rollback()
            metrics["success"] = False
            metrics["error_type"] = exc.__class__.__name__
            metrics["error"] = str(exc)
            metrics["total_ms"] = elapsed_ms(finalize_started)
            log_index_perf("initial_index_staging_finalized", **metrics)
            self.close(remove_files=True)
            raise

    def close(self, *, remove_files: bool = True) -> None:
        if not self.closed:
            self.conn.close()
            self.closed = True
        if remove_files:
            _remove_sqlite_sidecar_files(self.path)


def configure_database(data_dir: str | os.PathLike[str]):
    global DB_DIR, DB_PATH
    DB_DIR = Path(data_dir).expanduser()
    DB_PATH = DB_DIR / "data.db"


def get_db_path() -> str:
    return str(DB_PATH)


def _connect_path(path: Path, *, bulk_load: bool = False) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    if bulk_load:
        # Safe for rebuildable staging DBs only. If the process/OS dies, the
        # temp DB is discarded and the user's source documents/main DB remain
        # untouched.
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("PRAGMA cache_size=-131072")
    else:
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-32000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA mmap_size=134217728")
    return conn


def _connect() -> sqlite3.Connection:
    return _connect_path(DB_PATH)


def _supports_fts5_trigram() -> bool:
    global _FTS5_TRIGRAM_SUPPORTED
    if _FTS5_TRIGRAM_SUPPORTED is not None:
        return _FTS5_TRIGRAM_SUPPORTED

    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE VIRTUAL TABLE fts5_trigram_probe USING fts5(value, tokenize='trigram')")
        _FTS5_TRIGRAM_SUPPORTED = True
    except sqlite3.Error:
        _FTS5_TRIGRAM_SUPPORTED = False
    finally:
        conn.close()
    return _FTS5_TRIGRAM_SUPPORTED


@contextmanager
def _write_connection():
    """Open a SQLite connection while holding the process-local write lock.

    SQLite permits concurrent readers but only one writer.  Library rescans keep
    Office parsing parallel, then enter this narrow section only while mutating
    the database/FTS tables so worker threads do not race each other into
    `database is locked` failures.
    """
    with _DB_WRITE_LOCK:
        conn = _connect()
        try:
            yield conn
        finally:
            conn.close()


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
    if "trigram_text" not in existing_columns:
        cursor.execute("ALTER TABLE file_chunks ADD COLUMN trigram_text TEXT NOT NULL DEFAULT ''")


def _refresh_search_text(cursor: sqlite3.Cursor):
    cursor.execute("SELECT id, content FROM file_chunks")
    rows = cursor.fetchall()
    cursor.executemany(
        "UPDATE file_chunks SET search_text = ?, trigram_text = ? WHERE id = ?",
        [(build_search_text(row[1]), build_trigram_search_text(row[1]), row[0]) for row in rows],
    )


def _drop_legacy_file_search(cursor: sqlite3.Cursor):
    """Remove the unused base FTS table and its triggers from older DBs."""
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ai")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ad")
    cursor.execute("DROP TABLE IF EXISTS file_search")


def _drop_current_search_indexes(cursor: sqlite3.Cursor):
    """Drop current search FTS tables so schema options can be migrated."""
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ai_ko")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ad_ko")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ai_trigram")
    cursor.execute("DROP TRIGGER IF EXISTS chunks_ad_trigram")
    cursor.execute("DROP TABLE IF EXISTS file_search_ko")
    cursor.execute("DROP TABLE IF EXISTS file_search_trigram")


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


def _chunk_insert_values(chunks: Sequence[Dict[str, str]]) -> List[Tuple[str, str, str, str]]:
    return [
        (
            chunk["location"],
            chunk["content"],
            build_search_text(chunk["content"]),
            build_trigram_search_text(chunk["content"]),
        )
        for chunk in chunks
    ]


def prepare_indexed_file(
    path: str,
    name: str,
    file_type: str,
    key_column: str,
    column_count: int,
    chunks: Sequence[Dict[str, str]],
    file_mtime: float,
    parser_config: Optional[Dict[str, Any]] = None,
) -> PreparedIndexedFile:
    """Build CPU/string-heavy index fields before entering the DB writer."""
    return PreparedIndexedFile(
        path=path,
        name=name,
        file_type=file_type,
        key_column=key_column,
        column_count=column_count,
        file_mtime=file_mtime,
        parser_config_json=json.dumps(parser_config or {}, ensure_ascii=False),
        chunk_values=_chunk_insert_values(chunks),
        fingerprint=_build_document_fingerprint(chunks, source_mtime=file_mtime),
        chunk_count=len(chunks),
    )


def _upsert_document_fingerprint(
    cursor: sqlite3.Cursor,
    file_id: int,
    chunks: Sequence[Dict[str, str]],
    source_mtime: Optional[float] = None,
    fingerprint: Optional[Dict[str, Any]] = None,
):
    fingerprint = fingerprint or _build_document_fingerprint(chunks, source_mtime)
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


def _add_elapsed_metric(metrics: Optional[Dict[str, Any]], key: str, started: float) -> None:
    if metrics is None:
        return
    metrics[key] = round(float(metrics.get(key, 0.0)) + elapsed_ms(started), 3)


def _save_prepared_indexed_file(
    cursor: sqlite3.Cursor,
    payload: PreparedIndexedFile,
    now: str,
    metrics: Optional[Dict[str, Any]] = None,
) -> int:
    try:
        metadata_started = perf_counter()
        cursor.execute(
            """
            INSERT INTO registered_files (
                path, name, file_type, key_column, column_count,
                created_at, file_mtime, parser_config
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.path,
                payload.name,
                payload.file_type,
                payload.key_column,
                payload.column_count,
                now,
                payload.file_mtime,
                payload.parser_config_json,
            ),
        )
        file_id = cursor.lastrowid
        _add_elapsed_metric(metrics, "metadata_insert_ms", metadata_started)
        if metrics is not None:
            metrics["metadata_insert_count"] = int(metrics.get("metadata_insert_count", 0)) + 1
    except sqlite3.IntegrityError:
        metadata_started = perf_counter()
        cursor.execute(
            """
            UPDATE registered_files
            SET name=?, file_type=?, key_column=?, column_count=?,
                created_at=?, file_mtime=?, parser_config=?
            WHERE path=?
            """,
            (
                payload.name,
                payload.file_type,
                payload.key_column,
                payload.column_count,
                now,
                payload.file_mtime,
                payload.parser_config_json,
                payload.path,
            ),
        )
        _add_elapsed_metric(metrics, "metadata_update_ms", metadata_started)
        if metrics is not None:
            metrics["metadata_update_count"] = int(metrics.get("metadata_update_count", 0)) + 1
        metadata_select_started = perf_counter()
        cursor.execute("SELECT id FROM registered_files WHERE path=?", (payload.path,))
        row = cursor.fetchone()
        file_id = row[0] if row else -1
        _add_elapsed_metric(metrics, "metadata_select_ms", metadata_select_started)

    chunk_delete_started = perf_counter()
    cursor.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
    _add_elapsed_metric(metrics, "chunk_delete_ms", chunk_delete_started)
    chunk_insert_started = perf_counter()
    cursor.executemany(
        "INSERT INTO file_chunks (file_id, location, content, search_text, trigram_text) VALUES (?, ?, ?, ?, ?)",
        [
            (file_id, location, content, search_text, trigram_text)
            for location, content, search_text, trigram_text in payload.chunk_values
        ],
    )
    _add_elapsed_metric(metrics, "chunk_insert_ms", chunk_insert_started)
    if metrics is not None:
        metrics["chunk_insert_count"] = int(metrics.get("chunk_insert_count", 0)) + payload.chunk_count
    fingerprint_started = perf_counter()
    _upsert_document_fingerprint(
        cursor,
        file_id,
        [],
        source_mtime=payload.file_mtime,
        fingerprint=payload.fingerprint,
    )
    _add_elapsed_metric(metrics, "fingerprint_upsert_ms", fingerprint_started)
    return file_id


def _batched_values(values: Sequence[int], size: int = 900):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def _remove_sqlite_sidecar_files(path: Path) -> None:
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm"), Path(f"{path}-journal")):
        try:
            candidate.unlink()
        except FileNotFoundError:
            continue


def _create_fts_tables(cursor: sqlite3.Cursor) -> None:
    cursor.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search_ko USING fts5(
            search_text,
            content='file_chunks',
            content_rowid='id',
            tokenize='unicode61',
            columnsize=0
        )
        """
    )
    if _supports_fts5_trigram():
        cursor.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS file_search_trigram USING fts5(
                trigram_text,
                content='file_chunks',
                content_rowid='id',
                tokenize='trigram',
                columnsize=0
            )
            """
        )


def _create_fts_triggers(cursor: sqlite3.Cursor) -> None:
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

    if _supports_fts5_trigram():
        cursor.execute(
            """
            CREATE TRIGGER IF NOT EXISTS chunks_ai_trigram AFTER INSERT ON file_chunks BEGIN
                INSERT INTO file_search_trigram(rowid, trigram_text) VALUES (new.id, new.trigram_text);
            END
            """
        )
        cursor.execute(
            """
            CREATE TRIGGER IF NOT EXISTS chunks_ad_trigram AFTER DELETE ON file_chunks BEGIN
                INSERT INTO file_search_trigram(file_search_trigram, rowid, trigram_text)
                VALUES ('delete', old.id, old.trigram_text);
            END
            """
        )


def _rebuild_search_indexes(cursor: sqlite3.Cursor, *, optimize: bool = True) -> Dict[str, Any]:
    metrics: Dict[str, Any] = {}
    ko_rebuild_started = perf_counter()
    cursor.execute("INSERT INTO file_search_ko(file_search_ko) VALUES ('rebuild')")
    metrics["fts_ko_rebuild_ms"] = elapsed_ms(ko_rebuild_started)
    if optimize:
        ko_optimize_started = perf_counter()
        cursor.execute("INSERT INTO file_search_ko(file_search_ko) VALUES ('optimize')")
        metrics["fts_ko_optimize_ms"] = elapsed_ms(ko_optimize_started)

    if _supports_fts5_trigram():
        trigram_rebuild_started = perf_counter()
        cursor.execute("INSERT INTO file_search_trigram(file_search_trigram) VALUES ('rebuild')")
        metrics["fts_trigram_rebuild_ms"] = elapsed_ms(trigram_rebuild_started)
        if optimize:
            trigram_optimize_started = perf_counter()
            cursor.execute("INSERT INTO file_search_trigram(file_search_trigram) VALUES ('optimize')")
            metrics["fts_trigram_optimize_ms"] = elapsed_ms(trigram_optimize_started)

    _set_setting_with_cursor(cursor, "search_index_version", SEARCH_INDEX_VERSION)
    return metrics


def _create_schema(cursor: sqlite3.Cursor, *, create_search_triggers: bool = True) -> None:
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
        CREATE INDEX IF NOT EXISTS idx_registered_files_created_at
        ON registered_files(created_at DESC, id DESC)
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_registered_files_file_type
        ON registered_files(file_type)
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_registered_files_file_mtime
        ON registered_files(file_mtime DESC)
        """
    )

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
    _drop_legacy_file_search(cursor)

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )

    _create_fts_tables(cursor)
    if create_search_triggers:
        _create_fts_triggers(cursor)

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
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS comparison_cache (
            cache_key TEXT PRIMARY KEY,
            file_ids TEXT NOT NULL,
            comparison_scope TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_comparison_cache_created_at
        ON comparison_cache(created_at DESC)
        """
    )


def init_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with _write_connection() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        cursor = conn.cursor()
        _create_schema(cursor, create_search_triggers=True)

        if _get_setting_with_cursor(cursor, "search_index_version") != SEARCH_INDEX_VERSION:
            _refresh_search_text(cursor)
            _drop_current_search_indexes(cursor)
            _create_fts_tables(cursor)
            _create_fts_triggers(cursor)
            _rebuild_search_indexes(cursor, optimize=True)

        conn.commit()


def begin_initial_index_staging() -> InitialIndexStagingDatabase:
    """Create a rebuildable temp DB for first-run bulk indexing.

    The current app settings are copied in so the finished DB can replace the
    main DB through sqlite backup without losing the watched-folder config that
    triggered the scan.
    """
    DB_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = DB_DIR / f"data.initial-index.{uuid.uuid4().hex}.tmp.db"
    _remove_sqlite_sidecar_files(temp_path)
    conn = _connect_path(temp_path, bulk_load=True)
    cursor = conn.cursor()
    _create_schema(cursor, create_search_triggers=False)

    settings_rows: List[Tuple[str, str]] = []
    if DB_PATH.exists():
        source = _connect()
        try:
            source_cursor = source.cursor()
            source_cursor.execute("SELECT key, value FROM settings")
            settings_rows = [(str(row[0]), str(row[1])) for row in source_cursor.fetchall()]
        except sqlite3.Error:
            settings_rows = []
        finally:
            source.close()
    if settings_rows:
        cursor.executemany(
            """
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            settings_rows,
        )
    conn.commit()
    log_index_perf(
        "initial_index_staging_started",
        db_target="initial_staging",
        temp_db_path=str(temp_path),
        copied_setting_count=len(settings_rows),
    )
    return InitialIndexStagingDatabase(path=temp_path, conn=conn)


def register_file(
    path: str,
    name: str,
    file_type: str,
    key_column: str,
    column_count: int,
    parser_config: Optional[Dict[str, Any]] = None,
) -> int:
    with _write_connection() as conn:
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


def save_indexed_file(
    path: str,
    name: str,
    file_type: str,
    key_column: str,
    column_count: int,
    chunks: List[Dict[str, str]],
    file_mtime: float,
    parser_config: Optional[Dict[str, Any]] = None,
) -> int:
    """Upsert file metadata, chunks, fingerprint, and mtime in one write turn."""
    payload = prepare_indexed_file(
        path=path,
        name=name,
        file_type=file_type,
        key_column=key_column,
        column_count=column_count,
        chunks=chunks,
        file_mtime=file_mtime,
        parser_config=parser_config,
    )
    return save_prepared_indexed_file(payload)


def save_prepared_indexed_file(payload: PreparedIndexedFile) -> int:
    """Save one already-prepared indexed file payload."""
    with _write_connection() as conn:
        try:
            file_id = _save_prepared_indexed_file(conn.cursor(), payload, datetime.now().isoformat())
            conn.commit()
            return file_id
        except Exception:
            conn.rollback()
            raise


def _save_indexed_files_batch_on_connection(
    conn: sqlite3.Connection,
    payloads: Sequence[PreparedIndexedFile],
    *,
    db_target: str,
    search_trigger_mode: str,
) -> List[int]:
    if not payloads:
        return []

    metrics: Dict[str, Any] = {
        "db_target": db_target,
        "search_trigger_mode": search_trigger_mode,
        "batch_file_count": len(payloads),
        "batch_chunk_count": sum(payload.chunk_count for payload in payloads),
        "success": True,
    }
    transaction_started = perf_counter()
    try:
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        file_ids = [_save_prepared_indexed_file(cursor, payload, now, metrics) for payload in payloads]
        commit_started = perf_counter()
        conn.commit()
        metrics["commit_ms"] = elapsed_ms(commit_started)
        metrics["transaction_ms"] = elapsed_ms(transaction_started)
        log_index_perf("db_batch_save_done", **metrics)
        return file_ids
    except Exception as exc:
        rollback_started = perf_counter()
        conn.rollback()
        metrics["rollback_ms"] = elapsed_ms(rollback_started)
        metrics["transaction_ms"] = elapsed_ms(transaction_started)
        metrics["success"] = False
        metrics["error_type"] = exc.__class__.__name__
        metrics["error"] = str(exc)
        log_index_perf("db_batch_save_done", **metrics)
        raise


def save_indexed_files_batch(payloads: Sequence[PreparedIndexedFile]) -> List[int]:
    """Save multiple prepared index payloads in one SQLite transaction."""
    if not payloads:
        return []

    with _write_connection() as conn:
        return _save_indexed_files_batch_on_connection(
            conn,
            payloads,
            db_target="main",
            search_trigger_mode="active",
        )


def get_all_files() -> List[Dict[str, Any]]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [_decode_parser_config(dict(row)) for row in rows]


def get_registered_files_signature() -> str:
    """Return a cheap stable signature for group-cache invalidation."""
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, path, name, file_type, key_column, column_count,
               created_at, file_mtime, parser_config
        FROM registered_files
        ORDER BY id
        """
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    payload = {
        "db_path": str(DB_PATH),
        "count": len(rows),
        "rows": rows,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


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


def search_file_names(
    query: str,
    *,
    limit: int = 50,
    file_types: Optional[Sequence[str]] = None,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
) -> List[Dict[str, Any]]:
    normalized_query = query.strip()
    if not normalized_query:
        return []

    clauses = ["name LIKE ?"]
    params: List[Any] = [f"%{normalized_query}%"]
    filters = [file_type for file_type in (file_types or []) if file_type]
    if filters:
        placeholders = ",".join("?" for _ in filters)
        clauses.append(f"file_type IN ({placeholders})")
        params.extend(filters)
    if modified_from is not None or modified_to is not None:
        clauses.append("file_mtime IS NOT NULL")
    if modified_from is not None:
        clauses.append("file_mtime >= ?")
        params.append(modified_from)
    if modified_to is not None:
        clauses.append("file_mtime <= ?")
        params.append(modified_to)
    params.append(max(1, limit))

    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        f"""
        SELECT *
        FROM registered_files
        WHERE {' AND '.join(clauses)}
        ORDER BY file_mtime DESC, created_at DESC, id DESC
        LIMIT ?
        """,
        params,
    )
    rows = cursor.fetchall()
    conn.close()
    return [_decode_parser_config(dict(row)) for row in rows]


def delete_file(file_id: int) -> bool:
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM file_chunks WHERE file_id=?", (file_id,))
        cursor.execute("DELETE FROM document_fingerprints WHERE file_id=?", (file_id,))
        cursor.execute("DELETE FROM registered_files WHERE id=?", (file_id,))
        affected = cursor.rowcount
        if affected:
            cursor.execute("DELETE FROM comparison_cache")
        conn.commit()
        return affected > 0


def delete_files_by_types(file_types: Sequence[str]) -> int:
    """Remove app-owned registrations/indexes for the given file types."""
    normalized = [str(file_type) for file_type in file_types if str(file_type)]
    if not normalized:
        return 0

    placeholders = ",".join("?" for _ in normalized)
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT id FROM registered_files WHERE file_type IN ({placeholders})", normalized)
        file_ids = [int(row[0]) for row in cursor.fetchall()]
        if not file_ids:
            return 0

        id_placeholders = ",".join("?" for _ in file_ids)
        cursor.execute(f"DELETE FROM file_chunks WHERE file_id IN ({id_placeholders})", file_ids)
        cursor.execute(f"DELETE FROM document_fingerprints WHERE file_id IN ({id_placeholders})", file_ids)
        cursor.execute(f"DELETE FROM registered_files WHERE id IN ({id_placeholders})", file_ids)
        cursor.execute("DELETE FROM comparison_cache")
        conn.commit()
        return len(file_ids)


def delete_all_files() -> int:
    """Remove all app-owned registrations and indexes without touching source files."""
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM registered_files")
        count = int(cursor.fetchone()[0])
        cursor.execute("DELETE FROM file_chunks")
        cursor.execute("DELETE FROM document_fingerprints")
        cursor.execute("DELETE FROM comparison_cache")
        cursor.execute("DELETE FROM registered_files")
        conn.commit()
        return count


def save_file_chunks(file_id: int, chunks: List[Dict[str, str]]):
    chunk_values = _chunk_insert_values(chunks)

    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_mtime FROM registered_files WHERE id = ?", (file_id,))
        row = cursor.fetchone()
        source_mtime = row[0] if row else None
        cursor.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
        cursor.executemany(
            "INSERT INTO file_chunks (file_id, location, content, search_text, trigram_text) VALUES (?, ?, ?, ?, ?)",
            [
                (file_id, location, content, search_text, trigram_text)
                for location, content, search_text, trigram_text in chunk_values
            ],
        )
        _upsert_document_fingerprint(cursor, file_id, chunks, source_mtime=source_mtime)
        conn.commit()


def update_file_mtime(file_id: int, mtime: float):
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE registered_files SET file_mtime = ? WHERE id = ?", (mtime, file_id))
        cursor.execute("UPDATE document_fingerprints SET source_mtime = ? WHERE file_id = ?", (mtime, file_id))
        conn.commit()


def get_cached_comparison_result(cache_key: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("SELECT result_json FROM comparison_cache WHERE cache_key = ?", (cache_key,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    try:
        result = json.loads(row[0])
    except (TypeError, json.JSONDecodeError):
        return None
    return result if isinstance(result, dict) else None


def save_cached_comparison_result(
    cache_key: str,
    file_ids: Sequence[int],
    comparison_scope: str,
    result: Dict[str, Any],
) -> None:
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO comparison_cache (cache_key, file_ids, comparison_scope, result_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                file_ids=excluded.file_ids,
                comparison_scope=excluded.comparison_scope,
                result_json=excluded.result_json,
                created_at=excluded.created_at
            """,
            (
                cache_key,
                json.dumps([int(file_id) for file_id in file_ids], ensure_ascii=False),
                comparison_scope,
                json.dumps(result, ensure_ascii=False),
                datetime.now().isoformat(),
            ),
        )
        conn.commit()


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

        with _DB_WRITE_LOCK:
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


def _search_terms_for_table(raw_query: str) -> List[str]:
    cleaned = re.sub(r'["\*\(\)\[\]\{\}\^~\?\\]', " ", raw_query)
    return [term.strip().lower() for term in cleaned.split() if term.strip()]


def _search_table_for_query(raw_query: str) -> str:
    terms = _search_terms_for_table(raw_query)
    if _supports_fts5_trigram() and terms and all(len(term) >= 3 for term in terms):
        return "file_search_trigram"
    return "file_search_ko"


def _search_row_dicts(rows: Sequence[sqlite3.Row], query_for_snippet: str) -> List[Dict[str, Any]]:
    return [
        {
            **{key: row[key] for key in ("file_id", "name", "path", "file_type", "location")},
            "snippet": make_search_snippet(row["content"], query_for_snippet),
        }
        for row in rows
    ]


def _log_search_done(
    *,
    started: float,
    search_table: str,
    query_text: str,
    filters: Sequence[str],
    modified_from: Optional[float],
    modified_to: Optional[float],
    file_limit: Optional[int],
    per_file_limit: int,
    result: Optional[Sequence[Dict[str, Any]]] = None,
    error: Optional[Exception] = None,
) -> None:
    payload: Dict[str, Any] = {
        "search_table": search_table,
        "raw_query_length": len(query_text),
        "term_count": len(_search_terms_for_table(query_text)),
        "file_limit": file_limit,
        "per_file_limit": per_file_limit,
        "filter_count": len(filters),
        "has_modified_filter": modified_from is not None or modified_to is not None,
        "total_ms": elapsed_ms(started),
    }
    if result is not None:
        payload.update(
            {
                "row_count": len(result),
                "file_count": len({row["file_id"] for row in result}),
            }
        )
    if error is not None:
        payload.update({"success": False, "error_type": error.__class__.__name__})
    log_index_perf("search_done", **payload)


def search_chunks(
    fts_query: str,
    limit: int = 100,
    file_types: Optional[Sequence[str]] = None,
    raw_query: Optional[str] = None,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    file_limit: Optional[int] = None,
    per_file_limit: int = 3,
) -> List[Dict[str, Any]]:
    started = perf_counter()
    query_text = raw_query or fts_query
    search_table = _search_table_for_query(query_text)
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    filters = [file_type for file_type in (file_types or []) if file_type]
    filter_clause = ""
    params: List[Any] = [fts_query]
    if filters:
        placeholders = ",".join("?" for _ in filters)
        filter_clause += f" AND rf.file_type IN ({placeholders})"
        params.extend(filters)
    if modified_from is not None or modified_to is not None:
        filter_clause += " AND rf.file_mtime IS NOT NULL"
    if modified_from is not None:
        filter_clause += " AND rf.file_mtime >= ?"
        params.append(modified_from)
    if modified_to is not None:
        filter_clause += " AND rf.file_mtime <= ?"
        params.append(modified_to)

    try:
        if file_limit is None:
            params.append(limit)
            cursor.execute(
                f"""
                SELECT fc.file_id, rf.name, rf.path, rf.file_type, fc.location, fc.content
                FROM {search_table}
                JOIN file_chunks fc ON fc.id = {search_table}.rowid
                JOIN registered_files rf ON rf.id = fc.file_id
                WHERE {search_table} MATCH ?{filter_clause}
                ORDER BY rf.file_mtime IS NULL,
                         rf.file_mtime DESC,
                         rf.created_at DESC,
                         rf.id DESC,
                         fc.id ASC
                LIMIT ?
                """,
                params,
            )
            rows = cursor.fetchall()
            result = _search_row_dicts(rows, query_text)
            _log_search_done(
                started=started,
                search_table=search_table,
                query_text=query_text,
                filters=filters,
                modified_from=modified_from,
                modified_to=modified_to,
                file_limit=None,
                per_file_limit=per_file_limit,
                result=result,
            )
            return result

        safe_file_limit = max(1, file_limit)
        safe_per_file_limit = max(1, per_file_limit)
        cursor.execute(
            f"""
            WITH matched_files AS (
                SELECT fc.file_id AS file_id,
                       rf.file_mtime AS file_mtime,
                       rf.created_at AS created_at,
                       rf.id AS sort_id
                FROM {search_table}
                JOIN file_chunks fc ON fc.id = {search_table}.rowid
                JOIN registered_files rf ON rf.id = fc.file_id
                WHERE {search_table} MATCH ?{filter_clause}
                GROUP BY fc.file_id, rf.file_mtime, rf.created_at, rf.id
                ORDER BY rf.file_mtime IS NULL,
                         rf.file_mtime DESC,
                         rf.created_at DESC,
                         rf.id DESC
                LIMIT ?
            ),
            ranked_chunks AS (
                SELECT fc.file_id, rf.name, rf.path, rf.file_type, fc.location, fc.content,
                       matched_files.file_mtime AS matched_file_mtime,
                       matched_files.created_at AS matched_created_at,
                       matched_files.sort_id AS matched_sort_id,
                       ROW_NUMBER() OVER (PARTITION BY fc.file_id ORDER BY fc.id ASC) AS chunk_number
                FROM matched_files
                JOIN file_chunks fc ON fc.file_id = matched_files.file_id
                JOIN {search_table} ON {search_table}.rowid = fc.id
                JOIN registered_files rf ON rf.id = fc.file_id
                WHERE {search_table} MATCH ?
            )
            SELECT file_id, name, path, file_type, location, content
            FROM ranked_chunks
            WHERE chunk_number <= ?
            ORDER BY matched_file_mtime IS NULL,
                     matched_file_mtime DESC,
                     matched_created_at DESC,
                     matched_sort_id DESC,
                     chunk_number ASC
            """,
            [*params, safe_file_limit, fts_query, safe_per_file_limit],
        )
        rows = cursor.fetchall()
        result = _search_row_dicts(rows, query_text)
        _log_search_done(
            started=started,
            search_table=search_table,
            query_text=query_text,
            filters=filters,
            modified_from=modified_from,
            modified_to=modified_to,
            file_limit=safe_file_limit,
            per_file_limit=safe_per_file_limit,
            result=result,
        )
        return result
    except Exception as exc:
        _log_search_done(
            started=started,
            search_table=search_table,
            query_text=query_text,
            filters=filters,
            modified_from=modified_from,
            modified_to=modified_to,
            file_limit=file_limit,
            per_file_limit=per_file_limit,
            error=exc,
        )
        raise
    finally:
        conn.close()


def get_setting(key: str, default: str = "") -> str:
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else default


def set_setting(key: str, value: str):
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
        conn.commit()
