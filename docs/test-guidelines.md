# 테스트 갱신 가이드 (기능 추가/변경 시)

> 코드를 추가/변경할 때 어떤 테스트를 어디에 넣고 어떤 패턴을 따르는지 정리한 문서입니다.
> 사람이 읽기 좋게 단계별 시나리오를 두고, AI 가 빠르게 참조하도록 §7 에 색인을 따로 두었습니다.
>
> 관련 문서: [`prd-frontend-testing.md`](prd-frontend-testing.md), [`test-architecture-guide.md`](test-architecture-guide.md), [`ci-workflows-todo.md`](ci-workflows-todo.md)

---

## 0. TL;DR (한 페이지 요약)

| 변경 영역 | 어디에 테스트를 추가/갱신하나 | 도구 |
|---|---|---|
| `backend/api/*.py` 새 endpoint 또는 응답 변경 | 1) `tests/test_*.py` 에 pytest 케이스 추가, 2) `frontend/src/test/msw/handlers.ts` 에 핸들러 추가, 3) `frontend/src/api/client.ts` 또는 `library.ts` 에 추가했다면 `client.test.ts` / `library.test.ts` 케이스 추가 | pytest + Vitest+MSW |
| `backend/core/*.py` 비즈니스 로직 변경 | 해당하는 `tests/test_*.py` 에 케이스 추가 | pytest |
| `frontend/src/api/*.ts` 새 함수 또는 시그니처 변경 | `*.test.ts` 갱신, MSW 핸들러 타입 import 가 컴파일에서 깨지면 함께 수정 | Vitest+MSW |
| `frontend/src/contexts/*.tsx` 새 상태/효과 | `*.test.tsx` 에 케이스 추가 (rendering 시점, side effect, polling, snackbar 등) | Vitest |
| `frontend/src/components/*.tsx` 컴포넌트 로직 변경 | 옆에 `*.test.tsx` 에 케이스 추가. 큰 흐름이면 E2E 도 검토 | Vitest (+E2E if 통합) |
| `frontend/src/ui/*.tsx` UI 키트 변경 | 옆에 `*.test.tsx` 에 props/상호작용 케이스 추가 | Vitest |
| `frontend/electron/main.ts` IPC 핸들러 변경 | `frontend/tests/e2e/ipc.*.spec.ts` 에 케이스 추가, 필요하면 `OW_E2E` 분기도 함께 추가 | Playwright E2E |
| 사용자 플로우 변경 (검색 → 비교 → 등록 같은 통합 흐름) | `frontend/tests/e2e/*.spec.ts` 에 케이스 추가 | Playwright E2E |
| 라이브러리 인덱싱 / rescan 동작 변경 | pytest (단위) + Playwright (E2E) 양쪽 갱신 | 둘 다 |
| 카피(텍스트) 변경 | role/aria 기반 테스트는 영향 없음. 텍스트 의존 테스트는 검색해서 갱신 | grep + 갱신 |
| Onboarding / 첫 실행 흐름 변경 | `OnboardingCarousel.test.tsx` + `tests/e2e/fixtures.ts` 의 onboarding skip 패턴 검토 | Vitest + 잠재적 fixture 수정 |

PR 리뷰 시 체크하는 원칙 4가지:
1. 새 코드는 새 테스트와 함께 PR. 기존 코드 변경은 기존 테스트 갱신을 동반.
2. 테스트는 사용자가 보는 동작을 검증. 내부 상태 / private 함수 검증은 가급적 피한다.
3. 새 backend endpoint 를 client 에서 호출했다면 MSW 핸들러도 추가 (안 그러면 첫 컴포넌트 테스트가 `onUnhandledRequest:'error'` 로 실패).
4. 카피 변경할 때 `role` / `aria-label` / `data-testid` 가 안정적인지 우선 확인. 텍스트 매칭 테스트는 같이 갱신.

---

## 1. 어떤 테스트를 쓰나 (의사결정 트리)

```
변경한 코드가...

├─ 백엔드 Python 비즈니스 로직 (core/, storage/, database) ?
│   → pytest (tests/test_*.py)
│   ── 추가로 frontend 가 그 결과를 다르게 표시한다면:
│      → Vitest 컴포넌트 테스트도 갱신
│
├─ 백엔드 API endpoint (api/) ?
│   → pytest (라우터 함수 직접 호출 패턴, tests/test_files_api.py 참고)
│   → Vitest MSW 핸들러 (src/test/msw/handlers.ts)
│   → Vitest API 테스트 (src/api/client.test.ts or library.test.ts)
│
├─ Frontend API 클라이언트 (src/api/) ?
│   → Vitest+MSW 단위 테스트 (src/api/*.test.ts)
│   ── 새 endpoint 라면 MSW 핸들러도 추가 필수
│
├─ Frontend Context / 전역 상태 (src/contexts/) ?
│   → Vitest (src/contexts/*.test.tsx)
│
├─ Frontend 단일 컴포넌트의 UI 로직 (debounce, 필터, 페이지네이션 등) ?
│   → Vitest (옆에 *.test.tsx)
│
├─ Frontend 사용자 플로우 (탭 전환 → 라이브러리 등록 → 검색 → 비교) ?
│   → Playwright E2E (tests/e2e/*.spec.ts)
│   ── 거기에 단위 엣지 케이스도 있으면 Vitest 도 함께
│
├─ Electron IPC 핸들러 / main 프로세스 ?
│   → Playwright E2E (tests/e2e/ipc.*.spec.ts)
│   ── 필요시 OW_E2E 결정론 분기 추가 (electron/main.ts)
│
├─ UI 키트 (src/ui/) ?
│   → Vitest 옆에 *.test.tsx (props × 상호작용)
│
└─ 빌드 / 설정 / 타입 / tsconfig ?
    → 별도 테스트 없음. `npm run build` 가 통과하면 OK.
    ── 단, 새 종속성 추가 시 vitest / playwright 가 여전히 통과하는지 확인.
```

---

## 2. 시나리오별 작업 단계

### 2.1 새 backend endpoint 를 추가

예: `POST /api/library/optimize` 추가.

1. **Backend 구현 + pytest** (`backend/api/library.py` + `tests/test_library_*.py`):
   - 라우터 함수에 path 추가
   - `tests/test_*.py` 에 케이스 1+개 (성공 / 4xx / 5xx)

2. **Frontend 클라이언트 추가** (`frontend/src/api/library.ts` 또는 `client.ts`):
   - 함수 추가, 타입 정의
   - 타입은 `interface` 로 export — MSW 핸들러가 이 타입을 import 해서 컴파일 시 동기화

3. **MSW 핸들러 추가** (`frontend/src/test/msw/handlers.ts`):
   ```ts
   import type { OptimizeResponse } from '../../api/library'
   // ...
   http.post('*/api/library/optimize', () =>
     HttpResponse.json<OptimizeResponse>({ /* shape-correct stub */ }),
   ),
   ```

4. **Vitest API 테스트 추가** (`frontend/src/api/library.test.ts`):
   ```ts
   it('optimize POSTs the request body to /api/library/optimize', async () => {
     let captured: { mode?: string } | undefined
     server.use(
       http.post('*/api/library/optimize', async ({ request }) => {
         captured = (await request.json()) as { mode?: string }
         return HttpResponse.json({ /* response */ })
       }),
     )
     await api.library.optimize({ mode: 'aggressive' })
     expect(captured?.mode).toBe('aggressive')
   })
   ```

5. **컴포넌트가 사용한다면** 해당 컴포넌트 테스트 (`*.test.tsx`) 에 시나리오 추가.

### 2.2 기존 backend 응답 스키마 변경

예: `LibraryRescanStatus` 에 `worker_progress` 필드 추가.

1. **Backend** + pytest 갱신
2. **Frontend 타입 갱신** (`frontend/src/api/library.ts` 의 `LibraryRescanStatus` 인터페이스)
3. **빌드 확인**: `cd frontend && npm run build` — 타입 에러로 사용처가 컴파일 깨지면 모두 갱신
4. **MSW 핸들러 갱신** (`handlers.ts` 의 `idleRescanStatus` 등 fixture 객체):
   - 새 필드를 추가하지 않으면 TypeScript 가 컴파일 에러 (타입 import 패턴 덕분)
5. **Vitest 컴포넌트 테스트** 에서 새 필드를 사용하면 케이스 갱신
6. **E2E 가 해당 필드를 검증한다면** 갱신 (현재는 percent / stage / running 만 사용)

### 2.3 새 React 컴포넌트 추가

예: `frontend/src/components/RecentSearches.tsx` 추가.

1. **컴포넌트 구현**
2. **단위 테스트 옆에 추가** (`frontend/src/components/RecentSearches.test.tsx`):
   - `renderWithProviders` 사용 (`src/test/utils.tsx`)
   - api 의존이 있으면 `vi.mock('../api/client', ...)` 패턴
   - bridge 의존이 있으면 `installBridge({ ... })` (`src/test/bridge.ts`)
3. **상위 컴포넌트가 통합한다면** 그 테스트도 갱신 (mock 으로 자식을 stub 하지 않는 한 — 자식의 동작이 부모 테스트에 새어 들어옴)

### 2.4 기존 컴포넌트 수정

예: `FileSearch.tsx` 의 debounce 를 600ms → 300ms 로 변경.

1. **`FileSearch.test.tsx` 의 debounce 테스트 갱신**:
   ```ts
   await vi.advanceTimersByTimeAsync(299)
   expect(mockedSearchQuery).not.toHaveBeenCalled()
   await vi.advanceTimersByTimeAsync(2)
   expect(mockedSearchQuery).toHaveBeenCalled()
   ```
2. **카피 변경했다면** placeholder / button name 매칭하는 테스트 갱신
3. **E2E 가 영향받는지 확인**: 우리 e2e 는 `getByPlaceholder(/파일 안의 단어를 검색/)` 같은 정규식이라 대체로 안전

### 2.5 Electron IPC 채널 추가/변경

예: `app:open-data-folder` IPC 추가 (사용자 데이터 폴더를 OS 파일 탐색기에서 열기).

1. **`frontend/electron/main.ts`**:
   - `registerIpcHandlers()` 안에 `ipcMain.handle('app:open-data-folder', ...)` 추가
   - **OW_E2E 분기** 검토: native dialog / 시스템 호출은 Xvfb 에서 안 돌아감. `process.env.OW_E2E === '1'` 일 때 결정론적 응답 반환.
2. **preload bridge** (`frontend/electron/preload.ts`): 새 메서드 expose
3. **타입 추가** (`frontend/src/api/transport.ts` 의 `OfficeWhereBridge` 인터페이스)
4. **`frontend/src/test/bridge.ts`**: `installBridge` 의 default mock 에 새 메서드 추가
5. **Vitest 컴포넌트 테스트**: 그 IPC 를 호출하는 컴포넌트가 있다면 `installBridge({ openDataFolder: vi.fn() })` 로 검증
6. **E2E 추가** (`frontend/tests/e2e/ipc.*.spec.ts`):
   ```ts
   test('app:open-data-folder calls the OS shell', async ({ mainWindow }) => {
     const result = await mainWindow.evaluate(async () => {
       return await window.officeWhere?.openDataFolder?.()
     })
     // OW_E2E 분기에서 mock 응답 반환하므로 결과 형태만 검증
     expect(result).toBeDefined()
   })
   ```

### 2.6 라이브러리 / 인덱싱 동작 변경

예: rescan 시 새 종류의 파일 (`.hwp`) 도 처리하도록 변경.

1. **pytest** (backend/core/library_*.py 관련 tests/) 케이스 추가
2. **`examples/officewhere_test_library/`** 에 `.hwp` 샘플 추가 검토 (`scripts/generate_demo_cases.py` 갱신 + 재생성)
3. **E2E 갱신**:
   - `golden-path.spec.ts` 의 "registered + updated + skipped >= 10" 임계 갱신
   - `consistency-check.spec.ts` 의 group 카드 매칭 추가
4. **Vitest**: `MSW handlers.ts` 의 fixture 응답에 새 file_type 노출

### 2.7 카피(한국어 텍스트) 변경

예: "문서 새로고침" → "라이브러리 갱신" 으로 카피 변경.

1. **grep 으로 사용처 찾기**: `grep -rn '문서 새로고침' frontend/src frontend/tests`
2. **Vitest 테스트**: `getByRole('button', { name: '문서 새로고침' })` → 새 카피로 갱신
3. **E2E 테스트**: 같은 패턴
4. **장기 대응**: 카피가 자주 바뀌면 `data-testid` 추가 검토 (cf. PRD 의 셀렉터 전략)

---

## 3. 파일 구조 + 명명 규약

### 3.1 Vitest 단위 테스트 (코로케이션)

```
frontend/src/
├── api/
│   ├── client.ts
│   ├── client.test.ts          ← 옆에
│   ├── library.ts
│   ├── library.test.ts
│   ├── transport.ts
│   └── transport.test.ts
├── contexts/
│   ├── DisplaySettingsContext.tsx
│   ├── DisplaySettingsContext.test.tsx
│   └── LibraryRescanContext.tsx
│   └── LibraryRescanContext.test.tsx
├── components/
│   ├── FileSearch.tsx
│   ├── FileSearch.test.tsx
│   ├── ...
└── ui/
    ├── Button.tsx
    ├── Button.test.tsx
    └── ...
```

규칙:
- 단일 파일에 단일 테스트 파일. 분할 안 함.
- 인덱스 파일 (`index.ts`) 은 자체 테스트 안 함, 그 안의 export 가 사용되는 곳에서 검증.
- 테스트 파일은 production 빌드 (`tsc -b tsconfig.app.json`) 에서 자동 제외 (cf. `tsconfig.app.json` exclude).

### 3.2 Vitest 셋업 / 헬퍼 (`src/test/`)

```
frontend/src/test/
├── setup.ts          ← 글로벌 polyfill, MSW lifecycle, afterEach cleanup
├── bridge.ts         ← installBridge() helper (Electron preload mock)
├── utils.tsx         ← renderWithProviders() helper
└── msw/
    ├── handlers.ts   ← 34개 backend endpoint 의 default 핸들러
    ├── server.ts     ← setupServer 인스턴스
    └── safety.test.ts← 미정의 endpoint 거절 invariant 검증
```

원칙:
- 새 endpoint 는 `handlers.ts` 에 default 추가
- 시나리오별 응답은 spec 안에서 `server.use(...)` 로 override
- `installBridge()` 는 명시적 opt-in (자동 주입 안 함)

### 3.3 Playwright E2E (분리)

```
frontend/tests/e2e/
├── fixtures.ts                ← test/expect/registerAndRescan export
├── global-setup.ts            ← npm run build && build:electron 강제
├── boot.spec.ts               ← Tier 1
├── golden-path.spec.ts        ← Tier 1
├── consistency-check.spec.ts  ← Tier 2
├── duplicates.spec.ts         ← Tier 2
├── search-filters.spec.ts     ← Tier 2
├── rescan-cancel.spec.ts      ← Tier 2
├── ipc.app-data.spec.ts       ← Tier 3 IPC
└── ipc.update-check.spec.ts   ← Tier 3 IPC
```

규칙:
- Spec 파일명은 시나리오 중심 (`{flow}.spec.ts`). Tier 접두어 안 씀 — 시간 지나며 시나리오의 Tier 가 바뀔 수 있으니.
- IPC 관련은 `ipc.{channel}.spec.ts` 접두어.
- 새 시나리오는 새 spec 파일. 기존 spec 에 add 하기 전에 50줄 넘는지 확인.

---

## 4. 자주 쓰는 패턴 (실제 코드 발췌)

### 4.1 Vitest API 테스트 패턴 (MSW)

```ts
// src/api/library.test.ts 발췌
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw/server'
import { api } from './client'

it('serializes kind, type, query, sort, limit, offset as URL params', async () => {
  let captured: URLSearchParams | undefined
  server.use(
    http.get('*/api/library/groups', ({ request }) => {
      captured = new URL(request.url).searchParams
      return HttpResponse.json({ /* ... */ })
    }),
  )

  await getLibraryGroups({ kind: 'version_family', sort: 'recent' })

  expect(captured?.get('kind')).toBe('version_family')
  expect(captured?.get('sort')).toBe('recent')
})
```

핵심:
- `server.use(...)` 로 endpoint 별 동작 override
- request 검증: `await request.json()` 또는 `new URL(request.url).searchParams`
- response 검증: 함수가 반환한 `response.data` 가 JSON 그대로

### 4.2 Vitest Context 테스트 패턴

```ts
// src/contexts/LibraryRescanContext.test.tsx 발췌
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SnackbarProvider>
      <LibraryRescanProvider>{children}</LibraryRescanProvider>
    </SnackbarProvider>
  )
}

it('polls every 700ms while running and stops when not running', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // ... server.use() 로 status 응답 설정
  const { result } = renderHook(() => useLibraryRescan(), { wrapper })
  await waitFor(() => expect(result.current.running).toBe(true))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700 * 3 + 50)
  })
  // 3 폴링 사이클 발생 검증
  vi.useRealTimers()
})
```

핵심:
- `renderHook` + custom wrapper 로 Provider 주입
- `vi.useFakeTimers()` 로 시간 조작
- `act(async () => { await vi.advanceTimersByTimeAsync(...) })` 로 타이머 + state 동시 진행

### 4.3 Vitest 컴포넌트 테스트 패턴

```ts
// src/components/FileSearch.test.tsx 발췌
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      ...actual.api,
      search: { query: vi.fn(), reindex: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn() },
      // ...
    },
  }
})

import FileSearch from './FileSearch'
import { api } from '../api/client'
const mockedSearchQuery = vi.mocked(api.search.query)

it('does not query the backend until 600ms after the last keystroke', async () => {
  vi.useFakeTimers()
  mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

  renderWithProviders(<FileSearch />, { withLibraryRescan: false })
  const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)

  fireEvent.change(input, { target: { value: '회의' } })
  expect(mockedSearchQuery).not.toHaveBeenCalled()
  vi.advanceTimersByTime(601)
  expect(mockedSearchQuery).toHaveBeenCalledTimes(1)

  vi.useRealTimers()
})
```

핵심:
- `vi.mock` 으로 api 객체 통째 mock (MSW 안 씀 — 빠르고 단순)
- `vi.mocked()` 로 타입 안전한 mock 접근
- `renderWithProviders({ withLibraryRescan: false })` 로 불필요한 fetch 부수효과 제거
- `vi.useFakeTimers()` + `fireEvent.change` 패턴 (`userEvent.type` 은 fake timer 와 안 어울림)

### 4.4 Vitest UI 키트 패턴

```ts
// src/ui/Button.test.tsx 발췌
it('does not fire onClick when disabled', async () => {
  const onClick = vi.fn()
  render(<Button onClick={onClick} disabled>실행</Button>)
  await userEvent.click(screen.getByRole('button', { name: '실행' }))
  expect(onClick).not.toHaveBeenCalled()
})
```

핵심:
- 셀렉터는 `getByRole({ name })` — 접근성 검증 보너스
- props 조합별로 케이스 분리
- `userEvent` (실제 timer 환경)

### 4.5 Playwright E2E 패턴 (라이브러리 등록 후 시나리오)

```ts
// tests/e2e/duplicates.spec.ts 발췌
import { test, expect, registerAndRescan } from './fixtures'

test('duplicates tab renders the empty state when no different-name pairs exist', async ({
  mainWindow,
  testLibrary,
}) => {
  await registerAndRescan(mainWindow, testLibrary)

  await mainWindow
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '중복' })
    .click()

  await expect(mainWindow.getByText('같은 내용 문서').first()).toBeVisible({
    timeout: 10_000,
  })
})
```

핵심:
- `mainWindow` / `testLibrary` fixture 자동 주입
- `registerAndRescan` helper 로 등록 + rescan 완료 대기
- 사이드 nav 와 page 안 같은 라벨 충돌 시 `getByRole('navigation', ...)` 으로 scope

### 4.6 Playwright IPC 패턴

```ts
// tests/e2e/ipc.app-data.spec.ts 발췌
test('app:get-data-paths returns candidates anchored to the temp userData dir', async ({
  mainWindow,
  userDataDir,
}) => {
  const candidates = await mainWindow.evaluate(async () => {
    if (!window.officeWhere?.getAppDataPaths) {
      throw new Error('officeWhere.getAppDataPaths bridge missing')
    }
    return await window.officeWhere.getAppDataPaths()
  })

  const activeCandidates = candidates.filter((c) => !c.id.startsWith('legacy-'))
  for (const candidate of activeCandidates) {
    expect(candidate.path.startsWith(userDataDir)).toBe(true)
  }
})
```

핵심:
- `mainWindow.evaluate(async () => { window.officeWhere?.X(...) })` 로 IPC 호출
- main 프로세스 직접 mutate 가 필요하면 `electronApp.evaluate(...)` (단, dynamic import / require 사용 불가)
- isolation invariant 는 fixture 의 `userDataDir` 와 비교

---

## 5. 함정 카탈로그 (이전에 직접 부딪힌 것들)

새 테스트 작성하다 부딪힐 가능성 높은 함정. 한 번 보면 30분 절약.

### Vitest 영역

| 함정 | 증상 | 해결 |
|---|---|---|
| `transport.ts` 모듈 캐시 누수 | 다른 테스트의 `installBridge` 가 새 테스트에 새어 들어옴 | `setup.ts` 에서 `vi.resetModules()` + `__resetForTests()` 자동 호출 |
| `vi.useFakeTimers` + `userEvent.type` 조합 | timer 가 동작 안 함 또는 hang | `fireEvent.change(input, { target: { value: ... } })` 로 대체 |
| `noUnusedLocals: true` + 테스트 import | tsc 컴파일 실패 | `tsconfig.test.json` 은 `noUnusedLocals: false` 로 완화 |
| Switch (Toggle.tsx) 의 label 결합 | `getByLabelText` 가 동작 안 함 | `getAllByRole('checkbox')` 로 잡기 |
| 같은 텍스트가 여러 곳에 나옴 (필터 chip + 결과 row) | `Found multiple elements` | `.first()` 또는 더 좁은 scope (`fileTypePanel.getByRole(...)`) |
| `request.clone().json()` 패턴 | MSW v2 에서 "unusable" | clone 안 하고 원본만 한 번 read |
| 미정의 endpoint 호출 | `[MSW] Encountered an unhandled exception` | `handlers.ts` 에 default 추가 (PRD §Mock strategy Tier C) |

### Playwright 영역

| 함정 | 증상 | 해결 |
|---|---|---|
| `await import()` 또는 `require()` in `app.evaluate` | "dynamic import callback" / "require is not defined" | 외부에서 path join, evaluate 안에는 직렬화 가능한 값만 |
| macOS `/var/folders` symlink | isolation breach false positive | `fs.realpath()` 적용 (`fixtures.ts` userDataDir) |
| Electron 첫 launch 시 logs 디렉토리 ENOENT | `Uncaught Exception: ENOENT` | fixture 에서 `userData/logs` 와 `userData/backend-data` pre-create |
| splash 창이 firstWindow 로 잡힘 | tab UI 못 찾음 | `isRenderer = (url) => !url.startsWith('data:')` 로 main 창 식별 |
| `args[0]=main.js` 직접 지정 | `app.getAppPath()` = dist-electron, backend script path 깨짐 | `args[0]=frontendDir` + `cwd: frontendDir` (package.json `main` 활용) |
| OnboardingCarousel 첫 실행 차단 + close 클릭 | active tab 이 'files' 로 강제됨 | localStorage 의 `officewhere:onboarding-complete:v1` 를 'true' 로 set 하고 reload |
| `getByRole('button', { name: '필터' })` strict mode 위반 | '필터' / '필터 초기화' 둘 다 매칭 | `{ name: '필터', exact: true }` |
| 그룹 카드는 `group.title` 이 아니라 `group.base_name` 렌더 | 텍스트 못 찾음 | `base_name` 으로 검증 |
| `git checkout` 한 examples 파일은 mtime 이 현재 | 날짜 필터 "최근 7일" 검증 무의미 | 날짜 필터는 UI 상태 변화로만 검증 |
| 결과 row 가 viewport 밖 | `toBeVisible` 실패 | `toBeAttached` 로 DOM 존재만 검증 |
| `.docx` / `.xlsx` 라벨이 chip + 결과 행에 등장 | strict mode | `.first()` |

### 백엔드 영역

| 함정 | 증상 | 해결 |
|---|---|---|
| pytest `monkeypatch` 사용 후 다음 테스트 영향 | DB state 누수 | `setup_db` 헬퍼에서 `tmp_path` + `monkeypatch.setattr(database, 'DB_PATH', ...)` |
| `OW_E2E=1` 만 export 한 dev shell | `dev-web.sh` 거부 | `unset OW_E2E` 또는 OW_E2E_ALLOW=1 도 같이 (테스트 전용) |
| Korean filename surrogate escape | Linux scandir 실패 | LANG=C.UTF-8 LC_ALL=C.UTF-8 (CI 와 fixture 둘 다) |

---

## 6. 테스트 실행 명령

### 6.1 로컬에서

```bash
# 백엔드 pytest (전체)
./venv/bin/python -m pytest

# 백엔드 pytest (특정 파일)
./venv/bin/python -m pytest tests/test_e2e_guard.py -v

# 프론트엔드 Vitest (watch 모드)
cd frontend && npm test

# 프론트엔드 Vitest (1회 실행)
cd frontend && npm run test:run

# 프론트엔드 Vitest (특정 파일)
cd frontend && npm run test:run -- src/components/FileSearch.test.tsx

# 프론트엔드 Vitest (커버리지)
cd frontend && npm run test:coverage

# 프론트엔드 Playwright E2E (전체)
cd frontend && npm run test:e2e

# 프론트엔드 Playwright E2E (build 생략, 빠른 반복)
cd frontend && OW_E2E_SKIP_BUILD=1 npm run test:e2e

# 프론트엔드 Playwright E2E (특정 spec)
cd frontend && OW_E2E_SKIP_BUILD=1 npm run test:e2e -- boot.spec.ts

# 프론트엔드 Playwright UI 모드 (디버깅)
cd frontend && npm run test:e2e:ui
```

### 6.2 PR 머지 전 체크리스트

- [ ] `./venv/bin/python -m pytest` 통과
- [ ] `cd frontend && npm run build` 통과 (test 파일이 production 에 새지 않는지)
- [ ] `cd frontend && npm run test:run` 통과
- [ ] `cd frontend && npm run test:e2e` 통과 (또는 영향 받은 spec 만)
- [ ] 새 컴포넌트/함수에 대응하는 테스트 추가됨
- [ ] 카피 변경했다면 grep 으로 사용처 찾아 테스트 갱신함
- [ ] 새 backend endpoint 라면 MSW 핸들러 추가됨

### 6.3 디버깅 팁

```bash
# Playwright 실패 trace 보기
cd frontend && npx playwright show-trace test-results/<spec-folder>/trace.zip

# Vitest 단일 케이스만
cd frontend && npm run test:run -- -t "does not query the backend"

# Backend 수동 실행 (E2E 디버그용)
OW_E2E=1 OW_E2E_ALLOW=1 OW_DATA_DIR=/tmp/ow-debug ./venv/bin/python backend_server.py --port 18999
```

---

## 7. AI 를 위한 빠른 참조

이 절은 LLM coding 도우미가 위 본문을 다 읽지 않고도 올바른 위치에 테스트를 추가할 수 있도록 정리한 색인입니다. 표 / 매핑 / 템플릿만 모았습니다.

### 7.1 디렉토리 매핑

| 경로 | 무엇 | 신규 파일 명명 |
|---|---|---|
| `tests/test_*.py` | 백엔드 pytest | `test_<feature>.py` |
| `frontend/src/api/*.test.ts` | API 클라이언트 단위 | `<api_module>.test.ts` (옆에) |
| `frontend/src/contexts/*.test.tsx` | Context 단위 | `<Context>.test.tsx` (옆에) |
| `frontend/src/components/*.test.tsx` | 컴포넌트 단위 | `<Component>.test.tsx` (옆에) |
| `frontend/src/ui/*.test.tsx` | UI 키트 단위 | `<Component>.test.tsx` (옆에) |
| `frontend/src/test/msw/handlers.ts` | MSW default 응답 | (단일 파일, append) |
| `frontend/tests/e2e/*.spec.ts` | Playwright E2E | `<flow>.spec.ts` 또는 `ipc.<channel>.spec.ts` |

### 7.2 신규 endpoint 추가 → 테스트 변경 자동 체크리스트

```
신규 백엔드 endpoint POST /api/foo/bar → FooBarResponse 추가:

REQUIRED:
1. backend/api/foo.py 에 라우터 추가
2. tests/test_foo*.py 에 라우터 함수 직접 호출 케이스 추가 (성공 + 4xx)
3. frontend/src/api/{client,library}.ts 에 함수 추가, FooBarResponse 인터페이스 export
4. frontend/src/test/msw/handlers.ts 에 default 핸들러 추가 (FooBarResponse import)

CONDITIONAL:
5. 컴포넌트가 사용하면 → 그 컴포넌트의 *.test.tsx 갱신
6. 사용자 흐름의 일부면 → tests/e2e/*.spec.ts 추가/갱신
```

### 7.3 알려진 production 코드 → 테스트 매핑

| Production 파일 | 대응 테스트 |
|---|---|
| `backend_server.py` | `tests/test_e2e_guard.py`, `tests/test_env_config.py` |
| `backend/api/files.py` | `tests/test_files_api.py`, `tests/test_file_access.py` |
| `backend/api/check.py` | `tests/test_checker.py`, `tests/test_compare_artifacts.py` |
| `backend/api/search.py` | `tests/test_search.py`, `tests/test_hangul_search.py` |
| `backend/api/library.py` | `tests/test_library_groups.py`, `tests/test_library_rescan.py` |
| `backend/core/excel_*.py` | `tests/test_checker.py`, `tests/test_excel_streaming.py` |
| `backend/core/word_*.py` | `tests/test_checker.py` |
| `backend/core/ppt_*.py` | `tests/test_ppt_compare.py`, `tests/test_ppt_analysis.py` |
| `backend/database.py` | `tests/test_database_schema.py`, `tests/test_document_fingerprints.py` |
| `frontend/electron/main.ts` IPC 분기 | `tests/e2e/ipc.*.spec.ts`, `frontend/tests/e2e/fixtures.ts` |
| `frontend/src/api/transport.ts` | `frontend/src/api/transport.test.ts` |
| `frontend/src/api/client.ts` | `frontend/src/api/client.test.ts` |
| `frontend/src/api/library.ts` | `frontend/src/api/library.test.ts` |
| `frontend/src/contexts/DisplaySettingsContext.tsx` | `DisplaySettingsContext.test.tsx` |
| `frontend/src/contexts/LibraryRescanContext.tsx` | `LibraryRescanContext.test.tsx` |
| `frontend/src/components/FileSearch.tsx` | `FileSearch.test.tsx` + `tests/e2e/golden-path.spec.ts` + `tests/e2e/search-filters.spec.ts` |
| `frontend/src/components/FileManager.tsx` | `FileManager.test.tsx` + `tests/e2e/golden-path.spec.ts` |
| `frontend/src/components/ConsistencyCheck.tsx` | `ConsistencyCheck.test.tsx` + `tests/e2e/consistency-check.spec.ts` |
| `frontend/src/components/DuplicateFiles.tsx` | `DuplicateFiles.test.tsx` + `tests/e2e/duplicates.spec.ts` |
| `frontend/src/components/OnboardingCarousel.tsx` | `OnboardingCarousel.test.tsx` |
| `frontend/src/ui/Button.tsx` | `Button.test.tsx` |
| `frontend/src/ui/Dialog.tsx` | `Dialog.test.tsx` |
| `frontend/src/ui/TextField.tsx` | `TextField.test.tsx` |

### 7.4 새 테스트 파일 템플릿 (복사용)

#### Vitest 컴포넌트
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      ...actual.api,
      // override only what this component touches
    },
  }
})

import MyComponent from './MyComponent'

beforeEach(() => {
  // reset mocks between tests
})

describe('MyComponent', () => {
  it('renders', () => {
    renderWithProviders(<MyComponent />, { withLibraryRescan: false })
    expect(screen.getByText(/.../)).toBeInTheDocument()
  })
})
```

#### Vitest Context
```ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MyProvider, useMy } from './MyContext'

function withProvider({ children }: { children: React.ReactNode }) {
  return <MyProvider>{children}</MyProvider>
}

describe('MyProvider', () => {
  it('exposes initial state', () => {
    const { result } = renderHook(() => useMy(), { wrapper: withProvider })
    expect(result.current.value).toBe('default')
  })
})
```

#### Playwright E2E
```ts
import { test, expect, registerAndRescan } from './fixtures'

test('describe what the user does and observes', async ({ mainWindow, testLibrary }) => {
  await registerAndRescan(mainWindow, testLibrary) // optional, for tests needing data

  await mainWindow
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '검색' })
    .click()

  await expect(mainWindow.getByPlaceholder(/.../)).toBeVisible()
})
```

#### Playwright IPC
```ts
import { test, expect } from './fixtures'

test('IPC channel does the right thing', async ({ mainWindow }) => {
  const result = await mainWindow.evaluate(async () => {
    if (!window.officeWhere?.myMethod) throw new Error('bridge missing')
    return await window.officeWhere.myMethod()
  })
  expect(result).toBeDefined()
})
```

---

## 8. PR 리뷰 체크리스트 (리뷰어용)

체크리스트는 GitHub PR template 으로도 옮길 수 있음.

```markdown
## 테스트 변경 체크
- [ ] 새 코드에 대응하는 테스트가 추가됨
- [ ] 기존 코드 변경 시 영향받은 테스트가 갱신됨
- [ ] 카피 변경했다면 카피를 매칭하는 테스트도 함께 갱신
- [ ] 새 backend endpoint → MSW 핸들러 추가됨
- [ ] IPC 채널 추가 → fixtures.ts bridge default 와 spec 추가됨
- [ ] `npm run build` 통과 (테스트 파일이 production 빌드에 안 새는지)
- [ ] `npm run test:run` 통과
- [ ] `npm run test:e2e` 통과 (영향 받는 spec 만이라도)

## 테스트 품질 체크
- [ ] 테스트가 외부 동작을 검증 (내부 상태/private 함수 검증 안 함)
- [ ] 셀렉터가 role/aria 우선, data-testid 는 정말 필요한 곳만
- [ ] 새 테스트 케이스 이름이 행동을 설명함 ("clicking X triggers Y")
- [ ] 시간 의존 테스트는 vi.useFakeTimers 사용 또는 명시적 timeout
```

---

## 9. 참고

- 시스템 전체 구조: [`test-architecture-guide.md`](test-architecture-guide.md)
- 도입 이유 / 결정 기록: [`prd-frontend-testing.md`](prd-frontend-testing.md)
- CI 미구현 청사진: [`ci-workflows-todo.md`](ci-workflows-todo.md)
- 백엔드 테스트 패턴 (prior art): `tests/test_files_api.py`, `tests/test_search.py`
- 프론트엔드 테스트 prior art: `frontend/src/api/library.test.ts`, `frontend/src/components/FileSearch.test.tsx`, `frontend/tests/e2e/golden-path.spec.ts`
