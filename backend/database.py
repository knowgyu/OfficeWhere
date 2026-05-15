import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .core.hangul_search import build_search_text, build_trigram_search_text, make_search_snippet
from .core.index_perf import elapsed_ms, log_index_perf
from .storage import comparison_artifacts as artifact_storage
from .storage import duplicate_content as duplicate_content_storage
from .storage import library_groups as library_group_storage

logger = logging.getLogger(__name__)


def _default_db_dir() -> Path:
    configured = os.environ.get("OW_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".officewhere"


DB_DIR = _default_db_dir()
DB_PATH = DB_DIR / "data.db"
FINGERPRINT_VERSION = 1
SEARCH_INDEX_VERSION = "6"
COMPARISON_CACHE_VERSION = 3
EXCEL_INDEX_VERSION = "2"
COMPARISON_ARTIFACT_VERSION = "1"
WORD_COMPARISON_ARTIFACT_KIND = "word_ordered_text"
PPT_COMPARISON_ARTIFACT_KIND = "ppt_ordered_text"
WORD_COMPARISON_PARSER_VERSION = "word-blocks-v1"
PPT_COMPARISON_PARSER_VERSION = "ppt-slides-v1"
EXCEL_INDEX_VERSION_KEY = "excel_index_version"
LIBRARY_GROUP_INDEX_VERSION = "2"
LIBRARY_GROUP_INDEX_VERSION_KEY = "library_group_index_version"
LIBRARY_GROUP_INDEX_STATE_KEY = "library_group_index_state"
LIBRARY_GROUP_INDEX_UPDATED_AT_KEY = "library_group_index_updated_at"
LIBRARY_GROUP_INDEX_ERROR_KEY = "library_group_index_error"
COMPARISON_CACHE_MAX_BYTES = 100 * 1024 * 1024
COMPARISON_CACHE_MAX_AGE_DAYS = 90
COMPARISON_CACHE_MIN_KEEP_ROWS = 50
MISSING_FILE_RETENTION_DAYS = 7
_DB_WRITE_LOCK = threading.RLock()
_FTS5_TRIGRAM_SUPPORTED: Optional[bool] = None


@dataclass(frozen=True)
class PreparedIndexedFile:
    """DB-ready index payload prepared outside the SQLite writer lock."""

    path: str
    name: str
    file_type: str
    column_count: int
    file_mtime: float
    chunk_values: List[Tuple[str, str, str, str]]
    fingerprint: Dict[str, Any]
    chunk_count: int
    excel_sheets: List[Dict[str, Any]]
    excel_cells: List[Dict[str, Any]]
    comparison_artifacts: List[Dict[str, Any]]


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


@contextmanager
def _read_connection(*, row_factory: Optional[type] = None):
    """Open a SQLite read connection and always close it on success/failure."""
    conn = _connect()
    if row_factory is not None:
        conn.row_factory = row_factory
    try:
        yield conn
    finally:
        conn.close()


def _registered_files_columns(cursor: sqlite3.Cursor) -> set[str]:
    cursor.execute("PRAGMA table_info(registered_files)")
    return {str(row[1]) for row in cursor.fetchall()}


def _reset_legacy_excel_table_schema_if_needed(cursor: sqlite3.Cursor) -> bool:
    """Drop app-owned index tables when legacy Excel table metadata exists.

    Older app databases may still have registration-time table/range columns.
    SQLite cannot drop columns cheaply, and stale file IDs/cache entries would
    be misleading after the contract change, so the app-owned index tables are
    rebuilt on next launch/rescan. Source Office documents and settings are not
    touched.
    """
    existing_columns = _registered_files_columns(cursor)
    if not existing_columns or not {"key_column", "parser_config"}.intersection(existing_columns):
        return False

    _drop_current_search_indexes(cursor)
    _drop_legacy_file_search(cursor)
    cursor.execute("DROP TABLE IF EXISTS file_chunks")
    cursor.execute("DROP TABLE IF EXISTS document_fingerprints")
    cursor.execute("DROP TABLE IF EXISTS excel_sheet_index")
    cursor.execute("DROP TABLE IF EXISTS excel_cell_index")
    cursor.execute("DROP TABLE IF EXISTS comparison_cache")
    cursor.execute("DROP TABLE IF EXISTS comparison_artifacts")
    cursor.execute("DROP TABLE IF EXISTS registered_files")
    log_index_perf(
        "db_schema_reset",
        reason="remove_legacy_excel_table_metadata",
        legacy_columns=sorted(existing_columns),
    )
    return True


def _ensure_registered_files_columns(cursor: sqlite3.Cursor):
    existing_columns = _registered_files_columns(cursor)

    if "file_mtime" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN file_mtime REAL")
    if "availability_status" not in existing_columns:
        cursor.execute(
            "ALTER TABLE registered_files ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'available'"
        )
    if "last_seen_at" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN last_seen_at TEXT")
    if "missing_since" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN missing_since TEXT")
    if "missing_last_checked_at" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN missing_last_checked_at TEXT")
    if "missing_reason" not in existing_columns:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN missing_reason TEXT")


def _ensure_file_chunks_columns(cursor: sqlite3.Cursor):
    cursor.execute("PRAGMA table_info(file_chunks)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    if "search_text" not in existing_columns:
        cursor.execute("ALTER TABLE file_chunks ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")
    if "trigram_text" not in existing_columns:
        cursor.execute("ALTER TABLE file_chunks ADD COLUMN trigram_text TEXT NOT NULL DEFAULT ''")


def _reset_legacy_comparison_cache_schema_if_needed(cursor: sqlite3.Cursor) -> None:
    """Drop app-owned comparison cache rows when the old cache mode column exists."""
    cursor.execute("PRAGMA table_info(comparison_cache)")
    existing_columns = {str(row[1]) for row in cursor.fetchall()}
    if "comparison_scope" not in existing_columns:
        return

    cursor.execute("DROP TABLE IF EXISTS comparison_cache")
    log_index_perf(
        "db_schema_reset",
        reason="remove_legacy_comparison_scope_cache",
        legacy_columns=sorted(existing_columns),
    )


def _reset_legacy_library_group_action_schema_if_needed(cursor: sqlite3.Cursor) -> None:
    """Drop app-owned derived group tables when an old unused action column exists."""
    cursor.execute("PRAGMA table_info(library_group_index)")
    existing_columns = {str(row[1]) for row in cursor.fetchall()}
    if "recommended_action" not in existing_columns:
        return

    cursor.execute("DROP TABLE IF EXISTS library_group_members")
    cursor.execute("DROP TABLE IF EXISTS library_group_index")
    _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="remove_unused_group_action")
    log_index_perf(
        "db_schema_reset",
        reason="remove_unused_group_action",
        legacy_columns=sorted(existing_columns),
    )


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


def _set_library_group_index_state_with_cursor(
    cursor: sqlite3.Cursor,
    state: str,
    *,
    error: str = "",
    updated_at: Optional[str] = None,
) -> None:
    now = updated_at or datetime.now().isoformat()
    _set_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_VERSION_KEY, LIBRARY_GROUP_INDEX_VERSION)
    _set_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_STATE_KEY, state)
    _set_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_UPDATED_AT_KEY, now)
    _set_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_ERROR_KEY, error)


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


def _normalize_excel_sheet_rows(sheets: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for index, sheet in enumerate(sheets or [], start=1):
        sheet_name = str(sheet.get("sheet_name", "") or "").strip()
        if not sheet_name:
            continue
        normalized.append(
            {
                "sheet_name": sheet_name,
                "sheet_index": int(sheet.get("sheet_index") or index),
                "row_count": int(sheet.get("row_count") or 0),
                "column_count": int(sheet.get("column_count") or 0),
                "non_empty_cell_count": int(sheet.get("non_empty_cell_count") or 0),
                "content_hash": str(sheet.get("content_hash", "") or ""),
            }
        )
    return normalized


def _normalize_excel_cell_rows(cells: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for cell in cells or []:
        sheet_name = str(cell.get("sheet_name", "") or "").strip()
        content = str(cell.get("content", "") or "")
        if not sheet_name or not content.strip():
            continue
        row_number = int(cell.get("row_number") or 0)
        column_index = int(cell.get("column_index") or 0)
        if row_number < 1 or column_index < 1:
            continue
        column_letter = str(cell.get("column_letter", "") or "")
        if not column_letter:
            column_letter = _column_letter_for_index(column_index)
        location = str(cell.get("location", "") or f"{sheet_name} 시트 | {row_number}행 {column_letter}열")
        normalized.append(
            {
                "sheet_name": sheet_name,
                "sheet_index": int(cell.get("sheet_index") or 1),
                "row_number": row_number,
                "column_index": column_index,
                "column_letter": column_letter,
                "content": content,
                "location": location,
            }
        )
    return normalized


def _normalize_comparison_artifacts(artifacts: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    return artifact_storage.normalize_comparison_artifacts(
        artifacts,
        default_artifact_version=COMPARISON_ARTIFACT_VERSION,
    )


def _column_letter_for_index(index: int) -> str:
    if index < 1:
        return ""
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def prepare_indexed_file(
    path: str,
    name: str,
    file_type: str,
    column_count: int,
    chunks: Sequence[Dict[str, str]],
    file_mtime: float,
    excel_sheets: Optional[Sequence[Dict[str, Any]]] = None,
    excel_cells: Optional[Sequence[Dict[str, Any]]] = None,
    comparison_artifacts: Optional[Sequence[Dict[str, Any]]] = None,
) -> PreparedIndexedFile:
    """Build CPU/string-heavy index fields before entering the DB writer."""
    return PreparedIndexedFile(
        path=path,
        name=name,
        file_type=file_type,
        column_count=column_count,
        file_mtime=file_mtime,
        chunk_values=_chunk_insert_values(chunks),
        fingerprint=_build_document_fingerprint(chunks, source_mtime=file_mtime),
        chunk_count=len(chunks),
        excel_sheets=_normalize_excel_sheet_rows(excel_sheets),
        excel_cells=_normalize_excel_cell_rows(excel_cells),
        comparison_artifacts=_normalize_comparison_artifacts(comparison_artifacts),
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


def _replace_excel_index(
    cursor: sqlite3.Cursor,
    file_id: int,
    sheets: Sequence[Dict[str, Any]],
    cells: Sequence[Dict[str, Any]],
    *,
    updated_at: str,
) -> None:
    """Replace machine-readable Excel sheet/cell rows for one indexed file."""
    cursor.execute("DELETE FROM excel_cell_index WHERE file_id = ?", (file_id,))
    cursor.execute("DELETE FROM excel_sheet_index WHERE file_id = ?", (file_id,))
    if sheets:
        cursor.executemany(
            """
            INSERT INTO excel_sheet_index (
                file_id, sheet_name, sheet_index, row_count, column_count,
                non_empty_cell_count, content_hash, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    file_id,
                    sheet["sheet_name"],
                    int(sheet["sheet_index"]),
                    int(sheet["row_count"]),
                    int(sheet["column_count"]),
                    int(sheet["non_empty_cell_count"]),
                    str(sheet["content_hash"]),
                    updated_at,
                )
                for sheet in sheets
            ],
        )
    if cells:
        cursor.executemany(
            """
            INSERT INTO excel_cell_index (
                file_id, sheet_name, sheet_index, row_number, column_index,
                column_letter, content, location
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    file_id,
                    cell["sheet_name"],
                    int(cell["sheet_index"]),
                    int(cell["row_number"]),
                    int(cell["column_index"]),
                    str(cell["column_letter"]),
                    str(cell["content"]),
                    str(cell["location"]),
                )
                for cell in cells
            ],
        )


def _artifact_payload_bytes(payload: Dict[str, Any]) -> Tuple[bytes, bytes]:
    return artifact_storage.artifact_payload_bytes(payload)


def _replace_comparison_artifacts(
    cursor: sqlite3.Cursor,
    file_id: int,
    artifacts: Sequence[Dict[str, Any]],
    *,
    source_mtime: Optional[float],
    updated_at: str,
) -> None:
    artifact_storage.replace_comparison_artifacts(
        cursor,
        file_id,
        artifacts,
        default_artifact_version=COMPARISON_ARTIFACT_VERSION,
        source_mtime=source_mtime,
        updated_at=updated_at,
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
                path, name, file_type, column_count,
                created_at, file_mtime, availability_status,
                last_seen_at, missing_since, missing_last_checked_at, missing_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, 'available', ?, NULL, NULL, NULL)
            """,
            (
                payload.path,
                payload.name,
                payload.file_type,
                payload.column_count,
                now,
                payload.file_mtime,
                now,
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
            SET name=?, file_type=?, column_count=?,
                created_at=?, file_mtime=?,
                availability_status='available',
                last_seen_at=?,
                missing_since=NULL,
                missing_last_checked_at=NULL,
                missing_reason=NULL
            WHERE path=?
            """,
            (
                payload.name,
                payload.file_type,
                payload.column_count,
                now,
                payload.file_mtime,
                now,
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
    excel_index_started = perf_counter()
    if payload.file_type == "Excel":
        _replace_excel_index(cursor, file_id, payload.excel_sheets, payload.excel_cells, updated_at=now)
    else:
        _replace_excel_index(cursor, file_id, [], [], updated_at=now)
    _add_elapsed_metric(metrics, "excel_index_replace_ms", excel_index_started)
    artifact_started = perf_counter()
    _replace_comparison_artifacts(
        cursor,
        file_id,
        payload.comparison_artifacts,
        source_mtime=payload.file_mtime,
        updated_at=now,
    )
    _add_elapsed_metric(metrics, "comparison_artifact_replace_ms", artifact_started)
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
            column_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            file_mtime REAL,
            availability_status TEXT NOT NULL DEFAULT 'available',
            last_seen_at TEXT,
            missing_since TEXT,
            missing_last_checked_at TEXT,
            missing_reason TEXT
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
        CREATE INDEX IF NOT EXISTS idx_registered_files_availability_status
        ON registered_files(availability_status)
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_registered_files_missing_since
        ON registered_files(missing_since)
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
        CREATE INDEX IF NOT EXISTS idx_document_fingerprints_duplicate_candidates
        ON document_fingerprints(normalized_hash, content_chars, chunk_count)
        WHERE normalized_hash <> ''
          AND content_chars > 0
          AND chunk_count > 0
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS excel_sheet_index (
            file_id INTEGER NOT NULL,
            sheet_name TEXT NOT NULL,
            sheet_index INTEGER NOT NULL,
            row_count INTEGER NOT NULL,
            column_count INTEGER NOT NULL,
            non_empty_cell_count INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (file_id, sheet_name)
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_excel_sheet_index_file
        ON excel_sheet_index(file_id, sheet_index)
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS excel_cell_index (
            file_id INTEGER NOT NULL,
            sheet_name TEXT NOT NULL,
            sheet_index INTEGER NOT NULL,
            row_number INTEGER NOT NULL,
            column_index INTEGER NOT NULL,
            column_letter TEXT NOT NULL,
            content TEXT NOT NULL,
            location TEXT NOT NULL,
            PRIMARY KEY (file_id, sheet_name, row_number, column_index)
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_excel_cell_index_file
        ON excel_cell_index(file_id, sheet_index, row_number, column_index)
        """
    )
    _reset_legacy_comparison_cache_schema_if_needed(cursor)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS comparison_cache (
            cache_key TEXT PRIMARY KEY,
            file_ids TEXT NOT NULL,
            comparison_mode TEXT NOT NULL,
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

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS comparison_artifacts (
            file_id INTEGER NOT NULL,
            artifact_kind TEXT NOT NULL,
            file_type TEXT NOT NULL,
            artifact_version TEXT NOT NULL,
            parser_version TEXT NOT NULL,
            source_mtime REAL,
            payload_compressed BLOB NOT NULL,
            raw_size_bytes INTEGER NOT NULL,
            compressed_size_bytes INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (file_id, artifact_kind)
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_comparison_artifacts_kind
        ON comparison_artifacts(artifact_kind, file_type)
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS library_group_index_files (
            file_id INTEGER PRIMARY KEY,
            file_type TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            exact_key TEXT NOT NULL,
            version_key TEXT,
            file_json TEXT NOT NULL,
            file_signature TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_group_index_files_exact
        ON library_group_index_files(file_type, exact_key)
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_group_index_files_version
        ON library_group_index_files(file_type, version_key)
        """
    )

    _reset_legacy_library_group_action_schema_if_needed(cursor)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS library_group_index (
            group_id TEXT PRIMARY KEY,
            group_kind TEXT NOT NULL,
            file_type TEXT NOT NULL,
            base_name TEXT NOT NULL,
            canonical_name TEXT NOT NULL,
            title TEXT NOT NULL,
            confidence TEXT NOT NULL,
            reason TEXT NOT NULL,
            file_count INTEGER NOT NULL,
            latest_file_id INTEGER,
            previous_file_id INTEGER,
            manual_latest_file_id INTEGER,
            tokens_summary_json TEXT NOT NULL,
            content_status TEXT NOT NULL,
            fingerprint_coverage INTEGER NOT NULL,
            fingerprint_unique_count INTEGER NOT NULL,
            content_evidence TEXT NOT NULL,
            group_json TEXT NOT NULL,
            index_version TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_group_index_lookup
        ON library_group_index(group_kind, file_type, base_name)
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_group_index_recent
        ON library_group_index(updated_at DESC)
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS library_group_members (
            group_id TEXT NOT NULL,
            file_id INTEGER NOT NULL,
            rank INTEGER NOT NULL,
            PRIMARY KEY (group_id, file_id)
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_group_members_file
        ON library_group_members(file_id)
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS library_group_dirty_keys (
            group_kind TEXT NOT NULL,
            file_type TEXT NOT NULL,
            base_name TEXT NOT NULL,
            marked_at TEXT NOT NULL,
            PRIMARY KEY (group_kind, file_type, base_name)
        )
        """
    )


def _ensure_excel_index_version(cursor: sqlite3.Cursor) -> None:
    current = _get_setting_with_cursor(cursor, EXCEL_INDEX_VERSION_KEY, "")
    if current == EXCEL_INDEX_VERSION:
        return

    cursor.execute("SELECT COUNT(*) FROM registered_files WHERE file_type = 'Excel'")
    excel_file_count = int(cursor.fetchone()[0])
    if excel_file_count <= 0:
        _set_setting_with_cursor(cursor, EXCEL_INDEX_VERSION_KEY, EXCEL_INDEX_VERSION)
        return

    cursor.execute("DELETE FROM excel_cell_index")
    cursor.execute("DELETE FROM excel_sheet_index")
    cursor.execute(
        """
        DELETE FROM file_chunks
        WHERE file_id IN (SELECT id FROM registered_files WHERE file_type = 'Excel')
        """
    )
    cursor.execute(
        """
        DELETE FROM document_fingerprints
        WHERE file_id IN (SELECT id FROM registered_files WHERE file_type = 'Excel')
        """
    )
    cursor.execute("UPDATE registered_files SET file_mtime = NULL WHERE file_type = 'Excel'")
    cursor.execute("DELETE FROM comparison_cache")
    _set_setting_with_cursor(cursor, EXCEL_INDEX_VERSION_KEY, EXCEL_INDEX_VERSION)
    _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="excel_index_version_changed")
    log_index_perf(
        "db_excel_index_reset",
        previous_version=current,
        next_version=EXCEL_INDEX_VERSION,
        excel_file_count=excel_file_count,
    )


def _prune_unsupported_file_extensions(cursor: sqlite3.Cursor) -> int:
    """Remove app-owned records for formats no longer supported; never touches source files."""
    cursor.execute("SELECT id FROM registered_files WHERE lower(path) LIKE '%.xls'")
    file_ids = [int(row[0]) for row in cursor.fetchall()]
    pruned = _delete_registered_file_ids_with_cursor(
        cursor,
        file_ids,
        repair_reason="remove_unsupported_file_extensions",
    )
    if pruned:
        log_index_perf(
            "unsupported_records_pruned",
            operation="db_init",
            reason="remove_xls_support",
            file_count=pruned,
        )
    return pruned


def init_db():
    init_started = perf_counter()
    metrics: Dict[str, Any] = {"db_path": str(DB_PATH)}
    log_index_perf("db_init_start", **metrics)
    try:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        with _write_connection() as conn:
            journal_started = perf_counter()
            conn.execute("PRAGMA journal_mode=WAL")
            metrics["journal_mode_ms"] = elapsed_ms(journal_started)
            cursor = conn.cursor()

            schema_started = perf_counter()
            legacy_reset = _reset_legacy_excel_table_schema_if_needed(cursor)
            _create_schema(cursor, create_search_triggers=True)
            metrics["schema_ms"] = elapsed_ms(schema_started)
            metrics["legacy_reset"] = legacy_reset
            if legacy_reset:
                _set_setting_with_cursor(
                    cursor,
                    "last_schema_reset",
                    json.dumps(
                        {
                            "at": datetime.now().isoformat(),
                            "reason": "remove_legacy_excel_table_metadata",
                        },
                        ensure_ascii=False,
                    ),
                )

            prune_started = perf_counter()
            metrics["unsupported_pruned"] = _prune_unsupported_file_extensions(cursor)
            metrics["unsupported_prune_ms"] = elapsed_ms(prune_started)

            search_index_version = _get_setting_with_cursor(cursor, "search_index_version")
            metrics["previous_search_index_version"] = search_index_version
            if search_index_version != SEARCH_INDEX_VERSION:
                search_started = perf_counter()
                _refresh_search_text(cursor)
                _drop_current_search_indexes(cursor)
                _create_fts_tables(cursor)
                _create_fts_triggers(cursor)
                metrics.update(_rebuild_search_indexes(cursor, optimize=True))
                metrics["search_rebuild_ms"] = elapsed_ms(search_started)

            excel_started = perf_counter()
            _ensure_excel_index_version(cursor)
            metrics["excel_index_check_ms"] = elapsed_ms(excel_started)

            commit_started = perf_counter()
            conn.commit()
            metrics["commit_ms"] = elapsed_ms(commit_started)
        metrics["success"] = True
        metrics["total_ms"] = elapsed_ms(init_started)
        log_index_perf("db_init_done", **metrics)
    except Exception as exc:
        metrics["success"] = False
        metrics["error_type"] = exc.__class__.__name__
        metrics["error"] = str(exc)
        metrics["total_ms"] = elapsed_ms(init_started)
        log_index_perf("db_init_done", **metrics)
        raise


def get_library_group_index_status() -> Dict[str, str]:
    with _read_connection() as conn:
        cursor = conn.cursor()
        status = {
            "version": _get_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_VERSION_KEY, ""),
            "state": _get_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_STATE_KEY, "missing"),
            "updated_at": _get_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_UPDATED_AT_KEY, ""),
            "error": _get_setting_with_cursor(cursor, LIBRARY_GROUP_INDEX_ERROR_KEY, ""),
        }
    if status["version"] and status["version"] != LIBRARY_GROUP_INDEX_VERSION:
        status["state"] = "repair_needed"
        status["error"] = "derived index version mismatch"
    return status


def set_library_group_index_state(state: str, *, error: str = "") -> Dict[str, str]:
    with _write_connection() as conn:
        cursor = conn.cursor()
        _set_library_group_index_state_with_cursor(cursor, state, error=error)
        conn.commit()
    return get_library_group_index_status()


def mark_library_group_keys_dirty(keys: Sequence[Tuple[str, str, str]]) -> int:
    unique_keys = sorted({(str(kind), str(file_type), str(base_name)) for kind, file_type, base_name in keys})
    if not unique_keys:
        return 0

    now = datetime.now().isoformat()
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.executemany(
            """
            INSERT INTO library_group_dirty_keys (group_kind, file_type, base_name, marked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(group_kind, file_type, base_name) DO UPDATE SET
                marked_at=excluded.marked_at
            """,
            [(kind, file_type, base_name, now) for kind, file_type, base_name in unique_keys],
        )
        _set_library_group_index_state_with_cursor(cursor, "stale", updated_at=now)
        conn.commit()
    return len(unique_keys)


def list_library_group_dirty_keys() -> List[Tuple[str, str, str]]:
    with _read_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT group_kind, file_type, base_name
            FROM library_group_dirty_keys
            ORDER BY marked_at ASC
            """
        )
        rows = [(str(row[0]), str(row[1]), str(row[2])) for row in cursor.fetchall()]
    return rows


def clear_library_group_dirty_keys(keys: Optional[Sequence[Tuple[str, str, str]]] = None) -> None:
    with _write_connection() as conn:
        cursor = conn.cursor()
        if keys is None:
            cursor.execute("DELETE FROM library_group_dirty_keys")
        else:
            for kind, file_type, base_name in sorted({(str(k), str(t), str(b)) for k, t, b in keys}):
                cursor.execute(
                    """
                    DELETE FROM library_group_dirty_keys
                    WHERE group_kind=? AND file_type=? AND base_name=?
                    """,
                    (kind, file_type, base_name),
                )
        conn.commit()


def upsert_library_group_index_files(rows: Sequence[Dict[str, Any]]) -> None:
    if not rows:
        return
    now = datetime.now().isoformat()
    with _write_connection() as conn:
        cursor = conn.cursor()
        library_group_storage.upsert_library_group_index_files(cursor, rows, updated_at=now)
        conn.commit()


def delete_library_group_index_files(file_ids: Sequence[int]) -> None:
    ids = sorted({int(file_id) for file_id in file_ids if int(file_id) > 0})
    if not ids:
        return
    with _write_connection() as conn:
        cursor = conn.cursor()
        for batch in _batched_values(ids):
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(f"DELETE FROM library_group_index_files WHERE file_id IN ({placeholders})", batch)
            cursor.execute(f"DELETE FROM library_group_members WHERE file_id IN ({placeholders})", batch)
        conn.commit()


def get_library_group_index_file(file_id: int) -> Optional[Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM library_group_index_files WHERE file_id=?", (int(file_id),))
        row = cursor.fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["file"] = json.loads(data["file_json"])
    except (TypeError, json.JSONDecodeError) as exc:
        logger.warning(
            "library group file fact JSON is corrupt",
            extra={"file_id": int(file_id), "error": str(exc)},
        )
        set_library_group_index_state("repair_needed", error="corrupt file fact JSON")
        return None
    return data


def list_library_group_index_files_for_key(group_kind: str, file_type: str, base_name: str) -> List[Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        if group_kind == "exact_name_conflict":
            cursor.execute(
                """
                SELECT * FROM library_group_index_files
                WHERE file_type=? AND exact_key=?
                ORDER BY name COLLATE NOCASE ASC, file_id ASC
                """,
                (file_type, base_name),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM library_group_index_files
                WHERE file_type=? AND version_key=?
                ORDER BY name COLLATE NOCASE ASC, file_id ASC
                """,
                (file_type, base_name),
            )
        rows = [dict(row) for row in cursor.fetchall()]

    parsed: List[Dict[str, Any]] = []
    for row in rows:
        try:
            row["file"] = json.loads(row["file_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            logger.warning(
                "library group file fact JSON is corrupt",
                extra={"group_kind": group_kind, "file_type": file_type, "base_name": base_name, "error": str(exc)},
            )
            set_library_group_index_state("repair_needed", error="corrupt file fact JSON")
            return []
        parsed.append(row)
    return parsed


def list_library_group_index_file_ids() -> List[int]:
    with _read_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id FROM library_group_index_files")
        ids = [int(row[0]) for row in cursor.fetchall()]
    return ids


def replace_library_group_index_full(
    file_rows: Sequence[Dict[str, Any]],
    group_rows: Sequence[Dict[str, Any]],
    *,
    index_version: str = LIBRARY_GROUP_INDEX_VERSION,
) -> None:
    now = datetime.now().isoformat()
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM library_group_members")
        cursor.execute("DELETE FROM library_group_index")
        cursor.execute("DELETE FROM library_group_index_files")
        cursor.execute("DELETE FROM library_group_dirty_keys")
        library_group_storage.upsert_library_group_index_files(cursor, file_rows, updated_at=now)
        library_group_storage.insert_group_index_rows(cursor, group_rows, index_version=index_version, updated_at=now)
        _set_library_group_index_state_with_cursor(cursor, "ready", updated_at=now)
        conn.commit()


def replace_library_group_index_for_keys(
    keys: Sequence[Tuple[str, str, str]],
    group_rows: Sequence[Dict[str, Any]],
    *,
    index_version: str = LIBRARY_GROUP_INDEX_VERSION,
) -> None:
    if not keys:
        return
    now = datetime.now().isoformat()
    with _write_connection() as conn:
        cursor = conn.cursor()
        library_group_storage.delete_group_index_rows_for_keys(cursor, keys)
        library_group_storage.insert_group_index_rows(cursor, group_rows, index_version=index_version, updated_at=now)
        for group_kind, file_type, base_name in sorted({(str(k), str(t), str(b)) for k, t, b in keys}):
            cursor.execute(
                """
                DELETE FROM library_group_dirty_keys
                WHERE group_kind=? AND file_type=? AND base_name=?
                """,
                (group_kind, file_type, base_name),
            )
        _set_library_group_index_state_with_cursor(cursor, "ready", updated_at=now)
        conn.commit()


def clear_library_group_index(*, state: str = "ready", error: str = "") -> None:
    now = datetime.now().isoformat()
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM library_group_members")
        cursor.execute("DELETE FROM library_group_index")
        cursor.execute("DELETE FROM library_group_index_files")
        cursor.execute("DELETE FROM library_group_dirty_keys")
        _set_library_group_index_state_with_cursor(cursor, state, error=error, updated_at=now)
        conn.commit()


def list_indexed_library_groups(*, allow_state_write: bool = True) -> List[Dict[str, Any]]:
    status = get_library_group_index_status()
    if status.get("version") and status.get("version") != LIBRARY_GROUP_INDEX_VERSION:
        if allow_state_write:
            set_library_group_index_state("repair_needed", error="derived index version mismatch")
        return []

    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT *
            FROM library_group_index
            WHERE index_version=?
            ORDER BY updated_at DESC
            """,
            (LIBRARY_GROUP_INDEX_VERSION,),
        )
        rows = [dict(row) for row in cursor.fetchall()]
    for row in rows:
        try:
            row["group"] = json.loads(row["group_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            logger.warning("library group JSON is corrupt", extra={"group_id": row.get("group_id"), "error": str(exc)})
            if allow_state_write:
                set_library_group_index_state("repair_needed", error="corrupt group JSON")
            return []
    return rows


def list_library_group_summaries(
    *,
    kind: Optional[str] = None,
    file_type: Optional[str] = None,
    query: Optional[str] = None,
    sort: str = "recent",
    limit: int = 50,
    offset: int = 0,
    include_duplicate_content: bool = False,
    allow_state_write: bool = True,
) -> Dict[str, Any]:
    status = get_library_group_index_status()
    if status.get("version") and status.get("version") != LIBRARY_GROUP_INDEX_VERSION:
        if allow_state_write:
            set_library_group_index_state("repair_needed", error="derived index version mismatch")
        return {"total": 0, "counts_by_kind": {}, "rows": []}

    safe_limit = max(0, min(int(limit), 500))
    safe_offset = max(0, int(offset))
    where_sql, params = library_group_storage.summary_filters(
        index_version=LIBRARY_GROUP_INDEX_VERSION,
        kind=kind,
        file_type=file_type,
        query=query,
        include_duplicate_content=include_duplicate_content,
    )
    order_sql = library_group_storage.sort_sql(sort)

    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT COUNT(*)
            FROM library_group_index gi
            WHERE {where_sql}
            """,
            params,
        )
        total = int(cursor.fetchone()[0] or 0)

        cursor.execute(
            f"""
            SELECT gi.group_kind, COUNT(*) AS count
            FROM library_group_index gi
            WHERE {where_sql}
            GROUP BY gi.group_kind
            """,
            params,
        )
        counts_by_kind = {str(row["group_kind"]): int(row["count"] or 0) for row in cursor.fetchall()}

        cursor.execute(
            f"""
            SELECT
                gi.group_id,
                gi.group_kind,
                gi.file_type,
                gi.base_name,
                gi.canonical_name,
                gi.title,
                gi.confidence,
                gi.reason,
                gi.file_count,
                gi.latest_file_id,
                gi.previous_file_id,
                gi.manual_latest_file_id,
                gi.tokens_summary_json,
                gi.content_status,
                gi.fingerprint_coverage,
                gi.fingerprint_unique_count,
                gi.content_evidence,
                gi.updated_at,
                latest.file_json AS latest_file_json,
                previous.file_json AS previous_file_json
            FROM library_group_index gi
            LEFT JOIN library_group_index_files latest ON latest.file_id = gi.latest_file_id
            LEFT JOIN library_group_index_files previous ON previous.file_id = gi.previous_file_id
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        )
        rows = []
        for row in cursor.fetchall():
            data = dict(row)
            data["tokens_summary"] = library_group_storage.safe_json_list(data.pop("tokens_summary_json", "[]"))
            data["latest_file"] = library_group_storage.safe_json_dict(data.pop("latest_file_json", None))
            data["previous_file"] = library_group_storage.safe_json_dict(data.pop("previous_file_json", None))
            rows.append(data)

    return {
        "total": total,
        "counts_by_kind": counts_by_kind,
        "rows": rows,
    }


def get_indexed_library_group(group_id: str, *, allow_state_write: bool = True) -> Optional[Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT *
            FROM library_group_index
            WHERE group_id=? AND index_version=?
            """,
            (group_id, LIBRARY_GROUP_INDEX_VERSION),
        )
        row = cursor.fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["group"] = json.loads(data["group_json"])
    except (TypeError, json.JSONDecodeError) as exc:
        logger.warning("library group JSON is corrupt", extra={"group_id": group_id, "error": str(exc)})
        if allow_state_write:
            set_library_group_index_state("repair_needed", error="corrupt group JSON")
        return None
    return data


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
        try:
            with _read_connection() as source:
                source_cursor = source.cursor()
                source_cursor.execute("SELECT key, value FROM settings")
                settings_rows = [(str(row[0]), str(row[1])) for row in source_cursor.fetchall()]
        except sqlite3.Error:
            settings_rows = []
    if settings_rows:
        cursor.executemany(
            """
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            settings_rows,
        )
    _set_setting_with_cursor(cursor, EXCEL_INDEX_VERSION_KEY, EXCEL_INDEX_VERSION)
    conn.commit()
    log_index_perf(
        "initial_index_staging_started",
        db_target="initial_staging",
        temp_db_path=str(temp_path),
        copied_setting_count=len(settings_rows),
    )
    return InitialIndexStagingDatabase(path=temp_path, conn=conn)


def _mark_group_index_repair_needed_for_legacy_write(reason: str) -> None:
    """Mark derived groups stale for low-level helpers that cannot compute keys."""
    try:
        set_library_group_index_state("repair_needed", error=reason)
    except sqlite3.Error:
        # Some tests create partial legacy schemas before init_db(); callers should
        # not fail just because the optional derived-index tables/settings do not
        # exist yet.
        return


def register_file(
    path: str,
    name: str,
    file_type: str,
    column_count: int,
) -> int:
    with _write_connection() as conn:
        cursor = conn.cursor()
        now = datetime.now().isoformat()

        try:
            cursor.execute(
                """
                INSERT INTO registered_files (
                    path, name, file_type, column_count, created_at,
                    availability_status, last_seen_at, missing_since,
                    missing_last_checked_at, missing_reason
                )
                VALUES (?, ?, ?, ?, ?, 'available', ?, NULL, NULL, NULL)
                """,
                (path, name, file_type, column_count, now, now),
            )
            conn.commit()
            _mark_group_index_repair_needed_for_legacy_write("register_file")
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            cursor.execute(
                """
                UPDATE registered_files
                SET name=?, file_type=?, column_count=?, created_at=?,
                    availability_status='available',
                    last_seen_at=?,
                    missing_since=NULL,
                    missing_last_checked_at=NULL,
                    missing_reason=NULL
                WHERE path=?
                """,
                (name, file_type, column_count, now, now, path),
            )
            conn.commit()
            cursor.execute("SELECT id FROM registered_files WHERE path=?", (path,))
            row = cursor.fetchone()
            _mark_group_index_repair_needed_for_legacy_write("register_file")
            return row[0] if row else -1


def save_indexed_file(
    path: str,
    name: str,
    file_type: str,
    column_count: int,
    chunks: List[Dict[str, str]],
    file_mtime: float,
    excel_sheets: Optional[Sequence[Dict[str, Any]]] = None,
    excel_cells: Optional[Sequence[Dict[str, Any]]] = None,
    comparison_artifacts: Optional[Sequence[Dict[str, Any]]] = None,
) -> int:
    """Upsert file metadata, chunks, fingerprint, and mtime in one write turn."""
    payload = prepare_indexed_file(
        path=path,
        name=name,
        file_type=file_type,
        column_count=column_count,
        chunks=chunks,
        file_mtime=file_mtime,
        excel_sheets=excel_sheets,
        excel_cells=excel_cells,
        comparison_artifacts=comparison_artifacts,
    )
    return save_prepared_indexed_file(payload)


def save_prepared_indexed_file(payload: PreparedIndexedFile) -> int:
    """Save one already-prepared indexed file payload."""
    with _write_connection() as conn:
        try:
            cursor = conn.cursor()
            file_id = _save_prepared_indexed_file(cursor, payload, datetime.now().isoformat())
            _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="save_prepared_indexed_file")
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
        _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="save_indexed_files_batch")
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


def get_all_files(*, include_missing: bool = True) -> List[Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        where_clause = "" if include_missing else "WHERE availability_status != 'missing'"
        cursor.execute(f"SELECT * FROM registered_files {where_clause} ORDER BY created_at DESC")
        rows = cursor.fetchall()
    return [dict(row) for row in rows]


def get_registered_files_signature() -> str:
    """Return a cheap stable signature for group-cache invalidation."""
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, path, name, file_type, column_count,
                   created_at, file_mtime, availability_status,
                   last_seen_at, missing_since, missing_last_checked_at,
                   missing_reason
            FROM registered_files
            ORDER BY id
            """
        )
        rows = [dict(row) for row in cursor.fetchall()]
    payload = {
        "db_path": str(DB_PATH),
        "count": len(rows),
        "rows": rows,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def _build_file_list_filters(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
    include_missing: bool = True,
) -> Tuple[str, List[Any]]:
    clauses: List[str] = []
    params: List[Any] = []
    if not include_missing:
        clauses.append("availability_status != 'missing'")
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
    include_missing: bool = True,
) -> List[Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        where_clause, params = _build_file_list_filters(query, file_types, include_missing=include_missing)
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
    return [dict(row) for row in rows]


def list_duplicate_content_groups(
    *,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))

    with _read_connection(row_factory=sqlite3.Row) as conn:
        return duplicate_content_storage.list_duplicate_content_groups(
            conn,
            limit=safe_limit,
            offset=safe_offset,
        )


def count_files(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
    include_missing: bool = True,
) -> int:
    with _read_connection() as conn:
        cursor = conn.cursor()
        where_clause, params = _build_file_list_filters(query, file_types, include_missing=include_missing)
        cursor.execute(f"SELECT COUNT(*) FROM registered_files{where_clause}", params)
        total = int(cursor.fetchone()[0])
    return total


def count_files_by_type(
    query: str = "",
    file_types: Optional[Sequence[str]] = None,
    include_missing: bool = True,
) -> Dict[str, int]:
    with _read_connection() as conn:
        cursor = conn.cursor()
        where_clause, params = _build_file_list_filters(query, file_types, include_missing=include_missing)
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
    return counts


def get_file_by_id(file_id: int) -> Optional[Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM registered_files WHERE id=?", (file_id,))
        row = cursor.fetchone()
    return dict(row) if row else None


def mark_registered_file_available(file_id: int, *, seen_at: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Clear a missing marker after the source path is seen again."""
    checked_at = seen_at or datetime.now().isoformat()
    with _write_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM registered_files WHERE id=?", (int(file_id),))
        row = cursor.fetchone()
        if not row:
            return None
        cursor.execute(
            """
            UPDATE registered_files
            SET availability_status='available',
                last_seen_at=?,
                missing_since=NULL,
                missing_last_checked_at=NULL,
                missing_reason=NULL
            WHERE id=?
            """,
            (checked_at, int(file_id)),
        )
        _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="missing_file_recovered")
        conn.commit()
    return dict(row)


def mark_registered_files_missing(
    paths: Sequence[str],
    *,
    checked_at: Optional[str] = None,
    reason: str = "not_found_during_rescan",
) -> List[Dict[str, Any]]:
    """Mark registered paths as missing without deleting any app-owned records."""
    normalized = sorted({os.path.normpath(str(path)) for path in paths if str(path or "").strip()})
    if not normalized:
        return []

    timestamp = checked_at or datetime.now().isoformat()
    affected_rows: List[Dict[str, Any]] = []
    with _write_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        for batch in _batched_values(normalized):
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(f"SELECT * FROM registered_files WHERE path IN ({placeholders})", batch)
            rows = [dict(row) for row in cursor.fetchall()]
            for row in rows:
                missing_since = row.get("missing_since") or timestamp
                cursor.execute(
                    """
                    UPDATE registered_files
                    SET availability_status='missing',
                        missing_since=?,
                        missing_last_checked_at=?,
                        missing_reason=?
                    WHERE id=?
                    """,
                    (missing_since, timestamp, reason, int(row["id"])),
                )
                if row.get("availability_status") != "missing":
                    affected_rows.append(row)
        if affected_rows:
            _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="missing_file_marked")
        conn.commit()
    return affected_rows


def purge_expired_missing_files(
    *,
    now: Optional[datetime] = None,
    grace_days: int = MISSING_FILE_RETENTION_DAYS,
) -> List[Dict[str, Any]]:
    """Remove app-owned records for files that have stayed missing past the grace period."""
    threshold = (now or datetime.now()) - timedelta(days=max(0, int(grace_days)))
    with _write_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT *
            FROM registered_files
            WHERE availability_status='missing'
              AND missing_since IS NOT NULL
              AND missing_since <= ?
            """,
            (threshold.isoformat(),),
        )
        rows = [dict(row) for row in cursor.fetchall()]
        if rows:
            _delete_registered_file_ids_with_cursor(
                cursor,
                [int(row["id"]) for row in rows],
                repair_reason="purge_expired_missing_files",
            )
        conn.commit()
    return rows


def get_excel_sheet_index(file_ids: Sequence[int]) -> Dict[int, List[Dict[str, Any]]]:
    ids = sorted({int(file_id) for file_id in file_ids if int(file_id) > 0})
    if not ids:
        return {}

    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        rows: List[sqlite3.Row] = []
        for batch in _batched_values(ids):
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(
                f"""
                SELECT *
                FROM excel_sheet_index
                WHERE file_id IN ({placeholders})
                ORDER BY file_id, sheet_index, sheet_name
                """,
                batch,
            )
            rows.extend(cursor.fetchall())

    result: Dict[int, List[Dict[str, Any]]] = {file_id: [] for file_id in ids}
    for row in rows:
        result.setdefault(int(row["file_id"]), []).append(dict(row))
    return result


def get_excel_cell_index(file_ids: Sequence[int]) -> Dict[int, List[Dict[str, Any]]]:
    ids = sorted({int(file_id) for file_id in file_ids if int(file_id) > 0})
    if not ids:
        return {}

    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        rows: List[sqlite3.Row] = []
        for batch in _batched_values(ids):
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(
                f"""
                SELECT *
                FROM excel_cell_index
                WHERE file_id IN ({placeholders})
                ORDER BY file_id, sheet_index, row_number, column_index
                """,
                batch,
            )
            rows.extend(cursor.fetchall())

    result: Dict[int, List[Dict[str, Any]]] = {file_id: [] for file_id in ids}
    for row in rows:
        result.setdefault(int(row["file_id"]), []).append(dict(row))
    return result


def get_comparison_artifact(
    file_id: int,
    artifact_kind: str,
    *,
    expected_artifact_version: str = COMPARISON_ARTIFACT_VERSION,
    expected_parser_version: str = "",
) -> Dict[str, Any]:
    try:
        with _read_connection() as conn:
            artifact = artifact_storage.fetch_comparison_artifact(
                conn,
                int(file_id),
                str(artifact_kind),
                expected_artifact_version=expected_artifact_version,
                expected_parser_version=expected_parser_version,
            )
    except sqlite3.OperationalError as exc:
        logger.warning(
            "comparison artifact database unavailable",
            extra={"file_id": int(file_id), "artifact_kind": str(artifact_kind), "error": str(exc)},
        )
        return {"status": "unavailable", "payload": None}

    if artifact.get("status") == "corrupt":
        with _write_connection() as conn:
            cursor = conn.cursor()
            artifact_storage.delete_comparison_artifact(cursor, int(file_id), str(artifact_kind))
            conn.commit()
    return artifact


def save_comparison_artifact(
    file_id: int,
    *,
    file_type: str,
    artifact_kind: str,
    payload: Dict[str, Any],
    artifact_version: str = COMPARISON_ARTIFACT_VERSION,
    parser_version: str = "",
    source_mtime: Optional[float] = None,
) -> None:
    artifact = {
        "file_type": file_type,
        "artifact_kind": artifact_kind,
        "artifact_version": artifact_version,
        "parser_version": parser_version,
        "source_mtime": source_mtime,
        "payload": payload,
    }
    with _write_connection() as conn:
        cursor = conn.cursor()
        _replace_comparison_artifacts(
            cursor,
            int(file_id),
            _normalize_comparison_artifacts([artifact]),
            source_mtime=source_mtime,
            updated_at=datetime.now().isoformat(),
        )
        conn.commit()


def search_file_names(
    query: str,
    *,
    limit: int = 50,
    file_types: Optional[Sequence[str]] = None,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    excluded_folder_paths: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    normalized_query = query.strip()
    if not normalized_query:
        return []

    clauses = ["name LIKE ?", "availability_status != 'missing'"]
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
    _extend_excluded_path_filters(clauses, params, excluded_folder_paths)
    params.append(max(1, limit))

    with _read_connection(row_factory=sqlite3.Row) as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT rf.*,
                   df.normalized_hash,
                   df.content_hash,
                   df.content_chars,
                   df.chunk_count
            FROM registered_files rf
            LEFT JOIN document_fingerprints df ON df.file_id = rf.id
            WHERE {' AND '.join(clauses)}
            ORDER BY rf.file_mtime DESC, rf.created_at DESC, rf.id DESC
            LIMIT ?
            """,
            params,
        )
        rows = cursor.fetchall()
    return [dict(row) for row in rows]


def _delete_registered_file_ids_with_cursor(
    cursor: sqlite3.Cursor,
    file_ids: Sequence[int],
    *,
    repair_reason: str,
) -> int:
    normalized_ids = [int(file_id) for file_id in file_ids]
    if not normalized_ids:
        return 0

    id_placeholders = ",".join("?" for _ in normalized_ids)
    cursor.execute(f"DELETE FROM file_chunks WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM document_fingerprints WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM excel_cell_index WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM excel_sheet_index WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM comparison_artifacts WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM library_group_index_files WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM library_group_members WHERE file_id IN ({id_placeholders})", normalized_ids)
    cursor.execute(f"DELETE FROM registered_files WHERE id IN ({id_placeholders})", normalized_ids)
    affected = cursor.rowcount
    if affected:
        cursor.execute("DELETE FROM comparison_cache")
        _set_library_group_index_state_with_cursor(cursor, "repair_needed", error=repair_reason)
    return int(affected)


def delete_file(file_id: int) -> bool:
    with _write_connection() as conn:
        cursor = conn.cursor()
        affected = _delete_registered_file_ids_with_cursor(cursor, [file_id], repair_reason="delete_file")
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

        _delete_registered_file_ids_with_cursor(cursor, file_ids, repair_reason="delete_files_by_types")
        conn.commit()
        return len(file_ids)


def delete_files_by_extensions(extensions: Sequence[str]) -> int:
    """Remove app-owned registrations/indexes by source path suffix without touching source files."""
    normalized = []
    for extension in extensions:
        suffix = str(extension or "").strip().lower()
        if not suffix:
            continue
        normalized.append(suffix if suffix.startswith(".") else f".{suffix}")
    if not normalized:
        return 0

    clauses = " OR ".join("lower(path) LIKE ?" for _ in normalized)
    params = [f"%{suffix}" for suffix in normalized]
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT id FROM registered_files WHERE {clauses}", params)
        file_ids = [int(row[0]) for row in cursor.fetchall()]
        if not file_ids:
            return 0

        _delete_registered_file_ids_with_cursor(cursor, file_ids, repair_reason="delete_files_by_extensions")
        conn.commit()
        return len(file_ids)


def _path_is_under(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def delete_files_under_paths(paths: Sequence[str | os.PathLike[str]]) -> int:
    """Remove app-owned registrations/indexes whose source path is under a root.

    This only deletes OfficeWhere DB/index rows. It never touches the source
    document files themselves; callers that remove app-owned temporary files
    must do that explicitly after constraining the target root.
    """
    roots = [
        Path(path).expanduser().resolve(strict=False)
        for path in paths
        if str(path or "").strip()
    ]
    if not roots:
        return 0

    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, path FROM registered_files")
        file_ids: List[int] = []
        for file_id, source_path in cursor.fetchall():
            candidate = Path(str(source_path)).expanduser().resolve(strict=False)
            if any(candidate == root or _path_is_under(candidate, root) for root in roots):
                file_ids.append(int(file_id))
        if not file_ids:
            return 0

        _delete_registered_file_ids_with_cursor(cursor, file_ids, repair_reason="delete_files_under_paths")
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
        cursor.execute("DELETE FROM excel_cell_index")
        cursor.execute("DELETE FROM excel_sheet_index")
        cursor.execute("DELETE FROM comparison_artifacts")
        cursor.execute("DELETE FROM comparison_cache")
        cursor.execute("DELETE FROM registered_files")
        cursor.execute("DELETE FROM library_group_members")
        cursor.execute("DELETE FROM library_group_index")
        cursor.execute("DELETE FROM library_group_index_files")
        cursor.execute("DELETE FROM library_group_dirty_keys")
        _set_library_group_index_state_with_cursor(cursor, "ready")
        conn.commit()
        return count


def save_file_chunks(
    file_id: int,
    chunks: List[Dict[str, str]],
    *,
    excel_sheets: Optional[Sequence[Dict[str, Any]]] = None,
    excel_cells: Optional[Sequence[Dict[str, Any]]] = None,
    comparison_artifacts: Optional[Sequence[Dict[str, Any]]] = None,
):
    chunk_values = _chunk_insert_values(chunks)
    normalized_excel_sheets = _normalize_excel_sheet_rows(excel_sheets)
    normalized_excel_cells = _normalize_excel_cell_rows(excel_cells)
    normalized_comparison_artifacts = _normalize_comparison_artifacts(comparison_artifacts)

    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_mtime, file_type FROM registered_files WHERE id = ?", (file_id,))
        row = cursor.fetchone()
        source_mtime = row[0] if row else None
        file_type = row[1] if row else ""
        cursor.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
        cursor.executemany(
            "INSERT INTO file_chunks (file_id, location, content, search_text, trigram_text) VALUES (?, ?, ?, ?, ?)",
            [
                (file_id, location, content, search_text, trigram_text)
                for location, content, search_text, trigram_text in chunk_values
            ],
        )
        _upsert_document_fingerprint(cursor, file_id, chunks, source_mtime=source_mtime)
        if file_type == "Excel":
            _replace_excel_index(
                cursor,
                file_id,
                normalized_excel_sheets,
                normalized_excel_cells,
                updated_at=datetime.now().isoformat(),
            )
        else:
            _replace_excel_index(cursor, file_id, [], [], updated_at=datetime.now().isoformat())
        _replace_comparison_artifacts(
            cursor,
            file_id,
            normalized_comparison_artifacts,
            source_mtime=source_mtime,
            updated_at=datetime.now().isoformat(),
        )
        _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="save_file_chunks")
        conn.commit()


def update_file_mtime(file_id: int, mtime: float):
    with _write_connection() as conn:
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            """
            UPDATE registered_files
            SET file_mtime = ?,
                availability_status='available',
                last_seen_at=?,
                missing_since=NULL,
                missing_last_checked_at=NULL,
                missing_reason=NULL
            WHERE id = ?
            """,
            (mtime, now, file_id),
        )
        cursor.execute("UPDATE document_fingerprints SET source_mtime = ? WHERE file_id = ?", (mtime, file_id))
        _set_library_group_index_state_with_cursor(cursor, "repair_needed", error="update_file_mtime")
        conn.commit()


def get_cached_comparison_result(cache_key: str) -> Optional[Dict[str, Any]]:
    with _read_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT result_json FROM comparison_cache WHERE cache_key = ?", (cache_key,))
        row = cursor.fetchone()
    if not row:
        return None
    try:
        result = json.loads(row[0])
    except (TypeError, json.JSONDecodeError) as exc:
        logger.warning(
            "comparison cache entry is corrupt",
            extra={"cache_key": cache_key, "error": str(exc)},
        )
        return None
    return result if isinstance(result, dict) else None


def _prune_comparison_cache_with_cursor(
    cursor: sqlite3.Cursor,
    *,
    max_bytes: int = COMPARISON_CACHE_MAX_BYTES,
    max_age_days: int = COMPARISON_CACHE_MAX_AGE_DAYS,
    min_keep_rows: int = COMPARISON_CACHE_MIN_KEEP_ROWS,
) -> Dict[str, int]:
    """Bound comparison-cache size while always keeping the newest row.

    Age pruning keeps a small newest-row floor.  Size pruning is stricter so a
    few very large comparison results cannot grow the app-owned SQLite DB into
    multi-GB territory indefinitely.
    """
    keep_floor = max(0, int(min_keep_rows))
    deleted_age = 0
    deleted_size = 0

    if max_age_days > 0:
        cutoff = (datetime.now() - timedelta(days=max_age_days)).isoformat()
        cursor.execute(
            """
            DELETE FROM comparison_cache
            WHERE created_at < ?
              AND cache_key NOT IN (
                SELECT cache_key
                FROM comparison_cache
                ORDER BY created_at DESC
                LIMIT ?
              )
            """,
            (cutoff, keep_floor),
        )
        deleted_age = cursor.rowcount if cursor.rowcount != -1 else 0

    cursor.execute(
        """
        SELECT cache_key, COALESCE(length(result_json), 0) AS bytes
        FROM comparison_cache
        ORDER BY created_at DESC
        """
    )
    rows = [(str(row[0]), int(row[1] or 0)) for row in cursor.fetchall()]
    total_bytes = sum(size for _key, size in rows)
    if max_bytes > 0 and total_bytes > max_bytes:
        keys_to_delete: List[str] = []
        for index, (cache_key, size) in enumerate(reversed(rows)):
            original_index = len(rows) - 1 - index
            if original_index == 0:
                continue
            if total_bytes <= max_bytes:
                break
            keys_to_delete.append(cache_key)
            total_bytes -= size

        for batch in [keys_to_delete[index : index + 900] for index in range(0, len(keys_to_delete), 900)]:
            if not batch:
                continue
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(f"DELETE FROM comparison_cache WHERE cache_key IN ({placeholders})", batch)
            deleted_size += cursor.rowcount if cursor.rowcount != -1 else 0

    return {
        "deleted_age": deleted_age,
        "deleted_size": deleted_size,
    }


def prune_comparison_cache(
    *,
    max_bytes: int = COMPARISON_CACHE_MAX_BYTES,
    max_age_days: int = COMPARISON_CACHE_MAX_AGE_DAYS,
    min_keep_rows: int = COMPARISON_CACHE_MIN_KEEP_ROWS,
) -> Dict[str, int]:
    with _write_connection() as conn:
        cursor = conn.cursor()
        result = _prune_comparison_cache_with_cursor(
            cursor,
            max_bytes=max_bytes,
            max_age_days=max_age_days,
            min_keep_rows=min_keep_rows,
        )
        conn.commit()
        return result


def save_cached_comparison_result(
    cache_key: str,
    file_ids: Sequence[int],
    comparison_mode: str,
    result: Dict[str, Any],
) -> None:
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO comparison_cache (cache_key, file_ids, comparison_mode, result_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                file_ids=excluded.file_ids,
                comparison_mode=excluded.comparison_mode,
                result_json=excluded.result_json,
                created_at=excluded.created_at
            """,
            (
                cache_key,
                json.dumps([int(file_id) for file_id in file_ids], ensure_ascii=False),
                comparison_mode,
                json.dumps(result, ensure_ascii=False),
                datetime.now().isoformat(),
            ),
        )
        _prune_comparison_cache_with_cursor(cursor)
        conn.commit()


def get_file_fingerprints(file_ids: Optional[Sequence[int]] = None) -> Dict[int, Dict[str, Any]]:
    with _read_connection(row_factory=sqlite3.Row) as conn:
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


def _normalize_excluded_folder_path(value: str) -> str:
    normalized = str(value or "").strip().replace("\\", "/")
    if not normalized:
        return ""
    normalized = os.path.normpath(normalized).replace("\\", "/")
    while len(normalized) > 1 and normalized.endswith("/"):
        normalized = normalized[:-1]
    return normalized.lower()


def _normalize_excluded_folder_paths(values: Optional[Sequence[str]]) -> List[str]:
    seen: set[str] = set()
    normalized_paths: List[str] = []
    for value in values or []:
        normalized = _normalize_excluded_folder_path(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        normalized_paths.append(normalized)
    return normalized_paths


def _extend_excluded_path_filters(
    clauses: List[str],
    params: List[Any],
    excluded_folder_paths: Optional[Sequence[str]],
    *,
    column_expr: str = "rf.path",
) -> None:
    normalized_paths = _normalize_excluded_folder_paths(excluded_folder_paths)
    if not normalized_paths:
        return

    normalized_column_expr = f"lower(replace({column_expr}, char(92), '/'))"
    for folder_path in normalized_paths:
        clauses.append(f"NOT ({normalized_column_expr} = ? OR {normalized_column_expr} LIKE ?)")
        params.extend([folder_path, f"{folder_path}/%"])


def _search_table_for_query(raw_query: str) -> str:
    terms = _search_terms_for_table(raw_query)
    if _supports_fts5_trigram() and terms and all(len(term) >= 3 for term in terms):
        return "file_search_trigram"
    return "file_search_ko"


def _search_row_dicts(rows: Sequence[sqlite3.Row], query_for_snippet: str) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for row in rows:
        row_keys = set(row.keys())
        result = {
            **{key: row[key] for key in ("file_id", "name", "path", "file_type", "location")},
            "snippet": make_search_snippet(row["content"], query_for_snippet),
        }
        for key in ("normalized_hash", "content_hash", "content_chars", "chunk_count"):
            if key in row_keys:
                result[key] = row[key]
        results.append(result)
    return results


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
    excluded_folder_paths: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    started = perf_counter()
    query_text = raw_query or fts_query
    search_table = _search_table_for_query(query_text)
    conn = _connect()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    filters = [file_type for file_type in (file_types or []) if file_type]
    filter_clause = " AND rf.availability_status != 'missing'"
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
    excluded_clauses: List[str] = []
    _extend_excluded_path_filters(excluded_clauses, params, excluded_folder_paths)
    if excluded_clauses:
        filter_clause += " AND " + " AND ".join(excluded_clauses)

    try:
        if file_limit is None:
            params.append(limit)
            cursor.execute(
                f"""
                SELECT fc.file_id, rf.name, rf.path, rf.file_type, fc.location, fc.content,
                       df.normalized_hash, df.content_hash, df.content_chars, df.chunk_count
                FROM {search_table}
                JOIN file_chunks fc ON fc.id = {search_table}.rowid
                JOIN registered_files rf ON rf.id = fc.file_id
                LEFT JOIN document_fingerprints df ON df.file_id = rf.id
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
                       df.normalized_hash, df.content_hash, df.content_chars, df.chunk_count,
                       matched_files.file_mtime AS matched_file_mtime,
                       matched_files.created_at AS matched_created_at,
                       matched_files.sort_id AS matched_sort_id,
                       ROW_NUMBER() OVER (PARTITION BY fc.file_id ORDER BY fc.id ASC) AS chunk_number
                FROM matched_files
                JOIN file_chunks fc ON fc.file_id = matched_files.file_id
                JOIN {search_table} ON {search_table}.rowid = fc.id
                JOIN registered_files rf ON rf.id = fc.file_id
                LEFT JOIN document_fingerprints df ON df.file_id = rf.id
                WHERE {search_table} MATCH ?
            )
            SELECT file_id, name, path, file_type, location, content,
                   normalized_hash, content_hash, content_chars, chunk_count
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
    with _read_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cursor.fetchone()
    return row[0] if row else default


def set_setting(key: str, value: str):
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
        conn.commit()


def pop_setting(key: str, default: str = "") -> str:
    with _write_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        cursor.execute("DELETE FROM settings WHERE key = ?", (key,))
        conn.commit()
    return row[0] if row else default
