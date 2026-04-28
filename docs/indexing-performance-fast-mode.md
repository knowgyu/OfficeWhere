# Indexing Performance Fast Mode Plan

## Why this exists
Large OfficeWhere libraries can contain 1,000+ Office files. On high-spec PCs, users may prefer a faster, more resource-intensive indexing pass over the conservative default refresh.

## Decisions
- Keep **문서 새로고침** as the safe normal path.
- Add explicit **고속 색인** for users who accept higher CPU/RAM usage.
- Resolve worker count per rescan run instead of mutating a module-global worker count.
- Keep SQLite writes serialized with the process-local write lock; parser workers may run in parallel, but DB mutation remains one writer at a time.
- Ignore embedded media/binary parts for Word/PPT/Excel text indexing. OfficeWhere indexes text/table content; video/audio/image payloads are intentionally not parsed.
- Read XLSX sheet XML directly so malformed custom document properties do not block text/table extraction; preserve formatted date cells as readable date text.
- Keep normal refresh as the Excel stale-parser-config repair path; fast mode may skip unchanged stale configs for speed.

## Resource profile
- Normal mode uses `OW_MAX_WORKERS` and the conservative default cap.
- Fast mode uses `OW_FAST_MAX_WORKERS` and a higher cap for explicit high-speed runs.
- GPU is not used: Office ZIP/XML parsing, filesystem I/O, and SQLite/FTS writes are CPU/I/O-bound.

## Guardrails
- Source documents remain read-only.
- Existing automatic/scheduler refreshes stay in normal mode.
- Already-running rescan requests return the existing job status and do not change that job's mode/worker count.
- Invalid API modes are rejected by schema validation.

## Verification focus
- Normal refresh repairs stale Excel parser config.
- Fast refresh skips unchanged stale Excel config and leaves normal refresh to repair it later.
- PPT extraction never reads `ppt/media/*` parts.
- XLSX inspection ignores malformed `docProps/custom.xml` custom properties and keeps date cells readable rather than raw serial numbers.
- Concurrent SQLite saves remain serialized and pass regression coverage.
