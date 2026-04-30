import asyncio
import sys
from pathlib import Path

import backend_server
from backend.config import get_library_rescan_config
from backend import database
from backend.main import example_library_path
from backend.runtime import get_fast_worker_count, get_worker_count, normalize_fast_worker_count


def test_backend_server_reads_ow_env(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["backend_server.py"])
    monkeypatch.setenv("OW_HOST", "127.0.0.2")
    monkeypatch.setenv("OW_PORT", "8876")
    monkeypatch.setenv("OW_DATA_DIR", "/tmp/officewhere-primary")
    monkeypatch.setenv("OW_LOG_LEVEL", "warning")

    args = backend_server.parse_args()

    assert args.host == "127.0.0.2"
    assert args.port == 8876
    assert args.data_dir == "/tmp/officewhere-primary"
    assert args.log_level == "warning"


def test_backend_server_uses_officewhere_defaults(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["backend_server.py"])
    monkeypatch.delenv("OW_HOST", raising=False)
    monkeypatch.delenv("OW_PORT", raising=False)
    monkeypatch.delenv("OW_DATA_DIR", raising=False)
    monkeypatch.delenv("OW_LOG_LEVEL", raising=False)

    args = backend_server.parse_args()

    assert args.host == "127.0.0.1"
    assert args.port == 18765
    assert args.data_dir == ""
    assert args.log_level == "info"


def test_database_uses_ow_data_dir(monkeypatch):
    monkeypatch.setenv("OW_DATA_DIR", "/tmp/officewhere-primary")

    assert database._default_db_dir() == Path("/tmp/officewhere-primary")


def test_worker_count_uses_ow_env(monkeypatch):
    monkeypatch.setenv("OW_MAX_WORKERS", "2")

    assert get_worker_count(default=4, cap=8) == 2


def test_fast_worker_count_uses_separate_ow_env(monkeypatch):
    monkeypatch.setenv("OW_MAX_WORKERS", "2")
    monkeypatch.setenv("OW_FAST_MAX_WORKERS", "12")

    assert get_worker_count(default=4, cap=8) == 2
    assert get_fast_worker_count(default=24, cap=48) == 12


def test_fast_worker_count_normalizes_ui_bounds_and_steps(monkeypatch):
    monkeypatch.delenv("OW_FAST_MAX_WORKERS", raising=False)

    assert get_fast_worker_count() == 24
    assert normalize_fast_worker_count(2) == 4
    assert normalize_fast_worker_count(26) == 28
    assert normalize_fast_worker_count(99) == 32


def test_library_rescan_config_uses_narrow_ow_env_overrides(monkeypatch):
    monkeypatch.setenv("OW_RESCAN_BATCH_FLUSH_FILE_LIMIT", "7")
    monkeypatch.setenv("OW_RESCAN_BATCH_FLUSH_CHUNK_LIMIT", "100")
    monkeypatch.setenv("OW_RESCAN_BATCH_FLUSH_INTERVAL_SECONDS", "0.25")
    monkeypatch.setenv("OW_RESCAN_INITIAL_STAGING_FILE_THRESHOLD", "12")

    config = get_library_rescan_config()

    assert config.batch_flush_file_limit == 7
    assert config.batch_flush_chunk_limit == 100
    assert config.batch_flush_interval_seconds == 0.25
    assert config.initial_staging_file_threshold == 12


def test_example_library_path_uses_repo_examples():
    response = asyncio.run(example_library_path())

    assert response["available"] is True
    assert Path(response["path"]).name == "officewhere_test_library"
    assert Path(response["path"]).exists()
