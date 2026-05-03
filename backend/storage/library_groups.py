from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

GroupKey = Tuple[str, str, str]


def library_group_index_file_values(
    rows: Sequence[Dict[str, Any]],
    *,
    updated_at: str,
) -> List[Tuple[int, str, str, str, str, Optional[str], str, str, str]]:
    values: List[Tuple[int, str, str, str, str, Optional[str], str, str, str]] = []
    for row in rows:
        file_json = row["file_json"]
        if not isinstance(file_json, str):
            file_json = json.dumps(file_json, ensure_ascii=False, sort_keys=True)
        values.append(
            (
                int(row["file_id"]),
                str(row["file_type"]),
                str(row["name"]),
                str(row["path"]),
                str(row["exact_key"]),
                str(row["version_key"]) if row.get("version_key") else None,
                file_json,
                str(row["file_signature"]),
                updated_at,
            )
        )
    return values


def upsert_library_group_index_files(
    cursor: sqlite3.Cursor,
    rows: Sequence[Dict[str, Any]],
    *,
    updated_at: str,
) -> None:
    values = library_group_index_file_values(rows, updated_at=updated_at)
    if not values:
        return
    cursor.executemany(
        """
        INSERT INTO library_group_index_files (
            file_id, file_type, name, path, exact_key, version_key,
            file_json, file_signature, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
            file_type=excluded.file_type,
            name=excluded.name,
            path=excluded.path,
            exact_key=excluded.exact_key,
            version_key=excluded.version_key,
            file_json=excluded.file_json,
            file_signature=excluded.file_signature,
            updated_at=excluded.updated_at
        """,
        values,
    )


def delete_group_index_rows_for_keys(cursor: sqlite3.Cursor, keys: Sequence[GroupKey]) -> None:
    for group_kind, file_type, base_name in sorted({(str(k), str(t), str(b)) for k, t, b in keys}):
        cursor.execute(
            """
            SELECT group_id FROM library_group_index
            WHERE group_kind=? AND file_type=? AND base_name=?
            """,
            (group_kind, file_type, base_name),
        )
        group_ids = [str(row[0]) for row in cursor.fetchall()]
        for group_id in group_ids:
            cursor.execute("DELETE FROM library_group_members WHERE group_id=?", (group_id,))
        cursor.execute(
            """
            DELETE FROM library_group_index
            WHERE group_kind=? AND file_type=? AND base_name=?
            """,
            (group_kind, file_type, base_name),
        )


def insert_group_index_rows(
    cursor: sqlite3.Cursor,
    groups: Sequence[Dict[str, Any]],
    *,
    index_version: str,
    updated_at: str,
) -> None:
    for group in groups:
        group_json = group["group_json"]
        if not isinstance(group_json, str):
            group_json = json.dumps(group_json, ensure_ascii=False, sort_keys=True)
        tokens_summary = group.get("tokens_summary", [])
        tokens_json = (
            tokens_summary
            if isinstance(tokens_summary, str)
            else json.dumps(tokens_summary, ensure_ascii=False, sort_keys=True)
        )
        cursor.execute(
            """
            INSERT INTO library_group_index (
                group_id, group_kind, file_type, base_name, canonical_name, title,
                confidence, reason, file_count, latest_file_id, previous_file_id,
                manual_latest_file_id, tokens_summary_json, content_status,
                fingerprint_coverage, fingerprint_unique_count, content_evidence,
                group_json, index_version, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(group_id) DO UPDATE SET
                group_kind=excluded.group_kind,
                file_type=excluded.file_type,
                base_name=excluded.base_name,
                canonical_name=excluded.canonical_name,
                title=excluded.title,
                confidence=excluded.confidence,
                reason=excluded.reason,
                file_count=excluded.file_count,
                latest_file_id=excluded.latest_file_id,
                previous_file_id=excluded.previous_file_id,
                manual_latest_file_id=excluded.manual_latest_file_id,
                tokens_summary_json=excluded.tokens_summary_json,
                content_status=excluded.content_status,
                fingerprint_coverage=excluded.fingerprint_coverage,
                fingerprint_unique_count=excluded.fingerprint_unique_count,
                content_evidence=excluded.content_evidence,
                group_json=excluded.group_json,
                index_version=excluded.index_version,
                updated_at=excluded.updated_at
            """,
            (
                str(group["group_id"]),
                str(group["group_kind"]),
                str(group["file_type"]),
                str(group["base_name"]),
                str(group["canonical_name"]),
                str(group["title"]),
                str(group["confidence"]),
                str(group["reason"]),
                int(group["file_count"]),
                group.get("latest_file_id"),
                group.get("previous_file_id"),
                group.get("manual_latest_file_id"),
                tokens_json,
                str(group["content_status"]),
                int(group["fingerprint_coverage"]),
                int(group["fingerprint_unique_count"]),
                str(group["content_evidence"]),
                group_json,
                index_version,
                updated_at,
            ),
        )
        members = group.get("members", [])
        cursor.executemany(
            """
            INSERT INTO library_group_members (group_id, file_id, rank)
            VALUES (?, ?, ?)
            ON CONFLICT(group_id, file_id) DO UPDATE SET rank=excluded.rank
            """,
            [(str(group["group_id"]), int(file_id), rank) for rank, file_id in enumerate(members)],
        )


def summary_filters(
    *,
    index_version: str,
    kind: Optional[str],
    file_type: Optional[str],
    query: Optional[str],
    include_duplicate_content: bool,
) -> Tuple[str, List[Any]]:
    clauses = ["gi.index_version=?"]
    params: List[Any] = [index_version]
    if kind:
        clauses.append("gi.group_kind=?")
        params.append(str(kind))
    if file_type:
        clauses.append("gi.file_type=?")
        params.append(str(file_type))
    if not include_duplicate_content:
        clauses.append("NOT (gi.group_kind='exact_name_conflict' AND gi.content_status='same_content')")

    normalized_query = (query or "").strip().lower()
    if normalized_query:
        like = f"%{normalized_query}%"
        clauses.append(
            """
            (
                lower(gi.base_name) LIKE ?
                OR lower(gi.canonical_name) LIKE ?
                OR lower(gi.title) LIKE ?
                OR lower(gi.file_type) LIKE ?
                OR lower(gi.group_kind) LIKE ?
                OR lower(gi.tokens_summary_json) LIKE ?
                OR lower(gi.content_evidence) LIKE ?
                OR EXISTS (
                    SELECT 1
                    FROM library_group_members gm
                    JOIN library_group_index_files gf ON gf.file_id = gm.file_id
                    WHERE gm.group_id = gi.group_id
                      AND (lower(gf.name) LIKE ? OR lower(gf.path) LIKE ?)
                )
            )
            """
        )
        params.extend([like, like, like, like, like, like, like, like, like])
    return " AND ".join(clauses), params


def sort_sql(sort: str) -> str:
    if sort == "name":
        return "lower(gi.base_name) ASC, gi.file_type ASC, gi.group_kind ASC"
    if sort == "count":
        return "gi.file_count DESC, lower(gi.base_name) ASC, gi.file_type ASC, gi.group_kind ASC"
    if sort == "content":
        return """
            CASE gi.content_status
                WHEN 'content_differs' THEN 4
                WHEN 'partial' THEN 3
                WHEN 'pending' THEN 2
                WHEN 'not_enough_content' THEN 1
                WHEN 'same_content' THEN 0
                ELSE 0
            END DESC,
            gi.file_count DESC,
            lower(gi.base_name) ASC
        """
    return "gi.updated_at DESC, gi.file_count DESC, lower(gi.base_name) ASC"


def safe_json_list(value: Any) -> List[str]:
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError):
        logger.debug("library group summary JSON list is corrupt", extra={"value_type": type(value).__name__}, exc_info=True)
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item)]


def safe_json_dict(value: Any) -> Optional[Dict[str, Any]]:
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError):
        logger.debug("library group summary JSON object is corrupt", extra={"value_type": type(value).__name__}, exc_info=True)
        return None
    return parsed if isinstance(parsed, dict) else None
