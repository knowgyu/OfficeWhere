# OfficeWhere Performance Experiment Log

## Why this log exists

This is a narrative experiment log for later debugging, release notes, or a blog post. It is intentionally less formal than the decision record in `docs/indexing-performance-fast-mode.md` and captures the reasoning journey: symptoms, hypotheses, experiments, what was ruled out, and what changed.
For the architecture plan that preserves these performance decisions while separating backend responsibilities, see `docs/backend-python-boundary-refactor-plan.md`.
For the follow-up search/version hot-path roadmap produced after external review and architect/critic discussion, see `docs/search-version-performance-roadmap.md`.

## Starting symptoms

During large-library testing, OfficeWhere felt slower than expected on machines with enough CPU/RAM headroom:

- Around 1,115 Office files already made indexing, search, and version review feel heavy.
- On one PC, Python memory was roughly a few hundred MB, while CPU was often near 0% and disk around 0-0.2 MB/s.
- Increasing workers from 4 to 48 improved cadence only slightly in some environments.
- Corporate/security software was suspected because the machine appeared idle from normal Task Manager counters, yet progress advanced slowly.
- Search and version-management UX also needed to avoid dumping too many noisy results at once.

## Early packaging/runtime lessons

- The embedded-Python package made Windows distribution easier because it avoided relying on a user-installed Python.
- A `FATAL:v8_initializer.cc... error loading v8 startup snapshot file` report was likely caused by running Electron before fully extracting the zip package. This should become a future FAQ entry.
- `electron-builder` Windows packaging can fail when symlink extraction or icon resource editing is blocked by Windows permissions/security policy; these are packaging-environment issues rather than OfficeWhere parser bugs.

## Worker-count experiments

User-provided log summaries showed the core shape:

| Experiment | Observed pattern |
| --- | --- |
| 4 workers | Scan about 4.8s. Early indexing until cancellation about 51.5s. DB flush often 2.5-3.5s, sometimes about 5.1s. File-level DB queue waits commonly 3-6s, larger files 9-10s. Normal Word inspect/chunk tens to hundreds of ms; larger PPT/Excel around 0.7-1.7s. |
| 24 workers | Same scan time, better early throughput. DB flush duration similar, but DB queue waits often 4-6s and sometimes 10-15.6s. Some small documents showed inspect/chunk spikes around 3-5.7s, suggesting high-concurrency parser/shared-resource contention. |
| 48 workers | Slight cadence improvement in some cases, but DB queue wait tails could reach 80-90s. This was beyond the useful range for the current architecture. |

Conclusion: more workers helped only up to a point. After that, SQLite write serialization, FTS/write amplification, shared parser resources, filesystem/security-scanner overhead, and queue backpressure dominated.

## Hypotheses considered

### 1. Network drive latency

Considered because shared folders are a target use case. Later testing said the slow case was not a network drive, so this was not the primary explanation for the observed trace.

### 2. Parser slowness

Partly true, but not the only issue.

- A large Excel file repeatedly took about 50-60s to parse.
- That specific file is inherently heavy; even opening it manually is slow.
- This can dominate a single run and make DB changes look less effective unless the log is segmented by file.

### 3. DB write bottleneck

True.

- SQLite has one writer at a time.
- FTS triggers amplify writes when every inserted chunk updates one or more FTS tables immediately.
- Queue wait can grow even if each actual flush remains in the 2.5-3.5s range.
- Batching by file count alone is a poor fit when one Excel file can produce far more chunks than many Word files combined.

### 4. Antivirus/EDR/file access overhead

Still plausible for corporate PCs.

- Low CPU and low disk counters with slow progress can happen when file opens/reads are intercepted outside the app's direct process accounting.
- More workers may simply create more inspected file handles and more contention rather than more throughput.
- The mitigation is not “turn off security software”; it is better logging, fewer unnecessary files, less repeated access, and clear user guidance.

## Changes made from the experiments

### Narrow what gets indexed

- Removed Text/Markdown from the target indexing scope.
- Kept Office formats: `.xlsx`, `.xls`, `.docx`, `.pptx`.
- Added default excluded folder names for common developer/build/cache directories.

Why it mattered: scanning home/project roots should not waste time walking millions of irrelevant files in `node_modules`, virtualenvs, build folders, IDE metadata, and caches.

### Fast mode and worker controls

- Default fast worker count: 24.
- UI/runtime cap: 32.
- Worker slider uses 4-step increments.
- Folder add and manual refresh use fast mode.
- Scheduler/automatic refresh stays conservative.

Why not 48: user traces showed extreme DB queue tails at 48.

### Chunk-based batching

- Flush by chunk count as well as file count.
- Treat chunk-heavy files as their own flush when needed.

Why it mattered: one large Excel file should not hold a normal batch hostage.

### First-run staging DB

- For empty app-owned index + broad scan, write to a staging DB first.
- Defer FTS trigger work and rebuild FTS once at the end.
- Copy the verified DB into the main DB.

Why it mattered: initial indexing is different from incremental reindexing. It can safely optimize for bulk load because there is no existing app index to keep live.

### FTS/search simplification

- Removed the unused base `file_search` table.
- Kept compact Korean/short-query fallback and trigram support where available.
- Used `columnsize=0` because search no longer depends on BM25 rank.
- Changed search ordering to user-meaningful deterministic order: filename first, then content in file/document order.

Why it mattered: OfficeWhere is a file finder/reviewer. “Which file should I inspect?” matters more than BM25 scoring among chunks that all contain the query.

### Search/version UX load reduction

- Search shows filename matches in the card title instead of repeating a filename row.
- Body matches are collapsed/lazy-revealed per file.
- File result expansion is bounded/lazy-loaded up to 100 files.
- Version management hides same-name/same-content duplicate groups by default and exposes a secondary toggle to reveal them.
- Word/PPT search labels hide parser internals (`paragraph`, `shape`, `row`) and show user-level locations.

Why it mattered: performance is not only backend time. Rendering and cognitive load also matter.

### Parser logging split

- `index-performance.log` remains for scan/DB/queue/flush events.
- `parsing-performance.log` records parser timings separately.

Why it mattered: large Excel/PPT tails should be visible without mixing them into DB-flush analysis.

## What was intentionally not done

- Did not parse embedded videos/audio/images. OfficeWhere indexes text/table content only.
- Did not store extra Word/PPT comparison summaries for version-list acceleration in this pass. A later compressed comparison artifact is now documented separately as an on-demand compare optimization in `docs/search-version-performance-roadmap.md`; it must remain a rebuildable last-index cache, not source of truth.
- Did not add chunk-level fingerprints yet. File-level fingerprints are enough to suppress same-name/same-content duplicate groups.
- Did not use GPU. The workload is ZIP/XML/filesystem/SQLite bound.
- Did not make a complex scheduler. Excel-first / half-worker reservation is documented as a future simple step, not implemented yet.

## Open questions for future experiments

1. Would a simple Excel-first scheduler reduce wall-clock time by at least 10% on real user folders?
2. On corporate PCs, how much time is invisible security/EDR file inspection versus Office XML parsing?
3. Should initial staging also use more aggressive SQLite pragmas only while building the temporary DB?
4. Would process-based parsing outperform threads enough to justify packaging/cancellation/memory complexity?
5. Version-tab first-load has since moved to a persistent derived group index; the remaining follow-up is SQL-backed list filtering/sorting/paging from that index.
6. Is a user-facing “slow files” report useful, listing files whose parser time dominates the run?

## Useful log bundle for future diagnosis

Ask for these files from a user when diagnosing large-library slowness:

- `index-performance.log`
- `parsing-performance.log`
- OfficeWhere app/backend log if errors occurred
- Approximate worker count used during the run
- Whether files were local, mapped/network drive, cloud-synced, or under corporate DRM/EDR
- Whether the log was opened while indexing was still running

Avoid asking for source documents unless absolutely necessary. Logs must be enough for first-pass diagnosis.
