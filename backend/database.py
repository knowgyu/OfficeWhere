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
    conn = sqlite3.connect(str(DB_PATH))
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
    conn.commit()
    conn.close()


def register_file(path: str, name: str, file_type: str, key_column: str, column_count: int) -> int:
    """파일 등록. 이미 등록된 경우 업데이트."""
    conn = sqlite3.connect(str(DB_PATH))
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
        # 이미 등록된 파일 - 업데이트
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
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_file_by_id(file_id: int) -> Optional[Dict[str, Any]]:
    """ID로 파일 조회"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM registered_files WHERE id=?", (file_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def delete_file(file_id: int) -> bool:
    """파일 삭제"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("DELETE FROM registered_files WHERE id=?", (file_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0
