# Indexing Performance Fast Mode Plan

## Why this exists
Large OfficeWhere libraries can contain 1,000+ Office files. On high-spec PCs, users may prefer a faster, more resource-intensive indexing pass over the conservative default refresh.

This file is the durable decision record for indexing/DB/search-performance tradeoffs discussed during the 0.4.x-0.5.0 performance work. Local `.omx/plans/*` files hold planning scratchpads, but this document is the version-controlled reference.

## Decisions
- Keep **문서 새로고침** as the safe normal path.
- Run user-triggered folder additions and manual refreshes through fast mode; keep automatic/scheduler refreshes conservative.
- Resolve worker count per rescan run instead of mutating a module-global worker count.
- Keep SQLite writes serialized with the process-local write lock; parser workers may run in parallel, but DB mutation remains one writer at a time.
- Keep fast mode's default worker count at 24 and cap the UI/runtime at 32. Higher values produced long DB queue tails in user traces.
- Index only Office documents (`.xlsx`, `.xls`, `.docx`, `.pptx`). Legacy Text/Markdown registrations are app-owned rows and are pruned during library rescan; source files are not deleted.
- Skip exact folder-name matches for common developer/cache/build directories such as `node_modules`, `.git`, `venv`, `.venv`, `__pycache__`, `dist`, `build`, `target`, `.gradle`, `.cargo`, `.vscode`, `.idea`, `.omx`, and `.omc`.
- Flush prepared DB writes by chunk count as well as file count. A single chunk-heavy Office file flushes separately so it does not sit in a normal batch and make the UI look stuck.
- For first-run broad indexing, use a temporary staging DB when the app-owned file index is empty and the scan finds at least 50 Office files. Staging defers FTS trigger maintenance while chunks are loaded, then rebuilds FTS once and copies the verified DB into the main app DB. This keeps user source documents read-only and preserves settings.
- Search is treated as a local Office file finder, not a BM25 relevance engine. Filename matches are shown first; content matches are ordered by deterministic file metadata and in-document chunk order. FTS tables use `columnsize=0` because the hot search path no longer depends on SQLite BM25/rank docsize metadata.
- The search UI may lazy-load up to 100 matching files. It still fetches bounded pages instead of rendering an unbounded result set.
- Library rescans use a process-local execution token so automatic scheduler refreshes do not overlap manual/fast rescans.
- Do not defer WAL checkpoints as a separate runtime policy for now. User traces point first to FTS/write amplification; large WAL files can also hurt reads while the UI is active.
- Do not store extra Word/PPT comparison summaries for version management yet. Keep the DB lean; prefer lazy-loading detailed diff results in the UI if version comparison feels slow.
- Ignore embedded media/binary parts for Word/PPT/Excel text indexing. OfficeWhere indexes text/table content; video/audio/image payloads are intentionally not parsed.
- Read XLSX sheet XML directly so malformed custom document properties do not block text/table extraction; preserve formatted date cells as readable date text.
- Keep normal refresh as the Excel stale-parser-config repair path; fast mode may skip unchanged stale configs for speed.

## Resource profile
- Normal mode uses `OW_MAX_WORKERS` and the conservative default cap.
- Fast mode uses `OW_FAST_MAX_WORKERS` and a higher, user-visible cap for explicit high-speed runs.
- GPU is not used: Office ZIP/XML parsing, filesystem I/O, and SQLite/FTS writes are CPU/I/O-bound.

## Scheduling notes
- Current implementation uses bounded parser worker threads plus serialized DB writes.
- Future scheduling work should stay simple: prioritize Excel files early, sort Excel candidates by size descending, and reserve roughly half of worker slots for Excel while allowing idle slots to drain Word/PPT work.
- Do not implement complex per-file cost prediction until logs show a repeatable gain. File size is a weak signal for PPT but a useful first signal for slow Excel files.
- Python threads are already used. More threads do not guarantee more CPU parallelism because ZIP/XML/string parsing can hit the GIL and shared I/O/security-scanner limits; process-based parsing is a separate, higher-risk design.

## Performance log interpretation
- `scan_folder_done` reports per-folder `visited_dir_count`, `skipped_dir_count`, skipped folder names, `inaccessible_dir_count`, inaccessible folder names, unsupported suffix counts, and scan duration.
- `db_flush_done` reports `reason` (`file_limit`, `chunk_limit`, `single_large_file`, `interval`, `final`, or `cancel`), batch file/chunk counts, and write duration.
- `db_batch_save_done` reports lower-level SQLite timings such as metadata insert/update, chunk delete/insert, fingerprint upsert, commit time, target DB (`main` or `initial_staging`), and whether FTS triggers were active or deferred.
- `initial_index_staging_*` events show whether first-run staging was selected and how long deferred FTS rebuild, trigger creation, quick check, and copy-back took.
- `rescan_skipped` with `reason=already_running` means a scheduler/direct refresh was suppressed because another rescan already holds the execution token.
- `rescan_end` summarizes scan counts, unsupported-file counts, flush count/avg/max durations, registered chunk count, and legacy unsupported rows pruned.
- Detailed parser timing is written to a separate `parsing-performance.log` so large Excel/PPT/Word parse tails can be shared without mixing them into DB/index flush events. Override with `OW_PARSE_PERF_LOG_PATH`; disable with `OW_PARSE_PERF_LOG=0`.
- The UI emits a `saving` progress stage while DB writes are being committed so a long flush is visible instead of appearing hung.

## Guardrails
- Source documents remain read-only.
- Existing automatic/scheduler refreshes stay in normal mode.
- Already-running async rescan requests return the existing job status and do not change that job's mode/worker count; scheduler/direct rescans skip while the execution token is held.
- Invalid API modes are rejected by schema validation.

## Verification focus
- Normal refresh repairs stale Excel parser config.
- Fast refresh skips unchanged stale Excel config and leaves normal refresh to repair it later.
- PPT extraction never reads `ppt/media/*` parts.
- XLSX inspection ignores malformed `docProps/custom.xml` custom properties and keeps date cells readable rather than raw serial numbers.
- Concurrent SQLite saves remain serialized and pass regression coverage.
