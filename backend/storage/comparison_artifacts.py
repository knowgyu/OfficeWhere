from __future__ import annotations

import json
import logging
import sqlite3
import zlib
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)


def normalize_comparison_artifacts(
    artifacts: Optional[Sequence[Dict[str, Any]]],
    *,
    default_artifact_version: str,
) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for artifact in artifacts or []:
        artifact_kind = str(artifact.get("artifact_kind") or artifact.get("kind") or "").strip()
        file_type = str(artifact.get("file_type") or "").strip()
        payload = artifact.get("payload")
        if not artifact_kind or not file_type or not isinstance(payload, dict):
            continue
        normalized.append(
            {
                "artifact_kind": artifact_kind,
                "file_type": file_type,
                "artifact_version": str(artifact.get("artifact_version") or default_artifact_version),
                "parser_version": str(artifact.get("parser_version") or ""),
                "payload": payload,
                "source_mtime": artifact.get("source_mtime"),
            }
        )
    return normalized


def artifact_payload_bytes(payload: Dict[str, Any]) -> Tuple[bytes, bytes]:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return raw, zlib.compress(raw)


def replace_comparison_artifacts(
    cursor: sqlite3.Cursor,
    file_id: int,
    artifacts: Sequence[Dict[str, Any]],
    *,
    default_artifact_version: str,
    source_mtime: Optional[float],
    updated_at: str,
) -> None:
    cursor.execute("DELETE FROM comparison_artifacts WHERE file_id = ?", (file_id,))
    if not artifacts:
        return

    rows = []
    for artifact in artifacts:
        payload = artifact.get("payload")
        if not isinstance(payload, dict):
            continue
        raw, compressed = artifact_payload_bytes(payload)
        artifact_source_mtime = artifact.get("source_mtime")
        if artifact_source_mtime is None:
            artifact_source_mtime = source_mtime
        rows.append(
            (
                file_id,
                str(artifact["artifact_kind"]),
                str(artifact["file_type"]),
                str(artifact.get("artifact_version") or default_artifact_version),
                str(artifact.get("parser_version") or ""),
                artifact_source_mtime,
                compressed,
                len(raw),
                len(compressed),
                updated_at,
                updated_at,
            )
        )

    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO comparison_artifacts (
            file_id, artifact_kind, file_type, artifact_version, parser_version,
            source_mtime, payload_compressed, raw_size_bytes, compressed_size_bytes,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id, artifact_kind) DO UPDATE SET
            file_type=excluded.file_type,
            artifact_version=excluded.artifact_version,
            parser_version=excluded.parser_version,
            source_mtime=excluded.source_mtime,
            payload_compressed=excluded.payload_compressed,
            raw_size_bytes=excluded.raw_size_bytes,
            compressed_size_bytes=excluded.compressed_size_bytes,
            updated_at=excluded.updated_at
        """,
        rows,
    )


def fetch_comparison_artifact(
    conn: sqlite3.Connection,
    file_id: int,
    artifact_kind: str,
    *,
    expected_artifact_version: str,
    expected_parser_version: str,
) -> Dict[str, Any]:
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT *
            FROM comparison_artifacts
            WHERE file_id=? AND artifact_kind=?
            """,
            (int(file_id), str(artifact_kind)),
        )
    except sqlite3.OperationalError as exc:
        logger.debug(
            "comparison artifact lookup unavailable",
            extra={"file_id": int(file_id), "artifact_kind": str(artifact_kind), "error": str(exc)},
        )
        return {"status": "unavailable", "payload": None}
    row = cursor.fetchone()
    if not row:
        return {"status": "missing", "payload": None}

    data = dict(row)
    if data.get("artifact_version") != expected_artifact_version:
        return {"status": "artifact_version_mismatch", "payload": None, **data}
    if expected_parser_version and data.get("parser_version") != expected_parser_version:
        return {"status": "parser_version_mismatch", "payload": None, **data}

    try:
        raw = zlib.decompress(data["payload_compressed"])
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        logger.warning(
            "comparison artifact payload is corrupt",
            extra={"file_id": int(file_id), "artifact_kind": str(artifact_kind), "error": str(exc)},
        )
        return {"status": "corrupt", "payload": None, **data}

    if not isinstance(payload, dict):
        logger.warning(
            "comparison artifact payload is not an object",
            extra={"file_id": int(file_id), "artifact_kind": str(artifact_kind)},
        )
        return {"status": "corrupt", "payload": None, **data}
    return {"status": "ok", "payload": payload, **data}


def delete_comparison_artifact(cursor: sqlite3.Cursor, file_id: int, artifact_kind: str) -> None:
    cursor.execute(
        "DELETE FROM comparison_artifacts WHERE file_id=? AND artifact_kind=?",
        (int(file_id), str(artifact_kind)),
    )
