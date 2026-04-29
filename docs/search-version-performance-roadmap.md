# Search / Version Performance Roadmap

Date: 2026-04-29
Status: decision record for future work; not yet an implementation plan for a release.

## Why this document exists

This document consolidates the scattered discussion notes, external review feedback, and architect/critic review around OfficeWhere search, indexing, and version-management performance.

The key lesson is that the main risk is not “SQLite is too weak” or “we need a full rewrite.” The current slow paths mostly come from doing too much work at the wrong time:

- broad filesystem discovery before indexing;
- rectangular Excel diff loops over mostly empty cells;
- version group list requests that can still read/filter/sort too much derived JSON in Python;
- Word/PPT comparison paths that can re-open source documents instead of using comparison-ready indexed data;
- large UI and backend modules where new performance branches can easily add more complexity.

The product direction is therefore:

> Keep SQLite and the current desktop architecture, but narrow hot paths, reduce source-file re-reads, and move expensive derived work to indexing/refresh or rebuildable app-owned caches.

## Product stance: last-index snapshot, not live source comparison

OfficeWhere should behave as a **last-index snapshot** tool:

- Source Office documents are read-only and must never be modified, moved, renamed, or deleted by the app.
- Search, version list browsing, and normal comparison review should prefer app-owned indexed data/caches.
- Opening source files should happen mainly during explicit indexing/rescan/refresh, not during every normal UI navigation.
- If a file changes after the last index and the user has not refreshed, showing the last-indexed result is not a program error.
- A light warning is useful when the app can cheaply see that a source file appears newer than its indexed timestamp: “이 문서는 마지막 색인 이후 수정된 것 같습니다. 최신 내용으로 보려면 새로고침하세요.” The warning should not force a re-read or block the comparison.
- Avoid live fingerprint verification on compare/detail paths. Re-reading or hashing source files just to prove freshness defeats the main goal, especially on corporate PCs with antivirus, DLP, EDR, or DRM hooks.

Derived tables and artifacts are **rebuildable caches**, not source of truth. If they become incompatible, corrupt, or version-mismatched, the safe recovery is to rebuild them from indexed files during refresh/repair. The source documents remain untouched.

## External review: accepted, corrected, and deferred points

### Accepted insights

- `frontend/src/components/ConsistencyCheck.tsx`, `frontend/src/components/FileManager.tsx`, and `frontend/src/api/client.ts` are large enough to be a maintainability risk.
- `backend/core/library.py` owns too many responsibilities: scanning, rescan orchestration, grouping, status, settings, and derived-index lifecycle.
- Excel comparison currently has a rectangular worst case: if the used range grows to many rows/columns, the compare loop can walk far more coordinates than actually contain values.
- Version group list/detail paths should keep moving toward prepared SQL-backed summaries instead of rebuilding/filtering all groups in Python.
- Word/PPT compare can benefit from indexed comparison artifacts because source re-reads are costly and can be much worse under corporate security software.
- PPT slide alignment has an `O(n*m)` similarity shape; it is usually fine for small decks but needs a guard for unusually large decks.
- More targeted comparison tests are needed for the future sparse/artifact/SQL paths.

### Corrected or overstated points

- “There are no comparison tests” was overstated. `tests/test_checker.py` already exercises comparison behavior, but future changes still need narrower tests for Excel sparse diff, truncation warnings, group SQL filtering/paging, and Word/PPT artifact fallback.
- Excel cell indexing does **not** store empty cells. The blow-up risk is value-heavy Excel files and many non-empty chunks/cells, not empty-cell persistence.
- The global SQLite write lock is not automatically a design bug. SQLite still has one writer, and the current app intentionally batches writes and uses first-run staging. The risk is incremental write tail latency, not proof that PostgreSQL is needed now.
- Sync FastAPI routes are acceptable for a single-user desktop app. An async rewrite is not a current performance priority.

### Deferred or rejected overreactions

- Do not migrate to PostgreSQL/Tantivy/Meilisearch/DuckDB as the first response. The version-management bottleneck is data shape and hot-path breadth, not just the DB engine.
- Do not normalize the whole version-group model into many relational tables first. A hybrid derived summary plus serialized detail is enough for the current app.
- Do not perform a frontend mega-refactor before user-visible performance work. Instead, create small landing zones exactly where new logic will be added.
- Do not require Everything/ES. It can be an optional accelerator only.
- Do not add live source fingerprint checks to every compare. Freshness belongs to refresh/indexing; normal UI should avoid source I/O.

## Final roadmap

### P1 — Excel sparse diff and visible warnings

Goal: avoid walking empty rectangular space when comparing Excel versions.

Current issue:

- Current Excel diff can conceptually compare every coordinate in the sheet rectangle from `1..max_row` and `1..max_col`.
- If a template originally has only `A1:Z1` filled, but a returned workbook has values down to row `10000`, the rectangular range can become `10000 × 26` coordinates even if many cells are empty.
- The existing safety cap can stop after a limit of issues, but the loop can still waste time scanning coordinates before or between actual changes.

Preferred algorithm:

- Build maps of non-empty cells for both sides.
- Compare only the coordinate union: `before_cells.keys() ∪ after_cells.keys()`.
- A removed value is still detected because its coordinate exists in `before_cells`.
- An added value is still detected because its coordinate exists in `after_cells`.
- Coordinates empty on both sides do not need comparison.
- Sort output by sheet order, row, and column for deterministic UI.

Expected benefit:

- Large benefit for sparse or inflated used-range sheets.
- Smaller benefit for dense sheets where most cells are filled.
- Does not remove the cost of parsing/loading a dense Excel file; it mainly fixes the comparison loop.

Warnings:

- Keep a hard display/report cap, e.g. “처음 500개 변경점만 표시합니다.”
- Add a separate high-change-ratio warning, because many differences can mean either a legitimately large update or a wrongly grouped/different document.
- Prefer ratio-aware wording over only absolute count:
  - Example: “변경된 셀이 매우 많아 같은 양식의 다른 버전이 아닐 수 있습니다.”
  - Use both a minimum count and a ratio threshold so a tiny 10-cell file with 8 changes is treated differently from a 10,000-cell file with 500 changes.

Frontend boundary:

- Before adding new Excel warning/detail UI, extract only the touched Excel comparison panel/digest pieces from `ConsistencyCheck.tsx`.
- This is not a broad redesign. It is a landing-zone extraction so the sparse-diff UI does not make the already-large component larger and harder to reason about.

Test focus:

- Template row `A1:Z1` vs returned data through row `10000` should not require rectangular scanning.
- Added, removed, and changed cells must all be detected by coordinate union.
- Output order is stable across sheets/rows/columns.
- Display truncation warning appears when the backend caps results.
- High-ratio warning appears separately from truncation.

### P2 — Group SQL hybrid for list/filter/sort/page

Goal: make the version-management group list read prepared summary columns from SQLite instead of loading all serialized groups into Python for every list request.

Current direction already exists:

- The derived group index stores prepared group data and metadata.
- `group_json` is useful for detail views, because a complete nested group payload is convenient and avoids premature full normalization.

Refined design:

- Generate `group_json` and summary/search/sort columns together during derived-index refresh.
- Treat both as one-way derived outputs from canonical app data: registered files, fingerprints, manual-latest settings, and grouping rules.
- Use SQL `WHERE`, `ORDER BY`, `LIMIT`, and `OFFSET` for list requests.
- Keep `group_json` for detail expansion and compatibility.
- Do not let UI writes mutate summary columns directly.
- Do not implement two-way sync between `group_json` and summary columns.
- SQLite triggers are probably not the right boundary because grouping logic is Python/domain-heavy. A transactional rebuild/snapshot path is simpler and easier to test.

Useful summary columns may include:

- group id/key, group type, file type;
- display/search text;
- file count and latest modified time;
- content status/counts derived from fingerprints;
- manual-latest marker or latest file id;
- sort helpers for recent/name/count/content status.

Tradeoffs:

- Pros: faster paging/filtering, lower Python heap churn, better UI first paint, clearer query semantics.
- Cons: schema/migration work, refresh code must keep summary and detail generated together, and tests must pin count/sort/filter behavior.

Test focus:

- Cache-only group list does not trigger a full rebuild.
- Search/filter/sort/page are performed by SQL and return the same visible groups as the old Python path.
- Manual latest refresh updates only affected groups.
- Same-content duplicate hiding still uses persisted fingerprint evidence.

### P3 — PPT similarity guard

Goal: prevent unusually large PPT decks from producing excessive slide-similarity work.

Current issue:

- PPT alignment compares slide similarity in an `n × m` dynamic-programming shape.
- This is acceptable for common 10-30 slide decks, but a 100-slide vs 100-slide comparison can create 10,000 similarity calls.

Preferred guard:

- Cache pairwise slide similarity results inside a comparison.
- Add cheap prefilters where safe, such as text length/token-count distance or exact slide hash equality.
- Consider a maximum DP cell budget or fallback alignment mode for very large decks.
- Keep user-visible behavior conservative: better to show a bounded “large deck comparison simplified” notice than freeze the app.

Test focus:

- Normal small PPT comparisons are unchanged.
- Large deck comparisons do not explode in similarity calls.
- Guard/fallback wording is visible if precision is intentionally reduced.

### P4 — Word/PPT compressed comparison artifacts

Goal: reduce source Office re-reads for Word/PPT compare/detail paths, especially on corporate PCs where every file open can be intercepted by security software.

What an artifact is:

- An app-owned, rebuildable, compressed representation of the text structure extracted during indexing.
- It is **not** a copy of the original Office file.
- It is **not** hash-only. It must retain enough text and order/location data to show current text-based diffs.
- Hashes are accelerators for “unchanged block/slide” fast paths; text remains available for explaining the change.

Possible Word artifact payload:

- ordered block list;
- block type where useful;
- best-effort location/page label;
- raw extracted text used for compare display;
- normalized/text hash for fast equality checks;
- artifact/parser version.

Possible PPT artifact payload:

- ordered slide list;
- slide title/text summary;
- ordered text items/shapes/tables when needed;
- raw extracted text used for compare display;
- slide/item hashes for fast equality checks;
- artifact/parser version.

What it intentionally does not cover at first:

- formatting/design changes;
- image movement or replacement;
- animations/transitions;
- comments/review metadata;
- pixel-perfect visual rendering.

The user has confirmed that design/format/image-position changes are not important for the current product value. The artifact should therefore target text/content comparison, not full document rendering.

Freshness/invalidation model:

- Tie artifacts to OfficeWhere’s indexed generation/version, not to live source verification at compare time.
- Store metadata such as `file_id`, `file_type`, `artifact_version`, `parser_version`, `source_indexed_at` or equivalent indexed generation, compressed payload, payload size, and created time.
- If the app-owned index is refreshed, regenerate or invalidate affected artifacts as part of that refresh lifecycle.
- If a source file appears newer than the indexed timestamp, show a warning but do not silently re-read/hash it during normal compare.
- Existing `document_fingerprints` may help validate internal indexed-state consistency, but should not require live file hashing on compare.

Storage expectations:

- Artifacts add storage on top of `file_chunks`; they do not replace search chunks.
- Search chunks remain needed for FTS, Korean/choseong/trigram search, locations, and search result shaping.
- A rough expectation for text artifacts is around extracted text size plus metadata, often compressing well. Typical libraries may see tens to hundreds of MB of extra app-owned DB/cache data; unusually text-heavy libraries can be higher.
- Use compression, artifact versioning, payload size accounting, and pruning/repair options.

Tradeoffs:

- Pros: faster cache misses and multi-pair comparisons, fewer source file opens, more predictable behavior under antivirus/DLP/EDR, reusable structure for future compare UI.
- Cons: more app-owned storage, schema/versioning complexity, rebuild lifecycle to maintain, and a risk of confusing artifacts with source of truth unless the “last-index snapshot” contract is clear.

Test focus:

- Word/PPT compare can use artifacts and produce the same text diff as source parse for representative documents.
- Artifact version mismatch falls back to rebuild/refresh policy without corrupting source documents.
- Compressed payload round-trips across app restarts.
- Source-modified-after-index warning is shown as a warning only.

### P5 — Optional Everything/ES discovery accelerator

Goal: speed up file candidate discovery on Windows when the user already has Everything/ES available, while keeping OfficeWhere fully functional without it.

Scope:

- Use Everything/ES only to collect candidate Office file paths under watched folders.
- Do not use Everything for OfficeWhere content search, choseong search, version grouping, or comparison.
- Keep OfficeWhere’s own SQLite/FTS/search/choseong pipeline.

Rules:

- Windows-only optional path.
- Detect `es.exe` separately; `Everything.exe` being installed does not mean the CLI exists.
- Require Everything service/app to be usable, or fail fast.
- Apply OfficeWhere exclude-folder and supported-extension rules after receiving candidates.
- Add timeouts and automatic fallback to the current Python filesystem scan.
- Do not require users in locked-down corporate environments to install or enable it.

Licensing/package note:

- Treat ES as an optional external/bundled helper only after checking its current license and redistribution terms before packaging. Do not make it a hard runtime dependency.

Test focus:

- Missing `es.exe` falls back silently to Python scan.
- ES timeout/error falls back and does not block indexing.
- Candidate post-filtering preserves OfficeWhere exclude rules.

### P6 — Gradual cleanup as landing zones, not a mega-refactor

Goal: prevent each performance improvement from making large files even harder to maintain.

Approach:

- Extract only the component/module slice needed by the current feature.
- Keep behavior locked with targeted tests before moving logic.
- Prefer facade-compatible backend moves over import-path churn.
- Do not introduce new dependencies or service containers for cleanup alone.

Likely landing zones:

- Excel comparison display/digest pieces out of `ConsistencyCheck.tsx` before sparse warning UI.
- Group-list query/repository helpers around derived index SQL before expanding group list behavior.
- Word/PPT artifact reader/writer behind a small comparison service boundary before changing compare dispatch.
- Library scanning/ES discovery as a distinct scanner strategy, not mixed into grouping logic.

## How this affects earlier documents

- `docs/performance-experiment-log.md` remains the historical narrative of the indexing/search performance pass. Its “not done” list should be read as historical, not as a permanent ban on future compare artifacts.
- `docs/search-version-ux-notes.md` remains the UX decision record. Its non-goal about not storing extra Word/PPT summaries applies to version-list acceleration, not to future on-demand comparison artifacts.
- `docs/content-fingerprint-roadmap.md` remains the file-level fingerprint decision record. Future Word/PPT artifacts are not the same as chunk-level fingerprint tables: artifacts keep ordered text structure for compare, while fingerprints are evidence/hash layers.
- `docs/backend-python-boundary-refactor-plan.md` remains the broader architecture direction. This roadmap supplies concrete performance landing zones inside that gradual boundary work.

## Current priority order

1. Excel sparse diff + visible truncation/high-ratio warnings + small Excel UI landing-zone extraction.
2. Group SQL hybrid list/filter/sort/page path.
3. PPT similarity guard for large decks.
4. Word/PPT compressed comparison artifacts tied to indexed state.
5. Optional Everything/ES discovery accelerator.
6. Continue gradual component/module cleanup only where it supports the above work.
