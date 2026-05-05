# OfficeWhere TODO

Last updated: 2026-05-05

This file tracks follow-up work that is not part of the formal release checklist. Keep [`docs/release-test-checklist.md`](release-test-checklist.md) for release validation steps and [`docs/README.md`](README.md) for the documentation map.

## Current follow-ups

- [ ] Keep the frontend test suite quiet enough to be useful.
  - Current state: Vitest/RTL, MSW, and Playwright Electron specs are in the repo and the baseline CI runs renderer build, Electron build, E2E TypeScript check, and Vitest.
  - Remaining cleanup: several passing Vitest cases still emit React `act(...)` warnings. Treat them as test-harness hygiene, not a product blocker, and remove them opportunistically near the affected components.

- [ ] Enable full Electron E2E CI only after runner system dependencies are pinned.
  - Current state: Playwright E2E specs and fixtures exist, and `npx tsc -p frontend/tsconfig.e2e.json` is CI-gated.
  - Known blocker: Linux Electron launch needs system libraries such as `libasound`, GTK/GBM, and Xvfb. Use `docs/ci-workflows-todo.md` as the implementation sketch before adding a hard E2E PR gate.

- [ ] Continue architecture cleanup only as scoped follow-up waves, not as a big-bang rewrite.
  - Durable decision records: `docs/architecture-review-roadmap.md` and `docs/backend-python-boundary-refactor-plan.md`.
  - Completed foundation: P0 security hardening, P1 read/constant/Hangul/diagnostics safety, P2 comparison-artifact + library-group + duplicate-content storage seams, rescan/config/file-location seams, and P3 frontend presenter/section seams.
  - Next possible slices: FileManager library-settings hook/presenter, deeper group domain-builder extraction, more DB repository seams behind the `backend/database.py` facade, or migration backups. Each slice needs its own performance/safety decision.
  - Preserve the >10% performance guard for 500~2,000 document libraries.

- [ ] Follow the consolidated search/version performance roadmap when reopening performance work.
  - Durable decision record: `docs/search-version-performance-roadmap.md`.
  - Already landed: Excel sparse diff + warnings, SQL-backed group list filtering/paging, PPT similarity guard, Word/PPT compressed comparison artifacts, scanner boundary/cache work, and DB-backed version group index.
  - Do not pursue Everything/ES as a current accelerator. The integration attempt added setup/diagnostic burden while improving only the file-path discovery slice; keep the default scanner/cache path.
  - Treat this as the source of truth instead of duplicating the same performance notes across `.omx/context`, `.omx/wiki`, or session notes.

- [ ] Do not pursue AI/MCP as a primary product direction unless a non-generic document workflow emerges.
  - Reason: generic AI assistants can already search/read files when granted filesystem access; OfficeWhere should focus on Office-specific indexing, version evidence, change tracking, and safe document operations that generic AI tools do not reliably provide.
  - If revisited later, keep it opt-in and read-only by default; do not add broad filesystem mutation tools.

- [ ] Revisit simple scheduling only if logs show a likely 10%+ wall-clock gain.
  - Candidate: Excel-first ordering with about half the worker slots reserved for Excel-heavy runs.
  - Avoid complex cost prediction until repeated traces justify it.

- [ ] Decide whether root agent guides should be versioned only if shared agent guidance becomes important.
  - Current state: `AGENTS.md` and `CLAUDE.md` exist locally, but `.gitignore` ignores both.
  - Default: keep them local/ignored because they may contain machine- or session-specific agent instructions.
  - If stable repo-wide agent guidance should be shared across machines/agents, extract only the stable parts before committing anything.

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
- Python backend boundary refactor has a documented direction and multiple storage/rescan seams applied; do not treat the full boundary refactor as a current release TODO unless a specific maintainability task is reopened.
- Lightweight dependency/security review is normal release hygiene, not a standalone TODO unless a concrete risk appears.
- Manual release checklist walk-through is user-owned and should not block agent follow-up work unless explicitly requested.

## Maintenance notes

- Do not reintroduce legacy `Office Data Joiner`, `ODJ_*`, `officeDataJoiner`, `office_data_joiner`, or `office-data-joiner` names unless explicitly adding a compatibility layer.
- Do not delete regenerated build/cache artifacts after verification unless cleanup is explicitly requested.
