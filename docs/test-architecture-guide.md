# OfficeWhere 테스트 작성을 위한 아키텍처 가이드

> 본 문서는 테스트 코드 작성을 목적으로 OfficeWhere 프로젝트 전체(백엔드 + 프론트엔드 + 기존 테스트 + DB 스키마)를
> 한 번에 읽을 수 있도록 정리한 참고 자료입니다. 코드 덤프가 아닌 **구조 / 원리 / 역할 / 테스트 포인트** 중심으로 작성했습니다.
>
> 인용은 `경로:줄번호` 형식이며, 모든 경로는 레포 루트 기준입니다.

---

## 0. 한눈에 보는 큰 그림

```
┌────────────────────────── Electron 데스크톱 앱 ───────────────────────────┐
│                                                                          │
│  Renderer (React + Vite + TS)               Main (Electron, TS)          │
│  ─ src/App.tsx ─ 4개 탭                      ─ electron/main.ts          │
│    ├ FileSearch         (검색)                 ├ Python backend spawn    │
│    ├ ConsistencyCheck   (변경 이력/비교)       ├ IPC 14 채널            │
│    ├ DuplicateFiles     (같은 내용 문서)       ├ 자동 업데이트 체크      │
│    └ FileManager        (라이브러리/설정)      └ 데이터 폴더 관리        │
│                ↑                                       ↑                 │
│        api/transport.ts ─── (preload.ts) ──── window.officeWhere         │
│                ↓                                                         │
│        api/client.ts(axios) ─── HTTP ───→  http://127.0.0.1:18765        │
│                                                       │                  │
└───────────────────────────────────────────────────────┼──────────────────┘
                                                        ↓
┌──────────────── FastAPI 백엔드 (Python 3.11+) ─────────────────────────┐
│                                                                        │
│  backend/main.py  ─ lifespan: init_db() → start_scheduler()            │
│                                                                        │
│  api/                core/                       storage/   models/   │
│  ─ files.py          ─ indexer.py(파싱+청킹)     ─ comparison_artifacts │
│  ─ search.py         ─ library.py(스캔/그룹)      ─ duplicate_content   │
│  ─ check.py          ─ library_scanner.py        ─ library_groups       │
│  ─ library.py        ─ library_identity.py        schemas.py(Pydantic) │
│                      ─ excel/word/ppt_analysis                          │
│                      ─ excel/word/ppt_compare                           │
│                      ─ hangul_search(초성+ngram)                       │
│                      ─ checker.py / parser.py / normalizer.py          │
│                                                                        │
│  database.py(약 2.7K줄, SQLite WAL + FTS5)                              │
│   ─ 11개 테이블 + FTS 가상 테이블 + 마이그레이션 헬퍼                  │
└────────────────────────────────────────────────────────────────────────┘
```

핵심 사실 5가지:

1. **백엔드는 단일 프로세스**: 사용자 PC에서 `127.0.0.1:18765`(기본)로 떠 있는 FastAPI. 외부 노출 X, CORS는 localhost만.
2. **DB는 단일 SQLite 파일**: `~/Library/Application Support/OfficeWhere/backend-data/data.db` (macOS 기준). WAL 모드, FTS5 한국어 토크나이저.
3. **원본 파일은 절대 수정하지 않음**: 읽기 전용. 청크/지문/비교 아티팩트만 DB에 저장.
4. **프론트엔드 테스트 인프라가 있음**: Vitest/RTL/MSW 단위 테스트와 Playwright Electron E2E spec이 있으며, 기본 CI는 build + E2E typecheck + Vitest를 실행한다.
5. **Electron 모드 ↔ 웹 dev 모드 모두 지원**: `dev-web.sh`는 backend + Vite 만, packaged Electron은 번들 Python으로 backend 실행.

---

## 1. 백엔드 — FastAPI 서버

### 1.1 진입점과 lifecycle

| 파일 | 역할 |
|---|---|
| [`backend_server.py`](../backend_server.py) | CLI 엔트리. host/port/data-dir/log-level 파싱 후 `uvicorn`으로 `backend.main:app` 기동 |
| [`backend/main.py`](../backend/main.py) | FastAPI 앱 생성, CORS, 라우터 등록, `lifespan`에서 `init_db()` + `start_scheduler()` |
| [`backend/config.py`](../backend/config.py) | 환경 변수 기본값 (포트/host/데이터 경로) |
| [`backend/runtime.py`](../backend/runtime.py) | bundled Python 감지, 로그 디렉토리 결정 |
| [`backend/file_constants.py`](../backend/file_constants.py) | `SUPPORTED_EXTENSIONS = {".xlsx", ".docx", ".pptx"}` |

기동 순서 ([`main.py:29-37`](../backend/main.py)):

```
init_db()                    # DB 스키마 생성/마이그레이션
cleanup_tutorial_library()   # 이전 튜토리얼 라이브러리 잔재 정리
start_scheduler()            # 60초마다 자동 재인덱싱 체크 (daemon thread)
yield                        # 앱 가동
```

CORS 정책 ([`main.py:42-50`](../backend/main.py)): `localhost:*` / `127.0.0.1:*` 만 허용. `null` origin도 허용 (Electron renderer가 `file://` 인 경우).

### 1.2 API 라우터별 책임

#### `/api/files` ([`backend/api/files.py`](../backend/api/files.py))

| 엔드포인트 | 메소드 | 역할 |
|---|---|---|
| `/inspect` | POST | 등록 전 파일 검증 + 스키마 미리보기 |
| `/pick`, `/pick-folder` | POST | OS 다이얼로그 (Tkinter) — 단위 테스트 시 monkeypatch 필수 |
| `/` | POST | 단일 파일 등록 (`inspect_and_chunk` → `save_indexed_file`) |
| `/` | GET | 전체 파일 목록 |
| `/page` | GET | 페이징 + 필터(쿼리/타입/정렬) |
| `/duplicates` | GET | 동일 내용·다른 이름 그룹 목록 |
| `/{file_id}/schema` | GET | 등록된 파일의 현재 스키마 |
| `/{file_id}` | DELETE | 단일 등록 해제 |
| `/` | DELETE | 전체 등록 해제 |
| `/{file_id}/open`, `/show-in-folder` | POST | OS에 파일/폴더 열기 위임 (플랫폼별 동작) |
| `/scan-folder` | POST | 폴더 내 지원 파일을 ThreadPoolExecutor로 병렬 검사 |
| `/bulk-register` | POST | 여러 파일 동시 등록 (병렬) |

#### `/api/search` ([`backend/api/search.py`](../backend/api/search.py))

- `POST /` — `search_scope` (`filename` | `content` | `all`), `file_types` 필터, `modified_from/to`, `file_limit`(<=100), `limit`. 한글 초성 검색을 자동 활성.
- `POST /reindex` — 전체 재인덱싱 (병렬).
- `GET /settings`, `PUT /settings` — 자동 재인덱싱 모드(`manual` / `interval` / `daily`) 저장.

#### `/api/check` ([`backend/api/check.py`](../backend/api/check.py))

- `POST /` — 2개 이상 파일 비교 (Excel/Word/PPT). `_comparison_cache_key()`로 SHA256 캐시. `COMPARISON_CACHE_VERSION=3`, TTL 90일.
- `POST /excel-grid` — Excel diff 그리드(셀 단위 변경 표시). `focuses`로 사용자가 선택한 셀에 대한 히스토리 표시.
- 캐시 키 구성: `(file_id, path, mtime, mode, version)`. mtime 변경 감지 → 결과 invalidate.
- 같은 타입만 비교 가능. Word/PPT는 정확히 2개만 비교 (현 시점).

#### `/api/library` ([`backend/api/library.py`](../backend/api/library.py))

- `GET/PUT /settings` — `LibrarySettings` (감시 폴더, 제외 폴더, 자동 모드, 워커 수)
- `POST /rescan` — 동기 재스캔 (작은 라이브러리)
- `POST /rescan/start` — 비동기 작업 시작
- `GET /rescan/status` — 진행률 폴링용 (프론트엔드는 700ms 간격)
- `POST /rescan/cancel` — 취소
- `GET /groups`, `GET /groups/{id}` — 동일/유사 이름 파일 그룹 조회
- `PUT/DELETE /groups/{id}/latest-file` — 사용자가 지정한 "최신본" 수동 설정

### 1.3 코어 도메인 모듈

#### 파싱 / 인덱싱 파이프라인

```
inspect_and_chunk(path)                                  ← backend/core/indexer.py
   ├─ get_file_type() → 'Excel' | 'Word' | 'PowerPoint'  ← parser.py
   ├─ Excel:  excel_analysis.extract_excel_used_ranges() (openpyxl read_only)
   ├─ Word:   word_analysis.extract_word_blocks()        (python-docx)
   └─ PPT:    ppt_analysis.extract_ppt_slides()          (python-pptx)
        → chunks: [{ location, content, content_type }, ...]
        → comparison_artifacts: 비교용 구조화 데이터 (Word/PPT)
        → fingerprint: 정규화 텍스트 SHA256
```

청크 위치 문자열 규약:
- Excel: `"Sheet1 시트 | 3행 B열"`
- Word: `"쪽 N"` 또는 `"표 N"`
- PPT: `"슬라이드 N"`

`save_indexed_file(file_id, payload)` ([`database.py`](../backend/database.py))이 단일 트랜잭션으로:
1. `registered_files` UPSERT
2. `file_chunks` 일괄 INSERT
3. FTS 트리거 자동 동기화
4. `document_fingerprints` 갱신
5. (Excel) `excel_sheet_index` + `excel_cell_index` 갱신
6. (Word/PPT) `comparison_artifacts` zlib 압축 저장

#### 한글 검색 ([`backend/core/hangul_search.py`](../backend/core/hangul_search.py))

3가지 토큰을 같이 인덱싱 → FTS 매칭률 향상:

1. **원본 텍스트** — 그대로
2. **2-gram** — `"회의록"` → `["회의", "의록"]`
3. **초성** — `"회의"` → `"ㅎㅇ"`

`make_search_snippet(content, query)`이 매칭 위치를 `**...**`로 감싸 35자 컨텍스트 반환.

테스트 시 `_is_hangul_syllable()`, `get_choseong()` 같은 순수 함수만 분리 검증 가능 — DB 의존 없음.

#### 라이브러리 스캔 → 그룹화

```
load_library_settings()                       ← core/library_settings.py
   ↓
library_scanner.collect_supported_paths_with_stats()
   ├─ 디렉터리 시그니처(inode, mtime, size) 캐시 검증
   ├─ ScanCollection 반환 (paths, cache_hit, fallback_reason)
   └─ DEFAULT_EXCLUDED_FOLDER_NAMES (.git, node_modules, venv, ...)
   ↓
ThreadPoolExecutor(fast_worker_count) → inspect_and_chunk 병렬
   ↓
InitialIndexStagingDatabase (tmp DB) ← 초기 색인 시 메인 DB 락 회피
   ├─ BATCH_FLUSH_FILE_LIMIT (24) / BATCH_FLUSH_CHUNK_LIMIT (5000)
   └─ finalize_to_main() → SQLite backup API로 메인 DB에 commit
   ↓
library_identity.parse_document_identity(name)
   → 파일명에서 토큰 추출:
       ├─ date  : "2026-05-05", "260505"
       ├─ version: "v2.1", "rev3"
       └─ status: "최종본", "draft", "final"
   → sort_key 계산 → 그룹 내 "최신" 자동 결정
   ↓
library_groups.list_library_group_summaries()
   → group_kind: exact_match | version_match | date_match | exact_name_conflict
   → library_group_index / members / index_files 3개 테이블 갱신
```

`RescanStatusCoordinator` ([`core/rescan.py:51-106`](../backend/core/rescan.py))는 백그라운드 작업 단일성 보장(중복 시작 방지) + 취소 깃발 관리.

#### 비교(Diff) 모듈

| 파일 | 역할 | 키 알고리즘 |
|---|---|---|
| `excel_compare.py` | Excel 셀 단위 added/deleted/changed | `normalizer.values_equal()` (공백/숫자 비교 정규화) |
| `excel_diff_grid.py` | UI용 그리드 빌드 (focuses 기준) | sheet → rows → cells |
| `word_compare.py` | Word 블록 시퀀스 매칭 | `difflib.SequenceMatcher` on normalized blocks |
| `ppt_compare.py` | 슬라이드 정렬 + 변경 표시 | DP 정렬(슬라이드 유사도 기반) |

`comparison_artifacts` 테이블에 `word_ordered_text`, `ppt_ordered_text` 페이로드를 미리 저장 → 재비교 시 파일을 다시 파싱하지 않고 빠르게 가능.

### 1.4 데이터베이스 ([`backend/database.py`](../backend/database.py), 2700줄)

#### 스키마 버전 상수

```
FINGERPRINT_VERSION         = 1
SEARCH_INDEX_VERSION        = "6"
COMPARISON_CACHE_VERSION    = 3
EXCEL_INDEX_VERSION         = "2"
COMPARISON_ARTIFACT_VERSION = "1"
LIBRARY_GROUP_INDEX_VERSION = "2"
```

#### 테이블 11개 + FTS

| 테이블 | 역할 | 행 단위 |
|---|---|---|
| `registered_files` | 등록된 파일 메타 | 파일당 1 |
| `file_chunks` | 검색 청크 (location + content) | 청크당 1 |
| `file_search_v6` (FTS5 가상) | content + normalized_search_text | 청크당 1 |
| `settings` | key-value 설정 (인덱스 버전 등) | 키당 1 |
| `document_fingerprints` | normalized_hash, content_hash | 파일당 1 |
| `excel_sheet_index` | 시트별 행/열 개수 | 시트당 1 |
| `excel_cell_index` | 셀별 좌표/내용 | 셀당 1 |
| `comparison_cache` | 비교 결과 JSON (90일 TTL) | 비교당 1 |
| `comparison_artifacts` | Word/PPT 비교용 구조 (zlib 압축) | (file_id, kind)당 1 |
| `library_group_index` | 그룹 메타 (kind, base_name, latest_file_id) | 그룹당 1 |
| `library_group_members` | 그룹-파일 다대다 + rank | 멤버십당 1 |
| `library_group_index_files` | 멤버 파일 캐시 (file_signature) | 파일당 1 |
| `library_group_dirty_keys` | 재색인 대기 그룹 | 대기당 1 |

#### `init_db()` 마이그레이션 흐름

1. `_connect()` — SQLite WAL, busy_timeout=30s, cache_size 튜닝
2. `_create_schema()` — 모든 테이블/인덱스 `IF NOT EXISTS`
3. `_ensure_registered_files_columns()` — 새 컬럼 추가 (e.g., indexed_at)
4. `_reset_legacy_excel_table_metadata_schema()` — 구버전 컬럼 제거
5. `_drop_legacy_file_search()` — 이전 FTS 테이블 정리
6. `_reset_legacy_comparison_cache_schema_if_needed()` — 캐시 버전 미스매치 시 초기화
7. `_ensure_excel_index_version()` — Excel 인덱스 버전 점검 → 필요 시 재색인 마크
8. `_rebuild_search_indexes()` — FTS5 optimize
9. `_create_fts_triggers()` — INSERT/UPDATE/DELETE 시 FTS 자동 동기화

마이그레이션이 깨질 경우 `last_schema_reset` 설정값을 남기고, 프론트엔드는 `/api/app/schema-reset-state`로 사용자에게 안내 메시지를 표시.

#### 핵심 헬퍼 함수 (카테고리별)

| 카테고리 | 대표 함수 |
|---|---|
| 등록/저장 | `register_file`, `save_file_chunks`, `save_indexed_file`, `save_indexed_files_batch`, `delete_file`, `delete_all_files` |
| 조회 | `get_all_files`, `get_file_by_id`, `list_files_page`, `count_files`, `count_files_by_type`, `get_registered_files_signature` |
| 검색 | `search_chunks`, `search_file_names`, `_rebuild_search_indexes` |
| Fingerprint | `get_file_fingerprints`, `_build_document_fingerprint`, `_upsert_document_fingerprint` |
| Excel 인덱스 | `get_excel_sheet_index`, `get_excel_cell_index`, `_replace_excel_index` |
| 비교 아티팩트 | `get_comparison_artifact`, `save_comparison_artifact`, `_replace_comparison_artifacts` |
| 라이브러리 그룹 | `list_library_group_index_files_for_key`, `upsert_library_group_index_files`, `get_indexed_library_group`, `list_library_group_summaries`, `mark_library_group_keys_dirty`, `set_library_group_index_state` |
| 설정 | `_get_setting_with_cursor`, `_set_setting_with_cursor`, `pop_setting` |

### 1.5 환경 변수 (테스트 시 유용)

| 변수 | 기본값 | 용도 |
|---|---|---|
| `OW_DATA_DIR` | OS 기본 | DB/캐시 디렉터리 위치 (테스트 격리에 필수) |
| `OW_HOST` / `OW_PORT` | `127.0.0.1`/`18765` | 서버 바인딩 |
| `OW_INDEX_PERF_LOG` / `OW_INDEX_PERF_LOG_PATH` | off | 성능 JSON-line 로그 |
| `OW_PARSE_PERF_LOG` | off | 파서 성능 로그 |
| `OW_MAX_WORKERS`, `OW_FAST_MAX_WORKERS` | CPU 기반 | 병렬 워커 수 |
| `OW_RESCAN_BATCH_FLUSH_FILE_LIMIT` | 24 | 배치 플러시 임계 |
| `OW_RESCAN_BATCH_FLUSH_CHUNK_LIMIT` | 5000 | 배치 플러시 임계 |

---

## 2. 프론트엔드 — React + Vite + Electron

### 2.1 빌드 / 설정

[`frontend/package.json`](../frontend/package.json):

| 영역 | 내용 |
|---|---|
| 런타임 | `react@18.2`, `react-dom@18.2`, `axios@1.6` |
| 빌드 | `vite@5.1`, `typescript@5.2`, `@vitejs/plugin-react@4.2` |
| UI | `tailwindcss@3.4`, Material Icons |
| Electron | `electron@30.5`, `electron-builder@24.13` |
| **테스트** | **(없음)** — vitest/jest/playwright 모두 미설정 |

[`frontend/vite.config.ts`](../frontend/vite.config.ts) — `/api` 프록시가 `BACKEND_PORT`(기본 18765)로 향함. `VITE_BACKEND_URL` 환경변수가 있으면 우선.

### 2.2 Electron 레이어

#### [`frontend/electron/preload.ts`](../frontend/electron/preload.ts) — IPC 14채널

`contextBridge.exposeInMainWorld('officeWhere', { ... })`로 renderer에 노출:

| 채널 | 반환 | 용도 |
|---|---|---|
| `app:get-backend-base-url` | `string` | 백엔드 URL (renderer 부팅 시 1회) |
| `app:get-version`, `app:get-log-path` | `string` | 메타 정보 |
| `app:get-data-paths` | `AppDataCandidate[]` | DB/캐시 폴더 후보 |
| `app:clear-app-data` | `ClearAppDataResult` | 앱 데이터 삭제 (exit 옵션) |
| `app:consume-reset-state` | `AppResetState` | 스키마 리셋 메시지 소비 |
| `app:get/set-close-behavior` | `'ask' \| 'hide' \| 'quit'` | 창 닫기 동작 |
| `app:get/set-startup-settings` | `AppStartupSettings` | 자동 시작 |
| `app:check-for-updates` / `install-update` | 결과 객체 | GitHub 릴리스 확인/설치 |
| `dialog:pick-file` / `pick-folder` | `{ cancelled, path/folder_path, error? }` | OS 파일 선택 |

#### [`frontend/electron/main.ts`](../frontend/electron/main.ts) — backend 스폰

| 모드 | Python | Script | CWD |
|---|---|---|---|
| 개발 (`!app.isPackaged`) | `venv/bin/python` 또는 `python3` | `<repo>/backend_server.py` | repo root |
| 패키지 | `python-runtime/{platform}` | `<resources>/backend-source/backend_server.py` | backend-source |

스폰 시 환경 변수 주입: `OW_DATA_DIR`, `OW_HOST=127.0.0.1`, `OW_PORT=18765`, `OW_INDEX_PERF_LOG_PATH`, `PYTHONUTF8=1`, 패키지 모드는 `PYTHONNOUSERSITE=1`.

기동 후 30초간 `/api/health` 폴링 → 성공 시 `backendBaseUrl` 확정 → renderer가 IPC로 가져감. 비정상 종료 시 dialog로 에러 표시 후 앱 종료.

### 2.3 API 계층 (`src/api/`)

#### [`transport.ts`](../frontend/src/api/transport.ts) — URL 결정

```
getBackendBaseUrl()  ← 한 번만 호출, Promise 캐싱
   ├─ Electron 모드: window.officeWhere.getBackendBaseUrl()
   └─ Web dev:       import.meta.env.VITE_BACKEND_URL

apiPath(path)         ← 모든 API 호출의 기본
   = baseUrl + path   (예: 'http://127.0.0.1:18765/api/search')
```

⚠️ 모든 API 함수가 `await apiPath(...)` 후 axios 호출. 테스트 시 transport을 mock 하지 않으면 `Promise<string>`이 그대로 전달돼 fetch가 실패.

#### [`client.ts`](../frontend/src/api/client.ts) (42KB)

대표 함수: `api.search`, `api.file.inspect/preview/register/delete`, `api.check`, `api.duplicate.list`, `api.library.*`. 응답은 `AxiosResponse<T>` — 호출자가 `.data` 접근.

#### [`library.ts`](../frontend/src/api/library.ts)

`libraryApi.getSettings`, `updateSettings`, `rescan`, `startRescan`, `rescanStatus`, `cancelRescan`, `groups`, `groupDetail`, `setManualLatest` 등.

#### [`shared.ts`](../frontend/src/api/shared.ts)

```ts
type FileType = 'Excel' | 'Word' | 'PowerPoint' | 'Unknown'
type CompareMode = 'excel' | 'word' | 'ppt'
interface FileInfo { id, name, path, file_type, column_count, ... }
```

### 2.4 전역 상태 (Context 3종)

#### [`DisplaySettingsContext`](../frontend/src/contexts/DisplaySettingsContext.tsx)

- `textSize`: `'normal' | 'large' | 'xlarge' | 'xxlarge'` + 증가/감소/리셋 함수
- `themeMode`: `'system' | 'light' | 'dark'`, `resolvedTheme`(실제 적용)
- localStorage 키: `officewhere:app-text-size`, `officewhere:app-theme-mode`
- DOM 반영: `document.documentElement.dataset.theme`, `style.colorScheme`
- 시스템 테마 감지: `window.matchMedia('(prefers-color-scheme: dark)')`

#### [`LibraryRescanContext`](../frontend/src/contexts/LibraryRescanContext.tsx)

- 상태: `status`, `summary`, `running`, `cancelling`, `completionKey`
- **폴링**: `running===true` 동안 700ms 간격으로 `rescanStatus()` 호출
- 완료 감지 → reason별 Snackbar 메시지 (`'manual' | 'added' | 'fast'`)
- `observedRunningRef`로 알림 중복 방지

#### Snackbar (`src/ui/Snackbar.tsx`)

`useSnackbar()` 훅이 `success/error/warn/info(message, duration?)` 메서드 제공.

### 2.5 메인 화면

| 컴포넌트 | 크기 | 역할 | 주요 외부 의존 |
|---|---|---|---|
| [`App.tsx`](../frontend/src/App.tsx) | 44KB | 4탭 라우팅, 온보딩 캐러셀, 투어 가이드, 업데이트 체크 | localStorage, IPC, tutorial.ts |
| [`FileSearch.tsx`](../frontend/src/components/FileSearch.tsx) | 40KB | 검색 (debounce 600ms, 페이징, 타입/날짜 필터) | `api.search`, `api.file.preview` |
| [`FileManager.tsx`](../frontend/src/components/FileManager.tsx) | 56KB | 라이브러리 폴더 관리, 재인덱싱, 앱 데이터, 설정 | `libraryApi`, IPC(폴더 선택, 데이터 삭제) |
| [`ConsistencyCheck.tsx`](../frontend/src/components/ConsistencyCheck.tsx) | 58KB | 그룹 → 비교, 결과 시각화 (Excel/Word/PPT 별), Excel 셀 그리드 모달 | `libraryApi.groups`, `api.check`, `api.excelDiffGrid` |
| [`DuplicateFiles.tsx`](../frontend/src/components/DuplicateFiles.tsx) | 12KB | 동일 내용 그룹 페이징 | `api.duplicate.list` |
| [`OnboardingCarousel.tsx`](../frontend/src/components/OnboardingCarousel.tsx) | 17KB | 첫 실행 안내 | localStorage |
| [`PreviewPanel.tsx`](../frontend/src/components/PreviewPanel.tsx) | 5KB | 파일 미리보기 모달 | `api.file.preview` |

`components/consistency/`, `components/file-manager/`에 하위 컴포넌트 (ExcelCheckResult, GroupTimeline, ExcelDiffGridModal 등).

`src/ui/` Material Design 키트 14개 — 순수 렌더링 컴포넌트라 단위 테스트 부담이 가장 적음.

#### 탭 정의 ([`App.tsx:33-66`](../frontend/src/App.tsx))

```ts
TABS = [
  { id: 'search',     label: '문서 검색' },
  { id: 'check',      label: '변경 이력' },
  { id: 'duplicates', label: '같은 내용 문서' },
  { id: 'files',      label: '설정 / 라이브러리' },
]
```

투어 시스템: `getTutorialTargetElement(step)` → `[data-tour-target="${step}"]` DOM 쿼리 + 가시성 60% 검사.

---

## 3. 기존 테스트

[`pytest.ini`](../pytest.ini): `pythonpath=.`, `testpaths=tests`, `norecursedirs=python-runtime frontend venv dist build`. **conftest.py 없음** — 각 테스트가 독립적으로 fixture 구성. 2026-05-05 현재 전체 pytest 실행 기준은 177 passed 이다.

### 3.1 백엔드 pytest 파일 매핑

| 파일 | 줄 | 테스트 | 대상 |
|---|---|---|---|
| [`test_checker.py`](../tests/test_checker.py) | 939 | 23 | `checker`, `excel_diff_grid`, 비교 전반 |
| [`test_search.py`](../tests/test_search.py) | 639 | 33 | `indexer`, `search`, FTS, 한글 |
| [`test_library_groups.py`](../tests/test_library_groups.py) | 462 | 15 | 버전 그룹, 문서 정체성 파싱 |
| [`test_library_rescan.py`](../tests/test_library_rescan.py) | 911 | 31 | rescan 플로우, 스케줄러, 설정 |
| [`test_database_schema.py`](../tests/test_database_schema.py) | 135 | 4 | `init_db`, 마이그레이션, 레거시 정리 |
| [`test_document_fingerprints.py`](../tests/test_document_fingerprints.py) | 187 | 9 | 지문/중복 |
| [`test_excel_streaming.py`](../tests/test_excel_streaming.py) | 133 | 7 | Excel 분석, 독립 import 검증 |
| [`test_files_api.py`](../tests/test_files_api.py) | 135 | 7 | files API (list/remove/show) |
| [`test_ppt_compare.py`](../tests/test_ppt_compare.py) | 113 | 3 | PPT 슬라이드 DP 정렬 |
| [`test_compare_artifacts.py`](../tests/test_compare_artifacts.py) | 174 | 5 | 비교 아티팩트 zlib 저장소 |
| [`test_file_access.py`](../tests/test_file_access.py) | 65 | 4 | `inspect_file_path` |
| [`test_ppt_analysis.py`](../tests/test_ppt_analysis.py) | 61 | 4 | PPT 위치 좌표 |
| [`test_hangul_search.py`](../tests/test_hangul_search.py) | 35 | 5 | 초성/trigram/정규화 (순수 함수) |
| [`test_env_config.py`](../tests/test_env_config.py) | 91 | 8 | OW_* 환경변수 |
| [`test_e2e_guard.py`](../tests/test_e2e_guard.py) | 72 | 5 | E2E data-dir 안전장치 |
| [`test_duplicate_files.py`](../tests/test_duplicate_files.py) | 35 | 1 | 중복 그룹 조회 |
| [`test_runtime_packaging.py`](../tests/test_runtime_packaging.py) | 155 | 8 | 번들 Python, 릴리스 |
| [`test_tutorial_examples.py`](../tests/test_tutorial_examples.py) | 83 | 2 | 튜토리얼 라이브러리 |
| [`test_index_perf.py`](../tests/test_index_perf.py) | 19 | 1 | 성능 로그 파싱 |

### 3.2 표준 테스트 패턴

#### A. DB 격리 fixture (가장 흔함)

```python
@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("backend.database.DB_PATH", db_path)
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
```

→ 모든 테스트가 깨끗한 SQLite로 시작. WAL 모드라 병렬 실행도 안전.

#### B. Office 파일 동적 생성

```python
# Excel — openpyxl
wb = Workbook(); ws = wb.active; ws["A1"] = "회의"; wb.save(path)

# Word — python-docx
doc = Document(); doc.add_paragraph("..."); doc.save(path)

# PPT — python-pptx
prs = Presentation(); prs.slides.add_slide(prs.slide_layouts[6]); prs.save(path)
```

#### C. 라우터 함수 직접 호출 (TestClient 미사용)

```python
from backend.api.files import register
from backend.models.schemas import FileRegisterRequest
response = register(FileRegisterRequest(path=str(excel_path)))
assert response.id > 0
```

→ FastAPI dependency 없이 단순 Python 함수처럼 호출. HTTP 통합 테스트는 현재 없음.

### 3.3 커버리지 빈틈

| 영역 | 상태 | 비고 |
|---|---|---|
| `/api/search/reindex`, `/settings` | ❌ | 라우터 함수 미테스트 |
| `/api/library/rescan/status`, `/cancel`, `/groups/{id}/latest-file` | ❌/⚠️ | 내부만 테스트, 라우터 미테스트 |
| FastAPI HTTP 통합 (TestClient) | ❌ | 대부분 API가 함수 직접 호출 중심 |
| 프론트엔드 단위 | ✅/⚠️ | Vitest/RTL/MSW baseline 있음. React `act(...)` warning 정리는 남음 |
| Playwright Electron E2E | ✅/⚠️ | spec/fixture 있음. CI는 현재 typecheck까지, full Linux launch는 system deps 고정 후 승격 |
| 캐시 프루닝 | ⚠️ | 단순 TTL만 |
| 보호 문서 | 📄 | 수동 testbed (`docs/drm-python-testbed.md`) |

---

## 4. 테스트 작성 전략

### 4.1 백엔드 — 우선순위 추천

#### Tier 1 — 라우터 HTTP 통합 (빈틈)

`fastapi.testclient.TestClient`를 도입해 엔드포인트 단위 테스트. 현재는 함수 직접 호출만 있어 HTTP 계층(`Pydantic 검증`, `HTTPException`, status code) 검증이 약함.

```python
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.database.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("backend.database.DB_DIR", tmp_path)
    init_db()
    with TestClient(app) as c:
        yield c

def test_search_endpoint_validates_query(client):
    res = client.post("/api/search", json={"query": "", "search_scope": "all"})
    assert res.status_code in (200, 422)
```

테스트할 엔드포인트:
- `POST /api/search` — 빈 쿼리, file_types 필터, 날짜 범위, file_limit 상한(100)
- `POST /api/search/reindex` — DB 비어있을 때 / 파일 등록 후
- `GET /api/files/page` — 페이징/정렬/필터 조합
- `GET /api/files/duplicates` — 빈 결과 / 그룹 존재
- `POST /api/check` — 1개 파일 (실패), 다른 타입 혼합 (실패), Word 3개 (실패)
- `GET /api/library/groups` — kind/type 필터
- `PUT/DELETE /api/library/groups/{id}/latest-file` — 수동 지정/해제
- `GET /api/health`, `GET /api/app/example-library-path`, `GET /api/app/schema-reset-state`

#### Tier 2 — 미테스트 코어 함수

| 모듈 | 추가 테스트 후보 |
|---|---|
| `core/library_settings.py` | 잘못된 모드/시간 입력 시 검증 |
| `core/library_scan_cache.py` | 캐시 적중/실패/fallback_reason 조합 |
| `core/file_scope.py` | 권한 검사 경로 결합 |
| `core/index_perf.py` | 다중 이벤트 집계 |
| `storage/library_groups.py` | dirty key 마킹 → 부분 재색인 |

#### Tier 3 — 회귀 가능성 높은 시나리오

- **마이그레이션**: 구버전 DB(이전 스키마 fixture)로 시작 → `init_db()` → 데이터 보존 + 새 컬럼 채워짐 검증
- **재인덱싱 동시성**: 두 번 동시에 `start_library_rescan_job()` 호출 → 중복 방지
- **취소 응답성**: 큰 라이브러리 시뮬레이션 + cancel → 다음 워커 사이클 안에 멈춤
- **mtime 기반 캐시 무효화**: 파일 touch → 비교 결과 재계산 트리거
- **한글 초성 매칭**: `"회의"` 검색 → `"ㅎㅇ"` 입력으로도 동일 파일 매칭

### 4.2 프론트엔드 — 현재 테스트 baseline

현재 프론트엔드는 Vitest/RTL/MSW 단위 테스트와 Playwright Electron E2E spec을 함께 둔다. 새 테스트를 추가할 때는 [`docs/test-guidelines.md`](test-guidelines.md)를 우선 참고한다.

현재 구성:

- `frontend/vitest.config.ts` — jsdom, global setup, MSW server.
- `frontend/src/test/setup.ts` — test DOM/localStorage/matchMedia 초기화. `window.officeWhere`는 자동 주입하지 않고 필요한 테스트가 `installBridge()`를 호출한다.
- `frontend/src/test/utils.tsx` — `DisplaySettings`, `LibraryRescan`, `Snackbar` provider wrapper.
- `frontend/src/test/msw/handlers.ts` — backend endpoint 기본 mock 응답.
- `frontend/src/api/*.test.ts`, `frontend/src/contexts/*.test.tsx`, `frontend/src/components/*.test.tsx`, `frontend/src/ui/*.test.tsx` — co-located unit/component tests.

우선순위:

1. **API 계층** — `transport.ts`, `client.ts`, `library.ts`.
2. **Context** — `DisplaySettingsContext`, `LibraryRescanContext`.
3. **UI 키트** — `Button`, `Dialog`, `TextField`, Snackbar 계열.
4. **메인 컴포넌트** — `FileSearch`, `FileManager`, `ConsistencyCheck`, `DuplicateFiles`, `OnboardingCarousel`.
5. **통합** — Playwright로 boot/golden path/검색 필터/변경 이력/같은 내용 문서/IPC.

컴포넌트 테스트 시 주의사항:

- **타이머**: debounce/폴링 → `vi.useFakeTimers()` + `vi.advanceTimersByTime()` 또는 user-event의 timer 연동.
- **비동기 렌더**: `await waitFor(() => ...)` 또는 `findBy*`. 현재 일부 테스트는 통과하지만 `act(...)` warning이 남아 있어, 해당 컴포넌트 수정 시 함께 정리한다.
- **아이콘/동일 텍스트**: role/name 우선, 정말 구분이 안 되는 곳만 `data-testid`.
- **Tour target**: `[data-tour-target="..."]`는 튜토리얼용 계약이므로 테스트 셀렉터와 책임을 섞지 않는다.

### 4.3 Playwright Electron E2E

Playwright E2E는 `frontend/tests/e2e/fixtures.ts`가 실제 Electron 앱을 띄우고, Electron main process가 dev venv Python backend를 시작하는 구조다. 핵심 안전장치는 다음과 같다.

- `OW_E2E=1`, `OW_E2E_ALLOW=1`, 임시 `OW_DATA_DIR`를 주입해 사용자 실제 app-data 경로 접근을 backend guard에서 거절한다.
- `examples/officewhere_test_library`를 테스트별 임시 폴더로 복사한 뒤 등록한다. 체크아웃된 원본 예제 폴더는 직접 등록하지 않는다.
- `tests/e2e/*.spec.ts`는 boot, golden path, 검색 필터, 변경 이력, 같은 내용 문서, rescan cancel, app-data/update IPC를 나눠 검증한다.
- CI 기본 게이트는 아직 full Electron launch 대신 `npx tsc -p tsconfig.e2e.json`로 E2E spec 타입 안정성을 확인한다. Linux full E2E는 `libasound`, GTK/GBM, Xvfb 같은 runner 시스템 의존성을 고정한 뒤 별도 workflow로 승격한다.

---

## 5. 자주 발생하는 함정 (이전 사례 기반)

| 증상 | 원인 | 회피/검증 |
|---|---|---|
| `database is locked` | 동시 쓰기 | `_DB_WRITE_LOCK` 사용 / 재시도 / WAL 확인 |
| FTS 검색 결과 0건 | `init_db()` 전 INSERT, 트리거 미생성 | 등록 전 init 호출 / FTS 트리거 존재 검증 |
| 한글 초성 검색 실패 | `HANGUL_BASE` 계산 오류 | `get_choseong()` 단위 테스트 |
| 임시 staging DB 잔재 | 예외 시 정리 누락 | `try/finally`로 `finalize_to_main()` 보장 |
| 비교 캐시 stale | 파일 mtime 변경 미감지 | `_source_stat_metadata()` 검증 |
| `apiPath()` Promise 누락 | `await` 빠뜨림 | TS strict 의존 / 테스트에서 mock string 반환 |
| Context Hook rule 위반 | 조건부 `useDisplaySettings()` | 컴포넌트 최상단 호출 강제 |
| 폴링 멈추지 않음 | `running` 변경 안 됨 / cleanup 누락 | `useEffect` 의존성 배열 검증 |

---

## 6. 다음 단계 제안

테스트/문서 정리는 이제 "인프라 도입"이 아니라 baseline 유지와 빈틈 보강 단계다.

1. **React `act(...)` warning 정리** — 현재 Vitest는 통과하지만 로그가 noisy하다. affected component를 건드릴 때 테스트 await/timer 경계를 함께 정리한다.
2. **백엔드 HTTP 통합 테스트 도입** — `TestClient` fixture를 별도 계획으로 두고 `/api/health`, `/api/search`, `/api/check`부터 시작한다.
3. **Full Electron E2E CI 승격** — Linux runner의 `libasound`, GTK/GBM, Xvfb 의존성을 고정한 뒤 `docs/ci-workflows-todo.md` 기반으로 별도 workflow를 추가한다.
4. **E2E coverage 보강** — 사용자가 실제로 많이 쓰는 검색 → 변경 이력 → 같은 내용 문서 흐름에서 regressions가 반복되는 부분만 spec을 늘린다.
5. **문서 링크/상태 유지** — 새 workflow나 test command가 생기면 `README.md`, `docs/README.md`, `docs/test-guidelines.md`, `docs/release-test-checklist.md`를 같이 갱신한다.

---

## 부록 A. 참고 문서

| 문서 | 요약 |
|---|---|
| [`docs/release-test-checklist.md`](release-test-checklist.md) | 릴리스 전 자동 + 수동 검증 항목 |
| [`docs/drm-python-testbed.md`](drm-python-testbed.md) | 보호 문서 호환성 수동 검증 절차 |
| [`docs/architecture-review-roadmap.md`](architecture-review-roadmap.md) | 아키텍처 리뷰 로드맵 |
| [`docs/backend-python-boundary-refactor-plan.md`](backend-python-boundary-refactor-plan.md) | 백엔드 경계 리팩터링 계획 |
| [`docs/indexing-performance-fast-mode.md`](indexing-performance-fast-mode.md) | fast 모드 성능 노트 |
| [`docs/search-version-performance-roadmap.md`](search-version-performance-roadmap.md) | 검색 버전 성능 로드맵 |

## 부록 B. 모듈 ↔ 기존 테스트 매핑 (요약)

| 모듈 | 기존 테스트 | 추가 권장 |
|---|---|---|
| `api/files.py` | `test_files_api.py` | bulk_register 동시성, scan-folder 권한 거부 |
| `api/search.py` | (없음) | TestClient — 쿼리 검증, file_limit 상한 |
| `api/check.py` | `test_checker.py` | TestClient — 잘못된 input, 캐시 hit/miss |
| `api/library.py` | (간접) | TestClient — rescan 라이프사이클 전체 |
| `core/indexer.py` | `test_excel_streaming.py`, `test_search.py` 일부 | reindex_all 부분 실패 처리 |
| `core/library.py` | `test_library_groups.py`, `test_library_rescan.py` | 마이그레이션 시나리오 |
| `core/library_identity.py` | `test_library_groups.py` (간접) | 토큰 단위 분리 테스트 |
| `core/hangul_search.py` | `test_hangul_search.py` | 코드포인트 경계 / 비-한글 혼합 |
| `core/excel_compare.py` | `test_checker.py` | 큰 시트 / 빈 시트 / 머지셀 |
| `core/word_compare.py` | `test_checker.py` | 표 변경 / 페이지 경계 |
| `core/ppt_compare.py` | `test_ppt_compare.py` | 슬라이드 추가/삭제 / 동일 슬라이드 다른 위치 |
| `storage/comparison_artifacts.py` | `test_compare_artifacts.py` | 압축 손상 시 fallback |
| `storage/duplicate_content.py` | `test_duplicate_files.py` | 같은 해시 다른 mtime |
| `storage/library_groups.py` | (간접) | upsert 충돌, dirty key 처리 |
| `database.py` | `test_database_schema.py` | 각 마이그레이션 함수 단위 |
| Frontend API/Context/UI | `frontend/src/api/*.test.ts`, `frontend/src/contexts/*.test.tsx`, `frontend/src/components/*.test.tsx`, `frontend/src/ui/*.test.tsx` | React `act(...)` warning 정리, 큰 화면 흐름별 focused tests |
| Electron E2E | `frontend/tests/e2e/*.spec.ts` | Linux full E2E CI 승격, macOS packaged smoke |
