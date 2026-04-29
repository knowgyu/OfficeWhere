# Version-management first-load implementation note

Date: 2026-04-29
Status: implemented as a DB-backed derived index.

Follow-up performance roadmap: `docs/search-version-performance-roadmap.md`.

## Final direction

The initial warmup-only plan was superseded after reviewing the real performance requirement: the expensive operation should be the first target-add/indexing pass, and normal version-management use should read prepared app-owned data.

OfficeWhere now treats version/exact-name document groups as a persistent SQLite derived index rather than a synchronous in-memory rebuild:

- `library_group_index_files` stores per-file group keys and file snapshots.
- `library_group_index` stores serialized group summaries/details with filter/sort columns.
- `library_group_members` stores group membership.
- `library_group_dirty_keys` records affected exact-name/version-family keys.
- settings store derived-index version/state/update/error metadata.

## Lifecycle contract

1. **During active indexing/rescan**
   - Do not build version groups.
   - Mark affected group keys or repair-needed state only.

2. **After indexing/rescan completes**
   - Schedule one background refresh.
   - If the derived index is cold/corrupt/version-mismatched, run a full repair rebuild.
   - Otherwise rebuild only dirty affected keys.

3. **On normal UI group requests**
   - The version-management UI calls `GET /api/library/groups?cache_only=true`.
   - The API returns prepared rows plus status metadata, and schedules background repair/warmup if needed.
   - It does not synchronously rebuild all groups on the UI request path.

4. **On small mutations**
   - Add/update: union old/new keys for the changed file and refresh those keys.
   - Delete: use the deleted row's old keys and refresh those keys.
   - Manual latest: refresh only the target group key.

## Acceptance evidence

- First version-management UI request can return stale/empty prepared rows with `derived_index_stale=true` and auto-refresh after the background job completes.
- Manual latest no longer invalidates an all-file group rebuild.
- Same-name duplicate filtering uses persisted fingerprint evidence produced during refresh.
- Full rebuild is reserved for cold/corrupt/version mismatch or explicit repair fallback.

## Verification focus

- `tests/test_library_groups.py` covers cache-only non-rebuild and incremental affected-key refresh.
- `tests/test_database_schema.py` covers the derived-index schema.
- `tests/test_files_api.py` covers the search-result folder reveal backend API.
