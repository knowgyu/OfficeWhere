from backend.core.library import save_library_settings
from backend.database import get_all_files, init_db, register_file
from backend.models.schemas import LibrarySettings


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


def test_cancel_library_rescan_marks_running_job(tmp_path, monkeypatch):
    import time

    from backend.core import library

    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    save_library_settings(
        LibrarySettings(watched_folders=[{"path": str(tmp_path), "recursive": True}])
    )

    def slow_collect(_path, _recursive):
        time.sleep(0.2)
        return []

    monkeypatch.setattr(library, "_collect_supported_paths", slow_collect)

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

    monkeypatch.setattr(library, "_collect_supported_paths", lambda _path, _recursive: [str(target)])

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

    monkeypatch.setattr(library, "_collect_supported_paths", lambda _path, _recursive: [str(target)])
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
