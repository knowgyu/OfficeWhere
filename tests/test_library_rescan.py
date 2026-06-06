from datetime import datetime, timedelta

from backend.core.library import save_library_settings
from backend.database import get_all_files, init_db, register_file
from backend.models.schemas import LibraryRescanRequest, LibrarySettings


def _write_excel(path, data: dict):
    from openpyxl import Workbook

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Sheet1"
    headers = list(data.keys())
    worksheet.append(headers)
    row_count = max((len(values) for values in data.values()), default=0)
    for row_index in range(row_count):
        worksheet.append([
            values[row_index] if row_index < len(values) else ""
            for values in data.values()
        ])
    workbook.save(path)


def test_library_settings_interval_is_floored_and_minimum(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    saved = save_library_settings(LibrarySettings(auto_rescan_interval_hours=1.9))
    assert saved.auto_rescan_interval_hours == 1

    saved = save_library_settings(LibrarySettings(auto_rescan_interval_hours=0.2))
    assert saved.auto_rescan_interval_hours == 1


def test_library_rescan_invalidates_search_response_cache_epoch(tmp_path, monkeypatch):
    from backend.core import library
    from backend.core.search_cache import current_epoch, reset_search_cache_for_tests

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    reset_search_cache_for_tests()
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    before = current_epoch()

    library.rescan_library()

    assert current_epoch() > before


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


def test_classify_index_error_invalid_number_is_user_safe():
    from backend.core.library import classify_index_error

    diagnostic = classify_index_error(ValueError("invalid literal for int() with base 10: 'abc'"), "bad.xlsx")

    assert diagnostic["error_code"] == "office_parser_error"
    assert diagnostic["error_stage"] == "office_parser"
    assert "traceback" not in diagnostic["error_hint"].lower()


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


def test_collect_supported_paths_filters_supported_files_once(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core.library import _collect_supported_paths
    from backend.file_constants import SUPPORTED_EXTENSIONS

    appdata = tmp_path / "appdata"
    appdata.mkdir()
    monkeypatch.setattr("backend.database.DB_DIR", appdata)
    scan_root = tmp_path / "library"
    scan_root.mkdir()

    (scan_root / "report.xlsx").write_text("x")
    (scan_root / "note.md").write_text("x")
    (scan_root / "~$temp.xlsx").write_text("x")
    (scan_root / "image.png").write_text("x")
    nested = scan_root / "nested"
    nested.mkdir()
    (nested / "deck.pptx").write_text("x")
    excluded = scan_root / "node_modules"
    excluded.mkdir()
    (excluded / "hidden.docx").write_text("x")
    similarly_named = scan_root / "my-node_modules-docs"
    similarly_named.mkdir()
    (similarly_named / "kept.docx").write_text("x")

    recursive = _collect_supported_paths(str(scan_root), recursive=True)
    flat = _collect_supported_paths(str(scan_root), recursive=False)

    assert ".md" not in SUPPORTED_EXTENSIONS
    assert {scan_root / "report.xlsx", nested / "deck.pptx", similarly_named / "kept.docx"} == {
        Path(path) for path in recursive
    }
    assert {scan_root / "report.xlsx"} == {Path(path) for path in flat}


def test_collect_supported_paths_uses_snapshot_for_unchanged_folder(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library_scanner
    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    target = scan_root / "report.xlsx"
    target.write_text("x")
    appdata = tmp_path / "appdata"
    appdata.mkdir()

    monkeypatch.setattr("backend.database.DB_DIR", appdata)

    first = _collect_supported_paths_with_stats(str(scan_root), recursive=True)
    assert first.cache_hit is False
    assert {Path(path) for path in first.paths} == {target}

    def fail_scandir(_path):
        raise AssertionError("unchanged snapshot should avoid directory listing")

    monkeypatch.setattr(library_scanner.os, "scandir", fail_scandir)

    second = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert second.cache_hit is True
    assert second.discovery_source == "snapshot_cache"
    assert {Path(path) for path in second.paths} == {target}


def test_collect_supported_paths_uses_everything_provider_when_available(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library_scanner
    from backend.core.everything_scanner import EverythingDiscovery
    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    target = scan_root / "report.xlsx"
    target.write_text("x")
    appdata = tmp_path / "appdata"
    appdata.mkdir()

    monkeypatch.setattr("backend.database.DB_DIR", appdata)
    monkeypatch.setattr(
        library_scanner,
        "discover_supported_paths",
        lambda _folder, _recursive, _supported, _excluded: EverythingDiscovery(
            paths=[str(target)],
            modified_time_by_path={str(target): 1_700_000_000.0},
        ),
    )

    def fail_scandir(_path):
        raise AssertionError("Everything provider should avoid recursive filesystem discovery")

    monkeypatch.setattr(library_scanner.os, "scandir", fail_scandir)

    result = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert result.discovery_source == "everything_sdk"
    assert result.discovery_hint == ""
    assert {Path(path) for path in result.paths} == {target}
    assert result.modified_time_by_path[str(target)] == 1_700_000_000.0
    assert result.mtime_metadata_trusted is True


def test_collect_supported_paths_falls_back_with_everything_hint(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library_scanner
    from backend.core.everything_scanner import EverythingDiscovery
    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    target = scan_root / "report.xlsx"
    target.write_text("x")
    appdata = tmp_path / "appdata"
    appdata.mkdir()

    monkeypatch.setattr("backend.database.DB_DIR", appdata)
    monkeypatch.setattr(
        library_scanner,
        "discover_supported_paths",
        lambda _folder, _recursive, _supported, _excluded: EverythingDiscovery(
            unavailable_reason="sdk_dll_missing",
            hint="Everything SDK DLL이 없어 기본 폴더 스캔으로 진행했습니다.",
            help_url="https://www.voidtools.com/support/everything/sdk/",
        ),
    )

    result = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert result.discovery_source == "filesystem"
    assert result.discovery_fallback_reason == "sdk_dll_missing"
    assert result.discovery_hint == "Everything SDK DLL이 없어 기본 폴더 스캔으로 진행했습니다."
    assert result.discovery_help_url == "https://www.voidtools.com/support/everything/sdk/"
    assert {Path(path) for path in result.paths} == {target}


def test_collect_supported_paths_cache_reuse_write_failure_is_nonfatal(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library_scanner
    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    target = scan_root / "report.xlsx"
    target.write_text("x")
    appdata = tmp_path / "appdata"
    appdata.mkdir()

    monkeypatch.setattr("backend.database.DB_DIR", appdata)

    first = _collect_supported_paths_with_stats(str(scan_root), recursive=True)
    assert {Path(path) for path in first.paths} == {target}

    def fail_mark_reused(_entry):
        raise OSError("cache is temporarily read-only")

    monkeypatch.setattr(library_scanner, "mark_reused", fail_mark_reused)

    second = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert second.cache_hit is True
    assert second.discovery_source == "snapshot_cache"
    assert {Path(path) for path in second.paths} == {target}


def test_collect_supported_paths_falls_back_when_directory_signature_changes(tmp_path, monkeypatch):
    from pathlib import Path
    import os
    import time

    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    first_file = scan_root / "report.xlsx"
    first_file.write_text("x")
    appdata = tmp_path / "appdata"
    appdata.mkdir()
    monkeypatch.setattr("backend.database.DB_DIR", appdata)

    first = _collect_supported_paths_with_stats(str(scan_root), recursive=True)
    assert {Path(path) for path in first.paths} == {first_file}

    added = scan_root / "deck.pptx"
    added.write_text("x")
    next_mtime = time.time() + 3
    os.utime(scan_root, (next_mtime, next_mtime))

    second = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert second.cache_hit is False
    assert second.cache_fallback_reason == "directory_signature_changed"
    assert {Path(path) for path in second.paths} == {first_file, added}


def test_collect_supported_paths_full_scan_escape_after_reuse_limit(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library_scan_cache
    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    target = scan_root / "report.xlsx"
    target.write_text("x")
    appdata = tmp_path / "appdata"
    appdata.mkdir()

    monkeypatch.setattr("backend.database.DB_DIR", appdata)
    monkeypatch.setattr(library_scan_cache, "MAX_SNAPSHOT_REUSE_COUNT", 0)

    _collect_supported_paths_with_stats(str(scan_root), recursive=True)
    second = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert second.cache_hit is False
    assert second.cache_fallback_reason == "reuse_limit"
    assert second.visited_dir_count == 1
    assert {Path(path) for path in second.paths} == {target}


def test_collect_supported_paths_keeps_symlinked_files(tmp_path, monkeypatch):
    from pathlib import Path
    import os

    from backend.core.library import _collect_supported_paths_with_stats

    scan_root = tmp_path / "library"
    scan_root.mkdir()
    target = scan_root / "report.xlsx"
    target.write_text("x")
    link = scan_root / "linked.xlsx"
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError):
        pytest.skip("file symlink creation is unavailable on this platform")
    appdata = tmp_path / "appdata"
    appdata.mkdir()

    monkeypatch.setattr("backend.database.DB_DIR", appdata)

    result = _collect_supported_paths_with_stats(str(scan_root), recursive=True)

    assert {Path(path) for path in result.paths} == {target, link}


def test_scan_cache_disables_low_confidence_network_roots():
    from backend.core.library_scan_cache import is_high_confidence_root

    assert is_high_confidence_root("//server/share") is False
    assert is_high_confidence_root(r"\\server\\share") is False


def test_collect_supported_paths_skips_inaccessible_start_menu_junction(tmp_path, monkeypatch):
    from backend.core import library_scanner
    from backend.core.library import _collect_supported_paths_with_stats

    monkeypatch.setattr("backend.database.DB_DIR", tmp_path / "appdata")
    report = tmp_path / "report.docx"
    report.write_text("x")
    start_menu = tmp_path / "시작 메뉴"
    start_menu.mkdir()

    original_scandir = library_scanner.os.scandir

    class GuardedEntry:
        def __init__(self, entry):
            self._entry = entry
            self.name = entry.name
            self.path = entry.path

        def is_dir(self, *args, **kwargs):
            if self.path == str(start_menu):
                raise PermissionError("[WinError 5] 액세스가 거부되었습니다")
            return self._entry.is_dir(*args, **kwargs)

        def is_file(self, *args, **kwargs):
            return self._entry.is_file(*args, **kwargs)

    class GuardedScandir:
        def __init__(self, path):
            self._iterator = original_scandir(path)

        def __enter__(self):
            return (GuardedEntry(entry) for entry in self._iterator.__enter__())

        def __exit__(self, *args):
            return self._iterator.__exit__(*args)

    monkeypatch.setattr(library_scanner.os, "scandir", GuardedScandir)

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

    def fail_inspect(_path):
        raise IndexError("list index out of range")

    monkeypatch.setattr(library, "inspect_and_chunk", fail_inspect)

    response = library.rescan_library()

    assert response.failed == 1
    result = response.results[0]
    assert result.diagnostic_id
    assert result.error_code == "unsupported_or_corrupt_file"
    assert result.error_hint
    assert result.diagnostic_id in caplog.text


def test_rescan_response_exposes_discovery_hint(tmp_path, monkeypatch):
    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    target = tmp_path / "report.xlsx"
    _write_excel(target, {"name": ["alpha"]})
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    hint = "Everything SDK DLL이 없어 기본 폴더 스캔으로 진행했습니다."
    help_url = "https://www.voidtools.com/support/everything/sdk/"
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[str(target)],
            discovery_source="filesystem",
            discovery_hint=hint,
            discovery_help_url=help_url,
            discovery_fallback_reason="sdk_dll_missing",
        ),
    )

    progress = []
    response = library.rescan_library(mode="fast", progress_callback=progress.append)

    assert response.discovery_source == "filesystem"
    assert response.discovery_hint == hint
    assert response.discovery_help_url == help_url
    assert any(item.get("discovery_hint") == hint for item in progress)


def test_rescan_excel_indexes_used_range(tmp_path, monkeypatch):
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
    _write_excel(target, {"ID": ["A"], "담당자": ["Kim"], "새열": ["새값"]})
    next_mtime = time.time() + 3
    os.utime(target, (next_mtime, next_mtime))

    second = library.rescan_library()

    assert second.failed == 0
    assert second.updated == 1
    assert search("새값")[0]["location"] == "Sheet1 시트 | 2행 C열"


def test_rescan_skips_unchanged_excel_without_registration_metadata(tmp_path, monkeypatch):
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

    fast = library.rescan_library(mode="fast")
    assert fast.skipped == 1

    repaired = library.rescan_library(mode="normal")
    assert repaired.skipped == 1


def test_rescan_registers_excel_without_registration_key_metadata(tmp_path, monkeypatch):
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
        lambda _path: (
            {'name': target.name, 'file_type': 'Excel', 'columns': []},
            [{"location": "Sheet1 시트 | 1행 A열", "content": "표가 아닌 메모"}],
        ),
    )

    response = library.rescan_library()

    assert response.failed == 0
    assert response.registered == 1
    assert get_all_files()[0]["name"] == target.name


def test_parallel_indexed_file_saves_do_not_compete_for_sqlite_writer(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from backend.database import save_indexed_file

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    def save_one(index: int) -> int:
        return save_indexed_file(path=str(tmp_path / f'note-{index}.docx'), name=f'note-{index}.docx', file_type='Word', column_count=0, chunks=[{'location': '문단', 'content': f'동시 저장 샘플 {index}'}], file_mtime=float(index))

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
        prepare_indexed_file(path=str(tmp_path / f'note-{index}.docx'), name=f'note-{index}.docx', file_type='Word', column_count=0, chunks=[{'location': '문단', 'content': f'배치 저장 샘플 {index}'}], file_mtime=float(index))
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
    first_payload = prepare_indexed_file(path=str(target), name=target.name, file_type='Word', column_count=0, chunks=[{'location': '문단', 'content': '처음전용 배치 내용'}], file_mtime=1.0)
    [file_id] = save_indexed_files_batch([first_payload])
    first_fingerprint = get_file_fingerprints()[file_id]["content_hash"]

    updated_payload = prepare_indexed_file(path=str(target), name=target.name, file_type='Word', column_count=0, chunks=[{'location': '문단', 'content': '교체전용 배치 내용'}], file_mtime=2.0)
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
        lambda path: (
            {'name': Path(path).name, 'file_type': 'Word', 'columns': []},
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
        lambda path: (
            {'name': Path(path).name, 'file_type': 'Word', 'columns': []},
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
        lambda path: (
            {'name': Path(path).name, 'file_type': 'Word', 'columns': []},
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
    legacy_id = register_file(str(legacy), legacy.name, 'Text', 0)
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
        lambda path: (
            {'name': target.name, 'file_type': 'Word', 'columns': []},
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
        lambda path: (
            {'name': target.name, 'file_type': 'Word', 'columns': []},
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


def test_rescan_marks_missing_source_under_successful_scan_without_deleting_record(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import get_file_by_id, save_file_chunks

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "gone.docx"
    source.write_text("temporary source", encoding="utf-8")
    file_id = register_file(str(source), source.name, "Word", 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "누락 확인 키워드"}])
    source.unlink()
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[]),
    )

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.missing == 1
    row = get_file_by_id(file_id)
    assert row is not None
    assert row["availability_status"] == "missing"
    assert row["missing_since"]
    assert not source.exists()


def test_rescan_does_not_mark_missing_from_everything_only_absence(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import get_file_by_id, save_file_chunks

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "not-yet-indexed-by-everything.docx"
    source.write_text("temporary source", encoding="utf-8")
    file_id = register_file(str(source), source.name, "Word", 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "Everything 누락 확인"}])
    source.unlink()
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[],
            discovery_source="everything_sdk",
        ),
    )

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.missing == 0
    assert response.discovery_source == "everything_sdk"
    row = get_file_by_id(file_id)
    assert row is not None
    assert row["availability_status"] == "available"
    assert row["missing_since"] is None


def test_rescan_does_not_mark_missing_when_scan_root_fails(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import get_file_by_id

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    unavailable_root = tmp_path / "offline-share"
    source = unavailable_root / "kept.docx"
    file_id = register_file(str(source), source.name, "Word", 0)
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(unavailable_root), "recursive": True}]))

    def scan_failed(_path, _recursive, _excluded_folder_names=None):
        raise FileNotFoundError("share is offline")

    monkeypatch.setattr(library, "_collect_supported_paths_with_stats", scan_failed)

    response = library.rescan_library(mode="fast")

    assert response.failed == 1
    assert response.missing == 0
    row = get_file_by_id(file_id)
    assert row is not None
    assert row["availability_status"] == "available"
    assert row["missing_since"] is None


def test_missing_absence_proof_requires_successful_root_and_readable_parent(tmp_path, monkeypatch):
    from pathlib import Path

    from backend.core import library

    covered_root = library._normalized_resolved_path(str(tmp_path / "watched"))
    blocked_parent = tmp_path / "watched" / "blocked"
    blocked_parent.mkdir(parents=True)
    blocked_source = blocked_parent / "hidden.docx"
    outside_source = tmp_path / "outside" / "gone.docx"

    assert library._source_path_absence_is_proven(str(outside_source), [covered_root]) is False

    real_access = library.os.access
    monkeypatch.setattr(
        library.os,
        "access",
        lambda path, mode: False if Path(path) == blocked_parent else real_access(path, mode),
    )

    assert library._source_path_absence_is_proven(str(blocked_source), [covered_root]) is False


def test_rescan_recovers_missing_source_without_reindex_when_mtime_matches(tmp_path, monkeypatch):
    import sqlite3

    from backend.core import library
    from backend.database import get_file_by_id

    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "returned.docx"
    source.write_text("same file returned", encoding="utf-8")
    file_id = register_file(str(source), source.name, "Word", 0)
    source_mtime = source.stat().st_mtime
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        UPDATE registered_files
        SET file_mtime=?,
            availability_status='missing',
            missing_since=?,
            missing_last_checked_at=?,
            missing_reason='test'
        WHERE id=?
        """,
        (source_mtime, (datetime.now() - timedelta(days=1)).isoformat(), datetime.now().isoformat(), file_id),
    )
    conn.commit()
    conn.close()
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[str(source)]),
    )
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda _path: (_ for _ in ()).throw(AssertionError("unchanged recovered files should not be reindexed")),
    )

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.recovered == 1
    row = get_file_by_id(file_id)
    assert row is not None
    assert row["availability_status"] == "available"
    assert row["missing_since"] is None



def test_rescan_uses_trusted_discovery_mtime_to_skip_without_rescan_stat(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import get_file_by_id, save_file_chunks, update_file_mtime

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "unchanged.docx"
    source.write_text("same content", encoding="utf-8")
    file_id = register_file(str(source), source.name, "Word", 0)
    source_mtime = source.stat().st_mtime
    update_file_mtime(file_id, source_mtime)
    save_file_chunks(file_id, [{"location": "문단", "content": "변경 없음"}])
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))

    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[str(source)],
            discovery_source="everything_sdk",
            modified_time_by_path={str(source): source_mtime},
            mtime_metadata_trusted=True,
        ),
    )
    monkeypatch.setattr(
        library.os,
        "stat",
        lambda _path: (_ for _ in ()).throw(AssertionError("trusted Everything mtime should skip rescan-stage os.stat")),
    )
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda _path: (_ for _ in ()).throw(AssertionError("unchanged files should not be reindexed")),
    )

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.skipped == 1
    row = get_file_by_id(file_id)
    assert row is not None
    assert row["availability_status"] == "available"


def test_rescan_falls_back_to_stat_for_partial_or_invalid_discovery_mtime(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import save_file_chunks, update_file_mtime

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    with_metadata = tmp_path / "with-metadata.docx"
    without_metadata = tmp_path / "without-metadata.docx"
    invalid_metadata = tmp_path / "invalid-metadata.docx"
    for source in (with_metadata, without_metadata, invalid_metadata):
        source.write_text("same content", encoding="utf-8")
        file_id = register_file(str(source), source.name, "Word", 0)
        update_file_mtime(file_id, source.stat().st_mtime)
        save_file_chunks(file_id, [{"location": "문단", "content": source.name}])
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))

    trusted_mtime = with_metadata.stat().st_mtime
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[str(with_metadata), str(without_metadata), str(invalid_metadata)],
            discovery_source="everything_sdk",
            modified_time_by_path={
                str(with_metadata): trusted_mtime,
                str(invalid_metadata): 0.0,
            },
            mtime_metadata_trusted=True,
        ),
    )
    real_stat = library.os.stat
    stat_paths: list[str] = []

    def tracked_stat(path):
        text = str(path)
        if text == str(with_metadata):
            raise AssertionError("valid Everything mtime should avoid rescan-stage os.stat")
        stat_paths.append(text)
        return real_stat(path)

    monkeypatch.setattr(library.os, "stat", tracked_stat)
    monkeypatch.setattr(
        library,
        "inspect_and_chunk",
        lambda _path: (_ for _ in ()).throw(AssertionError("unchanged files should not be reindexed")),
    )

    response = library.rescan_library(mode="fast")

    assert response.failed == 0
    assert response.skipped == 3
    assert str(without_metadata) in stat_paths
    assert str(invalid_metadata) in stat_paths
    assert str(with_metadata) not in stat_paths


def test_rescan_does_not_trust_unverified_discovery_mtime_for_skip(tmp_path, monkeypatch):
    from backend.core import library
    from backend.database import save_file_chunks, update_file_mtime

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "stale.docx"
    source.write_text("temporary", encoding="utf-8")
    source_mtime = source.stat().st_mtime
    file_id = register_file(str(source), source.name, "Word", 0)
    update_file_mtime(file_id, source_mtime)
    save_file_chunks(file_id, [{"location": "문단", "content": "stale candidate"}])
    source.unlink()
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))

    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(
            paths=[str(source)],
            discovery_source="everything_sdk",
            modified_time_by_path={str(source): source_mtime},
            mtime_metadata_trusted=False,
        ),
    )

    response = library.rescan_library(mode="fast")

    assert response.skipped == 0
    assert response.failed == 1

def test_rescan_purges_missing_records_after_retention_and_cascades_indexes(tmp_path, monkeypatch):
    import sqlite3

    from backend.core import library
    from backend.core.indexer import search
    from backend.database import get_file_by_id, save_file_chunks

    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()

    source = tmp_path / "old-missing.docx"
    file_id = register_file(str(source), source.name, "Word", 0)
    save_file_chunks(file_id, [{"location": "문단", "content": "오래된 누락 키워드"}])
    old_missing_since = (datetime.now() - timedelta(days=8)).isoformat()
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        UPDATE registered_files
        SET availability_status='missing',
            missing_since=?,
            missing_last_checked_at=?,
            missing_reason='test'
        WHERE id=?
        """,
        (old_missing_since, old_missing_since, file_id),
    )
    conn.commit()
    conn.close()
    save_library_settings(LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}]))
    monkeypatch.setattr(
        library,
        "_collect_supported_paths_with_stats",
        lambda _path, _recursive, _excluded_folder_names=None: library._ScanCollection(paths=[]),
    )

    response = library.rescan_library(mode="fast")

    assert response.missing == 0
    assert response.purged_missing == 1
    assert get_file_by_id(file_id) is None
    assert search("오래된 누락 키워드") == []
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM file_chunks WHERE file_id=?", (file_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM document_fingerprints WHERE file_id=?", (file_id,)).fetchone()[0] == 0
