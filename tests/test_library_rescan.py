from backend.core.library import save_library_settings
from backend.database import init_db
from backend.models.schemas import LibrarySettings


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
