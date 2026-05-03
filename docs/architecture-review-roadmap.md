# Architecture Review Roadmap

Date: 2026-04-30
Status: current cross-cutting roadmap after external review, architect review, and critic review.

This document is the source of truth for the 2026-04-30 external architecture review triage. It complements, but does not replace:

- `docs/search-version-performance-roadmap.md` for search/version hot-path decisions;
- `docs/backend-python-boundary-refactor-plan.md` for long-term Python backend boundary direction;
- `docs/TODO.md` for the short actionable backlog.

## Standing principles

1. **No big-bang rewrite.** Large files are real maintainability risks, but they should be split by durable responsibility boundaries, not line count.
2. **Facade / Strangler Fig first.** Keep compatibility facades such as `backend/database.py`, `backend/core/library.py`, and `frontend/src/api/client.ts` while moving internals behind them.
3. **Hot-path neutrality.** Refactors must not add source-document I/O, extra network calls, heavier DB transactions, or slower first paint without a deliberate decision record.
4. **Last-index snapshot model.** Search/version/compare paths should prefer app-owned indexed data or rebuildable caches; source freshness warnings are warning-only and should not force live source hashing/parsing.
5. **Source documents are read-only.** OfficeWhere must not delete, move, rename, or save over user-selected source Office documents.
6. **No new dependencies by default.** Add tooling or UI/runtime packages only after a scoped plan justifies the cost.

## Current completed foundation

- Search/version performance phases have already landed: Excel sparse diff, metadata warnings, SQL-backed group summaries, PPT comparison guard, and compressed Word/PPT comparison artifacts.
- Responsibility refactor wave 1 landed backend `library_*` support seams and frontend consistency result presenters.
- Responsibility refactor wave 2 landed the frontend API facade split: `transport.ts`, `shared.ts`, `library.ts`, with `client.ts` kept as compatibility facade.
- Node 24 CI maintenance is complete.
- App-data reset now schedules app restart after successful cleanup.
- Architecture review P0-P3 wave landed as a facade-first strangler pass:
  - Electron arbitrary window-open URLs are limited to `http:` / `https:`.
  - File-location actions are delegated through `backend/services/file_location_service.py` with shell-free platform command construction.
  - `backend/database.py` has a `_read_connection()` helper and comparison-artifact storage is isolated behind `backend/storage/comparison_artifacts.py`.
  - Library rescan status/write policy/config coordination is isolated in `backend/core/rescan.py` and `backend/config.py`.
  - Shared file-scope constants live in `backend/file_constants.py`.
  - FileManager app-data/general settings sections and ConsistencyCheck group timeline presenter are split by product responsibility.
- Second refactor wave landed as another facade-first slice:
  - Library-group derived-index SQL/JSON mechanics moved behind `backend/storage/library_groups.py` while `backend/database.py` remains the public facade.
  - `FileManager` registered-file list rendering moved to `components/file-manager/RegisteredFilesSection.tsx`; controller state/API/dialog behavior remains in `FileManager.tsx`.
- Scanner boundary/performance slice landed for v0.6.8:
  - Default folder discovery moved toward `os.scandir` streaming traversal.
  - Managed library rescans can reuse conservative app-owned directory snapshots only when validation is high-confidence; otherwise they fallback to full filesystem scan.
  - One-shot folder scan now reuses the shared scanner filtering semantics.

## External review triage

### Accept immediately or soon

| Item | Why accept | Cost / risk | Preferred implementation style |
| --- | --- | --- | --- |
| Electron `openExternal` URL validation | Low-cost security hardening; current generic window-open handler can pass arbitrary schemes to the OS. | Low. Must preserve release-page open behavior. | Allow only `http:`/`https:` external links, optionally deny/log others. |
| Windows Explorer show-in-folder hardening | The current `Popen` string is not classic `shell=True` injection, but command-line string assembly is fragile and audit-unfriendly. | Medium-low. Explorer `/select` quoting can regress. | Preserve behavior with focused tests; prefer shell-free process args only if Explorer selection still works. |
| DB read connection context manager | Several read paths close connections manually; exceptions before close can leak resources. | Medium because many small edits can create broad diff. | Add `_read_connection()` and migrate read functions incrementally, starting with hot/low-risk paths. |
| `models -> core` constant dependency | `backend/models/schemas.py` importing `core.file_scope` is a small reverse dependency. | Low. | Move shared constants to a neutral module and update both sides. |
| Hangul search tests | Korean/choseong search is product-critical and should have direct regression coverage. | Low. | Add focused unit tests for `hangul_search.py` / normalization behavior. |
| Silent broad exception handling | Some broad catches are necessary for corrupt Office docs and cache fallback, but silent swallowing hurts field diagnosis. | Medium. Over-narrowing can make the app less robust with real user files. | Keep fallback behavior; add diagnostic logging/IDs only where currently silent. |

### Accept, but only as scoped refactor waves

| Item | Why accept | Cost / risk | Preferred implementation style |
| --- | --- | --- | --- |
| `database.py` responsibility split | It mixes connection, schema/migrations, CRUD, FTS, group summaries, cache, artifacts, and settings. | High. Transaction boundaries, schema migration, import cycles, and FTS behavior are easy to regress. | Keep `backend/database.py` facade. Split connection/read helpers first, then artifact/group-index/search repositories one wave at a time. |
| `_rescan_library_impl` split | The function owns scan, status, parser workers, staging DB, batch flush, cancellation, and error handling. | High because it is an indexing hot path. | Preserve cancellation/progress/staging/batch policies; extract scanner/planner/writer/status seams one at a time. |
| `FileManager.tsx` split | It still owns file list, library settings, app-data reset, preview, scan status, and display settings UI. | Medium-high. App-data reset and scan UX are easy to break. | Extract only the next touched area: data-management panel, library settings panel, or file-list presenter. |
| `ConsistencyCheck.tsx` remaining controller split | Result presenters are already extracted, but group/history/manual-latest/controller orchestration remains. | Medium. Tutorial, selection, and history diff behavior are coupled. | Extract a hook/presenter only around the next version-management UI change. |
| API service/use-case facades | Routers still call core/database functions directly. | Medium. A generic service layer can become overengineering. | Add service facades only for changed areas, not all routers at once. |
| Environment/config centralization | Env reads are scattered across backend runtime, perf logging, server entrypoint, Electron, and Vite. | Low-medium across Python/TS boundary. | Start with Python backend plain config module; avoid new settings dependency unless justified. |

### Defer unless evidence changes

| Item | Why defer |
| --- | --- |
| List virtualization dependency | Existing list/group pages are bounded. Add a new virtual-list dependency only after DOM/render profiling shows it is the bottleneck. |
| Frontend test framework | Valuable before deeper UI refactors, but Vitest/RTL introduces new dev dependencies and maintenance surface. Plan separately. |
| DB engine replacement / async FastAPI rewrite | Current bottlenecks are data shape and hot-path breadth, not proof that SQLite/FastAPI sync routes are the main issue. |
| Mandatory Everything/ES dependency | ES can be an optional Windows discovery accelerator only; OfficeWhere must remain fully functional without it. |
| Full migration backup by default | Useful for destructive app-owned DB migrations, but it has disk/privacy complexity. Prefer bounded one-generation backup only for risky migrations. |

## Current roadmap / TODO order

### P0 — Tiny security hardening — completed in current wave

1. Validate external URLs before `shell.openExternal` in Electron.
2. Harden Windows “show in folder” command construction while preserving Explorer selection behavior.

Success criteria:
- Electron build passes.
- Existing release/update URL behavior still works.
- Windows show-in-folder tests preserve the intended Explorer command semantics.

### P1 — Stability and regression safety — completed in current wave

1. Add `_read_connection()` to `backend/database.py` and migrate a first low-risk set of read helpers.
2. Move shared file-scope defaults out of `core` so `models/schemas.py` no longer depends on core implementation modules.
3. Add direct Hangul/choseong search unit tests.
4. Add diagnostic logging to currently silent broad exception paths without removing user-facing fallback behavior.

Success criteria:
- Full backend tests pass.
- No DB schema change unless separately planned.
- No source-document reads/writes added to normal UI paths.

### P2 — Small boundary refactor waves — second wave completed

1. Extract a backend storage seam behind `backend/database.py` facade, starting with comparison artifacts or library group summaries.
2. Extract `_rescan_library_impl` seams around scan/planning/status/write coordination, preserving monkeypatch-compatible aliases where tests depend on them.
3. Add a narrow service/use-case facade for the next changed API area instead of rewriting all routers.
4. Centralize backend env/config reads in a lightweight module.

Success criteria:
- Compatibility imports remain available.
- Existing indexing/staging/batch/FTS behavior is unchanged unless a test-backed change is explicitly planned.
- Representative search/version/indexing verification stays green.

Completed scope:
- Comparison artifacts were chosen as the first storage repository slice.
- File-location/show-in-folder was chosen as the first API service facade slice.
- Rescan extraction stayed on status/write-policy/config seams and preserved the `backend/core/library.py` public facade.
- Library-group derived-index storage mechanics are now isolated in `backend/storage/library_groups.py`; `backend/database.py` still owns connection/state/version policy and public function compatibility.

Deferred scope:
- Further group domain-builder extraction remains separate because it touches grouping semantics rather than storage mechanics.
- DB engine replacement and generic service layers remain non-goals.

### P3 — Frontend maintainability waves — second wave completed

1. Extract `FileManager` data-management/app-reset section first if reset/settings work continues.
2. Extract `FileManager` library settings or file-list presenter when those areas are next touched.
3. Extract remaining `ConsistencyCheck` group/history controller seams only when version-management UI changes require it.
4. Decide whether to introduce frontend tests before the next large UI refactor.

Success criteria:
- Existing Korean copy, CSS classes, tutorial markers, snackbar behavior, and import facade compatibility are preserved.
- No new UI dependency unless a separate plan approves it.

Completed scope:
- `FileManager` app-data reset/data-management UI was extracted to `components/file-manager/AppDataManagementSection.tsx`.
- `FileManager` display/close-behavior UI was extracted to `components/file-manager/GeneralSettingsSection.tsx`.
- `ConsistencyCheck` group timeline/version history presenter was extracted to `components/consistency/GroupTimeline.tsx`.
- `FileManager` registered-file list/search/selection/pagination presenter was extracted to `components/file-manager/RegisteredFilesSection.tsx` without moving API calls or state ownership.

Deferred scope:
- FileManager library settings hook/presenter and frontend test framework remain separate decisions.
- No list virtualization dependency was added because current list/group pages are bounded and no profiling evidence justified it.

### P4 — Optional product/performance follow-ups

1. Optional Everything SDK discovery accelerator is prepared as a v0.7.0 candidate, but remains release-gated on Windows validation plus SDK/license/redistribution decisions before any DLL/ES bundling.
2. List virtualization or hand-rolled viewport rendering only if profiling shows bounded paging is insufficient.
3. Bounded app-owned DB backup only for risky schema migrations, with pruning and reset cleanup rules.
4. Local AI Agent integration remains a later security/architecture task.

## Non-goals

- Do not perform a frontend/backend mega-refactor just because a file is large.
- Do not replace SQLite, add a new DB/search engine, or make ES mandatory in response to this review.
- Do not add live source fingerprint verification to normal compare/detail paths.
- Do not ask users to weaken antivirus/DLP/EDR; design around fewer unnecessary file opens instead.
