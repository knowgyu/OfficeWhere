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

    assert scripts["package:win"] == "electron-builder --win zip --publish never"
    assert scripts["prepare:python-runtime:mac"] == "python3 ../scripts/prepare_python_runtime.py mac-arm64"
    assert scripts["package:mac"].startswith("npm run prepare:python-runtime:mac && ")
    assert scripts["package:mac"].endswith("electron-builder --mac --publish never")
    assert build["publish"] is None
    top_level_sources = {item["from"] for item in build["extraResources"]}
    assert "../python-runtime/win-x64" not in top_level_sources
    assert build["win"]["extraResources"] == [
        {"from": "../python-runtime/win-x64", "to": "python-runtime"}
    ]
    assert build["mac"]["extraResources"] == [
        {"from": "../python-runtime/mac-arm64", "to": "python-runtime"}
    ]


def test_frontend_dependency_cache_key_ignores_release_version_only_changes():
    import importlib.util

    script_path = REPO_ROOT / "scripts" / "ci_frontend_cache_key.py"
    spec = importlib.util.spec_from_file_location("ci_frontend_cache_key", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    lock = json.loads((REPO_ROOT / "frontend" / "package-lock.json").read_text(encoding="utf-8"))
    changed = json.loads(json.dumps(lock))
    changed["version"] = "99.99.99"
    changed["packages"][""]["version"] = "99.99.99"

    assert module.normalize_lock_for_dependency_cache(lock) == module.normalize_lock_for_dependency_cache(changed)


def test_release_workflow_caches_downloads_and_reusable_install_outputs():
    workflow = (REPO_ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")

    windows_job = workflow.split("  windows-release:", 1)[1].split("  macos-release:", 1)[0]
    macos_job = workflow.split("  macos-release:", 1)[1].split("  publish-release:", 1)[0]
    publish_job = workflow.split("  publish-release:", 1)[1]

    assert "backend-verification:" in workflow
    assert "cancel-in-progress: true" in workflow
    assert "actions/cache@v4" not in workflow
    assert "actions/cache@v5" in workflow
    assert workflow.count('cache: "pip"') == 1
    assert workflow.count("Cache Python virtualenv") == 1
    assert "steps.backend-venv-cache.outputs.cache-hit != 'true'" in workflow
    assert "steps.prepare-python-venv.outputs.needs_install == 'true'" in workflow
    assert ".venv/bin/python -m pip install -r requirements-dev.txt" in workflow
    assert workflow.count("Run backend tests") == 1
    assert workflow.count("Run demo checks") == 1
    assert "Run backend tests" not in windows_job
    assert "Run backend tests" not in macos_job
    assert "Run demo checks" not in windows_job
    assert "Run demo checks" not in macos_job
    assert workflow.count("Cache npm downloads") == 2
    assert workflow.count("Cache frontend node_modules") == 2
    assert workflow.count("Cache Electron package downloads") == 2
    assert "Cache macOS backend runtime" in workflow
    assert workflow.count("scripts/ci_frontend_cache_key.py") == 2
    assert workflow.count("npm ci --no-audit --fund=false") == 2
    assert "npm ci --prefer-offline" not in workflow
    assert workflow.count("compression-level: 0") == 2
    assert "pip install --upgrade pip" not in workflow
    assert "electron_config_cache" in workflow
    assert "- backend-verification" in publish_job


def test_frontend_tests_workflow_reuses_dependency_cache():
    workflow = (REPO_ROOT / ".github" / "workflows" / "frontend-tests.yml").read_text(encoding="utf-8")

    assert "actions/checkout@v6" in workflow
    assert "actions/setup-node@v6" in workflow
    assert "scripts/ci_frontend_cache_key.py" in workflow
    assert "Cache frontend node_modules" in workflow
    assert "actions/cache@v5" in workflow
    assert "steps.frontend-node-modules-cache.outputs.cache-hit != 'true'" in workflow
    assert "npm ci --no-audit --fund=false" in workflow
    assert "npm ci --prefer-offline" not in workflow


def test_mac_runtime_layout_contract_is_documented():
    runtime_readme = (REPO_ROOT / "python-runtime" / "mac-arm64" / "README.md").read_text(encoding="utf-8")
    prepare_script = (REPO_ROOT / "scripts" / "prepare_python_runtime.py").read_text(encoding="utf-8")

    assert "python-runtime/mac-arm64/bin/python3" in runtime_readme
    assert "Contents/Resources/python-runtime" in runtime_readme
    assert "DEFAULT_PYTHON_VERSION = \"3.13\"" in prepare_script
    assert "aarch64-apple-darwin" in prepare_script
    assert "\"freethreaded\" in name" in prepare_script
    assert "python-build-standalone" in prepare_script


def test_release_workflow_builds_and_publishes_macos_artifacts():
    workflow = (REPO_ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")

    assert "macos-release:" in workflow
    assert "name: macOS arm64" in workflow
    assert "runs-on: macos-latest" in workflow
    assert "Prepare macOS backend runtime" in workflow
    assert "npm run prepare:python-runtime:mac" in workflow
    assert "npx electron-builder --mac --publish never" in workflow
    assert 'GITHUB_TOKEN: ""' in workflow
    assert 'GH_TOKEN: ""' in workflow
    assert "officewhere-${{ needs.release-metadata.outputs.version }}-mac-arm64" in workflow
    assert "macos-release" in workflow.split("publish-release:", 1)[1]
    assert "github.event_name == 'workflow_dispatch'" not in workflow.split("publish-release:", 1)[1]
    assert "Windows x64 and macOS arm64 desktop builds generated by GitHub Actions." in workflow


def test_release_docs_do_not_describe_macos_packaging_as_future_work():
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    build_sh = (REPO_ROOT / "build.sh").read_text(encoding="utf-8")
    release_note = (REPO_ROOT / "docs" / "releases" / "v0.7.7.md").read_text(encoding="utf-8")
    windows_runtime_readme = (REPO_ROOT / "python-runtime" / "win-x64" / "README.md").read_text(encoding="utf-8")
    release_checklist = (REPO_ROOT / "docs" / "release-test-checklist.md").read_text(encoding="utf-8")
    mapped_drive_backslash = "K:" + "\\"
    mapped_drive_slash = "K:" + "/"
    embedded_runtime_phrase = "embedded " + "Python runtime"
    private_runtime_phrase = "private " + "Python runtime"
    protected_doc_acronym = "D" + "RM"

    assert "officewhere-vX.Y.Z-mac-arm64.dmg" in readme
    assert "macOS / Linux 패키지는 embedded Python 방식으로 추후 지원 예정" not in readme
    assert mapped_drive_backslash not in readme
    assert mapped_drive_slash not in readme
    assert protected_doc_acronym not in release_note
    assert protected_doc_acronym not in windows_runtime_readme
    assert protected_doc_acronym not in release_checklist
    assert embedded_runtime_phrase not in readme
    assert private_runtime_phrase not in readme
    assert "npm run package:mac" in build_sh


def test_python_runtime_asset_lookup_uses_github_token_when_available():
    prepare_script = (REPO_ROOT / "scripts" / "prepare_python_runtime.py").read_text(encoding="utf-8")
    workflow = (REPO_ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    macos_job = workflow.split("macos-release:", 1)[1].split("publish-release:", 1)[0]
    prepare_step = macos_job.split("Prepare macOS backend runtime", 1)[1].split("Build Electron macOS app", 1)[0]
    package_step = macos_job.split("Build Electron macOS app", 1)[1].split("Package macOS release bundle", 1)[0]

    assert "os.environ.get(\"GITHUB_TOKEN\") or os.environ.get(\"GH_TOKEN\")" in prepare_script
    assert "headers[\"Authorization\"] = f\"Bearer {token}\"" in prepare_script
    assert "GITHUB_TOKEN: ${{ github.token }}" in prepare_step
    assert "GITHUB_TOKEN: ${{ github.token }}" not in package_step
    assert 'GITHUB_TOKEN: ""' in package_step
    assert 'GH_TOKEN: ""' in package_step
