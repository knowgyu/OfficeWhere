# PRD: 프론트엔드 테스트 자동화 (Vitest 단위 + Playwright Electron E2E)

> 발행일: 2026-05-05
> 상태: baseline-implemented; full Electron E2E CI remains follow-up
> 관련 문서: [`docs/test-architecture-guide.md`](test-architecture-guide.md), [`docs/release-test-checklist.md`](release-test-checklist.md)

---

## 2026-05-05 Status Update

이 PRD는 원래 "프론트엔드 테스트 baseline이 없던 상태"를 해결하기 위해 작성된 계획이다. 현재 main에는 다음 baseline이 이미 들어와 있다.

- Vitest/RTL/MSW harness와 co-located unit/component tests.
- Playwright Electron fixtures와 boot/golden-path/search/version/duplicates/IPC E2E specs.
- Backend E2E data-directory guard.
- `.github/workflows/frontend-tests.yml` 기본 CI: renderer build, Electron main build, `tsconfig.e2e.json` 타입체크, Vitest.

아직 남은 것은 full Electron E2E를 PR hard gate로 올리는 일이다. Linux runner에서 Electron launch에 필요한 `libasound`, GTK/GBM, Xvfb 같은 system dependency를 고정한 뒤 [`ci-workflows-todo.md`](ci-workflows-todo.md)의 후속 workflow를 추가한다.

## Problem Statement

OfficeWhere는 데스크톱이 메인인 제품이므로 프론트엔드/Electron 영역도 자동 회귀 안전망이 필요하다. 이 문서 작성 당시에는 이 영역의 자동화가 없었지만, 현재는 Vitest baseline과 Playwright E2E spec/typecheck가 들어와 있다. 남은 위험은 실제 Electron launch를 CI hard gate로 돌릴 runner system dependency가 아직 고정되지 않았다는 점이다.

[`docs/release-test-checklist.md`](release-test-checklist.md)의 수동 검증 항목 다수가 이 영역이며, 카피 변경(예: v0.7.11 calmer release)·rescan 폴링 타이밍·backend 부팅 실패·IPC 핸들러 동기화 깨짐 같은 회귀가 릴리스 직전에야 발견되는 비용이 누적되고 있다. 데스크톱-first 제품에서 가장 비싼 종류의 회귀(앱이 안 켜짐, golden path가 막힘)가 검증 공백에 노출되어 있다.

## Solution

다음 3계층 안전망을 구축한다:

1. **Vitest + jsdom + MSW** — React 컴포넌트, Context, API 클라이언트 계층의 로직 엣지 케이스를 빠르게 검증한다. PR마다 자동 실행, 수 분 내 종료.
2. **Playwright + 실제 Electron 바이너리 + dev venv 백엔드** — 사용자가 실제로 만나는 통합 흐름(앱 부팅 → 폴더 등록 → rescan → 검색 → 비교)을 진짜 SQLite와 진짜 Office 파서를 거쳐 검증한다. PR마다 Linux+Xvfb로 자동, macOS는 release 직전 수동 실행.
3. **사용자 데이터 절대 보호 가드** — E2E가 사고로 사용자의 실제 라이브러리/설정을 건드리는 시나리오를 백엔드 레벨에서 거절한다. `OW_E2E=1`일 때만 활성화.

같은 시나리오를 두 도구로 다른 깊이에서 받친다: E2E는 "통합 흐름이 깨졌는가"를 1번씩, Vitest는 그 흐름에 참여하는 단위들의 엣지 케이스(debounce, 빈 결과, 필터 조합, 한글 초성 매칭, 폴링 중복 알림 등)를 풍부하게 커버한다.

---

## User Stories

1. As a maintainer of OfficeWhere, I want every PR to automatically verify that the React app still builds and Vitest unit tests still pass, so that I never merge code that breaks established frontend behavior.
2. As a maintainer, I want every PR to automatically launch the actual Electron app with a real Python backend on Linux+Xvfb and walk through the golden path (폴더 등록 → rescan → 검색), so that I am alerted when boot/IPC/backend integration breaks before users see it.
3. As a maintainer, I want a manually-triggered macOS E2E smoke before each release, so that I verify the bundled `python-runtime/` and packaged `.app` actually launch on the user's primary OS without paying GitHub Actions macOS minutes on every PR.
4. As a maintainer, I want the E2E suite to be physically incapable of touching my real `~/Library/Application Support/OfficeWhere` data, so that a runaway test never wipes my actual library or settings.
5. As a maintainer, I want to run all frontend tests locally with `npm test` and `npm run test:e2e`, so that I can iterate quickly without pushing to CI.
6. As a maintainer, I want failed E2E tests to upload Playwright traces, screenshots, and videos as CI artifacts, so that I can debug failures without re-running locally.
7. As a maintainer, I want the E2E suite to detect when my regular OfficeWhere instance is already running and refuse to start (or transparently bypass via `OW_E2E=1`), so that single-instance-lock conflicts produce a clear error instead of silently killing the test.
8. As a developer, I want to write a Playwright test that requests a fresh Electron app instance and a copy of `examples/officewhere_test_library/` in two lines of fixture, so that I focus on scenario logic rather than setup boilerplate.
9. As a developer, I want to write a Vitest component test that renders a component with all the necessary providers (DisplaySettings, LibraryRescan, Snackbar) via a single helper, so that boilerplate doesn't dominate the test file.
10. As a developer, I want MSW handlers covering every backend endpoint with sensible defaults, so that I only override the endpoints relevant to the test I'm writing.
11. As a developer, I want to mock `window.officeWhere` (Electron preload bridge) globally so component tests don't have to set it up individually.
12. As a developer testing search behavior, I want a Vitest test for the 600ms debounce, file-type filter combinations, date-range filter, pagination, empty state, and Korean choseong matching, so that search edge cases are protected without slow E2E.
13. As a developer testing rescan behavior, I want a Vitest test that the LibraryRescanContext polls every 700ms while running, fires Snackbar on completion exactly once, and stops polling on cancel — so that polling regressions are caught at unit level.
14. As a developer testing the consistency check, I want an E2E that registers `주간보고_v1.0_*.docx` and `주간보고_v4.0_*.docx`, opens the version-family group, runs the comparison, and asserts that paragraph-level changes are visible — so that the Word diff path is exercised end-to-end.
15. As a developer testing duplicate detection, I want an E2E that registers `03_부서A/공통양식.xlsx` and `04_부서B/공통양식.xlsx` (same content, different paths) and asserts they appear in the duplicates tab — so that fingerprint-based deduplication is verified.
16. As a developer testing IPC, I want an E2E for `app:get-data-paths` and `app:clear-app-data` that confirms the user can see their data directories and trigger cleanup, including app exit-after-clear behavior.
17. As a developer testing the update check, I want an E2E that intercepts the GitHub releases API call and asserts the update dialog appears with the mocked version, so that the update flow is verified without depending on a real release being newer than the current build.
18. As a developer, I want test selectors based on accessible role + visible Korean text by default, so that tests double as accessibility checks and don't require sprinkling `data-testid` everywhere.
19. As a developer, I want `data-testid` only on elements where role/text is genuinely insufficient (dynamically generated cards, diff grid cells, identical-text buttons in different contexts), so that production code stays clean.
20. As a developer working on `FileSearch.tsx`, I want the corresponding test file (`FileSearch.test.tsx`) right next to it, so that I can't forget to update it when I change the component.
21. As a developer worried about flaky tests, I want CI to retry failed E2E tests once before declaring failure, so that genuinely transient issues (timing, port allocation) don't generate false alarms while real bugs still surface.
22. As a developer worried about test debt, I want coverage to be reported but not gated initially, so that PRs aren't blocked by an arbitrary threshold while the suite is still growing.
23. As a developer adding a new backend endpoint, I want a clear pattern for adding the corresponding MSW handler so that frontend tests can immediately use it.
24. As a maintainer concerned about CI cost, I want all PR-time CI to run on free Linux runners only, so that running tests on every push doesn't accumulate billing.
25. As a maintainer, I want a `concurrency: cancel-in-progress` policy so that pushing a new commit cancels the previous run on the same branch, saving CI minutes.
26. As a contributor running the suite locally for the first time, I want documented setup steps (Python venv, npm install, Electron system dependency 준비) so that I can run tests within minutes of cloning.
27. As a developer, I want test fixtures to copy `examples/officewhere_test_library/` into a temp directory rather than registering it directly, so that running a test never causes the user's checkout copy to be modified by accident.
28. As a developer, I want every E2E test to assert at the start that `OW_DATA_DIR` is a temp path, so that a misconfigured launch fails loudly instead of silently writing to user data.
29. As a developer, I want the E2E backend to be the dev venv (not the bundled `python-runtime/`) for PR runs, so that tests don't require a full package build to execute.
30. As a release manager, I want a separate `workflow_dispatch`-only macOS workflow that uses the bundled runtime and packaged `.app`, so that I can verify packaging immediately before publishing a release.
31. As a developer, I want clear separation between `src/test/setup.ts` (Vitest globals) and `tests/e2e/fixtures/` (Playwright fixtures), so that the two test stacks don't bleed into each other.
32. As a developer, I want `*.test.tsx` files automatically excluded from the production bundle and tsconfig build, so that test code never ships to users.
33. As a developer testing the consistency tab, I want an E2E that opens the Excel diff grid modal and asserts that changed cells are highlighted, since this is the most visually complex Tier 2 scenario.
34. As a developer testing rescan, I want an E2E that starts a rescan against a small library, verifies the progress bar appears, then cancels and verifies polling stops within one cycle (~1 second).
35. As a developer testing onboarding, I want a Vitest test for the OnboardingCarousel step transitions and localStorage flag persistence (Tier 3), without requiring an E2E run.
36. As a developer testing settings, I want a Vitest test for DisplaySettingsContext that text-size increase/decrease/reset and theme mode changes (system/light/dark) write to localStorage and update `document.documentElement.dataset.theme` (Tier 3).
37. As a developer testing the API client, I want a Vitest+MSW test that `getBackendBaseUrl()` correctly chooses the IPC bridge in Electron mode and the Vite env var in web dev mode.
38. As a developer testing API errors, I want a Vitest test that confirms a 500 response from `/api/check` surfaces a user-visible Snackbar message rather than silently failing.
39. As a maintainer, I want all production code changes (E2E guard, single-instance bypass, IPC determinism) to land in a single small Phase 0 PR before any test infrastructure is added, so that the production change is reviewed independently of test machinery.
40. As a developer, I want test files to follow a feature-based naming convention (`boot.spec.ts`, `consistency-check.spec.ts`) rather than tier-prefixed (`tier1.boot.spec.ts`), so that filenames remain stable as the suite evolves and scenarios shift between tiers.

---

## Implementation Decisions

### Architecture

- **Two test stacks, distinct responsibilities**:
  - **Vitest** runs in jsdom against React components, Contexts, and the API/transport layer. Fast, no real Electron, no real backend.
  - **Playwright** uses `@playwright/test`'s `_electron.launch()` against the actual Electron binary, which spawns a real Python backend (dev venv on PR; bundled `python-runtime/` on manual macOS runs).

- **Backend strategy in E2E**:
  - PR runs use the **dev venv** for speed and to avoid requiring a package build.
  - macOS workflow_dispatch runs use the **bundled `python-runtime/`** to verify packaging.
  - Backend HTTP is never stubbed in E2E — that defeats the purpose of integration coverage.

### Production code changes (Phase 0, prerequisite)

- **Backend** gains an `OW_E2E` safety guard: when `OW_E2E=1` is set, the backend refuses to start unless `OW_DATA_DIR` is non-empty and does not contain markers of the user's real data directory (`Application Support/OfficeWhere`, `AppData\OfficeWhere`, `.config/OfficeWhere`).
- **Electron main** bypasses `app.requestSingleInstanceLock()` when `OW_E2E=1`, so multiple test instances can run side by side and a developer's open OfficeWhere doesn't block tests.
- **Electron main** propagates the `OW_E2E` env var into the spawned Python backend.
- **(Phase 4 follow-up)** Selected IPC handlers gain deterministic responses when `OW_E2E=1`: e.g. `dialog:pick-folder` and `dialog:pick-file` read a path from an env var instead of opening an OS dialog (Xvfb cannot drive native dialogs reliably).

### Isolation strategy

- Playwright fixture launches Electron with `--user-data-dir=${tmpDir}/userData` plus `OW_DATA_DIR=${tmpDir}/backend` (the latter is redundant given Electron derives `dataDir` from `userData`, but explicit double-set is a safety belt) and `OW_E2E=1`.
- Each test gets its own tmp directory, cleaned up in fixture teardown regardless of test outcome.
- The first assertion in `electronApp` fixture verifies `OW_DATA_DIR` resolves under the OS temp directory; otherwise the fixture fails loud before any test code runs.

### Selector strategy (production code impact)

- Default to `getByRole({ name })` and visible Korean text (Testing Library convention), which doubles as an accessibility check.
- Add `data-testid` only where role/text is genuinely insufficient: dynamically generated group cards, search result items, Excel diff grid cells, and identical-action buttons appearing in multiple contexts. Estimated ~30–50 attributes total.
- The existing `data-tour-target` attributes (used by the tutorial system) are **not** reused as test selectors — keeps tutorial and test responsibilities decoupled.

### Mock strategy

- **API layer tests** (`src/api/*.test.ts`) use **MSW** with full handler coverage for ~30 backend endpoints. Default handlers return success; tests override per scenario via `server.use(...)`.
- **Component tests** mock the `api` object directly via `vi.mock('../api/client', ...)`. Components don't see HTTP — they see typed responses.
- **Context tests** mock `api` directly and additionally use localStorage/matchMedia helpers. `window.officeWhere` is installed explicitly with `installBridge()` only in tests that need the Electron bridge.

### File organization

- Vitest tests are **co-located**: `Component.test.tsx` next to `Component.tsx`.
- Playwright tests live under `frontend/tests/e2e/`, with shared helpers in `fixtures.ts`, `global-setup.ts`, and `window.d.ts`.
- Shared Vitest setup lives at `frontend/src/test/` (setup.ts, msw/handlers.ts, msw/server.ts, utils.tsx).
- `*.test.tsx` and `tests/e2e/**` are excluded from the production tsconfig build.

### CI workflows

Target workflow shape:

1. **Implemented: `frontend-tests.yml`** — renderer build, Electron main build, Playwright E2E TypeScript check, Vitest on `ubuntu-latest`. Triggers: PR/push paths for frontend workflow changes.
2. **Follow-up: `frontend-e2e.yml`** — Playwright Electron via Xvfb on `ubuntu-latest`. Add only after system deps and runtime cost are verified.
3. **Follow-up: `frontend-e2e-mac.yml`** — packaged `.app` smoke (Tier 1 only) on `macos-14`. Trigger: `workflow_dispatch` only. Not a gate; informational.

Existing `release.yml` remains the desktop artifact publisher. Workflows should use `concurrency: cancel-in-progress` and dependency caches where practical.

Coverage is reported as artifact only — no threshold gate initially. Adding a ratchet is a future decision once a baseline stabilizes.

### Scenario scope

| Tier | Coverage | Tools |
|---|---|---|
| Tier 1: app boot + golden path | E2E (real backend) + Vitest (logic) | Both |
| Tier 2: consistency check, duplicates, search filters, rescan/cancel | E2E (smoke through real flow) + Vitest (edge cases per unit) | Both |
| Tier 3: theme/text size, onboarding, app data, update check | Vitest for pure UI, E2E for IPC-dependent (app data, update check, close behavior, startup settings) | Vitest + selective E2E |

### Module sketch

| Module | Responsibility | Interface |
|---|---|---|
| **E2E isolation guard** (production) | Refuse real-data writes; bypass single-instance lock; propagate `OW_E2E` to backend | `OW_E2E=1` env var |
| **Vitest harness** | jsdom + global mocks + provider-rendering helper | `setup.ts`, `renderWithProviders` |
| **MSW handler library** | Default success responses for every backend endpoint | `import { handlers } from 'src/test/msw/handlers'` + per-test `server.use(...)` |
| **Playwright Electron fixture** | Tmp userData/SQLite, examples copy, cleanup, safety assertions | `test.extend({ electronApp, testLibrary })` |
| **CI workflows** | PR gates + manual macOS smoke | Three yml files |

These five modules are deep in the sense that scenario test files only depend on their stable, narrow interfaces. Adding a new scenario requires no harness change.

### Phase ordering

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Production code changes (E2E guard, single-instance bypass, env propagation) | half day, 1 PR |
| 1 | Vitest harness + first 2 simple tests (transport, DisplaySettings) | 1 day |
| 2 | Vitest API layer (MSW) + LibraryRescanContext | 2–3 days |
| 3 | Vitest main components (FileSearch, FileManager, ConsistencyCheck, DuplicateFiles, OnboardingCarousel) | 3–5 days |
| 4 | Playwright infra + Tier 1 E2E (boot, golden path) | 2–3 days |
| 5 | Playwright Tier 2 E2E (consistency, duplicates, search filters, rescan cancel) | 3–5 days |
| 6 | Playwright IPC E2E (app data, update check) + CI workflows + docs | 2–3 days |

Current status: Phase 0 through the baseline test/spec work has landed. Treat full Electron E2E CI and macOS packaged smoke as follow-up infrastructure work, not as missing unit-test baseline.

### Test data

- `examples/officewhere_test_library/` is already committed to the repo and contains carefully designed fixtures: 5-version Word/Excel/PowerPoint families, identical-name conflicts (`회의록.docx` × 2), and identical-content duplicates (`공통양식.xlsx` × 2).
- E2E fixtures **copy** this folder into the per-test temp directory rather than registering the checked-in copy directly. This guarantees no test mutates the repo state and that parallel tests don't share files.
- `scripts/generate_demo_cases.py` regenerates the library deterministically — used as a CI fallback if the committed binaries diverge from the generator.

---

## Testing Decisions

### What makes a good test

- **Test external behavior, not implementation**. A FileSearch test asserts "typing '회의' shows result containing '회의'", not "calls `setQuery` then `setDebouncedQuery`". A rescan-context test asserts "Snackbar.success called once with completion message", not "observedRunningRef.current was set to true".
- **Tests should fail when user-visible behavior changes, and only then**. Refactoring a component's internal state shape without changing what the user sees should not require test updates.
- **Tests double as documentation**. A reader of `FileSearch.test.tsx` should be able to enumerate the search feature's contracts (debounce 600ms, max 100 results, file-type filter, date range, pagination of 20, Korean choseong) by reading test names alone.
- **Selectors model the user's perception**. `getByRole('button', { name: '비교' })` over `querySelector('.compare-btn')`.

### Modules under test

- **Vitest**:
  - Vitest harness itself (smoke: rendering an empty `<App />` succeeds with all providers).
  - API layer: `transport.ts`, `client.ts`, `library.ts` (each function × success + 4xx + 5xx).
  - Contexts: DisplaySettings (localStorage, matchMedia, DOM data-theme), LibraryRescan (polling, Snackbar, cancel), Snackbar (queue, dismiss).
  - UI kit: each component × prop combinations × interaction (Button, Dialog, TextField, Snackbar, Toggle, SegmentedButton).
  - Main components: FileSearch (debounce, filters, pagination, empty, choseong), FileManager (folder add via IPC mock, rescan trigger, registered files paging, app data area), ConsistencyCheck (group filter, sort, comparison result branches, Excel grid modal), DuplicateFiles (rendering), OnboardingCarousel (step transitions, persistence).

- **Playwright**:
  - boot.spec — app launches, `/api/health` returns ok, main window visible.
  - golden-path.spec — folder add → rescan → search → result row visible.
  - consistency-check.spec — open version family group → compare → diff result visible (Word + Excel + PPT scenarios as separate `test()` blocks).
  - duplicates.spec — `공통양식.xlsx` group rendered.
  - search-filters.spec — type filter, date filter, pagination.
  - rescan-cancel.spec — start rescan → progress visible → cancel → polling stops within one cycle.
  - ipc/app-data.spec — get-data-paths returns candidates; clear-app-data with exit option triggers app quit.
  - ipc/update-check.spec — GitHub API intercepted; update dialog appears with mocked version.

### Prior art in the codebase

- Backend pytest patterns (`tests/test_*.py`) use `tmp_path` + `monkeypatch` for DB isolation — same idea adapted for Playwright (per-test tmp dir + env var override).
- `examples/officewhere_test_library/` already serves as integration data for backend tests indirectly via `test_tutorial_examples.py`. We extend this by copying-into-temp.
- `tests/test_files_api.py` calls FastAPI router functions directly without TestClient. This PRD does not change that pattern; backend HTTP integration testing is a separate concern.
- `docs/test-architecture-guide.md` documents the system and is the design reference for this PRD.

### What is NOT being tested

- Visual regression (pixel diff). Out of scope for v1; could be added later via Playwright screenshots if carousel/onboarding visual bugs become a pattern.
- Accessibility audit (axe-core integration). Partially covered by role-based selectors; explicit a11y assertions are out of scope for v1.
- Performance regression (FPS, indexing time). Backend already has `OW_INDEX_PERF_LOG`; frontend perf is out of scope.
- Backend HTTP layer (FastAPI TestClient integration). Identified as a gap in the architecture guide but is a separate, backend-side concern.
- Windows E2E. Deferred until Windows-specific regressions accumulate.
- Cross-version compatibility (older Office files). Out of scope; existing backend tests cover format edge cases.

---

## Out of Scope

- **Backend test additions** (FastAPI TestClient integration tests, additional core module tests). Tracked separately; this PRD is frontend/E2E only.
- **Windows CI workflow**. Deferred. Add when a Windows-specific regression is observed.
- **Coverage thresholds as PR gates**. Coverage is reported but does not fail builds in v1. Ratchet policy is a future decision.
- **Visual regression and a11y audits**. Considered; deferred.
- **Bundled-runtime CI for every PR**. Macos packaging is verified via manual `workflow_dispatch` only.
- **Removing the existing `release.yml` or modifying its packaging logic**.
- **Migrating the backend `tests/` directory layout** to match frontend co-location. Backend keeps its current centralized layout.
- **Multi-language (i18n) testing infrastructure**. Korean copy is the assumed only language; selectors using Korean text are acceptable.

---

## Further Notes

### Risks and mitigations

- **Xvfb limitations**: Native dialogs and tray interactions don't drive reliably under Xvfb. Mitigation: IPC handlers gain deterministic `OW_E2E` branches for `dialog:pick-*`. Tray-related E2E is out of scope.
- **Backend boot flakiness**: The 30-second health-check loop in [`electron/main.ts`](../frontend/electron/main.ts) can flake on slow runners. Mitigation: retry=1 in CI; longer timeout in fixture (60s) for first-launch cold-cache scenarios.
- **examples folder drift**: If a contributor regenerates `examples/officewhere_test_library/` with different content, all related E2E asserts may break. Mitigation: tests assert structural facts ("a result containing 회의 appears") rather than exact match counts; CI step verifies generator output is byte-stable on Ubuntu/macOS or — as fallback — regenerates from `scripts/generate_demo_cases.py` before each run.
- **Single-instance bypass during local development**: A developer running `OW_E2E=1` could accidentally start a second OfficeWhere alongside their real one. Mitigation: backend guard refuses unless `OW_DATA_DIR` is a tmp path, so a real second instance still cannot write to user data.

### Documentation

[`docs/test-architecture-guide.md`](test-architecture-guide.md) (already published) is the design reference. Keep [`docs/release-test-checklist.md`](release-test-checklist.md) updated as CI coverage changes. Do not mark full Electron E2E as automated until the workflow exists and has passed on the target runner.

### Success criteria

- Baseline complete: PR/push path runs renderer build, Electron build, E2E TypeScript check, and Vitest.
- Follow-up complete: Linux full E2E workflow passes with pinned system deps and uploads traces on failure.
- Release follow-up complete: Tier 1 E2E (`boot`, `golden-path`) passes on macOS workflow_dispatch before release tags.
- Zero regressions to existing release pipeline.
- A new contributor can run `npm test`, `npx tsc -p tsconfig.e2e.json`, and targeted E2E specs once local Electron system deps are present.
