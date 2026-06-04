from pathlib import Path

import pytest

from backend.core import everything_scanner


def test_candidate_dll_paths_prefers_env_then_vendor_tiers_and_program_files(monkeypatch, tmp_path):
    exe_dir = tmp_path / "runtime"
    backend_source = tmp_path / "resources" / "backend-source"
    repo_root = tmp_path / "repo"
    module_file = backend_source / "backend" / "core" / "everything_scanner.py"
    env_dll = tmp_path / "manual" / "Everything64.dll"
    program_files = tmp_path / "Program Files"
    program_files_x86 = tmp_path / "Program Files (x86)"

    for path in (exe_dir, module_file.parent, repo_root, env_dll.parent, program_files, program_files_x86):
        path.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(everything_scanner.sys, "executable", str(exe_dir / "python.exe"))
    monkeypatch.setattr(everything_scanner.sys, "maxsize", 2**63 - 1)
    monkeypatch.setattr(everything_scanner.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(everything_scanner, "__file__", str(module_file))
    monkeypatch.chdir(repo_root)
    monkeypatch.setenv("OW_EVERYTHING_SDK_DLL", str(env_dll))
    monkeypatch.setenv("ProgramFiles", str(program_files))
    monkeypatch.setenv("ProgramFiles(x86)", str(program_files_x86))

    candidates = [Path(path) for path in everything_scanner.candidate_dll_paths()]

    expected_prefix = [
        env_dll,
        exe_dir / "vendor" / "everything" / "Everything64.dll",
        exe_dir / "backend" / "vendor" / "everything" / "Everything64.dll",
        exe_dir / "Everything64.dll",
        exe_dir / "vendor" / "everything" / "Everything.dll",
        exe_dir / "backend" / "vendor" / "everything" / "Everything.dll",
        exe_dir / "Everything.dll",
        backend_source / "vendor" / "everything" / "Everything64.dll",
        backend_source / "backend" / "vendor" / "everything" / "Everything64.dll",
        backend_source / "Everything64.dll",
        backend_source / "vendor" / "everything" / "Everything.dll",
        backend_source / "backend" / "vendor" / "everything" / "Everything.dll",
        backend_source / "Everything.dll",
        repo_root / "vendor" / "everything" / "Everything64.dll",
        repo_root / "backend" / "vendor" / "everything" / "Everything64.dll",
        repo_root / "Everything64.dll",
    ]
    assert candidates[: len(expected_prefix)] == expected_prefix
    assert program_files / "Everything" / "Everything64.dll" in candidates
    assert program_files_x86 / "Everything" / "Everything64.dll" in candidates
    assert candidates.index(program_files / "Everything" / "Everything64.dll") < candidates.index(
        program_files_x86 / "Everything" / "Everything64.dll"
    )


def _filetime_parts_from_unix(seconds: float) -> tuple[int, int]:
    ticks = int((seconds + 11_644_473_600) * 10_000_000)
    return ticks & 0xFFFFFFFF, ticks >> 32


def test_filetime_to_unix_seconds_converts_everything_date_modified_metadata():
    filetime = everything_scanner.ctypes.wintypes.FILETIME()
    expected = 1_700_000_000.0
    low, high = _filetime_parts_from_unix(expected)
    filetime.dwLowDateTime = low
    filetime.dwHighDateTime = high

    assert everything_scanner.filetime_to_unix_seconds(filetime) == pytest.approx(expected)

    zero = everything_scanner.ctypes.wintypes.FILETIME()
    assert everything_scanner.filetime_to_unix_seconds(zero) is None


def test_query_everything_requests_and_returns_date_modified_metadata(tmp_path):
    target = tmp_path / "report.docx"
    target.write_text("x", encoding="utf-8")
    modified = 1_700_000_123.0

    class FakeEverythingDll:
        def __init__(self):
            self.request_flags = 0

        def Everything_Reset(self):
            pass

        def Everything_SetSearchW(self, _query):
            pass

        def Everything_SetMatchPath(self, _value):
            pass

        def Everything_SetRequestFlags(self, flags):
            self.request_flags = int(flags)

        def Everything_QueryW(self, _wait):
            return True

        def Everything_GetLastError(self):
            return 0

        def Everything_GetNumResults(self):
            return 1

        def Everything_IsFileResult(self, _index):
            return True

        def Everything_GetResultFullPathNameW(self, _index, buffer, _max_chars):
            buffer.value = str(target)
            return len(str(target))

        def Everything_GetResultDateModified(self, _index, filetime_pointer):
            low, high = _filetime_parts_from_unix(modified)
            filetime_pointer._obj.dwLowDateTime = low
            filetime_pointer._obj.dwHighDateTime = high
            return True

    fake = FakeEverythingDll()

    paths, total, mtimes = everything_scanner._query_everything(
        fake,
        folder_path=str(tmp_path),
        recursive=True,
        supported_extensions={".docx"},
        excluded_keys=set(),
    )

    assert paths == [str(target)]
    assert total == 1
    assert mtimes[str(target)] == pytest.approx(modified)
    assert fake.request_flags & everything_scanner._EVERYTHING_REQUEST_DATE_MODIFIED
