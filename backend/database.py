import sqlite3
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any


DB_DIR = Path.home() / ".office-data-joiner"
DB_PATH = DB_DIR / "data.db"


def get_db_path() -> str:
    return str(DB_PATH)


def init_db():
    """데이터베이스 초기화 및 테이블 생성"""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS registered_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            key_column TEXT NOT NULL,
            column_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)

    # 기존 DB 마이그레이션: file_mtime 컬럼 추가
    try:
        cursor.execute("ALTER TABLE registered_files ADD COLUMN file_mtime REAL")
    except sqlite3.OperationalError:
        pass  # 이미 존재

    # 파일 청크 테이블 (FTS5 content table)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS file_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            location TEXT NOT NULL,
            content TEXT NOT NULL
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON file_chunks(file_id)"
    )

    # FTS5 가상 테이블 (content table 방식)
    cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(
            content,
            content='file_chunks',
            content_rowid='id',
            tokenize='unicode61'
        )
    """)

    # FTS5 동기화 트리거
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON file_chunks BEGIN
            INSERT INTO file_search(rowid, content) VALUES (new.id, new.content);
        END
    """)
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON file_chunks BEGIN
            INSERT INTO file_search(file_search, rowid, content)
            VALUES ('delete', old.id, old.content);
        END
    """)

    # 스케줄러 설정 테이블
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    conn.commit()
    conn.close()


def register_file(path: str, name: str, file_type: str, key_column: str, column_count: int) -> int:
    """파일 등록. 이미 등록된 경우 업데이트."""
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    try:
        cursor.execute("""
            INSERT INTO registered_files (path, name, file_type, key_column, column_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (path, name, file_type, key_column, column_count, now))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        cursor.execute("""
            UPDATE registered_files
            SET name=?, file_type=?, key_column=?, column_count=?, created_at=?
            WHERE path=?
        """, (name, file_type, key_column, column_count, now, path))
        conn.commit()
        cursor.execute("SELECT id FROM registered_files WHERE path=?", (path,))
        row = cursor.fetchone()
        return row[0] if row else -1
    finally:
        conn.close()


def get_all_files() -> List[Dict[str, Any]]:
    """등록된 모든 파일 조회"""
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_file_by_id(file_id: int) -> Optional[Dict[str, Any]]:
    """ID로 파일 조회"""
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files WHERE id=?", (file_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def delete_file(file_id: int) -> bool:
    """파일 및 연관 청크 삭제"""
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    # 청크 먼저 삭제 (FTS 트리거 동작)
    cursor.execute("DELETE FROM file_chunks WHERE file_id=?", (file_id,))
    cursor.execute("DELETE FROM registered_files WHERE id=?", (file_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


# --- 검색 인덱스 CRUD ---

def save_file_chunks(file_id: int, chunks: List[Dict[str, str]]):
    """파일 청크 저장 (기존 청크 삭제 후 재삽입)"""
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
    cursor.executemany(
        "INSERT INTO file_chunks (file_id, location, content) VALUES (?, ?, ?)",
        [(file_id, c["location"], c["content"]) for c in chunks],
    )
    conn.commit()
    conn.close()


def update_file_mtime(file_id: int, mtime: float):
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE registered_files SET file_mtime = ? WHERE id = ?", (mtime, file_id)
    )
    conn.commit()
    conn.close()


def search_chunks(fts_query: str, limit: int = 100) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT fc.file_id, rf.name, rf.path, rf.file_type, fc.location,
               snippet(file_search, 0, '**', '**', '...', 15) AS snippet
        FROM file_search
        JOIN file_chunks fc ON fc.id = file_search.rowid
        JOIN registered_files rf ON rf.id = fc.file_id
        WHERE file_search MATCH ?
        ORDER BY rank
        LIMIT ?
        """,
        (fts_query, limit),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


# --- 설정 CRUD ---

def get_setting(key: str, default: str = "") -> str:
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else default


def set_setting(key: str, value: str):
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value)
    )
    conn.commit()
    conn.close()
