#!/usr/bin/env python3
"""Emit a stable frontend dependency cache key for GitHub Actions.

`frontend/package-lock.json` includes the OfficeWhere package version at the
root. Release-only version bumps should not invalidate dependency caches, so the
hash intentionally removes only the root package version fields and keeps every
actual dependency package version intact.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCKFILE = REPO_ROOT / "frontend" / "package-lock.json"


def normalize_lock_for_dependency_cache(lock: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(lock)
    normalized.pop("version", None)

    root_package = normalized.get("packages", {}).get("")
    if isinstance(root_package, dict):
        root_package.pop("version", None)

    return normalized


def compute_frontend_dependency_hash(lockfile: Path = LOCKFILE) -> str:
    lock = json.loads(lockfile.read_text())
    normalized = normalize_lock_for_dependency_cache(lock)
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:20]


def main() -> int:
    print(f"hash={compute_frontend_dependency_hash()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
