# OfficeWhere TODO

Last updated: 2026-04-30

This file tracks follow-up work that is not part of the formal release checklist. Keep `docs/release-test-checklist.md` for release validation steps.

## Immediate follow-ups

- [ ] Follow the external architecture review triage roadmap for the next engineering cleanup waves.
  - Durable decision record: `docs/architecture-review-roadmap.md`.
  - Current order: tiny security hardening → DB/read stability and Hangul tests → backend storage/rescan boundary waves → frontend FileManager/ConsistencyCheck maintainability waves.
  - Treat large-file findings as real signals, but use facade/strangler slices instead of a big-bang rewrite.

- [ ] Decide whether root agent guides should be versioned, only if shared agent guidance becomes important.
  - Current state: `AGENTS.md` and `CLAUDE.md` exist locally, but `.gitignore` ignores both.
  - Default: keep them local/ignored because they may contain machine- or session-specific agent instructions.
  - If stable repo-wide agent guidance should be shared across machines/agents, extract the stable parts before committing anything.

## Product / engineering follow-ups

- [ ] Follow the consolidated search/version performance roadmap when reopening performance work.
  - Durable decision record: `docs/search-version-performance-roadmap.md`.
  - Already landed in 0.6.x: Excel sparse diff + warnings, SQL-backed group list filtering/paging, PPT similarity guard, Word/PPT compressed comparison artifacts.
  - Remaining future item from that roadmap: optional Everything/ES discovery accelerator, only after scanner strategy boundaries and license/redistribution checks.
  - Treat this as the source of truth instead of duplicating the same performance notes across `.omx/context`, `.omx/wiki`, or session notes.

- [ ] Consider a local AI Agent integration surface after the 0.6.x release line stabilizes.
  - Candidate shapes: loopback-only REST API for search/version/library state, or MCP server exposing read-only tools plus explicitly user-approved app actions.
  - Constraints: source Office documents remain read-only; no broad filesystem mutation tools; any external agent access should be opt-in, local-only by default, and documented with clear trust boundaries.
  - Do not implement in 0.6.4; revisit as a deliberate architecture/security task.

- [ ] Revisit simple scheduling only if logs show a likely 10%+ wall-clock gain.
  - Candidate: Excel-first ordering with about half the worker slots reserved for Excel-heavy runs.
  - Avoid complex cost prediction until repeated traces justify it.

## Completed / user-owned for now

- App-data deletion/reset/exit race is handled by prior reset/shutdown commits; user will do any needed real-use confirmation.
- Embedded-Python Windows packaging has been checked on DRM-policy PCs.
- In-app update notice and portable zip update flow are implemented.
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
