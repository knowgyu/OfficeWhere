# OfficeWhere TODO

Last updated: 2026-04-28

This file tracks follow-up work that is not part of the formal release checklist. Keep `docs/release-test-checklist.md` for release validation steps.

## Immediate follow-ups

- [ ] Verify the embedded-Python Windows package on DRM policy PCs.
  - Current direction: packaged Windows release runs `backend_server.py` through the bundled `python-runtime/win-x64/python.exe` and vendors exact-pinned parser dependencies.
  - Confirm DRM-protected `.xlsx` / `.docx` / `.pptx` files index with the same behavior as the successful portable Python probe.
  - Include paths with spaces and Korean characters in the manual pass.
  - If a DRM policy PC still blocks reads, collect backend logs and rerun `scripts/drm_probe.py --library-check` with the bundled runtime before changing architecture.

- [ ] Decide whether root agent guides should be versioned.
  - Current state: `AGENTS.md` and `CLAUDE.md` exist locally, but `.gitignore` ignores both.
  - If these should be shared across machines/agents, remove or override those ignore rules and commit both files.

- [ ] Run full release verification once the working tree is ready.
  - `./venv/bin/python -m pytest -q`
  - `cd frontend && npm run build`
  - `cd frontend && npm run build:electron`
  - `./venv/bin/python scripts/run_demo_checks.py`
  - `./venv/bin/python -m compileall backend backend_server.py -q`
  - `git diff --check`

## Product / engineering follow-ups

- [ ] Manually walk through `docs/release-test-checklist.md` on Windows before publishing the next release.
  - Especially mapped/network drive registration, app-data reset, tray close behavior, and original-document safety.

- [ ] Verify packaged Electron behavior on Windows and track macOS/Linux embedded-runtime follow-up.
  - Packaged backend should keep using a dynamic localhost port.
  - Dev scripts should default to backend `18765` and frontend `15173`.

- [ ] Re-test large-library search/version responsiveness after the search-version performance pass.
  - Current direction: base `file_search` is no longer maintained, `file_search_ko` is a compact short-query fallback, version groups are cached by registered-file signature, and unchanged comparison results are reused by file stat/scope cache key.
  - If the first version-tab load is still slow, consider materializing group summaries in app-owned SQLite instead of rebuilding from all registered files after each process start.
  - If repeated comparisons accumulate too much app-data, add a comparison-cache retention policy by age/count.
  - Choseong-only search such as `ㅎㅇㄹ` is intentionally no longer guaranteed; keep 1-2 character Korean substring search working.

- [ ] Decide whether `docs/content-fingerprint-roadmap.md` is still current after recent version-management changes.
  - Keep file-level fingerprints as the default unless real usage shows chunk-level fingerprints are needed.

- [ ] Consider adding a lightweight dependency/security audit pass before release.
  - `frontend/package-lock.json` contains transitive deprecation notices from the Electron/Vite ecosystem; evaluate only if they affect release risk.

## Maintenance notes

- Do not reintroduce legacy `Office Data Joiner`, `ODJ_*`, `officeDataJoiner`, `office_data_joiner`, or `office-data-joiner` names unless explicitly adding a compatibility layer.
- Do not delete regenerated build/cache artifacts after verification unless cleanup is explicitly requested.
