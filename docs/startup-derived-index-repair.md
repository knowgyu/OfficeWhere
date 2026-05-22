# Startup and derived-index repair policy

OfficeWhere release startup must keep the desktop app available even when an existing app-owned SQLite DB is large or contains stale derived indexes from an older release.

## Policy

- Backend startup may create/verify the structural SQLite schema and run small bounded migrations.
- Startup must not synchronously rebuild whole-DB derived data such as FTS search indexes just because a derived index version marker changed.
- Rebuildable derived data is marked with explicit state (`ready`, `repair_needed`, `refreshing`, `error`) and repaired after startup by a daemon worker.
- Source Office documents remain read-only. Repair work touches only OfficeWhere-owned DB/index/cache rows under the app data directory.
- Search responses surface `search_index_state` and `search_index_stale` so the UI can explain temporary content-search limitations instead of reporting a backend failure.

## Current derived repairs

| Derived data | Startup behavior | Background behavior | User-facing effect while stale |
| --- | --- | --- | --- |
| Search text / FTS index | Mark `search_index_state=repair_needed`; do not rebuild during `init_db()` | Refresh `file_chunks.search_text`/`trigram_text`, recreate FTS tables, rebuild/optimize, set ready | Filename search remains available; content search is temporarily limited and shows a notice |
| Excel-derived index payload | Mark `excel_index_state=repair_needed`; do not delete Excel chunks during `init_db()` | Clear stale Excel-derived chunks/fingerprints/cache and mark Excel files for reindex | Existing app opens; affected Excel content is refreshed by later rescan/reindex |

## Release guidance

When changing parser/search/index logic:

1. Bump a derived index version only when existing derived rows are materially incompatible.
2. Do not add whole-DB rebuild work to `init_db()` unless it is proven tiny and bounded.
3. Prefer background repair with observable state and safe degraded behavior.
4. Add regression tests proving stale derived versions do not block startup.
5. Keep source document safety explicit in release notes when repair behavior changes.
