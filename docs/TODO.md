# OfficeWhere TODO

Last updated: 2026-04-27

This file tracks follow-up work that is not part of the formal release checklist. Keep `docs/release-test-checklist.md` for release validation steps.

## Immediate follow-ups

- [ ] Decide whether root agent guides should be versioned.
  - Current state: `AGENTS.md` and `CLAUDE.md` exist locally, but `.gitignore` ignores both.
  - If these should be shared across machines/agents, remove or override those ignore rules and commit both files.

- [ ] Review and commit the current OfficeWhere rename/cleanup batch.
  - Includes OfficeWhere naming cleanup, `OW_*` env-only config, `window.officeWhere`, dev ports `18765`/`15173`, `officewhere_backend.spec`, and removal of `scripts/run_perf_checks.py`.
  - Before committing, inspect `git diff` to make sure no unrelated changes are bundled unintentionally.

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

- [ ] Verify packaged Electron behavior on both Windows and macOS.
  - Packaged backend should keep using a dynamic localhost port.
  - Dev scripts should default to backend `18765` and frontend `15173`.

- [ ] Decide whether `docs/content-fingerprint-roadmap.md` is still current after recent version-management changes.
  - Keep file-level fingerprints as the default unless real usage shows chunk-level fingerprints are needed.

- [ ] Consider adding a lightweight dependency/security audit pass before release.
  - `frontend/package-lock.json` contains transitive deprecation notices from the Electron/Vite ecosystem; evaluate only if they affect release risk.

## Maintenance notes

- Do not reintroduce legacy `Office Data Joiner`, `ODJ_*`, `officeDataJoiner`, `office_data_joiner`, or `office-data-joiner` names unless explicitly adding a compatibility layer.
- Do not delete regenerated build/cache artifacts after verification unless cleanup is explicitly requested.
