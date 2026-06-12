---
title: "Search DB Open Latency and Persistent Read Connection Decision"
tags: ["search", "performance", "sqlite", "edr", "persistent-connection"]
created: 2026-06-11T14:12:11.088Z
updated: 2026-06-11T14:12:11.088Z
sources: []
links: []
category: decision
confidence: medium
schemaVersion: 1
---

# Search DB Open Latency and Persistent Read Connection Decision

## Context
- OfficeWhere v0.15.1 added request-level search timings to separate SQLite connection/open cost from filename search, content/FTS reads, and merge work.
- User-observed corporate EDR/antivirus environment shows repeated cache-miss searches where `db_open_ms` dominates wall time.

## Observed timings
- Query `인공지능`: `total_ms=3106`, `db_open_ms=2754`, `filename_ms=343`, `content_ms=8`, `merge_ms=8`, `content_storage_db_open_ms=0`, `content_storage_borrowed_connection=true`, `content_storage_search_table=file_search_trigram`, `content_fts_rowid_count=240`.
- Query `llmops` immediately after: `total_ms=2772`, `db_open_ms=2756`, `filename_ms=9`, `content_ms=6`, `merge_ms=6`.
- Combined two-request share: `db_open_ms` is about 93.7% of total request time. The second request is about 99.4% DB-open dominated.

## Interpretation
- FTS reads are not the bottleneck: content storage borrows the request connection, `content_storage_db_open_ms=0`, and FTS/detail/merge timings are single-digit ms despite hundreds of FTS rowids.
- Merge optimization is not the main performance lever in this environment; keeping it is low-risk but it does not explain the observed latency.
- The first query's `filename_ms=343` appears to be one-time warm-up or fallback/read cache behavior, because the next query drops to 9ms. Check `filename_source`, `filename_fallback_reason`, and Everything candidate metrics if this recurs.
- The dominant fixed cost is connection preparation: current `db_open_ms` includes `sqlite3.connect()` plus initial PRAGMA setup, not just FTS table access.

## Decision direction
- Pursue a persistent read connection for interactive search first, before deeper FTS/query rewrites.
- Keep source Office documents read-only and only reuse app-owned SQLite DB connections.
- Implement with explicit invalidation/close hooks for schema rebuild, app-data reset, DB path reconfiguration, and process shutdown.
- Avoid changing write-connection ownership in the first pass; reduce risk by making the persistent connection read-only or read-path-only.

## Validation target
- Before/after logs should show repeated cache-miss search requests no longer spending ~2.7s in `db_open_ms`.
- Expected healthy post-change shape: `db_open_ms` near 0 for reused reads, with total request time closer to filename/content/merge timings unless cache miss does expensive fallback work.
- If persistent connection fails or is invalidated, request should fall back to a one-shot read connection and log that path.

## Related prior records
- OfficeWhere Search Version and Performance Decisions
- Search Version Performance Roadmap

## Proposed implementation strategy

1. Limit the first change to the interactive search read path.
   - Do not convert every `_read_connection()` caller immediately.
   - Start with `search_documents()` because the logs prove this path pays the repeated ~2.7s DB-open fixed cost.

2. Add a dedicated persistent search read-connection manager in `backend/database.py`.
   - Keep `_write_connection()` unchanged.
   - Provide a new context manager such as `_search_read_connection(row_factory=sqlite3.Row)` or `persistent_search_read_connection()`.
   - Use one app-owned SQLite connection reused across search requests, with explicit metrics for `reused`, `opened`, `invalidated`, and fallback.

3. Make threading behavior explicit.
   - FastAPI sync endpoints can run in worker threads, so a normal SQLite connection cannot be shared blindly.
   - Preferred first-pass safety: one shared connection opened with cross-thread support plus a process-local lock around each borrowed search request. This serializes search DB reads but avoids repeated EDR-triggered opens; query work is currently only single-digit ms after the connection is ready.
   - Alternative if concurrency becomes an issue: thread-local persistent read connections, accepting one initial DB-open cost per worker thread.

4. Keep invalidation explicit.
   - Close and clear the persistent read connection when DB path is reconfigured, schema/init/reset work runs, app data is reset, or process shuts down.
   - On `sqlite3.Error` that suggests stale schema/closed DB/corruption, invalidate once and retry with a fresh one-shot read connection or reopened persistent connection.

5. Preserve read-only safety.
   - The persistent connection is for app-owned SQLite DB reads only; it must never touch source Office files.
   - Writes, rescans, indexing, migrations, and app-data cleanup remain under existing write/reset paths.

6. Validate with logs and regression tests.
   - Add tests proving repeated search requests reuse the same read connection and keep content storage borrowed (`content_storage_db_open_ms=0`).
   - Add tests proving `configure_database()` or invalidation closes the persistent connection so test DB swaps do not leak state.
   - Success metric: cache-miss repeated searches should show near-zero `db_open_ms` on reused reads and total request time should drop near the filename/content/merge timings.
