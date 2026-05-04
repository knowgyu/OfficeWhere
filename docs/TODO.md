# OfficeWhere TODO

Last updated: 2026-05-03

This file tracks follow-up work that is not part of the formal release checklist. Keep `docs/release-test-checklist.md` for release validation steps.

## Immediate follow-ups

- [ ] Decide whether root agent guides should be versioned, only if shared agent guidance becomes important.
  - Current state: `AGENTS.md` and `CLAUDE.md` exist locally, but `.gitignore` ignores both.
  - Default: keep them local/ignored because they may contain machine- or session-specific agent instructions.
  - If stable repo-wide agent guidance should be shared across machines/agents, extract the stable parts before committing anything.

## Product / engineering follow-ups

- [ ] Follow the consolidated search/version performance roadmap when reopening performance work.
  - Durable decision record: `docs/search-version-performance-roadmap.md`.
  - Already landed in 0.6.x: Excel sparse diff + warnings, SQL-backed group list filtering/paging, PPT similarity guard, Word/PPT compressed comparison artifacts.
  - v0.6.8 scanner boundary work: default discovery now has an `os.scandir`/snapshot-cache direction with fallback-on-doubt.
  - Do not pursue Everything/ES as a current accelerator. The integration attempt added setup/diagnostic burden while improving only the file-path discovery slice; keep the default scanner/cache path.
  - Treat this as the source of truth instead of duplicating the same performance notes across `.omx/context`, `.omx/wiki`, or session notes.

- [ ] Continue architecture cleanup only as scoped follow-up waves, not as a big-bang rewrite.
  - Durable decision record: `docs/architecture-review-roadmap.md`.
  - Completed current waves: P0 security hardening, P1 read/constant/Hangul/diagnostics safety, P2 comparison-artifact storage + rescan/config + file-location seams + library-group storage seam, P3 FileManager app-data/general settings + registered-file list presenter + ConsistencyCheck presenter seams.
  - Next possible slices: FileManager library-settings hook/presenter, deeper group domain-builder extraction, frontend tests, or migration backups — each needs its own performance/safety decision.
  - Preserve the >10% performance guard for 500~2,000 document libraries.

- [ ] Do not pursue AI/MCP as a primary product direction unless a non-generic document workflow emerges.
  - Reason: generic AI assistants can already search/read files when granted filesystem access; OfficeWhere should focus on Office-specific indexing, version evidence, change tracking, and safe document operations that generic AI tools do not reliably provide.
  - If revisited later, keep it opt-in and read-only by default; do not add broad filesystem mutation tools.

- [ ] Revisit simple scheduling only if logs show a likely 10%+ wall-clock gain.
  - Candidate: Excel-first ordering with about half the worker slots reserved for Excel-heavy runs.
  - Avoid complex cost prediction until repeated traces justify it.

## Completed / user-owned for now

- External architecture review P0-P3 first implementation wave and second responsibility-boundary refactor wave are complete enough for this pass; only scoped follow-up slices remain.
- v0.7.0 cleanup release is prepared around the stable search/index/version-comparison workflows; Everything/ES acceleration and unfinished Excel integration/Join surfaces are not current release candidates.
- App-data deletion/reset/exit race is handled by prior reset/shutdown commits; user will do any needed real-use confirmation.
- Windows packaging has been checked on policy-managed PCs.
- In-app update notice now downloads and verifies the Windows portable zip into the user's Downloads folder; portable folder self-replacement is intentionally not used.
- First-run onboarding/tutorial is implemented.
- Large DB/indexing structural optimization is considered complete enough for now.
- Version-management first-load now uses a DB-backed derived group index with background/single-flight refresh and incremental affected-key updates.
- Search result cards include a safe "폴더에서 보기" file-location action.
- Parser-side optimization is considered complete enough for now; only simple scheduling remains a possible future experiment.
- Python backend boundary refactor has a documented direction and the 0.6 search/version cleanup applied the first structural narrowing. Do not treat the full boundary refactor as a current release TODO unless a specific maintainability task is reopened.
- Lightweight dependency/security review is normal release hygiene, not a standalone TODO unless a concrete risk appears.
- Manual release checklist walk-through is user-owned and should not block agent follow-up work unless explicitly requested.

## Maintenance notes

- Do not reintroduce legacy `Office Data Joiner`, `ODJ_*`, `officeDataJoiner`, `office_data_joiner`, or `office-data-joiner` names unless explicitly adding a compatibility layer.
- Do not delete regenerated build/cache artifacts after verification unless cleanup is explicitly requested.
