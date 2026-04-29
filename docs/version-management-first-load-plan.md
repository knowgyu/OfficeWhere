# RALPLAN — Version-management first-load and first-query responsiveness

Date: 2026-04-29
Scope: follow-up plan for OfficeWhere version-management tab responsiveness.
Status: approved planning artifact after Planner/Architect/Critic revision loop; not yet implemented.

## Requirements summary

OfficeWhere should not block the version-management tab's first visible UI on full version-group analysis. On first entry, users should quickly see which Office files are registered and that document-group analysis is running. Heavier work such as version-family grouping, duplicate-content evidence, and fingerprint enrichment may complete in the background and refresh the group list when ready.

Current evidence:

- `frontend/src/components/ConsistencyCheck.tsx` mounts the version-management surface and calls both `fetchFiles(0, '')` and `fetchGroups(0, 'all')` in the initial effect.
- `frontend/src/api/client.ts` maps group list calls to `GET /api/library/groups`.
- `backend/api/library.py:get_library_groups()` delegates to `backend/core/library.py:list_file_groups()`.
- `list_file_groups()` currently calls `_all_file_group_details()` before filtering, sorting, and paging.
- `_all_file_group_details()` checks `_group_cache_key()`, which uses `get_registered_files_signature()` from `backend/database.py` and can scan registered-file metadata even when the group cache is warm.
- On cache miss, `_build_all_file_group_details()` loads all registered files, parses filename identities, builds exact-name and version-family groups, and only then applies the UI query/type/kind filters.

## RALPLAN-DR summary

### Principles

1. First paint before full analysis: show registered files and progress before complete group intelligence.
2. Preserve correctness: background analysis may be stale while running, but finished results must match the current library revision.
3. Keep source documents read-only and app-data scoped.
4. Prefer small reversible steps before introducing persistent group tables.
5. Add observable timing/state before claiming performance wins.

### Decision drivers

1. Perceived latency on first tab entry and first query.
2. Risk of invalid/stale group results after file registration, removal, rescan, or manual latest changes.
3. Implementation size suitable for a follow-up patch after 0.6.1.

### Viable options

#### Option A — Lazy UI plus in-process background warmup

- Add a group-analysis status/warmup path.
- On tab entry, render `files.page` immediately and start group warmup in the background.
- Poll or refresh group summaries when warmup completes.
- Replace expensive cache-key scans with lightweight library/manual-latest revisions.

Pros:
- Smallest change that addresses perceived latency.
- No new tables or migration surface.
- Easy to verify with existing API tests and frontend build.

Cons:
- First process start still pays full group build in the background.
- Group search cannot be truly SQL-pushed-down yet.
- Very large libraries may still need materialized summaries later.

#### Option B — SQL-filtered on-demand grouping

- For query/type/kind requests, first narrow `registered_files` in SQL.
- Build only candidate groups for that narrowed set.

Pros:
- First query can become much cheaper when search text or file type is selective.
- Avoids persistent schema changes.

Cons:
- Exact-name/version-family grouping can miss members unless candidate expansion rehydrates related filenames/base names.
- More edge cases around counts and pagination.

#### Option C — Materialized group summary tables

- Store `library_groups` and `library_group_members` in app-owned SQLite.
- Update them during rescan/register/delete/manual-latest changes.
- Group list becomes direct SQL `SELECT ... LIMIT/OFFSET`.

Pros:
- Best long-term first-query performance.
- Natural place for counts, sort keys, and filter indexes.

Cons:
- Largest migration and invalidation surface.
- Higher risk of stale group data if every write path is not covered.
- More than needed until traces prove background warmup is insufficient.

### Favored direction

Start with **Option A**, while instrumenting enough timing/state to decide whether Option B or C is justified later.

## Acceptance criteria

1. Opening the version-management tab does not wait for `/api/library/groups` before showing registered Office files.
2. The UI shows a clear background state such as `문서 묶음 분석 중…` while group warmup is running.
3. When warmup finishes, the group list refreshes without requiring a manual tab reload.
4. Re-entering the tab with a warm cache returns group summaries without rebuilding all groups.
5. On a cold cache, the initial tab entry calls `POST /api/library/groups/warmup` and `GET /api/library/groups/status` first; it does not call the blocking `/api/library/groups` path until status is `ready`.
6. `GET /api/library/groups` supports `cache_only=true`; while cold or warming it returns a non-error empty page with warmup metadata rather than building groups inline. Blocking fresh rebuild remains an explicit backend-only path, not the default UI first-paint path.
7. Manual latest-file changes still update the active group promptly and overlay/mutate the cached target group without forcing an immediate full rebuild. Manual-latest is treated as an overlay revision outside the expensive group-build cache, and the overlay updates cached summaries/details for the affected group.
8. If registered files change during warmup, stale warmup results are discarded or recomputed for the newer revision.
9. Duplicate-content/fingerprint evidence is deferred: before evidence is ready, `include_duplicates=false` shows exact-name groups with `content_status=pending`; same-content groups are hidden only after evidence confirms `same_content`. It must not run as an unbounded pre-page operation on first paint.
10. Source Office documents are never modified, moved, renamed, or deleted.
11. Tests cover cache warmup status, stale revision rejection, fingerprint/content-evidence deferral, and latest-file/manual-latest invalidation behavior.
12. Verification passes: backend tests, frontend build, Electron TypeScript build, compileall, demo checks, and `git diff --check`.

## Implementation plan

### Step 1 — Add lightweight library revision tracking

Touchpoints:

- `backend/database.py`
- `backend/core/library.py`
- tests around registration/removal/rescan/manual latest settings

Work:

- Add or reuse a settings-backed `library_revision` value that increments when registered-file membership or relevant metadata changes.
- Increment it transactionally in the registered-file mutation paths: single-file save/register/update, batch save, file delete by id, file delete by type, clear all registered files, and `update_file_mtime` because mtime influences latest-file ordering.
- Include first-run/staging replacement paths: `InitialIndexStagingDatabase.finalize_to_main()` and staging batch writes must result in a newer library revision when the main DB is replaced.
- Treat manual latest as a separate overlay revision outside the expensive group-build cache key. Manual-latest writes update the overlay revision and mutate/overlay the warm cache for affected summaries/details; they must not force a full group rebuild just to reflect latest ordering.
- Replace `_group_cache_key()`'s broad registered-file hash with a payload based on DB path and library revision for the expensive group build, plus the manual-latest overlay revision only at the overlay/application layer.
- Keep revision increments close to the write transaction that changes the relevant data; tests should fail if a public mutation path leaves cache revisions unchanged.

Notes:

- Avoid relying only on timestamps; monotonic integer strings are easier to test.
- Keep DB path in the cache key so tests/app-data switches do not reuse stale process cache.

### Step 2 — Split initial UI loading

Touchpoints:

- `frontend/src/components/ConsistencyCheck.tsx`

Work:

- Keep `fetchFiles(0, '')` on mount as the first visible content path.
- Start group warmup/status separately and do not let group loading dominate the whole tab state.
- Avoid the current cold-cache pattern where the first mount immediately calls blocking `/api/library/groups`: call `POST /api/library/groups/warmup`, poll `GET /api/library/groups/status`, then call `GET /api/library/groups` when status becomes `ready`.
- If the UI needs an early group request, it must pass `cache_only=true`, which returns currently cached groups or an empty warming response without inline group construction.
- Add copy for background group analysis using existing UI primitives and Korean copy.
- Keep group filter/query controls usable while analysis is pending; if necessary, show that group results will update after analysis completes.

### Step 3 — Add group warmup/status API

Touchpoints:

- `backend/api/library.py`
- `backend/core/library.py`
- `backend/models/schemas.py`
- `frontend/src/api/client.ts`

Work:

- Add `POST /api/library/groups/warmup` to start or join a single-flight background warmup.
- Add `GET /api/library/groups/status` to read status. Register these static routes before `/api/library/groups/{group_id}` in `backend/api/library.py`.
- Add a status model with explicit fields: `state`, `current_revision`, `cached_revision`, `in_flight_revision`, `stale`, `started_at`, `completed_at`, `error`, and optional elapsed timing.
- Define state transitions:
  - cold `idle`: no cached groups, no worker running.
  - cold `warming`: no cached groups, worker running for `in_flight_revision`; UI shows files plus analysis-running copy.
  - warm `ready`: `cached_revision == current_revision`, no newer worker required; UI may fetch groups normally.
  - stale cached with newer in-flight: `cached_revision < current_revision`, worker running; UI may display stale cached groups with a visible `업데이트 중` note while registered files remain authoritative.
  - `error`: last warmup failed; UI keeps file list visible and can show retry copy.
- Implement a single-flight background worker so repeated tab entries do not start duplicate group builds.
- Cache results only if the completed revision still matches the current revision.
- `GET /api/library/groups?cache_only=true` returns cached groups only. If no cache exists, it returns an empty page plus warmup metadata/state, not a blocking rebuild.
- Default UI first-paint path must not trigger inline full build; blocking/fresh rebuild may remain an explicit internal/default-off option for diagnostics or tests.

### Step 4 — Move content evidence off the critical path

Touchpoints:

- `backend/core/library.py`
- `backend/database.py`
- `tests/test_library_groups.py`

Work:

- Ensure exact-name duplicate fingerprint/content evidence does not run as an unbounded pre-page operation during first paint.
- Either warm duplicate evidence as part of the background group job or enrich only the currently displayed page.
- Preserve the default behavior that same-name/same-content duplicates can be hidden once evidence is available, but avoid blocking initial file visibility on that evidence.
- Before fingerprint evidence is ready and `include_duplicates=false`, return exact-name groups with `content_status=pending`; hide only groups proven to be `same_content`. Counts should describe the currently returned evidence state, and the UI can refresh after enrichment completes.

### Step 5 — Refresh groups when background analysis completes

Touchpoints:

- `frontend/src/components/ConsistencyCheck.tsx`
- `frontend/src/api/client.ts`

Work:

- Trigger warmup on tab entry.
- Poll status at a modest interval while pending/running, or perform one delayed refresh if the initial group call is already pending.
- Refresh group summaries once warmup completes.
- Stop polling on unmount or when the tab changes.

### Step 6 — Overlay manual-latest changes into warm cache

Touchpoints:

- `backend/core/library.py`
- `tests/test_library_groups.py`

Work:

- After saving or clearing manual latest, update/overlay the affected cached group in memory when the cache is warm.
- Keep the API response on the warm target group path.
- Ensure a subsequent group list reflects the manual latest order without forcing an immediate full rebuild.
- Because manual-latest is an overlay revision outside the expensive group-build cache key, update the overlay revision/cached overlay state together so `_group_cache_key()` does not invalidate the expensive group cache solely due to manual latest.

### Step 7 — Instrument and test

Touchpoints:

- `tests/test_library_groups.py`
- frontend build/TypeScript checks
- optional performance log additions if kept lightweight

Work:

- Unit-test cache key changes and stale revision handling.
- Unit-test warmup single-flight behavior.
- Unit-test each revision mutation path: single save/register/update, batch save, first-run/staging `finalize_to_main()`, delete id/type/all, `update_file_mtime`, and manual-latest overlay changes.
- Verify manual-latest APIs remain fast with a warm group cache and that the next group list sees the overlay.
- Test duplicate-content/fingerprint enrichment does not run unbounded on first paint.
- Keep metrics non-invasive; do not log document content.

## Risks and mitigations

- Risk: background warmup finishes with stale data after a rescan.
  Mitigation: include revision in warmup start/finish and discard mismatched results.

- Risk: UI appears incomplete or confusing while group analysis runs.
  Mitigation: show registered files immediately and use explicit copy that analysis is running in the background.

- Risk: revision increments are missed on a write path.
  Mitigation: centralize increments around registered-file write/delete/clear and manual-latest save functions; add tests for each public API path.

- Risk: background thread errors become silent.
  Mitigation: persist status error text for UI/snackbar/log visibility, without document body content.

## Verification plan

- `./venv/bin/python -m pytest tests/test_library_groups.py -q`
- `./venv/bin/python -m pytest -q`
- `cd frontend && npm run build`
- `cd frontend && npm run build:electron`
- `./venv/bin/python scripts/run_demo_checks.py`
- `./venv/bin/python -m compileall backend backend_server.py -q`
- `git diff --check`

Manual/performance follow-up after implementation:

- Open version-management tab on a large existing app-data DB and verify file list appears before group analysis finishes.
- Re-enter the tab and verify warm cache behavior.
- Type a query during background analysis and confirm the UI stays responsive.

## Consensus review amendments

Architect review approved Option A with required amendments. Critic review then required pinning backend/frontend contracts. The plan now explicitly covers endpoint names and route order, cold/cache-only `/api/library/groups` behavior, warmup state transitions, duplicate-content/fingerprint enrichment semantics, exhaustive transactional revision increments including staging finalize, and manual-latest as a non-rebuild overlay.

## ADR

### Decision

Implement version-management first-load responsiveness first with lazy UI rendering, lightweight revision-based cache invalidation, and a single-flight background group warmup. Defer SQL-pushed grouping and materialized group tables until traces show Option A is insufficient.

### Drivers

- User-perceived responsiveness matters more than having all group intelligence ready before first paint.
- The current full-group rebuild path is correct but too expensive to keep on the critical first-render path.
- The next patch should remain reversible and low-risk.

### Alternatives considered

- SQL-filtered on-demand grouping: useful for later first-query optimization, but easy to undercount group members unless expanded carefully.
- Materialized group tables: strongest long-term model, but too large for the immediate follow-up and risks stale data across many write paths.
- Doing nothing beyond latest-file click optimization: leaves first tab entry and first query latency unresolved.

### Why chosen

Option A gives the UI a fast first paint while preserving the existing grouping algorithm as the source of truth. It minimizes schema risk and creates observability for deciding whether heavier architecture is warranted.

### Consequences

- The app will have a visible distinction between registered files and analyzed document groups.
- Background status/state must be kept accurate.
- Future materialized-table work remains possible because the revision/status boundary can be reused.

### Follow-ups

- If first query remains slow after Option A, add SQL candidate narrowing with safe member expansion.
- If first process-start warmup remains too slow for very large libraries, materialize group summaries in SQLite.
- Consider search-result file header menu separately: open file, show in folder, copy path.

## Available agent types / staffing guidance

Solo `$ralph` path:

- `executor`: implement backend revision/warmup and frontend lazy loading.
- `test-engineer`: extend group/cache tests and check UI state assumptions.
- `verifier`: run the full verification suite and inspect evidence.

Team path:

- Lane 1 `executor`: backend revision cache key and warmup/status APIs.
- Lane 2 `executor`: frontend lazy first-paint and polling/refresh UI.
- Lane 3 `test-engineer`: backend tests and frontend type/build verification.
- Lane 4 `code-reviewer` or `verifier`: integration review, stale-state risks, and final evidence.

Launch hints:

```bash
omx team 4:executor "Implement docs/version-management-first-load-plan.md with separate backend/frontend/test/review lanes. Keep source documents read-only."
# or
$ralph "Implement docs/version-management-first-load-plan.md and verify with the listed commands."
```

Team verification path:

1. Backend lane proves revision/warmup status behavior with tests.
2. Frontend lane proves first-paint UI does not block on group completion via build/type checks and component state review.
3. Test lane runs the listed verification commands.
4. Verifier confirms no source-document mutation paths and no GitHub Release publication behavior changes unless explicitly requested.
