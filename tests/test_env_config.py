import asyncio
import sys
from pathlib import Path

import backend_server
from backend import database
from backend.main import example_library_path
from backend.runtime import get_fast_worker_count, get_worker_count


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
    assert get_fast_worker_count(default=8, cap=24) == 12


def test_example_library_path_uses_repo_examples():
    response = asyncio.run(example_library_path())

    assert response["available"] is True
    assert Path(response["path"]).name == "officewhere_test_library"
    assert Path(response["path"]).exists()
