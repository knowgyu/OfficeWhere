import logging
import os
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..database import (
    get_all_files,
    get_setting,
    save_file_chunks,
    search_chunks,
    set_setting,
    update_file_mtime,
)
from .excel_analysis import extract_excel_used_range, inspect_excel_file_with_recovery
from .parser import get_file_type
from .ppt_analysis import extract_ppt_slides, inspect_ppt_file
from .text_analysis import extract_text_blocks, inspect_text_file
from ..runtime import get_worker_count
from .word_analysis import extract_word_blocks, inspect_word_file

logger = logging.getLogger(__name__)

_scheduler_thread: threading.Thread | None = None
_MAX_WORKERS = get_worker_count()


def _excel_used_range_chunks(path: str) -> List[Dict[str, str]]:
    df, config = extract_excel_used_range(path)
    chunks: List[Dict[str, str]] = []

    sheet_name = config["sheet_name"]
    for dataframe_index, row in df.iterrows():
        excel_row = int(dataframe_index) + 1
        for column, value in row.items():
            text = str(value).strip()
            if text:
                chunks.append(
                    {
                        "location": f"{sheet_name} 시트 | {excel_row}행 {column}열",
                        "content": text,
                    }
                )

    return chunks


def _inspect_and_chunk_excel(path: str, parser_config: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    inspection = inspect_excel_file_with_recovery(path, parser_config=parser_config)
    chunks = _excel_used_range_chunks(path)
    return inspection, chunks


def _inspect_and_chunk_word(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    inspection = inspect_word_file(path)
    blocks = extract_word_blocks(path)
    chunks = [{"location": block["location"], "content": block["text"]} for block in blocks]
    return inspection, chunks


def _inspect_and_chunk_pptx(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    inspection = inspect_ppt_file(path)
    slides = extract_ppt_slides(path)
    chunks: List[Dict[str, str]] = []
    for slide in slides:
        if slide["title"]:
            chunks.append({"location": f"슬라이드 {slide['slide_number']} 제목", "content": slide["title"]})
        for item in slide["items"]:
            chunks.append(
                {
                    "location": f"슬라이드 {slide['slide_number']} | {item['location']}",
                    "content": item["text"],
                }
            )
    return inspection, chunks


def _inspect_and_chunk_text(path: str) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    inspection = inspect_text_file(path)
    blocks = extract_text_blocks(path)
    chunks = [{"location": block["location"], "content": block["text"]} for block in blocks]
    return inspection, chunks


def inspect_and_chunk(path: str, parser_config: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    ext = Path(path).suffix.lower()
    if ext in (".xlsx", ".xls"):
        inspection, chunks = _inspect_and_chunk_excel(path, parser_config=parser_config)
    elif ext == ".docx":
        inspection, chunks = _inspect_and_chunk_word(path)
    elif ext == ".pptx":
        inspection, chunks = _inspect_and_chunk_pptx(path)
    elif ext in (".txt", ".md"):
        inspection, chunks = _inspect_and_chunk_text(path)
    else:
        raise ValueError(f"지원하지 않는 파일 형식: {ext}")

    return {
        "name": Path(path).name,
        "file_type": get_file_type(path),
        "columns": inspection["columns"],
        "parser_config": inspection["parser_config"],
        "table_candidates": inspection.get("table_candidates", []),
        "sample": inspection["sample"],
    }, chunks


def index_file(file_id: int, path: str, parser_config: Optional[Dict[str, Any]] = None) -> int:
    ext = Path(path).suffix.lower()
    if ext in (".xlsx", ".xls"):
        chunks = _excel_used_range_chunks(path)
    elif ext == ".docx":
        _, chunks = _inspect_and_chunk_word(path)
    elif ext == ".pptx":
        _, chunks = _inspect_and_chunk_pptx(path)
    elif ext in (".txt", ".md"):
        _, chunks = _inspect_and_chunk_text(path)
    else:
        return 0

    save_file_chunks(file_id, chunks)
    update_file_mtime(file_id, os.path.getmtime(path))
    return len(chunks)


def _sanitize_fts_query(raw: str) -> str:
    raw = re.sub(r'["\*\(\)\[\]\{\}\^~\?\\]', " ", raw)
    words = raw.split()
    if not words:
        return '""'
    return " ".join(f'"{word}"' for word in words)


def search(
    query: str,
    limit: int = 100,
    file_types: Optional[Sequence[str]] = None,
    modified_from: Optional[float] = None,
    modified_to: Optional[float] = None,
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
    )


def reindex_all() -> Dict[str, int]:
    from concurrent.futures import ThreadPoolExecutor

    files = get_all_files()

    def _reindex_one(file_info: Dict[str, Any]) -> str:
        path = file_info["path"]
        if not os.path.exists(path):
            return "failed"
        try:
            index_file(file_info["id"], path, parser_config=file_info.get("parser_config"))
            return "success"
        except Exception:
            diagnostic_id = uuid.uuid4().hex[:8]
            logger.exception("index_file failed diagnostic_id=%s path=%s", diagnostic_id, path)
            return "failed"

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        outcomes = list(executor.map(_reindex_one, files))

    set_setting("last_reindex_at", datetime.now().isoformat())
    return {"success": outcomes.count("success"), "failed": outcomes.count("failed"), "skipped": 0}


def _do_reindex_incremental():
    files = get_all_files()
    for file_info in files:
        path = file_info["path"]
        if not os.path.exists(path):
            continue
        try:
            current_mtime = os.path.getmtime(path)
            stored_mtime = file_info.get("file_mtime")
            if stored_mtime is not None and abs(current_mtime - stored_mtime) < 1.0:
                continue
            index_file(file_info["id"], path, parser_config=file_info.get("parser_config"))
        except Exception:
            diagnostic_id = uuid.uuid4().hex[:8]
            logger.exception("incremental index failed diagnostic_id=%s path=%s", diagnostic_id, path)

    set_setting("last_reindex_at", datetime.now().isoformat())


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


def start_scheduler():
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name="reindex-scheduler")
    _scheduler_thread.start()
