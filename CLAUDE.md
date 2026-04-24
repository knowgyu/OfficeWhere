# CLAUDE.md — Office Data Joiner 에이전트 가이드

CLI 에이전트가 이 프로젝트를 작업할 때 참고하는 문서입니다.

---

## 프로젝트 한 줄 요약

Excel/Word/PPT 파일들을 DB처럼 관리하는 데스크톱 도구.  
FastAPI 백엔드 + React 프론트엔드를 PyInstaller로 묶어 Windows `.exe`로 배포.

---

## 디렉토리 구조

```
backend/
  main.py           — FastAPI 앱, lifespan(DB 초기화), static SPA serve
  database.py       — SQLite CRUD (~/.office-data-joiner/data.db, parser_config 저장)
  core/
    parser.py       — 파일 타입별 스키마 조회 / Excel 표 파싱 엔트리
    excel_analysis.py — Excel 표 후보 탐지 + parser_config 기반 표 추출
    excel_compare.py  — Excel multi-file consistency diff
    word_analysis.py  — Word 문단 + 표 행 블록 추출
    word_compare.py   — Word block diff
    ppt_analysis.py   — PPT 슬라이드 + 아이템 추출
    ppt_compare.py    — PPT 슬라이드 diff
    normalizer.py   — key 정규화 + rapidfuzz 유사도 매칭
    joiner.py       — Excel 전용 JOIN
    checker.py      — 타입별 정합성 검사 dispatcher
    file_access.py  — 파일 경로 검사 + tkinter 파일 선택창
  api/
    files.py        — /api/files (CRUD + inspect + pick + parser_config 등록)
    query.py        — /api/query/join, /api/query/export
    check.py        — /api/check (mode=excel|word|ppt)
  models/schemas.py — Pydantic 요청/응답 스키마

frontend/src/
  App.tsx                   — 탭 레이아웃 (파일관리 / JOIN쿼리 / 정합성검사)
  api/client.ts             — axios API 클라이언트 + 타입 정의
  components/
    FileManager.tsx         — 타입별 등록/목록/미리보기
    JoinQuery.tsx           — Excel-only JOIN UI
    ConsistencyCheck.tsx    — mode 기반 비교 결과 UI
    ResultTable.tsx         — 검색/정렬/페이지네이션 범용 결과 테이블

launcher.py                 — .exe 진입점: uvicorn 스레드 + 브라우저 자동 오픈
office_data_joiner.spec     — PyInstaller 패키징 설정
setup.bat / setup.sh        — 개발 환경 구성
build.bat / build.sh        — 프론트엔드 빌드 + PyInstaller
tests/                      — pytest 단위 테스트
scripts/
  generate_demo_cases.py    — Excel/Word/PPT 데모 문서 생성
  run_demo_checks.py        — 데모 문서 기반 수동 검증 스크립트
  run_perf_checks.py        — 비교 성능 측정 스크립트
ARCHITECTURE.md             — 비교 아키텍처 설계 문서
```

---

## 개발 환경 설정

```bash
# Python 3.10+ 필수
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt

# 테스트
pytest

# 백엔드 개발 서버 (포트 8765 고정)
python -m uvicorn backend.main:app --port 8765 --reload

# 프론트엔드 개발 서버 (포트 5173)
cd frontend && npm ci && npm run dev
# 브라우저: http://localhost:5173
```

---

## Windows .exe 빌드

```bat
setup.bat   # 최초 1회: venv + pip install + npm ci
build.bat   # frontend build + PyInstaller
# 결과: dist\office-data-joiner\office-data-joiner.exe
```

---

## 핵심 설계 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 포트 | 8765 | 8000/8080 충돌 방지 |
| key 정규화 | 앞뒤 공백·기호 제거 → 소문자 → rapidfuzz ratio ≥ 85 | `SIMILARITY_THRESHOLD` in `normalizer.py` |
| Excel 등록 | `parser_config` 저장 | 헤더가 첫 행이 아니어도 표를 재현 가능 |
| JOIN 방식 | Excel-only + parser_config 기반 표 추출 | Word/PPT는 diff 전용 |
| Word 비교 | 문단 + 표 행 블록 diff | 수정본 비교 목적 |
| PPT 비교 | 슬라이드 정렬 + item diff | 슬라이드 추가/삭제와 내부 변경 파악 |
| SQLite 위치 | `~/.office-data-joiner/data.db` | 사용자 홈, 권한 문제 없음 |
| 파일 데이터 저장 | 경로·메타만 저장, 쿼리 시 매번 파싱 | 대용량 파일 DB 저장 불필요 |
| uvicorn frozen 모드 | `uvicorn.run(app_obj, ...)` (객체 직접 전달) | PyInstaller에서 문자열 import 불가 |

---

## Windows / PyInstaller 주의사항

- `launcher.py` 최상단: `multiprocessing.freeze_support()` 필수 (Windows .exe)
- `launcher.py` 최상단: `asyncio.WindowsSelectorEventLoopPolicy()` (Python 3.10+ Windows)
- frozen 모드에서는 `from backend.main import app` 후 `uvicorn.run(app, ...)` 사용
- `office_data_joiner.spec`의 `hiddenimports`에 uvicorn/pandas/multiprocessing 계열 명시
- tkinter 파일 선택창: `root.lift()` + `root.focus_force()` 없으면 최전면 미보장

---

## 주요 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/files` | 등록 파일 목록 |
| POST | `/api/files` | 파일 단건 등록 |
| DELETE | `/api/files/{id}` | 파일 등록 해제 |
| POST | `/api/files/inspect` | 경로로 파일 스키마 조회 |
| POST | `/api/files/pick` | OS 파일 선택창 열기 |
| POST | `/api/files/pick-folder` | OS 폴더 선택창 열기 |
| POST | `/api/files/scan-folder` | 폴더 재귀 스캔 (지원 파일 목록 + 스키마) |
| POST | `/api/files/bulk-register` | 여러 파일 일괄 등록 |
| GET | `/api/files/{id}/schema` | 파일 컬럼·샘플 조회 |
| POST | `/api/query/join` | Excel-only JOIN 쿼리 실행 |
| POST | `/api/query/export` | JOIN 결과 Excel 다운로드 |
| POST | `/api/check` | 타입별 정합성 검사 실행 (`excel`/`word`/`ppt`) |

---

## 새 기능 추가 체크리스트

1. `backend/core/` — 비즈니스 로직
2. `backend/models/schemas.py` — Pydantic 스키마
3. `backend/api/` — FastAPI 라우터
4. `backend/main.py` — 라우터 등록
5. `frontend/src/api/client.ts` — axios 함수 + 타입
6. `frontend/src/components/` — React 컴포넌트
7. `tests/` — pytest 테스트
8. `office_data_joiner.spec` — 새 패키지 있으면 `hiddenimports` 추가

---

## 테스트 패턴

- Excel offset header / parser_config 테스트: `tests/test_file_access.py`
- Excel/Word/PPT 비교 엔진 테스트: `tests/test_checker.py`
- JOIN Excel-only 제한 테스트: `tests/test_query.py`
- 성능/데모 수동 검증:

```bash
venv/bin/python scripts/run_demo_checks.py
venv/bin/python scripts/run_perf_checks.py
```

---

## 변경 시 함께 수정해야 하는 파일 쌍

| 변경 내용 | 함께 수정 |
|-----------|-----------|
| 새 API 응답 필드 추가 | `schemas.py` ↔ `client.ts` |
| Excel inspect/등록 구조 변경 | `excel_analysis.py` ↔ `files.py` ↔ `FileManager.tsx` / `FolderScanner.tsx` |
| 비교 결과 구조 변경 | `checker.py` / `*_compare.py` ↔ `ConsistencyCheck.tsx` |
| 새 Python 패키지 추가 | `requirements.txt` ↔ `office_data_joiner.spec` (`hiddenimports`) |
| 정규화 threshold 변경 | `normalizer.py` (`SIMILARITY_THRESHOLD`) → README 수치 반영 |
