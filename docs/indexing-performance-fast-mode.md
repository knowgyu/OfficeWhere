# Indexing and Search Performance Decision Record

## Purpose

This is the version-controlled decision record for OfficeWhere's 0.4.x-0.5.0 performance work. It captures decisions that should survive beyond local `.omx/` planning files: indexing throughput, SQLite/FTS write strategy, search ordering, and follow-up scheduling ideas.

For a narrative experiment log that is easier to reuse in a blog post, see `docs/performance-experiment-log.md`.
For the docs-only backend role-separation/refactor plan that should guide future architecture work, see `docs/backend-python-boundary-refactor-plan.md`.

## Current behavior

- User-triggered 대상 추가 and 문서 새로고침 run in fast mode.
- Scheduler/automatic refresh stays conservative and does not silently inherit a manual fast run's worker count.
- Fast mode defaults to 24 workers and is capped at 32 through the UI/runtime. Worker values normalize to 4-step increments.
- Parser workers run in parallel, but SQLite writes are still serialized through the app-owned DB writer path.
- OfficeWhere indexes Office documents only: `.xlsx`, `.docx`, `.pptx`.
- Legacy Text/Markdown registrations are pruned from the app-owned index during library rescan. Source files are never deleted.
- Folder scanning skips exact folder-name matches for common developer/cache/build directories such as `node_modules`, `.git`, `venv`, `.venv`, `__pycache__`, `dist`, `build`, `target`, `.gradle`, `.cargo`, `.vscode`, `.idea`, `.omx`, and `.omc`.

## SQLite / FTS decisions

- Keep SQLite writes serialized. Multiple Python parser workers can prepare data, but DB mutation remains one writer at a time.
- Flush prepared DB writes by chunk count as well as file count. A single chunk-heavy Office file flushes separately so it does not sit inside a normal batch and make progress appear stuck.
- For first-run broad indexing, use a temporary staging DB when the app-owned file index is empty and the scan finds at least 50 Office files.
  - Staging defers FTS trigger maintenance while chunks are loaded.
  - FTS is rebuilt once at the end.
  - The verified DB is copied back into the main app DB.
  - User source documents remain read-only throughout.
- Do not defer WAL checkpoints as a separate runtime policy for now. User traces pointed first to FTS/write amplification; large WAL files can also hurt active reads.
- FTS tables use `columnsize=0` because the hot search path does not use SQLite BM25/rank docsize metadata.
- Search is treated as a local Office file finder, not a semantic relevance engine.
  - Filename matches are shown first.
  - Content matches use deterministic file metadata and in-document chunk order.
  - Lazy-loading can reveal up to 100 matching files without rendering an unbounded result set.

## Parser decisions

- Ignore embedded media/binary payloads for Word/PPT/Excel text indexing. OfficeWhere indexes text/table content; video/audio/image bytes are intentionally not parsed.
- Read XLSX sheet XML directly so malformed custom document properties do not block text/table extraction.
- Preserve formatted date cells as readable date text instead of raw Excel serial numbers.
- Keep normal refresh as the Excel stale-parser-config repair path; fast mode may skip unchanged stale configs for speed.
- Parser timings are logged separately from DB/index timings in `parsing-performance.log`.
  - Default location: next to `index-performance.log`.
  - Override: `OW_PARSE_PERF_LOG_PATH`.
  - Disable: `OW_PARSE_PERF_LOG=0`.
  - The parser log records paths, sizes, chunk counts, timings, and error metadata only; it must not store document body text.

## Resource profile

- Normal mode uses `OW_MAX_WORKERS` and the conservative default cap.
- Fast mode uses `OW_FAST_MAX_WORKERS` or the saved UI `fast_worker_count`, bounded by the runtime cap.
- GPU is not used. Office ZIP/XML parsing, filesystem I/O, antivirus/EDR inspection, and SQLite/FTS writes are CPU/I/O-bound.
- More workers do not guarantee proportional speedup. At high concurrency, user traces showed DB queue wait tails and parser/shared-resource contention.

## Scheduling notes for future work

Current implementation keeps scheduling intentionally simple. Future scheduling work should stay simple unless logs prove a repeatable gain:

- Prioritize Excel files early and sort Excel candidates by size descending.
- Reserve roughly half of worker slots for Excel while allowing idle slots to drain Word/PPT work.
- Do not implement complex per-file cost prediction yet. File size is a weak signal for PPT, but it is a useful first signal for slow Excel files.
- Python threads are already used. Process-based parsing could bypass more GIL contention, but it is a larger design because payload transfer, cancellation, memory, packaged Python behavior, and DRM/EDR interactions all become more complex.

## Performance log interpretation

`index-performance.log`:

- `scan_folder_done`: per-folder scan counts, skipped folder names, inaccessible folder names, unsupported suffix counts, and scan duration.
- `db_flush_done`: flush reason (`file_limit`, `chunk_limit`, `single_large_file`, `interval`, `final`, or `cancel`), batch file/chunk counts, and write duration.
- `db_batch_save_done`: lower-level SQLite timings such as metadata insert/update, chunk delete/insert, fingerprint upsert, commit time, DB target (`main` or `initial_staging`), and whether FTS triggers were active or deferred.
- `initial_index_staging_*`: whether first-run staging was selected and how long deferred FTS rebuild, trigger creation, quick check, and copy-back took.
- `rescan_skipped` with `reason=already_running`: a scheduler/direct refresh was suppressed because another rescan already holds the execution token.
- `rescan_end`: scan counts, unsupported-file counts, flush count/avg/max durations, registered chunk count, and legacy unsupported rows pruned.

`parsing-performance.log`:

- `excel_used_range_chunks_done`: Excel sheet range extraction and chunk generation duration.
- `excel_inspect_and_chunk_done`: total Excel metadata + chunk timing.
- `word_parse_done`: Word XML parse/chunk timing.
- `ppt_parse_done`: PPT slide XML parse/chunk timing.

## Guardrails

- Source documents remain read-only.
- App-data cleanup/reset must only touch app-owned DB/cache/settings/log locations.
- Already-running async rescan requests return the existing job status and do not change that job's mode/worker count.
- Scheduler/direct rescans skip while the execution token is held.
- Invalid API modes are rejected by schema validation.

## Verification focus

- Normal refresh repairs stale Excel parser config.
- Fast refresh skips unchanged stale Excel config and leaves normal refresh to repair it later.
- PPT extraction never reads `ppt/media/*` parts.
- XLSX inspection ignores malformed `docProps/custom.xml` custom properties and keeps date cells readable.
- Concurrent SQLite saves remain serialized and pass regression coverage.
- Search ordering remains deterministic and does not depend on BM25 rank.
