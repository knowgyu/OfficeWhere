# Python Backend Boundary Refactor Plan

작성일: 2026-04-29

상태: **facade-first 구조 정리 진행 중**. 0.6~0.7 작업에서 검색/버전 관리 hot path, comparison artifact storage, library group storage, duplicate-content 조회 seam, rescan/config/file-location seam을 일부 분리했다. `backend/database.py`는 아직 public compatibility facade로 유지한다.

검색/버전관리 hot path의 후속 성능 결정은
`docs/search-version-performance-roadmap.md`에 모아 둔다.

> 2026-05-05 메모: 이 문서는 장기 방향 기록이다. 현재 코드에서는 `backend/storage/comparison_artifacts.py`, `backend/storage/library_groups.py`, `backend/storage/duplicate_content.py` 같은 저장소 seam이 이미 생겼지만, transaction/schema/FTS 호환성 때문에 `backend/database.py` facade를 한 번에 제거하지 않는다.

## 목적

OfficeWhere의 현재 Python backend는 기능적으로 잘 동작하지만, 시간이 지나며 다음 책임이 `backend/database.py`, `backend/core/indexer.py`, `backend/core/library.py`, 일부 `backend/api/*`에 함께 쌓였다.

- Office 문서 추출/파싱
- 색인 작업 스케줄링과 진행률
- SQLite 저장/검색/FTS 관리
- 라이브러리 폴더 스캔과 재색인
- 버전 그룹핑과 비교 오케스트레이션
- FastAPI 라우터의 HTTP 응답/에러 처리

목표는 **Node로 당장 옮기는 것**이 아니라, Python backend 내부에서 먼저 책임 경계를 세워 유지보수성과 테스트 가능성을 높이는 것이다. 단, 성능을 잃으면 안 되므로 실제 구현은 작은 단계로만 진행한다.

## 결론

추천 구조는 **Python 내부 하이브리드 서비스/저장소/문서 어댑터 구조**다.

```text
FastAPI routers
  -> services/use-cases
    -> document adapters          # Excel / Word / PPT 추출과 비교용 타입별 동작
    -> indexing pipeline          # scan, parse jobs, batch write, progress
    -> storage repositories       # SQLite/FTS/setting/cache/fingerprint
    -> search service             # query normalization, result shaping
    -> versioning service         # grouping, manual latest, duplicate filtering
```

즉, Electron은 지금처럼 앱 실행/종료/보안 경계를 맡고, Python backend는 계속 로컬 앱 백엔드 역할을 한다. 다만 Python 내부에서 “문서 추출”, “색인 파이프라인”, “SQLite/FTS 저장”, “검색”, “버전관리”, “HTTP API”가 서로의 내부를 덜 알게 만든다.

## 0.6에서 먼저 적용한 결정

- 제품 hot path를 **검색 + 버전 관리**로 좁혔다.
- 미완성 등록 표 비교 UI와 해당 backend 라우터를 제거했다.
- `registered_files` DB schema에서 과거 등록 표 metadata persisted field를 제거했다.
- legacy DB에서 해당 column이 감지되면 app-owned 등록/index/cache table을 재생성한다. 원본 문서는 건드리지 않는다.
- Excel indexing/registration/rescan은 table 후보 탐색 대신 used-range/cell-coordinate extraction만 사용한다.
- Excel version comparison은 항상 used-range cell diff를 사용한다.
- comparison cache는 version/key 변경 후 100MB/90일/최신 300개 기준으로 pruning한다.
- portable update는 GitHub Release 확인 후 Windows zip과 SHA256 검증 파일을 받아 다운로드 폴더에 저장하고 검증한 뒤 파일 위치를 연다. 실행 중인 포터블 앱 폴더를 helper로 자동 교체하지 않는다.

## 왜 당장 Node app-core로 옮기지 않는가

장기적으로 Electron + Node app-core + Python extractor pool 구조는 가능하다. 하지만 지금 OfficeWhere는 이미 embedded Python release line, FastAPI 라우터, SQLite/FTS, 성능 로그, staging DB, fast worker 설정, 버전 비교 UI까지 연결되어 있다. 이 상태에서 Node app-core를 바로 넣으면 다음 위험이 크다.

- Python/Node 양쪽에 동일한 DB/검색/작업큐 개념이 중복될 수 있다.
- Windows 패키징과 종료/초기화 경로가 다시 흔들릴 수 있다.
- IPC/JSON 직렬화가 색인 hot path에 들어가면 성능 저하가 생길 수 있다.
- 현재 성능 개선에서 이미 중요해진 SQLite batch/staging/FTS 세부 정책이 추상화 속에 숨을 수 있다.

따라서 1차 목표는 **Python 내부에서 추출 경계를 안정화**하는 것이다. 나중에 Node app-core가 필요해져도, 이 경계가 먼저 있어야 안전하게 옮길 수 있다.

## 공식 문서 기반 제약

### SQLite / WAL / FTS5

- SQLite WAL은 reader와 writer가 동시에 진행될 수 있어 검색/색인 동시성에 유리하지만, **writer는 한 번에 하나**다. 앱 구조는 다중 writer가 아니라 단일 write coordinator와 짧은 batch transaction을 기준으로 설계해야 한다. SQLite WAL 문서: <https://www.sqlite.org/wal.html>
- WAL은 같은 host의 shared memory에 의존하므로 app DB는 로컬 app-data에 둬야 한다. 원본 문서가 네트워크 드라이브여도 SQLite DB 자체는 네트워크 파일시스템에 두지 않는다. SQLite WAL 문서: <https://www.sqlite.org/wal.html>
- WAL checkpoint는 read 성능과 write 성능 사이의 균형 문제다. 자동 checkpoint를 무작정 뒤로 미루는 것은 긴 read/query와 WAL 성장 문제를 만들 수 있으므로, 현재처럼 조심스럽게 다룬다. SQLite WAL 문서: <https://www.sqlite.org/wal.html>
- `columnsize=0`은 FTS5의 토큰 수 backing table을 생략해 공간을 아낄 수 있지만, BM25 같은 ranking 함수가 필요할 때 비용이 달라질 수 있다. OfficeWhere 검색은 BM25 의미 랭킹보다 파일 우선/문서 내 위치 순서가 중요하므로 현재 방향과 맞는다. SQLite FTS5 문서: <https://www.sqlite.org/fts5.html>
- FTS5 external/contentless 계열은 공간을 아낄 수 있지만, consistency 관리 책임이 커진다. 이 refactor의 첫 단계에서 schema를 크게 바꾸지 않는다. SQLite FTS5 문서: <https://www.sqlite.org/fts5.html>
- `PRAGMA optimize`는 최신 SQLite에서 query planner 통계 관리를 위한 권장 진입점이다. 다만 구조 리팩터링 자체와 분리해 별도 성능 실험으로 다뤄야 한다. SQLite PRAGMA 문서: <https://www.sqlite.org/pragma.html#pragma_optimize>

### Python concurrency

- CPython 기본 빌드에서는 GIL 때문에 CPU-bound Python bytecode는 thread만 늘려도 선형으로 빨라지지 않는다. Thread는 파일 I/O, ZIP/XML read, 대기 시간이 많은 작업에는 여전히 유효하다. Python threading 문서: <https://docs.python.org/3/library/threading.html>
- `ProcessPoolExecutor`는 GIL을 우회하지만, 인자/결과가 pickle 가능해야 하고 worker subprocess가 import 가능한 entrypoint를 가져야 하며, nested executor 호출은 deadlock 위험이 있다. Python concurrent.futures 문서: <https://docs.python.org/3/library/concurrent.futures.html>
- Python 3.13+ free-threaded build는 선택 옵션이고, C extension 호환성과 runtime GIL 재활성화 가능성이 있다. OfficeWhere의 단기 설계는 no-GIL Python을 전제로 하지 않는다. Python free-threading 문서: <https://docs.python.org/3/howto/free-threading-python.html>

### Electron boundary

- Electron renderer에는 raw filesystem/process 권한을 주지 않고, preload/contextBridge를 통해 제한 API만 노출하는 현재 방향을 유지한다. Electron security/contextBridge 문서: <https://www.electronjs.org/docs/latest/tutorial/security>, <https://www.electronjs.org/docs/latest/api/context-bridge>
- Electron `utilityProcess`는 Node child process용 선택지지만, 이것만으로 Python backend를 당장 Node로 옮길 이유는 없다. Electron utilityProcess 문서: <https://www.electronjs.org/docs/latest/api/utility-process>
- `userData`는 앱 설정 위치이며, Chromium cache 같은 큰 session data는 별도 관리 여지가 있다. app-data reset은 backend 종료와 DB close 이후 app-owned data만 대상으로 해야 한다. Electron app path 문서: <https://www.electronjs.org/docs/latest/api/app>

## 현재 코드 기준 경계 후보

| 현재 위치 | 현재 책임 | 목표 경계 |
| --- | --- | --- |
| `backend/api/files.py` | HTTP 처리 + path 검증 + 파싱 + 저장 | router는 요청/응답만, `FileService`가 use-case 처리 |
| `backend/core/indexer.py` | chunk 추출 dispatch + search query + scheduler | `documents/*`, `indexing/*`, `search/*`, `jobs/*`로 분리 |
| `backend/core/library.py` | settings + scan + rescan + batch flush + staging + version grouping + status | `library/scanner.py`, `library/rescan_pipeline.py`, `library/grouping.py`, `jobs/status.py` |
| `backend/database.py` | connection + schema + CRUD + FTS + cache + settings + fingerprints | `storage/*`로 내부 분리하되 `database.py` facade 유지 |
| `backend/core/checker.py` | file type별 비교 dispatch | `comparison/dispatcher.py`와 document comparator adapter |
| `backend/core/*_analysis.py` | Office 문서별 parser/detail logic | `documents/excel.py`, `documents/word.py`, `documents/ppt.py` adapter가 감싸기 |
| `frontend/electron/main.ts` | backend lifecycle, app-data reset, tray/window | 유지. Python backend boundary와 직접 섞지 않기 |

## 권장 목표 모듈 구조

```text
backend/
  api/                       # FastAPI request/response, HTTPException mapping만 남긴다
  services/
    file_service.py
    search_service.py
    library_rescan_service.py
    library_group_service.py
    comparison_service.py

  domain/
    documents.py             # DocumentInspection, DocumentChunk, FileRef 등 순수 DTO
    indexing.py              # Prepared payload 계약
    errors.py                # API layer가 HTTP로 변환할 typed error

  documents/
    base.py                  # DocumentAdapter Protocol
    registry.py              # extension/file_type -> adapter
    excel.py                 # 기존 excel_analysis wrapper
    word.py                  # 기존 word_analysis wrapper
    ppt.py                   # 기존 ppt_analysis wrapper

  storage/
    connection.py            # DB_PATH/configure/connect/write lock
    schema.py                # init/migration/FTS table creation
    files_repo.py
    chunks_repo.py
    search_repo.py           # FTS SQL/table selection/query plan
    settings_repo.py
    fingerprints_repo.py
    comparison_cache_repo.py
    staging.py

  indexing/
    payloads.py              # prepare_indexed_file equivalent
    writer.py                # single/batch/staging writes
    search_query.py          # FTS query sanitization
    reindex.py

  library/
    settings.py
    scanner.py
    rescan_pipeline.py
    rescan_status.py
    grouping.py
    error_classification.py

  comparison/
    dispatcher.py
    excel.py
    word.py
    ppt.py
    excel_grid.py
```

### Compatibility facade 원칙

처음부터 import 경로를 바꾸지 않는다. 아래 파일은 한동안 facade로 유지한다.

```text
backend/database.py
backend/core/indexer.py
backend/core/library.py
backend/core/checker.py
backend/core/parser.py
```

이유: 테스트와 내부 호출이 이미 이 함수들을 직접 import한다. 먼저 내부 구현만 위임하도록 만들고, import graph가 깨끗해진 뒤 마지막에 정리한다.

## 핵심 interface 초안

### DocumentAdapter

```python
class DocumentAdapter(Protocol):
    file_type: str
    extensions: set[str]

    def inspect(self, path: str) -> DocumentInspection: ...
    def chunks(self, path: str) -> list[DocumentChunk]: ...
```

선택 확장:

```python
class ComparableDocumentAdapter(DocumentAdapter, Protocol):
    def compare(self, file_infos: list[FileRef], scope: str) -> ComparisonResult: ...
```

중요: adapter는 DB를 몰라야 한다. adapter는 파일 경로와 추출 옵션만 받아 추출 결과만 반환한다.
Excel 표 병합 같은 별도 기능이 다시 필요해지면 검색/버전 adapter와 분리된 feature adapter로 설계한다.

### Storage repositories

Repository는 ORM 같은 두꺼운 추상화가 아니라, 현재 SQL/FTS 정책을 보존하는 얇은 단위다.

- `FileRepository`: registered files CRUD/list/count
- `ChunkRepository`: chunk replace/delete/insert
- `SearchRepository`: FTS table 선택, trigram/ko fallback, deterministic order
- `SettingsRepository`: library/scheduler/manual latest settings
- `FingerprintRepository`: document fingerprint read/update/backfill
- `ComparisonCacheRepository`: comparison cache read/write

중요: `SearchRepository`는 generic repository가 아니다. FTS table selection, query plan, cap/windowing은 제품 동작이므로 숨기지 말고 집중시킨다.

## 성능 guardrails

이 refactor는 성능 향상이 아니라 구조 안정화가 목적이다. 따라서 **성능 손실 방지**가 1순위다.

- Office 파일 parsing/fingerprint/payload 준비를 SQLite write lock 안으로 옮기지 않는다.
- `PreparedIndexedFile` 성격의 payload 준비는 계속 DB write 전에 끝낸다.
- file count뿐 아니라 chunk count 기준 batch flush를 유지한다.
- first-run staging DB와 deferred FTS rebuild 정책을 보존한다.
- 검색 시 원본 Office 파일을 열지 않는다.
- 버전 목록 조회 시 원본 Office 파일을 열지 않는다. 상세 비교만 선택된 pair에 대해 lazy 계산한다.
- FTS rebuild/migration/search SQL은 테스트와 함께 움직인다.
- pandas/import-heavy dependency는 backend startup에서 eager import하지 않는다.
- process/IPC/JSON serialization은 hot path에 넣지 않는다. 그런 실험은 별도 branch에서 성능 로그로 증명한 뒤 결정한다.
- 새 DI framework나 service container dependency를 추가하지 않는다.

성능 기준:

- 대표 rescan/search/version-list에서 10% 이상 느려지면 실패로 본다.
- 10-15% 이상 느려져도 구조적 이득이 명확하다면 별도 decision record가 필요하다.
- search/version first paint는 기존보다 느려지면 안 된다.

## Data flow simulation

### 초기/수동 색인

```text
POST /api/library/rescan
  -> LibraryRescanService.start
    -> SettingsRepository.load
    -> LibraryScanner.collect_supported_paths
    -> RescanPlanner decide skip/reindex/prune
    -> worker pool: DocumentRegistry.adapter_for(path).inspect/chunks
    -> IndexPayloadFactory.prepare outside DB lock
    -> IndexWriter.flush by chunk/file/time thresholds
    -> optional InitialIndexStagingDatabase
    -> StatusReporter progress snapshot
```

이 경로에서 병렬화 가능한 부분은 parser/prepare 단계다. DB write는 계속 serialized batch로 둔다.

### 검색

```text
POST /api/search
  -> SearchService.search
    -> QueryNormalizer / SearchQueryPlan
    -> SearchRepository.search_file_names
    -> SearchRepository.search_chunks
    -> result shaping/snippets
```

이 경로에서는 Python parser도 Office 원본 file open도 없다.

### 버전 목록

```text
GET /api/library/groups
  -> LibraryGroupService.list_groups
    -> FingerprintRepository / FileRepository
    -> grouping cache/signature check
    -> duplicate filtering/manual latest apply
```

버전 목록은 DB metadata/fingerprint 기반이어야 하며, detailed diff와 분리한다.

### 상세 변경점 비교

```text
POST /api/check
  -> ComparisonService.compare_pair_or_group
    -> FileRepository.get file refs
    -> ComparisonCacheRepository.get
    -> ComparisonDispatcher by file_type
    -> adapter-specific comparator
    -> ComparisonCacheRepository.save
```

이 경로만 선택된 파일 pair를 깊게 읽을 수 있다. 즉시 전체 version group을 전부 재파싱하지 않는다.

## Migration plan

### Phase 0 — 문서와 baseline

- [x] 구조 계획 문서 작성.
- [ ] 현재 `index-performance.log`, `parsing-performance.log` 대표 샘플을 보존한다.
- [ ] 현재 release 기준 verification command를 기록한다.
- [ ] architecture branch 이름을 정한다: `arch/python-backend-boundaries` 권장.

### Phase 1 — characterization tests

- [ ] `search_chunks`, `search_file_names`의 short Korean/trigram/filename/content cap 동작 테스트 보강.
- [ ] `delete_file`, `delete_all_files`, comparison cache clearing 테스트 보강.
- [ ] `ensure_file_fingerprints` backfill과 group cache invalidation 테스트 보강.
- [ ] rescan cancellation/already-running/initial staging finalize 테스트 보강.
- [ ] packaged resource 경로(`frontend/package.json` `extraResources`) smoke check를 명시한다.

### Phase 2 — storage split behind `backend.database` facade

- [ ] `storage/connection.py`부터 분리하되 `database.py` public 함수는 유지.
- [ ] schema/FTS creation은 한 번에 크게 옮기지 말고 table group별로 이동.
- [ ] `SearchRepository`는 search SQL을 그대로 옮기고, query plan 변화를 만들지 않는다.
- [ ] batch/staging write tests 통과 전 다음 phase로 가지 않는다.

### Phase 3 — document adapter registry

- [ ] Excel/Word/PPT adapter wrapper만 추가하고 기존 parser 함수는 facade로 유지.
- [ ] `get_file_type`/extension dispatch 중복을 registry로 흡수.
- [ ] adapter는 DB import 금지.
- [x] 0.6: 검색/버전 경로를 used-range extraction으로 단순화했다.

### Phase 4 — indexing/library pipeline split

- [ ] scanner, rescan planner, write buffer, status reporter를 분리.
- [ ] `BATCH_FLUSH_FILE_LIMIT`, `BATCH_FLUSH_CHUNK_LIMIT`, staging 선택 조건을 보존.
- [ ] parser worker와 DB writer 경계를 더 명확히 한다.
- [ ] performance logs field names를 바꾸지 않거나, migration note를 남긴다.

### Phase 5 — service layer and thin routers

- [ ] `FileService`, `SearchService`, `LibraryGroupService`, `ComparisonService` 도입.
- [ ] FastAPI router는 schema validation, HTTPException mapping, response serialization 중심으로 축소.
- [ ] frontend `client.ts` response shape 변경 없음.

### Phase 6 — optional future process boundary

- [ ] Python 내부 경계가 안정화된 뒤에만 persistent extractor process pool 또는 Node app-core 실험 branch를 만든다.
- [ ] process boundary를 넣는 경우, DTO serialization cost와 cancellation/shutdown/packaging을 먼저 검증한다.

## Branch and PR strategy

권장 branch stack:

1. `docs/python-backend-boundaries` — 이 문서만.
2. `arch/storage-facade-split` — DB module facade 유지.
3. `arch/document-adapter-registry` — parser dispatch 정리.
4. `arch/indexing-pipeline-split` — rescan/batch/status 경계.
5. `arch/service-thin-routers` — API router slimming.
6. `arch/facade-cleanup` — import graph가 깨끗해진 뒤만.

규칙:

- 한 branch에서 `database.py`와 `library.py`를 동시에 크게 찢지 않는다.
- schema migration은 별도 PR로 분리한다.
- 한 PR당 “동작은 같고 위치만 이동” 또는 “테스트 추가” 중 하나에 가깝게 유지한다.
- 모든 PR에 performance log 비교를 붙인다.

## Verification plan

기본 gate:

```bash
./venv/bin/python -m pytest -q
./venv/bin/python scripts/run_demo_checks.py
./venv/bin/python -m compileall backend backend_server.py -q
cd frontend && npm run build
cd frontend && npm run build:electron
git diff --check
```

성능 gate:

```bash
# 대표 로컬/공유폴더 케이스에서 수행
OW_INDEX_PERF_LOG_PATH=/tmp/index-performance.log \
OW_PARSE_PERF_LOG_PATH=/tmp/parsing-performance.log \
./venv/bin/python -m pytest -q tests/test_library_rescan.py
```

수동 QA:

- [ ] 첫 실행/초기화 후 튜토리얼이 다시 보인다.
- [ ] 대상 추가 후 색인 진행률이 정상 증가한다.
- [ ] 검색이 원본 파일 재오픈 없이 빠르게 뜬다.
- [ ] 버전 탭 목록이 먼저 뜨고, 상세 변경점은 선택 후 lazy load된다.
- [ ] Excel 표로보기 색상/셀 변경 이력이 유지된다.
- [ ] 앱데이터 초기화 후 backend/Python/Electron background process가 남지 않는다.
- [ ] Windows zip을 완전히 압축 해제한 뒤 실행한다.

## Cleanup opportunities

코드 이동과 동시에 무리하게 삭제하지 않는다. 다만 각 phase 끝에서 다음을 확인한다.

- [ ] 더 이상 import되지 않는 helper 함수.
- [ ] legacy PyInstaller 문서/경로와 현재 embedded Python packaging 문서의 불일치.
- [ ] release checklist에서 `officewhere_backend.spec` 같은 옛 설명이 남아 있는지.
- [ ] parser에서 더 이상 지원하지 않는 `.txt`, `.md` 관련 UI/문서 흔적.
- [ ] 성능 로그에 문서 본문 text가 절대 남지 않는지.

## 최종 판단

이 계획은 “깔끔한 아키텍처” 자체가 목적이 아니다. 목적은 다음이다.

1. 검색/버전관리 hot path가 parser나 rescan 상태에 덜 흔들리게 한다.
2. SQLite/FTS batch/staging 최적화를 더 안전하게 유지한다.
3. Excel/Word/PPT parser 변경이 API/DB 코드로 번지지 않게 한다.
4. app reset, packaging, worker settings 같은 desktop runtime 경계를 명확히 한다.
5. 향후 Node app-core 또는 extractor process pool로 갈 수 있는 길을 열되, 지금은 성능과 안정성을 잃지 않는다.

따라서 다음 실제 작업은 code rewrite가 아니라 **characterization tests + thin facade extraction**부터 시작해야 한다.
