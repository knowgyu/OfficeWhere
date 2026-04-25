# OfficeWhere Architecture

## 개요

OfficeWhere는 로컬 파일을 직접 보관하지 않고, 파일 경로와 파서 설정, 검색 색인만 SQLite에 저장한다. 앱은 Electron shell, React renderer, FastAPI backend, SQLite database로 구성된다.

```text
Electron main
  ├─ backend process 실행/감시
  ├─ 런타임 backend URL 주입
  └─ OS 파일/폴더 선택 bridge

React renderer
  ├─ 라이브러리/검색/통합/정합성 UI
  └─ axios로 FastAPI 호출

FastAPI backend
  ├─ 파일 등록/검사 API
  ├─ 검색/색인 API
  ├─ Excel JOIN API
  └─ 타입별 비교 API

SQLite
  ├─ registered_files
  ├─ settings (library/search scheduler settings)
  └─ file_chunks + FTS search index
```

## 주요 설계 결정

| 영역 | 결정 | 이유 |
| --- | --- | --- |
| 원본 파일 | 복사하지 않고 경로만 저장 | 대용량/권한/동기화 문제 최소화 |
| 저장소 | 사용자 홈의 SQLite | 설치형 서버 없이 로컬 앱으로 동작 |
| Excel | `parser_config` 저장 | 표가 첫 행/첫 열에서 시작하지 않아도 재현 가능 |
| Word/PPT | 문서 diff 모델 | key 기반 표 비교보다 수정본 비교에 적합 |
| 검색 | SQLite FTS5 + chunk 메타데이터 | 로컬·오프라인·빠른 전문 검색 |
| 재스캔 | 전역 비동기 작업 상태 | 탭 이동 후에도 진행/취소 상태 유지 |
| 배포 | Electron + PyInstaller backend | 비개발자 Windows 실행 경험 개선 |

## 백엔드 구조

```text
backend/
  main.py                 FastAPI 앱과 라우터 등록
  database.py             SQLite 초기화와 CRUD
  api/
    files.py              파일 등록/검사/선택
    library.py            대상 폴더, 재스캔, 진행 상태, 취소
    search.py             검색 API
    query.py              Excel JOIN / export
    check.py              타입별 정합성 검사
  core/
    library.py            설정 저장소 기반 대상 폴더와 재스캔 orchestration
    indexer.py            검색 chunk 생성과 증분 색인
    excel_analysis.py     Excel 표 후보 탐지
    excel_compare.py      Excel 정합성 비교
    word_analysis.py      Word 문단/표 블록 추출
    word_compare.py       Word block diff
    ppt_analysis.py       PPT 슬라이드/아이템 추출
    ppt_compare.py        PPT slide diff
    joiner.py             Excel-only JOIN
    checker.py            비교 dispatcher
```

## 파일 타입별 처리

### Excel

- 등록 시 표 후보 영역을 탐지한다.
- `.xlsx` 계열은 `openpyxl.load_workbook(read_only=True, data_only=True)`로 열고 `iter_rows()`로 필요한 행 범위만 스트리밍한다.
- 헤더 후보는 상단 30행(`HEADER_SCAN_LIMIT`) 안에서 찾고, 후보 점수 계산은 제한된 샘플 행(`HEADER_SCAN_ROW_BUDGET`)만 사용한다. 스캔이 샘플 끝까지 이어지는 경우 실제 worksheet row bound를 `end_row`로 보존해 큰 표가 잘리지 않게 한다.
- 선택된 `sheet_name`, `header_row`, `start_col`, `end_col`, `end_row`를 저장한다.
- JOIN과 정합성 검사 시 같은 설정으로 표를 다시 읽되, 저장된 표 범위만 DataFrame으로 만든다.
- pandas는 backend 시작/라우터 import 시점에 로드하지 않고, Excel 표 추출·JOIN·export가 실제 실행될 때 지연 import한다.
- 정합성 검사는 값 차이, key 누락, 컬럼 누락을 반환한다.

### Word

- 문단과 표 행을 순서를 유지하는 block으로 추출한다.
- 정확히 2개 파일을 비교한다.
- `insert`, `delete`, `replace` 형태의 diff를 반환한다.

### PowerPoint

- 슬라이드 제목, signature, 내부 텍스트/표 item을 추출한다.
- 정확히 2개 파일을 비교한다.
- 슬라이드 추가/삭제와 매칭된 슬라이드 내부 변경을 반환한다.

### Text / Markdown

- 단락과 줄 위치를 chunk 메타데이터로 저장한다.
- 검색 전용으로 사용한다.

## 재스캔 / 색인 흐름

1. `settings` 테이블에 저장된 library settings에서 대상 폴더 목록을 읽는다.
2. 지원 확장자 파일 경로를 수집한다.
3. DB의 기존 mtime과 비교한다.
4. 신규/변경 파일만 inspect 및 색인한다.
5. 변경이 없는 파일은 “변경 없음”으로 집계한다.
6. 진행 상태는 stage, progress, current file, counters로 노출한다.
7. 취소 요청이 오면 다음 안전 지점에서 중단하고 상태를 `cancelled`로 정리한다.

이 구조는 파일 내용 분석 비용을 줄이지만, 폴더를 순회해 후보 경로와 mtime을 확인하는 비용은 남아 있다. 폴더 순회 자체를 더 줄이려면 파일 시스템 watcher나 별도 캐시가 필요하다.

## 프론트엔드 구조

```text
frontend/src/
  App.tsx                         탭 레이아웃과 전역 재스캔 표시
  main.tsx                        provider bootstrap
  api/client.ts                   API 타입과 axios 함수
  contexts/LibraryRescanContext.tsx
  components/
    FileManager.tsx               라이브러리/폴더/재스캔 UI
    FileSearch.tsx                검색과 문서 형식 필터
    JoinQuery.tsx                 Excel 통합 UI
    ConsistencyCheck.tsx          타입별 비교 결과 UI
    ResultTable.tsx               표 표시 공통 컴포넌트
```

## API 요약

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/files` | 등록 파일 목록 |
| POST | `/api/files` | 파일 단건 등록 |
| POST | `/api/files/inspect` | 파일 구조 미리보기 |
| POST | `/api/files/pick` | OS 파일 선택 |
| POST | `/api/files/pick-folder` | OS 폴더 선택 |
| GET | `/api/library/settings` | 라이브러리 대상 폴더와 자동 재스캔 설정 조회 |
| PUT | `/api/library/settings` | 라이브러리 대상 폴더와 자동 재스캔 설정 저장 |
| POST | `/api/library/rescan` | 동기 재스캔 |
| POST | `/api/library/rescan/start` | 비동기 재스캔 시작 |
| GET | `/api/library/rescan/status` | 재스캔 상태 조회 |
| POST | `/api/library/rescan/cancel` | 재스캔 취소 요청 |
| POST | `/api/search` | 문서 검색 |
| POST | `/api/query/join` | Excel JOIN |
| POST | `/api/query/export` | JOIN 결과 Excel export |
| POST | `/api/check` | 타입별 정합성 검사 |

## 배포 구조

- `frontend/package.json`의 `electron-builder` 설정이 Windows zip을 만든다.
- `office_data_joiner_backend.spec`가 backend executable을 만든다.
- Electron resources에는 renderer dist와 backend executable이 포함된다.
- GitHub Actions는 태그 push 시 테스트, 빌드, zip 패키징, Release asset 업로드를 수행한다.
