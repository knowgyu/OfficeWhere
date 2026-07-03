import logging
import os
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..database import (
    COMPARISON_ARTIFACT_VERSION,
    PPT_COMPARISON_ARTIFACT_KIND,
    PPT_COMPARISON_PARSER_VERSION,
    WORD_COMPARISON_ARTIFACT_KIND,
    WORD_COMPARISON_PARSER_VERSION,
    delete_files_by_extensions,
    delete_files_by_types,
    get_all_files,
    get_excel_index_status,
    get_search_index_status,
    get_setting,
    prune_unsupported_file_extensions,
    repair_excel_index_version,
    repair_search_indexes,
    save_file_chunks,
    search_chunks,
    set_setting,
    update_file_mtime,
    UNSUPPORTED_EXTENSION_PRUNE_VERSION,
    UNSUPPORTED_EXTENSION_PRUNE_VERSION_KEY,
)
from .excel_analysis import extract_excel_used_ranges
from .file_scope import SUPPORTED_EXTENSIONS
from .index_perf import elapsed_ms, log_index_perf, log_parse_perf, timed_ms
from .pdf_analysis import extract_pdf_pages, inspect_pdf_pages
from .parser import get_file_type
from .ppt_analysis import extract_ppt_slides, inspect_ppt_slides
from ..runtime import get_worker_count
from .search_cache import bump_search_cache_epoch
from .word_analysis import extract_word_blocks, inspect_word_blocks

logger = logging.getLogger(__name__)

_scheduler_thread: threading.Thread | None = None
_startup_repair_thread: threading.Thread | None = None
_MAX_WORKERS = get_worker_count()


def _word_comparison_artifact(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "artifact_kind": WORD_COMPARISON_ARTIFACT_KIND,
        "file_type": "Word",
        "artifact_version": COMPARISON_ARTIFACT_VERSION,
        "parser_version": WORD_COMPARISON_PARSER_VERSION,
        "payload": {"blocks": blocks},
    }


def _ppt_comparison_artifact(slides: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "artifact_kind": PPT_COMPARISON_ARTIFACT_KIND,
        "file_type": "PowerPoint",
        "artifact_version": COMPARISON_ARTIFACT_VERSION,
        "parser_version": PPT_COMPARISON_PARSER_VERSION,
        "payload": {"slides": slides},
    }


def _excel_preview_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _excel_used_range_inspection_and_chunks(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    started = time.perf_counter()
    metrics: Dict[str, Any] = {
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    }
    try:
        chunks: List[Dict[str, str]] = []
        excel_cells: List[Dict[str, Any]] = []
        used_ranges = extract_excel_used_ranges(path)
        excel_sheets = [used_range.sheet_summary() for used_range in used_ranges]

        for used_range in used_ranges:
            sheet_name = used_range.sheet_name
            sheet_index = used_range.sheet_index
            for cell in used_range.iter_non_empty_cells():
                location = f"{sheet_name} 시트 | {cell['row_number']}행 {cell['column_letter']}열"
                chunks.append(
                    {
                        "location": location,
                        "content": cell["text"],
                    }
                )
                excel_cells.append(
                    {
                        "sheet_name": sheet_name,
                        "sheet_index": sheet_index,
                        "row_number": cell["row_number"],
                        "column_index": cell["column_index"],
                        "column_letter": cell["column_letter"],
                        "content": cell["text"],
                        "location": location,
                    }
                )

        preview_range = next((item for item in used_ranges if item.non_empty_cell_count > 0), used_ranges[0])
        range_config = preview_range.range_config
        sheet_name = range_config["sheet_name"]
        columns = preview_range.preview_columns()
        sample = [
            [_excel_preview_text(value) for value in row]
            for row in preview_range.preview_sample()
        ]
        inspection = {
            "columns": columns,
            "sample": sample,
            "excel_sheets": excel_sheets,
            "excel_cells": excel_cells,
        }

        metrics.update(
            success=True,
            sheet_name=sheet_name,
            sheet_count=len(used_ranges),
            row_count=sum(item.row_count for item in used_ranges),
            column_count=max((item.column_count for item in used_ranges), default=0),
            chunk_count=len(chunks),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("excel_used_range_chunks_done", **metrics)
        return inspection, chunks
    except Exception as exc:
        metrics.update(
            success=False,
            error_type=exc.__class__.__name__,
            error=str(exc),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("excel_used_range_chunks_done", **metrics)
        raise


def _inspect_and_chunk_excel(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    started = time.perf_counter()
    metrics: Dict[str, Any] = {
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    }
    try:
        inspection, chunks = timed_ms(metrics, "used_range_chunk_ms", lambda: _excel_used_range_inspection_and_chunks(path))
        metrics.update(
            success=True,
            file_type="Excel",
            chunk_count=len(chunks),
            column_count=len(inspection["columns"]),
            total_ms=elapsed_ms(started),
        )
        log_parse_perf("excel_inspect_and_chunk_done", **metrics)
        return inspection, chunks
    except Exception as exc:
        metrics.update(
            success=False,
            error_type=exc.__class__.__name__,
            error=str(exc),
            total_ms=elapsed_ms(started),
        )
        log_parse_perf("excel_inspect_and_chunk_done", **metrics)
        raise

def _inspect_and_chunk_word(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    started = time.perf_counter()
    metrics: Dict[str, Any] = {
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    }
    try:
        blocks = extract_word_blocks(path)
        inspection = inspect_word_blocks(blocks)
        inspection["comparison_artifacts"] = [_word_comparison_artifact(blocks)]
        chunks = [
            {"location": f"쪽 {int(block.get('page_number') or 1)}", "content": block["text"]}
            for block in blocks
        ]
        metrics.update(
            success=True,
            file_type="Word",
            block_count=len(blocks),
            chunk_count=len(chunks),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("word_parse_done", **metrics)
        return inspection, chunks
    except Exception as exc:
        metrics.update(
            success=False,
            file_type="Word",
            error_type=exc.__class__.__name__,
            error=str(exc),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("word_parse_done", **metrics)
        raise


def _inspect_and_chunk_pptx(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    started = time.perf_counter()
    metrics: Dict[str, Any] = {
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    }
    try:
        slides = extract_ppt_slides(path)
        inspection = inspect_ppt_slides(slides)
        inspection["comparison_artifacts"] = [_ppt_comparison_artifact(slides)]
        chunks: List[Dict[str, str]] = []
        for slide in slides:
            slide_location = f"슬라이드 {slide['slide_number']}"
            if slide["title"]:
                chunks.append({"location": slide_location, "content": slide["title"]})
            for item in slide["items"]:
                chunks.append(
                    {
                        "location": slide_location,
                        "content": item["text"],
                    }
                )
        metrics.update(
            success=True,
            file_type="PowerPoint",
            slide_count=len(slides),
            chunk_count=len(chunks),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("ppt_parse_done", **metrics)
        return inspection, chunks
    except Exception as exc:
        metrics.update(
            success=False,
            file_type="PowerPoint",
            error_type=exc.__class__.__name__,
            error=str(exc),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("ppt_parse_done", **metrics)
        raise


def _inspect_and_chunk_pdf(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    started = time.perf_counter()
    metrics: Dict[str, Any] = {
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    }
    try:
        pages = extract_pdf_pages(path)
        inspection = inspect_pdf_pages(pages)
        chunks = [
            {"location": page["location"], "content": page["text"]}
            for page in pages
        ]
        metrics.update(
            success=True,
            file_type="PDF",
            page_count_with_text=len(pages),
            chunk_count=len(chunks),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("pdf_parse_done", **metrics)
        return inspection, chunks
    except Exception as exc:
        metrics.update(
            success=False,
            file_type="PDF",
            error_type=exc.__class__.__name__,
            error=str(exc),
            duration_ms=elapsed_ms(started),
        )
        log_parse_perf("pdf_parse_done", **metrics)
        raise


def inspect_and_chunk(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    ext = Path(path).suffix.lower()
    if ext == ".xlsx":
        inspection, chunks = _inspect_and_chunk_excel(path)
    elif ext == ".docx":
        inspection, chunks = _inspect_and_chunk_word(path)
    elif ext == ".pptx":
        inspection, chunks = _inspect_and_chunk_pptx(path)
    elif ext == ".pdf":
        inspection, chunks = _inspect_and_chunk_pdf(path)
    else:
        raise ValueError(f"지원하지 않는 파일 형식: {ext}")

    return {
        "name": Path(path).name,
        "file_type": get_file_type(path),
        "columns": inspection["columns"],
        "sample": inspection["sample"],
        "excel_sheets": inspection.get("excel_sheets", []),
        "excel_cells": inspection.get("excel_cells", []),
        "comparison_artifacts": inspection.get("comparison_artifacts", []),
    }, chunks


def index_file(file_id: int, path: str) -> int:
    started = time.perf_counter()
    metrics: Dict[str, Any] = {
        "operation": "reindex_file",
        "file_id": file_id,
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
    }
    ext = Path(path).suffix.lower()
    try:
        stat_result = timed_ms(metrics, "stat_ms", lambda: os.stat(path))
        metrics["size_bytes"] = stat_result.st_size
        excel_index_payload: Dict[str, Any] = {}
        if ext == ".xlsx":
            inspection, chunks = timed_ms(metrics, "inspect_chunk_ms", lambda: _excel_used_range_inspection_and_chunks(path))
            excel_index_payload = {
                "excel_sheets": inspection.get("excel_sheets", []),
                "excel_cells": inspection.get("excel_cells", []),
            }
        elif ext == ".docx":
            inspection, chunks = timed_ms(metrics, "inspect_chunk_ms", lambda: _inspect_and_chunk_word(path))
            excel_index_payload = {
                "comparison_artifacts": inspection.get("comparison_artifacts", []),
            }
        elif ext == ".pptx":
            inspection, chunks = timed_ms(metrics, "inspect_chunk_ms", lambda: _inspect_and_chunk_pptx(path))
            excel_index_payload = {
                "comparison_artifacts": inspection.get("comparison_artifacts", []),
            }
        elif ext == ".pdf":
            inspection, chunks = timed_ms(metrics, "inspect_chunk_ms", lambda: _inspect_and_chunk_pdf(path))
            excel_index_payload = {}
        else:
            log_index_perf(
                "file_done",
                **metrics,
                action="skipped",
                success=True,
                reason="unsupported_extension",
                chunk_count=0,
                total_ms=elapsed_ms(started),
            )
            return 0

        timed_ms(metrics, "save_ms", lambda: save_file_chunks(file_id, chunks, **excel_index_payload))
        timed_ms(metrics, "mtime_update_ms", lambda: update_file_mtime(file_id, stat_result.st_mtime))
        metrics.update(
            action="reindexed",
            success=True,
            chunk_count=len(chunks),
            total_ms=elapsed_ms(started),
        )
        log_index_perf("file_done", **metrics)
    except Exception as exc:
        metrics.update(
            action="failed",
            success=False,
            error_type=exc.__class__.__name__,
            error=str(exc),
            total_ms=elapsed_ms(started),
        )
        log_index_perf("file_done", **metrics)
        raise
    return len(chunks)


def _sanitize_fts_query(raw: str) -> str:
    raw = re.sub(r'["\*\(\)\[\]\{\}\^~\?\\]', " ", raw)
    words = raw.split()
    if not words:
        return '""'
    if len(words) > 1:
        return f'"{" ".join(words)}"'
    return f'"{words[0]}"'


def search(
    query: str,
    limit: int = 100,
    file_types: Optional[Sequence[str]] = None,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
    file_limit: Optional[int] = None,
    file_offset: int = 0,
    per_file_limit: int = 3,
    excluded_folder_paths: Optional[Sequence[str]] = None,
    conn: Optional[sqlite3.Connection] = None,
    metrics: Optional[Dict[str, Any]] = None,
) -> list:
    if not query.strip():
        return []
    return search_chunks(
        _sanitize_fts_query(query),
        limit=limit,
        file_types=file_types,
        raw_query=query,
        modified_from=modified_from,
        modified_to=modified_to,
        file_limit=file_limit,
        file_offset=file_offset,
        per_file_limit=per_file_limit,
        excluded_folder_paths=excluded_folder_paths,
        conn=conn,
        metrics=metrics,
    )


def reindex_all() -> Dict[str, int]:
    from concurrent.futures import ThreadPoolExecutor

    pruned_legacy = delete_files_by_types(["Text", "Markdown"]) + delete_files_by_extensions([".xls"])
    files = get_all_files(include_missing=False)

    def _reindex_one(file_info: Dict[str, Any]) -> str:
        path = file_info["path"]
        if Path(path).suffix.lower() not in SUPPORTED_EXTENSIONS:
            return "skipped"
        if not os.path.exists(path):
            return "failed"
        try:
            index_file(file_info["id"], path)
            return "success"
        except Exception:
            diagnostic_id = uuid.uuid4().hex[:8]
            logger.exception("index_file failed diagnostic_id=%s path=%s", diagnostic_id, path)
            return "failed"

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        outcomes = list(executor.map(_reindex_one, files))

    set_setting("last_reindex_at", datetime.now().isoformat())
    bump_search_cache_epoch("reindex_all_done")
    return {
        "success": outcomes.count("success"),
        "failed": outcomes.count("failed"),
        "skipped": pruned_legacy + outcomes.count("skipped"),
    }


def _do_reindex_incremental():
    files = get_all_files(include_missing=False)
    for file_info in files:
        path = file_info["path"]
        if not os.path.exists(path):
            continue
        try:
            current_mtime = os.path.getmtime(path)
            stored_mtime = file_info.get("file_mtime")
            if stored_mtime is not None and abs(current_mtime - stored_mtime) < 1.0:
                continue
            index_file(file_info["id"], path)
        except Exception:
            diagnostic_id = uuid.uuid4().hex[:8]
            logger.exception("incremental index failed diagnostic_id=%s path=%s", diagnostic_id, path)

    set_setting("last_reindex_at", datetime.now().isoformat())
    bump_search_cache_epoch("incremental_reindex_done")


def _scheduler_loop():
    import time

    from .library import rescan_library, should_auto_rescan

    while True:
        time.sleep(60)
        try:
            if should_auto_rescan():
                rescan_library()

            mode = get_setting("reindex_mode", "manual")
            if mode == "manual":
                continue
            if mode == "interval":
                interval_hours = float(get_setting("reindex_interval_hours", "24"))
                last_str = get_setting("last_reindex_at", "")
                if last_str:
                    last_dt = datetime.fromisoformat(last_str)
                    elapsed_hours = (datetime.now() - last_dt).total_seconds() / 3600
                    if elapsed_hours < interval_hours:
                        continue
                _do_reindex_incremental()
            elif mode == "daily":
                target_str = get_setting("reindex_daily_time", "03:00")
                now = datetime.now()
                try:
                    target_h, target_m = map(int, target_str.split(":"))
                except ValueError:
                    continue
                last_str = get_setting("last_reindex_at", "")
                target_today = now.replace(hour=target_h, minute=target_m, second=0, microsecond=0)
                if now >= target_today:
                    if last_str:
                        last_dt = datetime.fromisoformat(last_str)
                        if last_dt.date() >= now.date():
                            continue
                    _do_reindex_incremental()
        except Exception:
            diagnostic_id = uuid.uuid4().hex[:8]
            logger.exception("scheduler error diagnostic_id=%s", diagnostic_id)


def _startup_derived_index_repair_loop():
    try:
        prune_unsupported_file_extensions(reason="startup_background")

        excel_status = get_excel_index_status()
        if excel_status.get("stale"):
            repair_excel_index_version(reason="startup_background")

        search_status = get_search_index_status()
        if search_status.get("stale"):
            repair_search_indexes(reason="startup_background")
    except Exception:
        diagnostic_id = uuid.uuid4().hex[:8]
        logger.exception("startup derived index repair failed diagnostic_id=%s", diagnostic_id)


def start_startup_derived_index_repair():
    """Kick off rebuildable index repair without delaying backend health."""

    global _startup_repair_thread
    if _startup_repair_thread and _startup_repair_thread.is_alive():
        return

    try:
        needs_prune = get_setting(
            UNSUPPORTED_EXTENSION_PRUNE_VERSION_KEY, ""
        ) != UNSUPPORTED_EXTENSION_PRUNE_VERSION
        needs_repair = bool(
            needs_prune or get_excel_index_status().get("stale") or get_search_index_status().get("stale")
        )
    except Exception:
        diagnostic_id = uuid.uuid4().hex[:8]
        logger.exception("startup derived index repair status check failed diagnostic_id=%s", diagnostic_id)
        return
    if not needs_repair:
        return

    _startup_repair_thread = threading.Thread(
        target=_startup_derived_index_repair_loop,
        daemon=True,
        name="startup-derived-index-repair",
    )
    _startup_repair_thread.start()


def start_scheduler():
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name="reindex-scheduler")
    _scheduler_thread.start()
