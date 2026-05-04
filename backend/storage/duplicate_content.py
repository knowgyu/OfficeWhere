from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Sequence


_CANDIDATE_GROUPS_CTE = """
    WITH candidate_groups AS (
        SELECT
            df.normalized_hash AS content_signature,
            COUNT(*) AS file_count,
            COUNT(DISTINCT lower(trim(rf.name))) AS distinct_name_count,
            SUM(df.content_chars) AS total_content_chars,
            MAX(rf.file_mtime) AS latest_mtime
        FROM document_fingerprints df
        JOIN registered_files rf ON rf.id = df.file_id
        WHERE df.normalized_hash <> ''
          AND df.content_chars > 0
          AND df.chunk_count > 0
        GROUP BY df.normalized_hash
        HAVING COUNT(*) >= 2
           AND COUNT(DISTINCT lower(trim(rf.name))) >= 2
    )
"""


def list_duplicate_content_groups(
    conn: sqlite3.Connection,
    *,
    limit: int,
    offset: int,
) -> Dict[str, Any]:
    """Return same-content/different-name groups using an existing read connection."""

    cursor = conn.cursor()
    cursor.execute(
        f"""
        {_CANDIDATE_GROUPS_CTE}
        SELECT COUNT(*)
        FROM candidate_groups
        """
    )
    total = int(cursor.fetchone()[0] or 0)
    cursor.execute(
        f"""
        {_CANDIDATE_GROUPS_CTE},
        paged_groups AS (
            SELECT *
            FROM candidate_groups
            ORDER BY latest_mtime IS NULL,
                     latest_mtime DESC,
                     file_count DESC,
                     content_signature
            LIMIT ? OFFSET ?
        )
        SELECT
            pg.content_signature,
            pg.file_count,
            pg.distinct_name_count,
            pg.total_content_chars,
            pg.latest_mtime,
            rf.id,
            rf.name,
            rf.path,
            rf.file_type,
            rf.column_count,
            rf.created_at,
            rf.file_mtime,
            df.content_chars,
            df.chunk_count
        FROM paged_groups pg
        JOIN document_fingerprints df ON df.normalized_hash = pg.content_signature
        JOIN registered_files rf ON rf.id = df.file_id
        ORDER BY pg.latest_mtime IS NULL,
                 pg.latest_mtime DESC,
                 pg.file_count DESC,
                 pg.content_signature,
                 rf.file_mtime IS NULL,
                 rf.file_mtime DESC,
                 rf.created_at DESC,
                 rf.id DESC
        """,
        (limit, offset),
    )
    return duplicate_content_groups_from_rows(
        [dict(row) for row in cursor.fetchall()],
        total=total,
        limit=limit,
        offset=offset,
    )


def duplicate_content_groups_from_rows(
    rows: Sequence[Dict[str, Any]],
    *,
    total: int,
    limit: int,
    offset: int,
) -> Dict[str, Any]:
    groups_by_signature: Dict[str, Dict[str, Any]] = {}
    ordered_signatures: List[str] = []
    for row in rows:
        signature = str(row["content_signature"])
        group = groups_by_signature.get(signature)
        if group is None:
            group = {
                "content_signature": signature,
                "file_count": int(row["file_count"]),
                "distinct_name_count": int(row["distinct_name_count"]),
                "total_content_chars": int(row["total_content_chars"] or 0),
                "latest_mtime": row.get("latest_mtime"),
                "file_types": [],
                "files": [],
            }
            groups_by_signature[signature] = group
            ordered_signatures.append(signature)

        file_type = str(row["file_type"] or "")
        if file_type and file_type not in group["file_types"]:
            group["file_types"].append(file_type)
        group["files"].append(
            {
                "id": int(row["id"]),
                "name": row["name"],
                "path": row["path"],
                "file_type": row["file_type"],
                "column_count": int(row["column_count"] or 0),
                "created_at": row.get("created_at"),
                "file_mtime": row.get("file_mtime"),
                "content_chars": int(row.get("content_chars") or 0),
                "chunk_count": int(row.get("chunk_count") or 0),
            }
        )

    return {
        "total": total,
        "groups": [groups_by_signature[signature] for signature in ordered_signatures],
        "limit": limit,
        "offset": offset,
    }
