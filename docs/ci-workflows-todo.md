# E2E CI 워크플로우 청사진 (Phase 6 후속 부분)

> 기본 프론트엔드 Build + Vitest 게이트는 `.github/workflows/frontend-tests.yml`에 구현되어 있습니다. 이 문서는 Electron E2E와 macOS 수동 검증처럼 후속으로 분리할 CI를 정리한 가이드입니다.
> 다른 OS / runner 환경에서 직접 PR 만들 때 이 문서를 그대로 보고 작성하면 됩니다.
>
> 관련 문서: [`docs/prd-frontend-testing.md`](prd-frontend-testing.md), [`docs/test-architecture-guide.md`](test-architecture-guide.md), [`docs/test-guidelines.md`](test-guidelines.md)

## 왜 미구현인가

이 워크플로우는 macOS 로컬에서 검증할 수 없는 부분이 큽니다:
- Linux Xvfb 환경에서 Electron + 한글 파일명 + 시스템 패키지 의존성이 어떻게 풀리는지 직접 돌려봐야 함
- GitHub Actions 의 free public repo 한도 내에서 실제 실행 시간 측정 필요
- macOS runner 의 quarantine / Gatekeeper 가 packaged `.app` 에 어떻게 작용하는지 manual dispatch 1회 검증 필요

따라서 빠른 프론트엔드 Build + Vitest 게이트는 먼저 자동화하고, Electron E2E / macOS 수동 검증은 별도 PR 로 다른 환경에서 검증하면서 진행합니다.

## 구현 시 체크리스트

- [ ] OfficeWhere repo 가 GitHub public 인지 확인 (Linux + Windows 무료, macOS 만 분당 과금)
- [x] `.github/workflows/frontend-tests.yml` 추가 (Build + Vitest 게이트)
- [ ] `.github/workflows/frontend-e2e.yml` 추가 (E2E Linux + Xvfb 게이트)
- [ ] `.github/workflows/frontend-e2e-mac.yml` 추가 (workflow_dispatch only)
- [ ] PR 한 번 열어서 빠른 게이트와 E2E 게이트가 모두 자동 실행되고 통과하는지 확인
- [ ] 의도적으로 깨지는 변경 (예: [`FileSearch.tsx`](../frontend/src/components/FileSearch.tsx) 의 debounce 600 → 0) 으로 PR 만들어 게이트가 빨강으로 차단하는지 확인
- [ ] release 직전 macOS workflow 수동 trigger 1회 실행 → Tier 1 통과
- [ ] [`docs/release-test-checklist.md`](release-test-checklist.md) 갱신 (자동화된 항목 표시)

---

## Implemented baseline: `frontend-tests.yml` (Build + Vitest)

**트리거**: PR + push to main. **OS**: Ubuntu. **시간 예상**: 2~4분.

현재 기본 게이트는 `.github/workflows/frontend-tests.yml`에 구현되어 있습니다.

검증 범위:
- `npm ci --prefer-offline --no-audit --fund=false`
- `npm run build`
- `npm run build:electron`
- `npm run test:run`

후속 문서의 나머지 항목은 Electron E2E와 macOS 수동 검증처럼 runner/시스템 의존성이 큰 부분만 다룹니다.

---

## Workflow 2: `frontend-e2e.yml` (Playwright Electron + Xvfb)

**트리거**: PR + push to main. **OS**: Ubuntu (무료). **시간 예상**: 8~15분 (cold backend / Electron 설치 캐시 미스 시).

```yaml
name: Frontend E2E (Linux)

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e:
    name: Playwright Electron
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'

      # Cache the dev venv between runs.
      - name: Cache Python venv
        uses: actions/cache@v4
        with:
          path: venv
          key: venv-${{ runner.os }}-py3.13-${{ hashFiles('requirements.txt', 'requirements-dev.txt') }}

      - name: Setup Python venv
        run: |
          if [ ! -d venv ]; then python -m venv venv; fi
          ./venv/bin/pip install --upgrade pip
          ./venv/bin/pip install -r requirements-dev.txt

      # Electron 30 needs these system libraries on Ubuntu 24.04 runners.
      # libgbm1 + libasound2t64 are the most commonly forgotten — without
      # them launch fails with cryptic "Failed to launch GPU process".
      - name: Install Electron / Xvfb system deps
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
            xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0 \
            libgbm1 libasound2t64 \
            xvfb

      - name: Cache Electron download
        uses: actions/cache@v4
        with:
          path: ~/.cache/electron
          key: electron-${{ runner.os }}-${{ hashFiles('frontend/package-lock.json') }}

      - name: Install frontend deps
        working-directory: frontend
        run: npm ci

      - name: Build renderer + Electron main
        working-directory: frontend
        run: |
          npm run build
          npm run build:electron

      - name: Run Playwright E2E
        working-directory: frontend
        run: |
          xvfb-run --auto-servernum --server-args='-screen 0 1280x960x24' \
            npx playwright test
        env:
          # The fixture launches Electron with cwd=frontend, but global-setup
          # runs npm in frontend/ — inherit the venv path from runner home.
          PYTHONPATH: ${{ github.workspace }}
          # Ensure UTF-8 locale on Ubuntu so Korean filenames in
          # examples/officewhere_test_library/ don't surrogate-escape.
          LANG: C.UTF-8
          LC_ALL: C.UTF-8

      - name: Upload Playwright trace + video on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-trace
          path: |
            frontend/test-results/
            frontend/playwright-report/
          retention-days: 14
```

검증 포인트:
- `xvfb-run` 의 `-screen 0 1280x960x24` 색 깊이 24 명시 안 하면 일부 Canvas 동작이 fallback
- `--no-sandbox` 는 fixture 안에서 이미 적용됨 (`tests/e2e/fixtures.ts`)
- Python venv cache key 가 OS + Python 버전 + requirements 해시를 포함하는지 확인
- Electron download cache (`~/.cache/electron`) 가 첫 실행 후 ~5분 단축
- 의도적 실패를 만들어 trace.zip 이 artifact 로 업로드되는지 확인

알려진 함정:
- Ubuntu 22.04 runner 에서는 `libasound2t64` → `libasound2` 로 변경 필요 (Ubuntu 24.04 에서 패키지명이 바뀜)
- `setup-python@v5` 가 가끔 캐시된 venv 의 활성화 스크립트를 손상시킴 — venv 캐시 분리는 그래서 별도 step
- `HOME` env 가 GitHub Actions 에서 누락되는 경우 `app.getPath('userData')` 가 폭발 — fixture 가 `--user-data-dir` 명시 주입하므로 무관하지만, 직접 `getPath` 호출하는 부수 코드가 있다면 주의

---

## Workflow 3: `frontend-e2e-mac.yml` (macOS smoke, dispatch only)

**트리거**: `workflow_dispatch` 만 (수동). **OS**: macos-14 (arm64). **시간 예상**: 20~30분 (분당 ~$0.08, 한 번에 ~$2).

```yaml
name: Frontend E2E (macOS smoke)

on:
  workflow_dispatch:
    inputs:
      tier:
        description: '실행할 Tier (1 = 부팅 + golden-path 만, 2 = Tier 1+2)'
        required: false
        default: '1'
        type: choice
        options: ['1', '2']

jobs:
  e2e-mac:
    name: Packaged .app smoke
    runs-on: macos-14
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'

      - name: Setup dev venv (used by Phase 0~5 backend tests)
        run: ./setup.sh

      - name: Build packaged Python runtime (Apple Silicon)
        working-directory: frontend
        run: npm run prepare:python-runtime:mac

      - name: Install frontend deps
        working-directory: frontend
        run: npm ci

      - name: Build renderer + Electron main
        working-directory: frontend
        run: |
          npm run build
          npm run build:electron

      - name: Run Tier 1 specs (boot + golden-path) only
        if: ${{ inputs.tier == '1' }}
        working-directory: frontend
        run: npx playwright test boot.spec.ts golden-path.spec.ts

      - name: Run Tier 1+2 specs
        if: ${{ inputs.tier == '2' }}
        working-directory: frontend
        run: npx playwright test

      - name: Upload trace + video on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-trace-mac
          path: frontend/test-results/
```

검증 포인트:
- macOS 에서 `xvfb-run` 불필요 (네이티브 디스플레이 사용)
- `prepare:python-runtime:mac` 이 약 150MB 다운로드 + extract → 캐시 중요
- packaged `.app` 빌드는 별도 (이 워크플로우는 dev tree 의 `dist-electron/main.js` 직접 launch). 진짜 `.dmg/.zip` 검증은 `release.yml` 에 위임
- workflow_dispatch input 으로 Tier 선택 → release 직전엔 `tier=1`, 디버깅 시 `tier=2`

언제 trigger 하나:
- 새 release 태그 푸시 직전 (예: `v0.7.13` PR merge → tag 전 1회)
- macOS-only 회귀가 의심될 때 (예: 한글 파일명 / Apple Silicon 특이 동작 / Electron 30 macOS 버그)

---

## CI 비용/시간 예산

| 워크플로우 | 트리거 | OS | 시간 / 실행 | 비용 / 실행 |
|---|---|---|---|---|
| frontend-fast | PR + push | ubuntu-latest | 2~3분 | $0 (public repo) |
| frontend-e2e | PR + push | ubuntu-latest | 8~15분 | $0 |
| frontend-e2e-mac | dispatch | macos-14 | 20~30분 | ~$2/실행 |

월간 PR ~20개 × Vitest+E2E 1회씩 = 4~6시간 무료 사용. macOS 는 release 마다 1회씩 → 연간 release 12개면 ~$24.

`concurrency: cancel-in-progress: true` 가 같은 브랜치에 빠르게 push 시 이전 잡 취소해 분 절약.

---

## release.yml 과의 관계

기존 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 은 그대로 둡니다. 거기는 빌드 + 패키지만 담당하고 (tag push 시), 이 문서의 워크플로우 3개는 테스트만 담당합니다. 두 워크플로우가 같은 trigger 에 안 겹치는지 확인:
- release.yml: `on: push: tags: ['v*']`, `workflow_dispatch`
- frontend-e2e.yml: `on: push: branches: [main], pull_request`
- frontend-e2e-mac.yml: `on: workflow_dispatch`

겹침 없음. 단 release 직전 PR (예: `release/v0.7.13` 브랜치) 를 main 에 머지할 때 frontend-e2e 가 한 번 더 돌고, 이후 tag push 시 release.yml 이 별개로 돈다.

---

## 최소 동작 확인 시퀀스

CI PR 을 만들 때 다음 순서로 작은 PR 4개:

1. **frontend-fast.yml 추가** — 이 PR 자체에서 자기 워크플로우가 통과하는지 확인.
2. **frontend-e2e.yml 추가** — 같은 패턴.
3. **의도적 회귀 PR** — `frontend/src/api/transport.ts` 의 `getBackendBaseUrl` 을 일부러 깨고 양쪽 게이트가 빨강으로 막는지 확인. 머지 안 하고 close.
4. **frontend-e2e-mac.yml 추가** — workflow_dispatch 1회 실행으로 통과 확인.

각 단계에서 timeout / artifact 업로드 / cache hit 를 직접 보고 문제 있으면 같은 PR 안에서 수정.

---

## 결정 트리 (구현 시작 시점에 다시 보기)

- public repo? Linux/Windows 모두 무료, 이 문서 그대로 사용 가능.
- private repo? 분당 청구. 우선 frontend-fast 만, frontend-e2e 는 push to main 만으로 제한 검토.
- Windows 회귀 자주? frontend-e2e-windows.yml 추가 (Linux 워크플로우 복제 + xvfb 제거).
- Vitest 가 잠시 느려짐? `--shard` 로 분할 검토.
- Playwright trace 너무 큼? `retain-on-failure` (이미 적용) + retention-days 단축.
