from pathlib import Path

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
