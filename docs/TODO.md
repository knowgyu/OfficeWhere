# OfficeWhere TODO

Last updated: 2026-04-29

This file tracks follow-up work that is not part of the formal release checklist. Keep `docs/release-test-checklist.md` for release validation steps.

## Immediate follow-ups

- [ ] Implement the version-management first-load plan in `docs/version-management-first-load-plan.md`.
  - First paint should show registered Office files quickly.
  - Version-family / duplicate-content group analysis may warm in the background and refresh the group list when ready.
  - Start with lazy UI + revision-based cache invalidation + single-flight warmup before considering materialized group tables.

- [ ] Verify the embedded-Python Windows package on DRM policy PCs if DRM policy machines still behave differently from the portable Python probe.
  - Current direction: packaged Windows release runs `backend_server.py` through the bundled `python-runtime/win-x64/python.exe` and vendors exact-pinned parser dependencies.
  - Include paths with spaces and Korean characters if this is retested.
  - If a DRM policy PC still blocks reads, collect backend logs and rerun `scripts/drm_probe.py --library-check` with the bundled runtime before changing architecture.

- [ ] Decide whether root agent guides should be versioned.
  - Current state: `AGENTS.md` and `CLAUDE.md` exist locally, but `.gitignore` ignores both.
  - If these should be shared across machines/agents, remove or override those ignore rules and commit both files.

## Product / engineering follow-ups

- [ ] Add a search-result file context menu on the filename/header area.
  - Suggested actions: open file, show in folder/file location, copy full path, and optionally show app-level file details.
  - Electron does not automatically expose the OS shell context menu inside the React result card; implement an app-owned context menu wired through preload/main APIs such as `shell.showItemInFolder` when this is prioritized.
  - Keep the menu small and user-facing; avoid parser/debug actions in the first pass.

- [ ] Keep Python backend boundary refactor staged and performance-guarded.
  - Use `docs/backend-python-boundary-refactor-plan.md` as the source of truth before moving modules.
  - Start with characterization tests and compatibility facades; do not begin with a broad package rewrite.
  - Treat search/version first-paint and indexing throughput as acceptance criteria.

- [ ] Revisit simple scheduling only if logs show a likely 10%+ wall-clock gain.
  - Candidate: Excel-first ordering with about half the worker slots reserved for Excel-heavy runs.
  - Avoid complex cost prediction until repeated traces justify it.

- [ ] Consider adding a lightweight dependency/security audit pass before a published GitHub Release.
  - `frontend/package-lock.json` contains transitive deprecation notices from the Electron/Vite ecosystem; evaluate only if they affect release risk.

## Completed / user-owned for now

- App-data deletion/reset/exit race is handled by prior reset/shutdown commits; user will do any needed real-use confirmation.
- In-app update notice and portable zip update flow are implemented.
- First-run onboarding/tutorial is implemented.
- Large DB/indexing structural optimization is considered complete enough for now; remaining performance work is the version-management first-load plan above.
- Manual release checklist walk-through is user-owned and should not block agent follow-up work unless explicitly requested.

## Maintenance notes

- Do not reintroduce legacy `Office Data Joiner`, `ODJ_*`, `officeDataJoiner`, `office_data_joiner`, or `office-data-joiner` names unless explicitly adding a compatibility layer.
- Do not delete regenerated build/cache artifacts after verification unless cleanup is explicitly requested.
