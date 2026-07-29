# OfficeWhere 아키텍처 요약

OfficeWhere는 로컬/공유 폴더에 흩어진 Office/PDF 문서를 찾아 색인하고, 검색과 버전 비교를 제공하는 데스크톱 앱입니다. 원본 문서는 항상 읽기 전용으로 다룹니다.

## 구성

| 영역 | 위치 | 역할 |
| --- | --- | --- |
| Desktop shell | `frontend/electron/` | Electron main/preload. Python backend 실행, 포트 전달, 제한된 `window.officeWhere` bridge 제공 |
| Renderer | `frontend/src/` | React + TypeScript + Vite UI. 검색, 문서 관리, 중복/버전 비교 화면 |
| API backend | `backend/main.py`, `backend/api/` | FastAPI router, CORS, 설정/API 계약 |
| Provider contract | `backend/api/provider.py`, `backend/application/`, `docs/provider-contract.md` | contextWhere와 로컬 agent가 SQLite 직접 접근 없이 쓰는 자동화용 read-oriented 계약 |
| App data | `backend/database.py` | SQLite schema, 등록 파일, 검색 청크, 서명, 비교/그룹 캐시, 설정 |
| Parsing/indexing | `backend/core/` | Office/PDF parser, rescan, search, comparison, Excel/PPT/Word diff |
| Packaging | `scripts/prepare_python_runtime.py`, `python-runtime/`, `frontend/package.json` | backend source/runtime과 Electron bundle 생성 |

## Packaged Python runtime

패키징된 앱은 사용자의 시스템 Python에 의존하지 않습니다. Electron은 app bundle 안의 private Python runtime으로 `resources/backend-source/backend_server.py`를 실행합니다.

- Windows: `npm run package:win`이 `scripts/prepare_python_runtime.py win-x64`를 먼저 실행해 공식 Python embeddable zip과 `requirements.txt` 패키지를 `python-runtime/win-x64/`에 준비합니다.
- macOS arm64: `npm run package:mac`이 `scripts/prepare_python_runtime.py mac-arm64`를 먼저 실행해 standalone Python runtime과 같은 `requirements.txt` 패키지를 `python-runtime/mac-arm64/`에 준비합니다.
- `python-runtime/*`의 생성된 바이너리와 `site-packages`는 git에 커밋하지 않습니다. 빌드/릴리스 runner에서 재생성하고 Electron Builder가 최종 앱에 포함합니다.
- Windows runtime은 Windows runner에서 실제 설치합니다. Linux에서는 `--dry-run`으로 URL/경로 계약만 검증합니다.

PDF 텍스트 추출은 PDFium 기반 `pypdfium2`로 수행합니다. `backend/core/pdf_analysis.py`는 PDFium 호출을
전역 락으로 감싸 스레드 병렬 색인 중에도 한 번에 하나의 PDFium 작업만 수행하고, 원본 PDF는 열람 후 닫기만
합니다. 일부 PDF는 엔진별 텍스트 추출 결과가 다를 수 있으므로 배포 전 실제 샘플로 확인합니다.

PowerPoint 본문/표 추출은 `backend/core/ppt_analysis.py`의 OOXML zip parser가 담당합니다. runtime PPT 읽기를 위해 `python-pptx`를 호출하지 않습니다. `python-pptx`는 테스트/데모 문서 생성 같은 개발 도구 경로에서만 필요할 수 있습니다.

## Frontend HTTP policy

Renderer API 호출은 `frontend/src/api/http.ts`의 얇은 native `fetch` wrapper를 사용합니다. 외부 HTTP client dependency를 기본값으로 두지 않습니다.

- wrapper는 기존 client 코드가 기대하는 `{ data }` 응답 모양을 유지합니다.
- 오류도 기존 UI/tests가 다루던 `{ response: { status, data } }` 형태로 맞춰 던집니다.
- 새 API client를 추가할 때는 `fetch`를 직접 흩뿌리기보다 이 wrapper를 재사용합니다.
- Axios 같은 HTTP dependency는 native `fetch`로 처리할 수 없는 명확한 요구가 생길 때만 다시 검토합니다.

## 주요 데이터 흐름

1. 사용자가 대상 폴더를 추가합니다.
2. 문서 새로고침이 watched folder를 스캔해 지원 확장자를 찾습니다.
3. backend가 지원 문서를 읽어 app-owned SQLite DB에 메타데이터, 검색 청크, 내용 서명, 비교 보조 캐시를 저장합니다.
4. renderer는 HTTP API로 검색/목록/비교 결과만 받아 표시합니다.
5. 원본 문서는 이동, 삭제, 덮어쓰기, 저장을 하지 않습니다.

## 등록 파일 상태

등록된 파일은 원본 경로가 사라질 수 있으므로 DB에 가용성 상태를 둡니다.

- `available`: 최근 스캔 또는 직접 등록에서 원본 경로가 확인된 상태
- `missing`: 성공적으로 확인한 watched root 아래에서 원본 경로가 더 이상 보이지 않는 상태
- `missing_since`: 처음 누락으로 확인된 시각
- `missing_last_checked_at`: 마지막으로 누락을 확인한 시각

문서 새로고침은 스캔이 실패했거나 접근 권한이 불명확한 root/subdir에 대해서는 누락으로 단정하지 않습니다. 원본이 다시 보이면 `available`로 복구합니다. 7일 이상 계속 누락된 항목은 앱 DB와 검색/비교 캐시에서만 정리하며, 원본 파일 삭제 동작은 없습니다.

## UI/API 계약 변경 시 같이 볼 파일

| 바뀐 계약 | 함께 확인 |
| --- | --- |
| API request/response | `backend/models/schemas.py`, `frontend/src/api/*.ts`, 관련 tests |
| 파일 목록/검색 | `backend/api/files.py`, `backend/core/indexer.py`, `backend/database.py`, `FileSearch`, `FileManager` |
| 문서 새로고침 | `backend/core/library.py`, `backend/core/library_scanner.py`, `frontend/src/contexts/LibraryRescanContext.tsx` |
| 버전/중복 그룹 | `backend/core/library.py`, `backend/storage/library_groups.py`, `ConsistencyCheck`, `DuplicateFiles` |
| 비교 결과 | `backend/core/checker.py`, `excel_compare.py`, `word_compare.py`, `ppt_compare.py`, frontend consistency components |
| Electron bridge/packaging | `frontend/electron/main.ts`, `frontend/electron/preload.ts`, `frontend/package.json`, release workflow |

## Provider 경계

`/api/provider/v1`은 외부 자동화가 사용할 수 있는 얇은 provider 계약입니다. contextWhere 같은 상위 orchestration은 OfficeWhere SQLite를 직접 읽지 않고 이 계약을 통해 검색, 파일 목록, 중복, 캐시된 문서 묶음, 비교 기능만 호출합니다. provider의 문서 묶음 조회는 cache-only snapshot이며, 파생 인덱스 새로고침/repair 표시나 누락된 fingerprint 생성까지 포함해 상태 변경 동작을 수행하지 않습니다. 재색인, 설정 변경, 파일 등록/삭제, OS 파일 열기 같은 작업도 명시적 사용자 의도 없이 자동 호출하지 않습니다. MailWhere는 메일 mirror/search를, contextWhere는 여러 provider의 evidence/wiki/context pack을 소유하며 OfficeWhere는 문서 내용과 색인 책임만 유지합니다. 자세한 규칙은 `docs/provider-contract.md`를 봅니다.

## Startup and derived-index repair

릴리즈 시작 경로는 앱 가용성을 먼저 보장해야 합니다. 구조적 SQLite schema 준비는 startup에서 수행하지만, FTS 검색 인덱스나 Excel 파생 인덱스처럼 재생성 가능한 대용량 derived data는 startup을 막지 않고 `repair_needed`/`refreshing` 상태로 표시한 뒤 백그라운드에서 복구합니다. 세부 정책은 `docs/startup-derived-index-repair.md`를 봅니다.

## 운영 원칙

- 새 의존성보다 기존 seam과 테스트를 우선합니다.
- 참조 없는 legacy helper나 대체 구현은 남겨두지 말고 테스트로 현재 동작을 고정한 뒤 삭제합니다.
- 앱 데이터 초기화/정리는 DB, 캐시, 로그, 설정 등 app-owned 위치만 대상으로 합니다.
- 패키징된 Electron backend 포트는 OS가 배정한 loopback 포트를 사용합니다. 고정 포트로 바꾸지 않습니다.
- 사용자-facing 한국어 문구는 내부 용어보다 동작 중심으로 씁니다.
