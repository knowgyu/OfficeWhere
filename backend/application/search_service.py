from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, time
from time import perf_counter
from typing import Any, Optional

from ..core.everything_scanner import discover_filename_candidates
from ..core.hangul_search import make_search_snippet
from ..core.index_perf import elapsed_ms, log_index_perf
from ..core.indexer import search
from ..core.search_cache import current_epoch, enabled as search_cache_enabled
from ..core.search_cache import get_search_cache, set_search_cache
from ..database import _read_connection, get_search_index_status, search_file_names, search_file_names_by_paths
from ..models.schemas import SearchRequest, SearchResponse, SearchResult

FILE_TYPE_ALIASES = {
    "word": "Word",
    "docx": "Word",
    "ppt": "PowerPoint",
    "pptx": "PowerPoint",
    "powerpoint": "PowerPoint",
    "excel": "Excel",
    "xlsx": "Excel",
    "pdf": "PDF",
}
DEFAULT_SEARCH_FILE_LIMIT = 20
MAX_SEARCH_FILE_LIMIT = 100
CONTENT_MATCHES_PER_FILE = 8
MIN_CONTENT_MATCHES_PER_FILE = 1


@dataclass
class FilenameSearchTelemetry:
    source: str = "db_like"
    fallback_reason: str = ""
    everything_queried_count: int = 0
    everything_candidate_count: int = 0


def normalize_file_type_filters(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        canonical = FILE_TYPE_ALIASES.get(value.strip().lower())
        if canonical and canonical not in normalized:
            normalized.append(canonical)
    return normalized


def _parse_modified_bound(value: Optional[str], *, end_of_day: bool = False) -> Optional[float]:
    if not value:
        return None

    stripped = value.strip()
    if not stripped:
        return None

    try:
        if len(stripped) == 10:
            parsed_date = datetime.strptime(stripped, "%Y-%m-%d").date()
            parsed = datetime.combine(parsed_date, time.max if end_of_day else time.min)
        else:
            parsed = datetime.fromisoformat(stripped)
    except ValueError:
        return None

    return parsed.timestamp()


def _bounded_file_limit(value: int) -> int:
    if value < 1:
        return DEFAULT_SEARCH_FILE_LIMIT
    return min(value, MAX_SEARCH_FILE_LIMIT)


def _bounded_per_file_limit(value: int) -> int:
    if value < MIN_CONTENT_MATCHES_PER_FILE:
        return CONTENT_MATCHES_PER_FILE
    return min(value, CONTENT_MATCHES_PER_FILE)


def _unique_file_count(results: list[dict]) -> int:
    return len({int(item["file_id"]) for item in results})


def _cap_unique_files(results: list[dict], file_limit: int) -> tuple[list[dict], bool]:
    capped: list[dict] = []
    seen: set[int] = set()
    has_more = False
    for item in results:
        file_id = int(item["file_id"])
        if file_id not in seen and len(seen) >= file_limit:
            has_more = True
            continue
        seen.add(file_id)
        capped.append(item)
    return capped, has_more


def _slice_unique_files(results: list[dict], file_offset: int, file_limit: int) -> tuple[list[dict], bool]:
    sliced: list[dict] = []
    seen: set[int] = set()
    skipped: set[int] = set()
    has_more = False
    safe_offset = max(0, file_offset)
    for item in results:
        file_id = int(item["file_id"])
        if file_id in seen:
            if file_id not in skipped:
                sliced.append(item)
            continue
        if len(seen) < safe_offset:
            seen.add(file_id)
            skipped.add(file_id)
            continue
        if len(seen) >= safe_offset + file_limit:
            has_more = True
            continue
        seen.add(file_id)
        sliced.append(item)
    return sliced, has_more


def _filename_rows(
    query: str,
    file_types: list[str],
    limit: int,
    offset: int = 0,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    excluded_folder_paths: Optional[list[str]] = None,
    *,
    prefer_everything: bool = True,
    conn=None,
) -> tuple[list[dict], FilenameSearchTelemetry]:
    normalized_query = query.strip()
    telemetry = FilenameSearchTelemetry()
    if not normalized_query:
        telemetry.source = "empty"
        return [], telemetry

    if prefer_everything:
        discovery = discover_filename_candidates(normalized_query)
        telemetry.everything_queried_count = int(discovery.queried_count or 0)
        telemetry.everything_candidate_count = len(discovery.paths)
        if discovery.available and discovery.paths:
            rows = search_file_names_by_paths(
                normalized_query,
                discovery.paths,
                file_types=file_types,
                modified_from=modified_from,
                modified_to=modified_to,
                excluded_folder_paths=excluded_folder_paths,
                limit=limit,
                offset=offset,
                conn=conn,
            )
            if rows:
                telemetry.source = discovery.source or "everything_sdk"
                return rows, telemetry
            telemetry.fallback_reason = "no_registered_candidates"
        else:
            telemetry.fallback_reason = discovery.unavailable_reason or "empty_candidates"

    telemetry.source = "db_like"
    rows = search_file_names(
        normalized_query,
        file_types=file_types,
        modified_from=modified_from,
        modified_to=modified_to,
        excluded_folder_paths=excluded_folder_paths,
        limit=limit,
        offset=offset,
        conn=conn,
    )
    return rows, telemetry


def _file_info_to_filename_match(file_info: dict, normalized_query: str) -> dict:
    return {
        "file_id": file_info["id"],
        "name": file_info["name"],
        "path": file_info["path"],
        "file_type": file_info["file_type"],
        "location": "파일명",
        "snippet": make_search_snippet(file_info["name"], normalized_query, context=80),
        "normalized_hash": file_info.get("normalized_hash"),
        "content_hash": file_info.get("content_hash"),
        "content_chars": file_info.get("content_chars"),
        "chunk_count": file_info.get("chunk_count"),
        "file_mtime": file_info.get("file_mtime"),
    }


def _filename_matches(
    query: str,
    file_types: list[str],
    limit: int,
    offset: int = 0,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    excluded_folder_paths: Optional[list[str]] = None,
    *,
    prefer_everything: bool = True,
    conn=None,
) -> tuple[list[dict], FilenameSearchTelemetry]:
    normalized_query = query.strip()
    rows, telemetry = _filename_rows(
        normalized_query,
        file_types,
        limit,
        offset,
        modified_from,
        modified_to,
        excluded_folder_paths,
        prefer_everything=prefer_everything,
        conn=conn,
    )
    return [_file_info_to_filename_match(file_info, normalized_query) for file_info in rows], telemetry


def _content_matches(
    query: str,
    limit: int,
    file_types: list[str],
    file_limit: int,
    file_offset: int,
    per_file_limit: int,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    excluded_folder_paths: Optional[list[str]] = None,
    conn=None,
) -> list[dict]:
    return search(
        query,
        limit=limit,
        file_types=file_types,
        modified_from=modified_from,
        modified_to=modified_to,
        file_limit=file_limit,
        file_offset=file_offset,
        per_file_limit=per_file_limit,
        excluded_folder_paths=excluded_folder_paths,
        conn=conn,
    )


def _cache_key(
    req: SearchRequest,
    *,
    file_types: list[str],
    modified_from: Optional[float],
    modified_to: Optional[float],
    excluded_folder_paths: list[str],
    file_limit: int,
    file_offset: int,
    per_file_limit: int,
    query_limit: int,
    search_index_status: dict[str, Any],
    content_index_ready: bool,
    epoch: int,
) -> str:
    payload = {
        "version": 1,
        "epoch": epoch,
        "query": req.query,
        "limit": int(req.limit),
        "query_limit": int(query_limit),
        "file_limit": int(file_limit),
        "file_offset": int(file_offset),
        "per_file_limit": int(per_file_limit),
        "file_types": list(file_types),
        "search_scope": req.search_scope,
        "modified_from": modified_from,
        "modified_to": modified_to,
        "excluded_folder_paths": sorted(excluded_folder_paths),
        "search_index_state": str(search_index_status.get("state") or "ready"),
        "search_index_stale": not content_index_ready,
        "search_index_updated_at": search_index_status.get("updated_at"),
        "search_index_error": search_index_status.get("error"),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _log_search_request_done(
    *,
    started: float,
    request_id: str,
    req: SearchRequest,
    metrics: dict[str, Any],
    file_types: Optional[list[str]] = None,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    excluded_folder_paths: Optional[list[str]] = None,
    file_limit: Optional[int] = None,
    file_offset: Optional[int] = None,
    per_file_limit: Optional[int] = None,
    response: Optional[SearchResponse] = None,
    error: Optional[Exception] = None,
) -> None:
    payload: dict[str, Any] = {
        "request_id": request_id,
        "search_scope": req.search_scope,
        "raw_query_length": len(req.query),
        "file_type_count": len(file_types or []),
        "file_limit": file_limit,
        "file_offset": file_offset,
        "per_file_limit": per_file_limit,
        "excluded_folder_count": len(excluded_folder_paths or []),
        "has_modified_filter": modified_from is not None or modified_to is not None,
        "total_ms": elapsed_ms(started),
        "success": error is None,
        **metrics,
    }
    if response is not None:
        payload.update(
            {
                "row_count": response.total,
                "file_count": response.file_count,
                "has_more": response.has_more,
                "search_index_state": response.search_index_state,
                "search_index_stale": response.search_index_stale,
            }
        )
    if error is not None:
        payload.update({"error_type": error.__class__.__name__})
    log_index_perf("search_request_done", **payload)


def search_documents(req: SearchRequest) -> SearchResponse:
    """Run the provider/search use case without coupling callers to FastAPI."""

    request_started = perf_counter()
    request_id = uuid.uuid4().hex[:12]
    metrics: dict[str, Any] = {
        "cache_status": "disabled" if not search_cache_enabled() else "miss",
        "filename_source": "",
        "filename_fallback_reason": "",
        "everything_queried_count": 0,
        "everything_candidate_count": 0,
        "filename_ms": 0,
        "content_ms": 0,
        "merge_ms": 0,
    }
    file_types: list[str] = []
    modified_from: Optional[float] = None
    modified_to: Optional[float] = None
    excluded_folder_paths: list[str] = []
    file_limit: Optional[int] = None
    file_offset: Optional[int] = None
    per_file_limit: Optional[int] = None
    search_conn_cm = None
    search_conn = None

    try:
        search_conn_cm = _read_connection(row_factory=sqlite3.Row)
        search_conn = search_conn_cm.__enter__()
        normalize_started = perf_counter()
        search_index_status = get_search_index_status(conn=search_conn)
        content_index_ready = not bool(search_index_status.get("stale"))
        file_types = normalize_file_type_filters(req.file_types)
        modified_from = _parse_modified_bound(req.modified_from, end_of_day=False)
        modified_to = _parse_modified_bound(req.modified_to, end_of_day=True)
        excluded_folder_paths = [path for path in req.excluded_folder_paths if path.strip()]
        file_limit = _bounded_file_limit(req.file_limit)
        file_offset = max(0, req.file_offset)
        per_file_limit = _bounded_per_file_limit(req.per_file_limit)
        query_limit = min(
            max(req.limit, file_limit * per_file_limit),
            file_limit * (per_file_limit + 1),
        )
        fetch_file_limit = file_limit + 1
        metrics["normalize_ms"] = elapsed_ms(normalize_started)
        metrics["search_cache_epoch"] = current_epoch()

        cache_key = _cache_key(
            req,
            file_types=file_types,
            modified_from=modified_from,
            modified_to=modified_to,
            excluded_folder_paths=excluded_folder_paths,
            file_limit=file_limit,
            file_offset=file_offset,
            per_file_limit=per_file_limit,
            query_limit=query_limit,
            search_index_status=search_index_status,
            content_index_ready=content_index_ready,
            epoch=int(metrics["search_cache_epoch"]),
        )
        cache_started = perf_counter()
        cached_payload = get_search_cache(cache_key)
        metrics["cache_lookup_ms"] = elapsed_ms(cache_started)
        if cached_payload is not None:
            response = SearchResponse(**cached_payload)
            metrics["cache_status"] = "hit"
            metrics["filename_source"] = "cache"
            _log_search_request_done(
                started=request_started,
                request_id=request_id,
                req=req,
                metrics=metrics,
                file_types=file_types,
                modified_from=modified_from,
                modified_to=modified_to,
                excluded_folder_paths=excluded_folder_paths,
                file_limit=file_limit,
                file_offset=file_offset,
                per_file_limit=per_file_limit,
                response=response,
            )
            return response

        def remember_filename(telemetry: FilenameSearchTelemetry, elapsed: int) -> None:
            metrics["filename_ms"] = metrics.get("filename_ms", 0) + elapsed
            metrics["filename_source"] = telemetry.source
            metrics["filename_fallback_reason"] = telemetry.fallback_reason
            metrics["everything_queried_count"] = telemetry.everything_queried_count
            metrics["everything_candidate_count"] = telemetry.everything_candidate_count

        if req.search_scope == "filename":
            filename_started = perf_counter()
            name_matches, filename_telemetry = _filename_matches(
                req.query,
                file_types,
                fetch_file_limit,
                file_offset,
                modified_from,
                modified_to,
                excluded_folder_paths,
                conn=search_conn,
            )
            remember_filename(filename_telemetry, elapsed_ms(filename_started))
            merge_started = perf_counter()
            results, has_more = _cap_unique_files(name_matches, file_limit)
            metrics["merge_ms"] = elapsed_ms(merge_started)
        elif req.search_scope == "content":
            metrics["filename_source"] = "not_requested"
            if content_index_ready:
                content_started = perf_counter()
                results = _content_matches(
                    req.query,
                    limit=query_limit,
                    file_types=file_types,
                    file_limit=fetch_file_limit,
                    file_offset=file_offset,
                    per_file_limit=per_file_limit,
                    modified_from=modified_from,
                    modified_to=modified_to,
                    excluded_folder_paths=excluded_folder_paths,
                    conn=search_conn,
                )
                metrics["content_ms"] = elapsed_ms(content_started)
                merge_started = perf_counter()
                results, has_more = _cap_unique_files(results, file_limit)
                metrics["merge_ms"] = elapsed_ms(merge_started)
            else:
                results, has_more = [], False
        else:
            filename_started = perf_counter()
            name_matches, filename_telemetry = _filename_matches(
                req.query,
                file_types,
                file_offset + fetch_file_limit,
                0,
                modified_from,
                modified_to,
                excluded_folder_paths,
                conn=search_conn,
            )
            remember_filename(filename_telemetry, elapsed_ms(filename_started))
            merge_started = perf_counter()
            name_page, name_has_more = _slice_unique_files(name_matches, file_offset, file_limit)
            if len(name_page) >= file_limit and name_has_more:
                results, has_more = name_page, True
                metrics["merge_ms"] = elapsed_ms(merge_started)
            else:
                name_file_ids = {int(item["file_id"]) for item in name_matches}
                content_candidates = []
                if content_index_ready:
                    content_needed = max(1, file_offset + fetch_file_limit - _unique_file_count(name_matches))
                    content_file_limit = content_needed + len(name_file_ids)
                    content_started = perf_counter()
                    content_candidates = _content_matches(
                        req.query,
                        limit=max(query_limit, content_file_limit * per_file_limit),
                        file_types=file_types,
                        file_limit=content_file_limit,
                        file_offset=0,
                        per_file_limit=per_file_limit,
                        modified_from=modified_from,
                        modified_to=modified_to,
                        excluded_folder_paths=excluded_folder_paths,
                        conn=search_conn,
                    )
                    metrics["content_ms"] = elapsed_ms(content_started)
                content_results = []
                seen = {(item["file_id"], item["location"], item["snippet"]) for item in name_matches}
                for item in content_candidates:
                    key = (item["file_id"], item["location"], item["snippet"])
                    if key in seen:
                        continue
                    seen.add(key)
                    content_results.append(item)
                results, combined_has_more = _slice_unique_files(name_matches + content_results, file_offset, file_limit)
                has_more = name_has_more or combined_has_more
                metrics["merge_ms"] = elapsed_ms(merge_started)

        response = SearchResponse(
            query=req.query,
            total=len(results),
            results=[SearchResult(**result) for result in results],
            file_count=_unique_file_count(results),
            file_limit=file_limit,
            has_more=has_more and (file_offset + file_limit) < MAX_SEARCH_FILE_LIMIT,
            search_index_state=str(search_index_status.get("state") or "ready"),
            search_index_stale=not content_index_ready,
            search_index_updated_at=search_index_status.get("updated_at"),
            search_index_error=search_index_status.get("error"),
        )
        cache_store_started = perf_counter()
        set_search_cache(cache_key, response.model_dump())
        metrics["cache_store_ms"] = elapsed_ms(cache_store_started)
        _log_search_request_done(
            started=request_started,
            request_id=request_id,
            req=req,
            metrics=metrics,
            file_types=file_types,
            modified_from=modified_from,
            modified_to=modified_to,
            excluded_folder_paths=excluded_folder_paths,
            file_limit=file_limit,
            file_offset=file_offset,
            per_file_limit=per_file_limit,
            response=response,
        )
        return response
    except Exception as exc:
        _log_search_request_done(
            started=request_started,
            request_id=request_id,
            req=req,
            metrics=metrics,
            file_types=file_types,
            modified_from=modified_from,
            modified_to=modified_to,
            excluded_folder_paths=excluded_folder_paths,
            file_limit=file_limit,
            file_offset=file_offset,
            per_file_limit=per_file_limit,
            error=exc,
        )
        raise
    finally:
        if search_conn_cm is not None:
            search_conn_cm.__exit__(None, None, None)
