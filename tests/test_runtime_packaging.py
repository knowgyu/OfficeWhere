import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_electron_packaged_python_dispatches_by_platform():
    main_ts = (REPO_ROOT / "frontend" / "electron" / "main.ts").read_text(encoding="utf-8")

    assert "function getBundledPythonExecutable" in main_ts
    assert "process.platform === 'win32'" in main_ts
    assert "'python.exe'" in main_ts
    assert "process.platform === 'darwin'" in main_ts
    assert "'bin', 'python3'" in main_ts
    assert "configuredPython || getBundledPythonExecutable()" in main_ts
    assert "delete backendEnv.PYTHONHOME" in main_ts
    assert "delete backendEnv.PYTHONPATH" in main_ts
    assert "PYTHONNOUSERSITE" in main_ts


def test_electron_builder_runtime_resources_are_platform_scoped():
    package = json.loads((REPO_ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]
    build = package["build"]

    assert scripts["prepare:python-runtime:mac"] == "python3 ../scripts/prepare_python_runtime.py mac-arm64"
    assert scripts["package:mac"].startswith("npm run prepare:python-runtime:mac && ")
    top_level_sources = {item["from"] for item in build["extraResources"]}
    assert "../python-runtime/win-x64" not in top_level_sources
    assert build["win"]["extraResources"] == [
        {"from": "../python-runtime/win-x64", "to": "python-runtime"}
    ]
    assert build["mac"]["extraResources"] == [
        {"from": "../python-runtime/mac-arm64", "to": "python-runtime"}
    ]


def test_mac_runtime_layout_contract_is_documented():
    runtime_readme = (REPO_ROOT / "python-runtime" / "mac-arm64" / "README.md").read_text(encoding="utf-8")
    prepare_script = (REPO_ROOT / "scripts" / "prepare_python_runtime.py").read_text(encoding="utf-8")

    assert "python-runtime/mac-arm64/bin/python3" in runtime_readme
    assert "Contents/Resources/python-runtime" in runtime_readme
    assert "DEFAULT_PYTHON_VERSION = \"3.13\"" in prepare_script
    assert "aarch64-apple-darwin" in prepare_script
    assert "\"freethreaded\" in name" in prepare_script
    assert "python-build-standalone" in prepare_script
