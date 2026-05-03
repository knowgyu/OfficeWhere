#!/usr/bin/env python3
"""Prepare bundled Python runtimes for Electron packaging.

The macOS app uses a private CPython runtime instead of PyInstaller so the
downloaded `.app` can start the FastAPI backend without requiring users to
install Python. The script intentionally uses only the standard library.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PYTHON_VERSION = "3.13"
PYTHON_STANDALONE_API = "https://api.github.com/repos/astral-sh/python-build-standalone/releases"
PYTHON_STANDALONE_RELEASES_PAGE = "https://github.com/astral-sh/python-build-standalone/releases"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare OfficeWhere bundled Python runtime")
    parser.add_argument("target", choices=["mac-arm64"], help="Runtime target to prepare")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing prepared runtime",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve and print the selected runtime asset without downloading",
    )
    parser.add_argument(
        "--skip-pip-install",
        action="store_true",
        help="Only unpack CPython; do not install requirements.txt into the runtime",
    )
    parser.add_argument(
        "--python-version",
        default=os.environ.get("OW_PYTHON_RUNTIME_VERSION", DEFAULT_PYTHON_VERSION),
        help="CPython major.minor version to select from python-build-standalone releases",
    )
    return parser.parse_args()


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "OfficeWhere-runtime-prep",
        },
    )
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - retry network boundary
            last_error = exc
            if attempt < 3:
                time.sleep(attempt * 1.5)
    assert last_error is not None
    raise last_error


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "OfficeWhere-runtime-prep"})
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001 - retry network boundary
            last_error = exc
            if attempt < 3:
                time.sleep(attempt * 1.5)
    assert last_error is not None
    raise last_error


def score_asset_name(name: str, release_index: int = 0) -> int:
    score = release_index * 100
    if "stripped" not in name:
        score += 10
    return score


def find_asset_from_releases_page(python_version: str) -> tuple[str, str]:
    version_pattern = re.escape(f"cpython-{python_version}")
    pattern = re.compile(
        rf'href="(?P<href>[^"]*?/astral-sh/python-build-standalone/releases/download/[^"]*?'
        rf'{version_pattern}[^"]*?aarch64-apple-darwin[^"]*?install_only[^"]*?\.tar\.gz)"'
    )
    page = fetch_text(PYTHON_STANDALONE_RELEASES_PAGE)
    candidates: list[tuple[int, str, str]] = []
    for match in pattern.finditer(page):
        href = html.unescape(match.group("href"))
        if "debug" in href or "freethreaded" in href:
            continue
        url = href if href.startswith("http") else f"https://github.com{href}"
        name = url.rsplit("/", 1)[-1].replace("%2B", "+")
        candidates.append((score_asset_name(name), name, url))
    if not candidates:
        raise RuntimeError("GitHub releases page did not expose a matching runtime asset link")
    _, name, url = sorted(candidates, key=lambda item: item[0])[0]
    return name, url


def find_asset(target: str, python_version: str) -> tuple[str, str]:
    if target != "mac-arm64":
        raise ValueError(f"unsupported target: {target}")

    platform_marker = "aarch64-apple-darwin"
    version_marker = f"cpython-{python_version}"
    try:
        releases = fetch_json(f"{PYTHON_STANDALONE_API}?per_page=20")
    except Exception:
        return find_asset_from_releases_page(python_version)
    candidates: list[tuple[int, str, str]] = []

    for release_index, release in enumerate(releases):
        for asset in release.get("assets", []):
            name = asset.get("name", "")
            url = asset.get("browser_download_url", "")
            if not url:
                continue
            if version_marker not in name or platform_marker not in name:
                continue
            if "install_only" not in name or not name.endswith(".tar.gz"):
                continue
            if "debug" in name or "freethreaded" in name:
                continue
            candidates.append((score_asset_name(name, release_index), name, url))

    if not candidates:
        raise RuntimeError(
            f"could not find {version_marker} {platform_marker} install_only asset "
            "in recent python-build-standalone releases"
        )

    _, name, url = sorted(candidates, key=lambda item: item[0])[0]
    return name, url


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "OfficeWhere-runtime-prep"})
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                with destination.open("wb") as output:
                    shutil.copyfileobj(response, output)
            return
        except Exception as exc:  # noqa: BLE001 - retry network boundary
            last_error = exc
            if destination.exists():
                destination.unlink()
            if attempt < 3:
                time.sleep(attempt * 2)
    assert last_error is not None
    raise last_error


def find_extracted_runtime(root: Path) -> Path:
    matches = [path for path in root.rglob("bin/python3") if path.is_file()]
    if not matches:
        raise RuntimeError("archive did not contain bin/python3")
    return matches[0].parents[1]


def copy_runtime(source: Path, destination: Path, force: bool) -> None:
    if destination.exists():
        if not force and (destination / "bin" / "python3").exists():
            print(f"Runtime already prepared: {destination}")
            return
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    python_bin = destination / "bin" / "python3"
    python_bin.chmod(python_bin.stat().st_mode | 0o755)


def install_requirements(runtime_dir: Path, skip: bool) -> None:
    if skip:
        return
    if platform.system() != "Darwin" or platform.machine() not in {"arm64", "aarch64"}:
        raise RuntimeError(
            "Installing macOS arm64 runtime packages requires running this script on a macOS arm64 builder. "
            "Use --skip-pip-install only for archive/layout inspection."
        )

    python_bin = runtime_dir / "bin" / "python3"
    requirements = REPO_ROOT / "requirements.txt"
    subprocess.run([str(python_bin), "-m", "ensurepip", "--upgrade"], check=True)
    subprocess.run([str(python_bin), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run([str(python_bin), "-m", "pip", "install", "-r", str(requirements)], check=True)


def prepare_mac_arm64(args: argparse.Namespace) -> None:
    runtime_dir = REPO_ROOT / "python-runtime" / "mac-arm64"
    python_bin = runtime_dir / "bin" / "python3"
    if python_bin.exists() and not args.force:
        print(f"Runtime already prepared: {python_bin}")
        return

    asset_name, asset_url = find_asset(args.target, args.python_version)
    print(f"Selected runtime asset: {asset_name}")
    print(asset_url)
    if args.dry_run:
        return

    cache_dir = REPO_ROOT / ".cache" / "python-runtime"
    archive = cache_dir / asset_name
    if not archive.exists():
        print(f"Downloading {asset_name}...")
        download(asset_url, archive)

    with tempfile.TemporaryDirectory(prefix="officewhere-python-runtime-") as temp_dir:
        extract_root = Path(temp_dir)
        with tarfile.open(archive, "r:gz") as tar:
            if sys.version_info >= (3, 12):
                tar.extractall(extract_root, filter="data")
            else:
                tar.extractall(extract_root)
        copy_runtime(find_extracted_runtime(extract_root), runtime_dir, args.force)

    install_requirements(runtime_dir, args.skip_pip_install)
    print(f"Prepared runtime: {python_bin}")


def main() -> int:
    args = parse_args()
    try:
        if args.target == "mac-arm64":
            prepare_mac_arm64(args)
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI needs concise error output
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
