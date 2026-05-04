"""Verify backend_server._guard_e2e() refuses to start when E2E env signals
are inconsistent or point at a real user data directory.

The guard is the last line of defense against an E2E run accidentally writing
to ~/Library/Application Support/OfficeWhere or its Windows/Linux equivalents.
"""

import pytest

import backend_server


def test_guard_no_op_when_e2e_unset(monkeypatch):
    monkeypatch.delenv("OW_E2E", raising=False)
    monkeypatch.delenv("OW_E2E_ALLOW", raising=False)
    monkeypatch.setenv("OW_DATA_DIR", "/Users/me/Library/Application Support/OfficeWhere")

    backend_server._guard_e2e()  # no SystemExit


def test_guard_refuses_when_allow_missing(monkeypatch, capsys):
    monkeypatch.setenv("OW_E2E", "1")
    monkeypatch.delenv("OW_E2E_ALLOW", raising=False)
    monkeypatch.setenv("OW_DATA_DIR", "/tmp/ow-test")

    with pytest.raises(SystemExit) as excinfo:
        backend_server._guard_e2e()

    assert excinfo.value.code == 78
    err = capsys.readouterr().err
    assert "OW_E2E_ALLOW" in err


def test_guard_refuses_empty_data_dir(monkeypatch, capsys):
    monkeypatch.setenv("OW_E2E", "1")
    monkeypatch.setenv("OW_E2E_ALLOW", "1")
    monkeypatch.setenv("OW_DATA_DIR", "")

    with pytest.raises(SystemExit) as excinfo:
        backend_server._guard_e2e()

    assert excinfo.value.code == 78
    assert "OW_DATA_DIR" in capsys.readouterr().err


@pytest.mark.parametrize(
    "real_path",
    [
        "/Users/me/Library/Application Support/OfficeWhere/backend-data",
        "C:\\Users\\me\\AppData\\Roaming\\OfficeWhere\\backend-data",
        "/home/me/.config/OfficeWhere/backend-data",
    ],
)
def test_guard_refuses_real_user_data_dirs(monkeypatch, capsys, real_path):
    monkeypatch.setenv("OW_E2E", "1")
    monkeypatch.setenv("OW_E2E_ALLOW", "1")
    monkeypatch.setenv("OW_DATA_DIR", real_path)

    with pytest.raises(SystemExit) as excinfo:
        backend_server._guard_e2e()

    assert excinfo.value.code == 78
    assert "OW_DATA_DIR" in capsys.readouterr().err


def test_guard_passes_with_temp_dir(monkeypatch):
    monkeypatch.setenv("OW_E2E", "1")
    monkeypatch.setenv("OW_E2E_ALLOW", "1")
    monkeypatch.setenv("OW_DATA_DIR", "/tmp/officewhere-e2e-abc123")

    backend_server._guard_e2e()  # no SystemExit
