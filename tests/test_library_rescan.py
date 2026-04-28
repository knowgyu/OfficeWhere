from backend.core.library import save_library_settings
from backend.database import get_all_files, init_db, register_file
from backend.models.schemas import LibraryRescanRequest, LibrarySettings


def _write_excel(path, data: dict):
    import pandas as pd

    pd.DataFrame(data).to_excel(path, index=False)


def test_library_settings_interval_is_floored_and_minimum(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    saved = save_library_settings(LibrarySettings(auto_rescan_interval_hours=1.9))
    assert saved.auto_rescan_interval_hours == 1

    saved = save_library_settings(LibrarySettings(auto_rescan_interval_hours=0.2))
    assert saved.auto_rescan_interval_hours == 1


def test_library_settings_fast_worker_count_is_bounded_to_ui_steps(tmp_path, monkeypatch):
    from backend.core.library import load_library_settings
    from backend.database import set_setting

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    saved = save_library_settings(LibrarySettings(fast_worker_count=3))
    assert saved.fast_worker_count == 4

    saved = save_library_settings(LibrarySettings(fast_worker_count=26))
    assert saved.fast_worker_count == 28

    saved = save_library_settings(LibrarySettings(fast_worker_count=99))
    assert saved.fast_worker_count == 32

    set_setting("library_settings", LibrarySettings(fast_worker_count=48).model_dump_json())
    assert load_library_settings().fast_worker_count == 32


def test_library_settings_excluded_folder_names_are_normalized(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    saved = save_library_settings(
        LibrarySettings(excluded_folder_names=[" node_modules ", "NODE_MODULES", "", ".git"])
    )

    assert saved.excluded_folder_names == ["node_modules", ".git"]


def test_cancel_library_rescan_marks_running_job(tmp_path, monkeypatch):
    import time

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    def slow_collect(_path, _recursive, _excluded_folder_names=None):
        time.sleep(0.2)
        return library._ScanCollection(paths=[])

    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", slow_collect)

    library.start_library_rescan()
    cancelling = library.cancel_library_rescan()

    assert cancelling.cancel_requested is True
    assert cancelling.stage == "cancelling"

    deadline = time.time() + 2
    status = library.get_library_rescan_status()
    while status.running and time.time() < deadline:
        time.sleep(0.05)
        status = library.get_library_rescan_status()

    assert status.running is False
    assert status.stage == "cancelled"


def test_start_library_rescan_fast_status_and_running_job_mode_are_stable(tmp_path, monkeypatch):
    import time

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    monkeypatch.setattr("backend.core.library.get_fast_worker_count", lambda _configured=None: 12)
    init_db()
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    collect_calls = 0

    def slow_collect(_path, _recursive, _excluded_folder_names=None):
        nonlocal collect_calls
        collect_calls += 1
        time.sleep(0.2)
        return library._ScanCollection(paths=[])

    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", slow_collect)

    first = library.start_library_rescan(mode="fast")
    second = library.start_library_rescan(mode="normal")

    assert first.mode == "fast"
    assert first.worker_count == 12
    assert second.mode == "fast"
    assert second.worker_count == 12

    deadline = time.time() + 2
    status = library.get_library_rescan_status()
    while status.running and time.time() < deadline:
        time.sleep(0.05)
        status = library.get_library_rescan_status()

    assert status.running is False
    assert collect_calls == 1


def test_direct_rescan_skips_when_another_rescan_is_running(tmp_path, monkeypatch):
    import threading
    import time

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    entered = threading.Event()
    release = threading.Event()

    def slow_collect(_path, _recursive, _excluded_folder_names=None):
        entered.set()
        release.wait(2)
        return library._ScanCollection(paths=[])

    events = []
    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", slow_collect)
    monkeypatch.setattr(library, "log_index_perf", lambda event, **fields: events.append((event, fields)))

    thread = threading.Thread(target=library.rescan_library, daemon=True)
    thread.start()
    assert entered.wait(1)

    skipped = library.rescan_library()

    release.set()
    thread.join(2)

    assert skipped.registered == 0
    assert any(event == "rescan_skipped" and fields["reason"] == "already_running" for event, fields in events)


def test_async_rescan_holds_execution_token_for_scheduler_calls(tmp_path, monkeypatch):
    import threading
    import time

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    entered = threading.Event()
    release = threading.Event()

    def slow_collect(_path, _recursive, _excluded_folder_names=None):
        entered.set()
        release.wait(2)
        return library._ScanCollection(paths=[])

    events = []
    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", slow_collect)
    monkeypatch.setattr(library, "log_index_perf", lambda event, **fields: events.append((event, fields)))

    started = library.start_library_rescan(mode="fast")
    skipped = library.rescan_library(mode="normal")

    assert started.running is True
    assert skipped.registered == 0
    assert any(event == "rescan_skipped" and fields["mode"] == "normal" for event, fields in events)

    assert entered.wait(1)
    release.set()

    deadline = time.time() + 2
    status = library.get_library_rescan_status()
    while status.running and time.time() < deadline:
        time.sleep(0.05)
        status = library.get_library_rescan_status()

    assert status.running is False


def test_library_rescan_request_rejects_invalid_mode():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        LibraryRescanRequest(mode="turbo")


def test_classify_index_error_parser_config_out_of_range():
    from backend.core.library import classify_index_error

    diagnostic = classify_index_error(ValueError("parser_config row 범위가 시트 크기를 벗어났습니다."), "bad.xlsx")

    assert diagnostic["error_code"] == "parser_config_out_of_range"
    assert diagnostic["error_stage"] == "parser_config"
    assert "표 범위" in diagnostic["error_hint"]


def test_classify_index_error_index_error_is_user_safe():
    from backend.core.library import classify_index_error

    diagnostic = classify_index_error(IndexError("list index out of range"), "bad.xlsx")

    assert diagnostic["error_code"] == "unsupported_or_corrupt_file"
    assert diagnostic["error_stage"] == "office_parser"
    assert "traceback" not in diagnostic["error_hint"].lower()


def test_classify_index_error_database_locked_is_specific():
    import sqlite3

    from backend.core.library import classify_index_error

    diagnostic = classify_index_error(sqlite3.OperationalError("database is locked"), "large.docx")

    assert diagnostic["error_code"] == "database_locked"
    assert diagnostic["error_stage"] == "database"
    assert "새로고침" in diagnostic["error_hint"]


def test_collect_supported_paths_filters_supported_files_once(tmp_path):
    from pathlib import Path

    from backend.core.library import _collect_supported_paths

    (tmp_path / "report.xlsx").write_text("x")
    (tmp_path / "note.md").write_text("x")
    (tmp_path / "~$temp.xlsx").write_text("x")
    (tmp_path / "image.png").write_text("x")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "deck.pptx").write_text("x")
    excluded = tmp_path / "node_modules"
    excluded.mkdir()
    (excluded / "hidden.docx").write_text("x")
    similarly_named = tmp_path / "my-node_modules-docs"
    similarly_named.mkdir()
    (similarly_named / "kept.docx").write_text("x")

    recursive = _collect_supported_paths(str(tmp_path), recursive=True)
    flat = _collect_supported_paths(str(tmp_path), recursive=False)

    assert {tmp_path / "report.xlsx", nested / "deck.pptx", similarly_named / "kept.docx"} == {
        Path(path) for path in recursive
    }
    assert {tmp_path / "report.xlsx"} == {Path(path) for path in flat}


def test_collect_supported_paths_skips_inaccessible_start_menu_junction(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core.library import _collect_supported_paths_with_stats

    report = tmp_path / "report.docx"
    report.write_text("x")
    start_menu = tmp_path / "시작 메뉴"
    start_menu.mkdir()

    original_is_dir = Path.is_dir

    def guarded_is_dir(path):
        if path == start_menu:
            raise PermissionError("[WinError 5] 액세스가 거부되었습니다")
        return original_is_dir(path)

    monkeypatch.setattr(Path, "is_dir", guarded_is_dir)

    result = _collect_supported_paths_with_stats(str(tmp_path), recursive=True)

    assert result.paths == [str(report)]
    assert result.inaccessible_dir_count == 1
    assert result.inaccessible_dirs_by_name == {"시작 메뉴": 1}


def test_rescan_failure_result_includes_diagnostic_fields(tmp_path, monkeypatch, caplog):
    from backend.core import library

    caplog.set_level("ERROR", logger="backend.core.library")
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    target = tmp_path / "bad.xlsx"
    target.write_bytes(b"not a real workbook")
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[str(target)]))

    def fail_inspect(_path, parser_config=None):
        raise ValueError("parser_config row 범위가 시트 크기를 벗어났습니다.")

    monkeypatch.setattr(library, "inspect_and_chunk", fail_inspect)

    response = library.rescan_library()

    assert response.failed == 1
    result = response.results[0]
    assert result.diagnostic_id
    assert result.error_code == "parser_config_out_of_range"
    assert result.error_hint
    assert result.diagnostic_id in caplog.text


def test_rescan_excel_refreshes_parser_config_and_indexes_used_range(tmp_path, monkeypatch):
    import os
    import time

    from backend.core import library
    from backend.core.indexer import search

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    target = tmp_path / "budget.xlsx"
    _write_excel(target, {"ID": ["A"], "담당자": ["Kim"]})
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    first = library.rescan_library()
    assert first.failed == 0
    assert first.registered == 1
    first_row = get_all_files()[0]
    assert first_row["parser_config"]["end_col"] == 2

    stale_parser_config = {
        "sheet_name": "Sheet1",
        "header_row": 1,
        "start_col": 1,
        "end_col": 99,
        "end_row": 99,
    }
    register_file(str(target), target.name, "Excel", "ID", 99, parser_config=stale_parser_config)

    repaired = library.rescan_library()

    assert repaired.failed == 0
    assert repaired.updated == 1
    repaired_row = get_all_files()[0]
    assert repaired_row["parser_config"]["end_col"] == 2

    _write_excel(target, {"ID": ["A"], "담당자": ["Kim"], "새열": ["새값"]})
    next_mtime = time.time() + 3
    os.utime(target, (next_mtime, next_mtime))

    second = library.rescan_library()

    assert second.failed == 0
    assert second.updated == 1
    updated_row = get_all_files()[0]
    assert updated_row["parser_config"]["end_col"] == 3
    assert search("새값")[0]["location"] == "Sheet1 시트 | 2행 C열"


def test_fast_rescan_skips_unchanged_stale_excel_config_but_normal_repairs(tmp_path, monkeypatch):
    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    target = tmp_path / "budget.xlsx"
    _write_excel(target, {"ID": ["A"], "담당자": ["Kim"]})
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    first = library.rescan_library(mode="normal")
    assert first.registered == 1

    stale_parser_config = {
        "sheet_name": "Sheet1",
        "header_row": 1,
        "start_col": 1,
        "end_col": 99,
        "end_row": 99,
    }
    register_file(str(target), target.name, "Excel", "ID", 99, parser_config=stale_parser_config)

    fast = library.rescan_library(mode="fast")
    assert fast.skipped == 1
    assert get_all_files()[0]["parser_config"]["end_col"] == 99

    repaired = library.rescan_library(mode="normal")
    assert repaired.updated == 1
    assert get_all_files()[0]["parser_config"]["end_col"] == 2


def test_rescan_registers_excel_without_detected_key_for_version_review(tmp_path, monkeypatch):
    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    target = tmp_path / "layout-only.xlsx"
    target.write_bytes(b"placeholder")
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[str(target)]))
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda _path, parser_config=None: (
            {
                "name": target.name,
                "file_type": "Excel",
                "columns": [],
                "parser_config": {},
            },
            [{"location": "Sheet1 시트 | 1행 A열", "content": "표가 아닌 메모"}],
        ),
    )

    response = library.rescan_library()

    assert response.failed == 0
    assert response.registered == 1
    row = get_all_files()[0]
    assert row["key_column"] == ""


def test_parallel_indexed_file_saves_do_not_compete_for_sqlite_writer(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from backend.database import save_indexed_file

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    def save_one(index: int) -> int:
        return save_indexed_file(
            path=str(tmp_path / f"note-{index}.docx"),
            name=f"note-{index}.docx",
            file_type="Word",
            key_column="",
            column_count=0,
            chunks=[{"location": "문단", "content": f"동시 저장 샘플 {index}"}],
            file_mtime=float(index),
            parser_config={},
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        file_ids = list(executor.map(save_one, range(40)))

    assert len(set(file_ids)) == 40
    assert len(get_all_files()) == 40


def test_save_indexed_files_batch_indexes_multiple_files_in_one_commit(tmp_path, monkeypatch):
    from backend.core.indexer import search
    from backend.database import prepare_indexed_file, save_indexed_files_batch

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    payloads = [
        prepare_indexed_file(
            path=str(tmp_path / f"note-{index}.docx"),
            name=f"note-{index}.docx",
            file_type="Word",
            key_column="",
            column_count=0,
            chunks=[{"location": "문단", "content": f"배치 저장 샘플 {index}"}],
            file_mtime=float(index),
            parser_config={},
        )
        for index in range(3)
    ]

    file_ids = save_indexed_files_batch(payloads)

    assert len(set(file_ids)) == 3
    assert len(get_all_files()) == 3
    assert search("배치 저장 샘플", file_limit=3)


def test_save_indexed_files_batch_replaces_chunks_and_fingerprint(tmp_path, monkeypatch):
    from backend.core.indexer import search
    from backend.database import get_file_fingerprints, prepare_indexed_file, save_indexed_files_batch

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    target = tmp_path / "note.docx"
    first_payload = prepare_indexed_file(
        path=str(target),
        name=target.name,
        file_type="Word",
        key_column="",
        column_count=0,
        chunks=[{"location": "문단", "content": "처음전용 배치 내용"}],
        file_mtime=1.0,
        parser_config={},
    )
    [file_id] = save_indexed_files_batch([first_payload])
    first_fingerprint = get_file_fingerprints()[file_id]["content_hash"]

    updated_payload = prepare_indexed_file(
        path=str(target),
        name=target.name,
        file_type="Word",
        key_column="",
        column_count=0,
        chunks=[{"location": "문단", "content": "교체전용 배치 내용"}],
        file_mtime=2.0,
        parser_config={},
    )
    [updated_file_id] = save_indexed_files_batch([updated_payload])
    updated_fingerprint = get_file_fingerprints()[updated_file_id]

    assert updated_file_id == file_id
    assert search("처음전용") == []
    assert search("교체전용")
    assert updated_fingerprint["chunk_count"] == 1
    assert updated_fingerprint["content_hash"] != first_fingerprint


def test_library_rescan_flushes_prepared_files_in_batches(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_FILE_LIMIT", 2)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_CHUNK_LIMIT", 999)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_INTERVAL_SECONDS", 999.0)
    init_db()

    targets = []
    for index in range(3):
        target = tmp_path / f"note-{index}.docx"
        target.write_text(f"샘플 {index}", encoding="utf-8")
        targets.append(target)

    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )
    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[str(path) for path in targets]))
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda path, parser_config=None: (
            {
                "name": Path(path).name,
                "file_type": "Word",
                "columns": [],
                "parser_config": {},
            },
            [{"location": "문단", "content": f"{path} 배치 색인"}],
        ),
    )

    batch_sizes = []
    original_batch_save = library.save_indexed_files_batch

    def recording_batch_save(payloads):
        batch_sizes.append(len(payloads))
        return original_batch_save(payloads)

    monkeypatch.setattr(library, "save_indexed_files_batch", recording_batch_save)

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.registered == 3
    assert sorted(batch_sizes) == [1, 2]
    assert len(get_all_files()) == 3


def test_initial_rescan_stages_bulk_index_and_preserves_settings(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library
    from backend.core.indexer import search

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    monkeypatch.setattr("backend.core.library.INITIAL_STAGING_FILE_THRESHOLD", 2)
    init_db()

    targets = []
    for index in range(3):
        target = tmp_path / f"staged-{index}.docx"
        target.write_text("placeholder", encoding="utf-8")
        targets.append(target)

    save_library_settings(
        LibrarySettings(
            watched_folders=[{"path": str(tmp_path), "recursive": True}],
            fast_worker_count=24,
        )
    )
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[str(path) for path in targets]
        ),
    )
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda path, parser_config=None: (
            {
                "name": Path(path).name,
                "file_type": "Word",
                "columns": [],
                "parser_config": {},
            },
            [{"location": "문단", "content": f"{Path(path).stem} 초기 스테이징 색인"}],
        ),
    )

    events = []
    monkeypatch.setattr("backend.database.log_index_perf", lambda event, **fields: events.append((event, fields)))

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.registered == 3
    assert len(get_all_files()) == 3
    assert search("초기 스테이징", file_limit=3)
    assert library.load_library_settings().watched_folders[0].path == str(tmp_path)
    assert any(event == "db_batch_save_done" and fields["db_target"] == "initial_staging" for event, fields in events)
    assert any(event == "initial_index_staging_finalized" and fields["success"] is True for event, fields in events)


def test_library_rescan_flushes_by_chunk_count_and_emits_saving_stage(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_FILE_LIMIT", 99)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_CHUNK_LIMIT", 3)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_INTERVAL_SECONDS", 999.0)
    init_db()

    targets = []
    for index in range(2):
        target = tmp_path / f"chunky-{index}.docx"
        target.write_text(f"샘플 {index}", encoding="utf-8")
        targets.append(target)

    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[str(path) for path in targets]
        ),
    )
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda path, parser_config=None: (
            {
                "name": Path(path).name,
                "file_type": "Word",
                "columns": [],
                "parser_config": {},
            },
            [
                {"location": "문단 1", "content": f"{path} 청크 1"},
                {"location": "문단 2", "content": f"{path} 청크 2"},
            ],
        ),
    )

    batch_chunk_counts = []
    original_batch_save = library.save_indexed_files_batch

    def recording_batch_save(payloads):
        batch_chunk_counts.append(sum(payload.chunk_count for payload in payloads))
        return original_batch_save(payloads)

    progress = []
    monkeypatch.setattr(library, "save_indexed_files_batch", recording_batch_save)

    response = library.rescan_library(mode="fast", progress_callback=progress.append)

    assert response.failed == 0
    assert response.registered == 2
    assert batch_chunk_counts == [2, 2]
    assert any(item["stage"] == "saving" for item in progress)


def test_rescan_prunes_legacy_text_and_markdown_rows_without_source_delete(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import get_file_by_id, save_file_chunks

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    legacy = tmp_path / "legacy.txt"
    legacy.write_text("남아있는 원본", encoding="utf-8")
    legacy_id = register_file(str(legacy), legacy.name, "Text", "", 0)
    save_file_chunks(legacy_id, [{"location": "본문", "content": "예전 텍스트 색인"}])

    target = tmp_path / "current.docx"
    target.write_text("placeholder", encoding="utf-8")
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[str(target)]),
    )
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda path, parser_config=None: (
            {
                "name": target.name,
                "file_type": "Word",
                "columns": [],
                "parser_config": {},
            },
            [{"location": "문단", "content": "현재 워드 색인"}],
        ),
    )

    response = library.rescan_library(mode="fast")

    assert response.pruned_unsupported == 1
    assert legacy.exists()
    assert get_file_by_id(legacy_id) is None
    assert [row["name"] for row in get_all_files()] == [target.name]


def test_library_rescan_logs_single_large_file_flush_reason(tmp_path, monkeypatch):
    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_FILE_LIMIT", 99)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_CHUNK_LIMIT", 3)
    monkeypatch.setattr("backend.core.library.BATCH_FLUSH_INTERVAL_SECONDS", 999.0)
    init_db()

    target = tmp_path / "large.docx"
    target.write_text("placeholder", encoding="utf-8")
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[str(target)]),
    )
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda path, parser_config=None: (
            {
                "name": target.name,
                "file_type": "Word",
                "columns": [],
                "parser_config": {},
            },
            [{"location": f"문단 {index}", "content": f"큰 파일 청크 {index}"} for index in range(4)],
        ),
    )

    events = []
    monkeypatch.setattr(library, "log_index_perf", lambda event, **fields: events.append((event, fields)))

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert any(
        event == "db_flush_done"
        and fields["reason"] == "single_large_file"
        and fields["single_large_file"] is True
        for event, fields in events
    )
