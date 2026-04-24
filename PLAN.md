# Office Data Joiner 프로젝트 계획서

## 프로젝트 개요

여러 Excel/Word/PPT 파일을 마치 데이터베이스처럼 관리하는 도구.
"과제명" 같은 공통 key 컬럼을 기준으로 여러 파일을 JOIN하거나, 파일 간 데이터 정합성을 검사할 수 있다.
비개발자도 더블클릭 한 번으로 실행할 수 있는 독립 실행형 프로그램(.exe)으로 배포한다.

---

## 배경 및 Pain Point

1. **다중 파일 JOIN 문제**
   - 과제 관련 Excel 파일이 여러 개 존재
   - 파일마다 "과제명"은 같으나 서로 다른 컬럼을 가짐
   - SQL JOIN처럼 과제명을 key로 여러 파일의 데이터를 합쳐 보고 싶음

2. **정합성 불일치 문제**
   - 같은 과제명, 유사한 컬럼명인데 셀 값이 서로 다른 경우 발생
   - 현재는 이를 수동으로 확인해야 해서 번거롭고 실수 가능성 높음
   - Excel뿐 아니라 Word, PPT 파일도 동일한 문제 존재

3. **key 값 표기 비일관성 문제**
   - 같은 과제임에도 "스마트팜 과제", "- 스마트팜과제", " 스마트팜 과제 " 처럼 표기가 다름
   - 공백, 앞뒤 기호(-), 연속 공백 등으로 인해 단순 문자열 비교로는 같은 항목임을 알 수 없음

---

## 목표 (Goals)

| # | 목표 | 우선순위 |
|---|------|---------|
| G1 | 여러 Excel 파일을 과제명 key 기준으로 JOIN하여 통합 뷰 제공 | 최우선 |
| G2 | 파일 간 동일 key + 유사 컬럼 값의 불일치를 자동 감지하고 경보 | 최우선 |
| G3 | key 값 정규화(공백, 기호 제거)와 유사도 매칭으로 표기 차이 극복 | 최우선 |
| G4 | 비개발자가 더블클릭만으로 실행 가능한 .exe 배포 | 최우선 |
| G5 | Word, PPT 파일도 테이블 데이터 추출 및 검사 지원 | 중요 |
| G6 | JOIN 결과를 Excel 파일로 다운로드 | 중요 |
| G7 | 분산된 파일(다른 폴더) 모두 등록 가능 | 중요 |
| G8 | 컬럼명 유사도 자동 매칭 (rapidfuzz) | 중요 |

---

## 기능 명세

### 1. 파일 관리 (File Manager)
- [ ] 파일 등록: 경로 직접 입력 or 파일 탐색기에서 선택
- [ ] 지원 형식: `.xlsx`, `.xls`, `.docx`, `.pptx`
- [ ] 등록 시 key 컬럼 지정 (자동 추천: '과제', 'key', 'id', '번호' 포함 컬럼)
- [ ] 등록된 파일 목록 표시 (파일명, 타입, key 컬럼, 컬럼 수)
- [ ] 파일 클릭 시 컬럼 목록 + 샘플 데이터 미리보기
- [ ] 파일 삭제 (목록에서 제거)
- [ ] 등록 정보 앱 재시작 후에도 유지 (SQLite)

### 2. JOIN 쿼리 (Join Query)
- [ ] 조인할 파일 선택 (체크박스)
- [ ] 각 파일에서 가져올 컬럼 선택
- [ ] JOIN 타입 선택: left / outer / inner
- [ ] 결과 미리보기 (테이블)
- [ ] 결과 Excel 다운로드

### 3. 정합성 검사 (Consistency Check)
- [ ] 검사할 파일 선택 (multi)
- [ ] key 정규화 규칙 적용 후 동일 key 그룹화
- [ ] 유사 컬럼명 자동 그룹화 (rapidfuzz, 유사도 ≥ 85%)
- [ ] 값이 다른 항목을 이슈로 표시
- [ ] severity 구분: `conflict` (값이 다름) / `warning` (값이 비어있거나 유사)
- [ ] 이슈 목록: key 원본값 변형들, 컬럼 그룹, 파일별 값 표시
- [ ] key 표기 변형 감지 (정규화 전 원본값도 함께 표시)

### 4. key 정규화 규칙
- [ ] 앞뒤 공백 제거
- [ ] 앞뒤 `-`, `_`, `.` 제거
- [ ] 내부 연속 공백 → 단일 공백으로 치환
- [ ] 소문자 변환 후 비교
- [ ] rapidfuzz.fuzz.ratio ≥ 85 이면 동일 key로 처리
- [ ] 컬럼명 유사도도 동일 threshold 적용

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | FastAPI, uvicorn |
| 데이터 처리 | pandas, openpyxl, xlrd |
| 문서 파싱 | python-docx, python-pptx |
| 유사도 매칭 | rapidfuzz |
| 데이터 저장 | SQLite (`~/.office-data-joiner/data.db`) |
| 프론트엔드 | React 18, TypeScript, Vite, Tailwind CSS |
| 패키징 | PyInstaller (--onedir, Windows .exe) |
| 포트 | 8765 (충돌 최소화) |

---

## 구현 계획 (Implementation Plan)

### Phase 1: 백엔드 코어
- [ ] 프로젝트 디렉토리 구조 생성
- [ ] `requirements.txt`, `requirements-dev.txt` 작성
- [ ] `backend/database.py` — SQLite 초기화, registered_files 테이블
- [ ] `backend/core/parser.py` — Excel/Word/PPT 파싱 → DataFrame
- [ ] `backend/core/normalizer.py` — key 정규화 + rapidfuzz 매칭
- [ ] `backend/core/joiner.py` — 다중 파일 JOIN 로직
- [ ] `backend/core/checker.py` — 정합성 검사 로직
- [ ] `backend/models/schemas.py` — Pydantic 스키마 정의
- [ ] `backend/api/files.py` — 파일 CRUD 엔드포인트
- [ ] `backend/api/query.py` — JOIN 쿼리 엔드포인트
- [ ] `backend/api/check.py` — 정합성 검사 엔드포인트
- [ ] `backend/main.py` — FastAPI 앱, static serve, 라우터 등록

### Phase 2: 프론트엔드
- [ ] `frontend/package.json`, `vite.config.ts`, `tsconfig.json` 설정
- [ ] `frontend/src/api/client.ts` — API 클라이언트
- [ ] `frontend/src/components/FileManager.tsx`
- [ ] `frontend/src/components/JoinQuery.tsx`
- [ ] `frontend/src/components/ConsistencyCheck.tsx`
- [ ] `frontend/src/components/ResultTable.tsx`
- [ ] `frontend/src/App.tsx` — 탭 레이아웃
- [ ] Tailwind CSS 설정

### Phase 3: 패키징 및 배포
- [ ] `launcher.py` — 서버 시작 + 브라우저 자동 오픈
- [ ] `office_data_joiner.spec` — PyInstaller spec (frontend/dist 포함)
- [ ] `setup.bat` / `setup.sh` — venv + pip install
- [ ] `build.bat` / `build.sh` — 프론트엔드 빌드 + PyInstaller
- [ ] `.gitignore` 작성
- [ ] `README.md` 작성 (한국어, 개발자용 + 사용자용)

### Phase 4: 검증
- [ ] 백엔드 단위 테스트 (normalizer, parser, checker)
- [ ] 샘플 Excel 파일로 JOIN 동작 확인
- [ ] 정합성 검사 이슈 감지 확인
- [ ] PyInstaller 빌드 후 .exe 실행 테스트

---

## 사용자 요구사항 원문 메모

> "엑셀파일을 잘 관리하게 만드는 프로젝트. 마치 DB처럼 '과제명' 등 unique한 key값이 있을 때, 각 파일별로 column이 다를 수 있음. 이 상황에서 join하고 필요한 데이터들을 가져올 수 있도록."

> "과제명은 동일하나 서로 다른 column을 가지고있는 것들이 있음. column들을 join하는 것처럼."

> "같은 과제명, 유사한 column명인데, 막상 해당 셀에 내용은 다른 경우가 있음. 이렇게 서로 정합성이 안 맞는 경우에 대해 alarm을 띄워주는 것."

> "excel뿐 아니라, 워드파일이나 ppt파일도 동일할 것 같음."

> "과제명 검사할 때, 스페이스바가 껴있다거나 맨 앞에 '-'가 있다거나 그렇게 내용이 거의 같음에도 문자열 자체는 다르게 나올 수 있음."

> "사용자가 비개발자이고, 그냥 쉽게 바로 프로그램처럼 바로 켜졌으면 함."

> "파일들이 특정 폴더에 모여있을 수도, 분산되어 있을 수도 있음."

> "유사한 column명 매칭은 자동으로 되었으면 함."

> "github에 올려둘건데, venv 설정부터 requirements까지 잘 작성되어야 하고, pyinstaller 명령어까지 있어야 바로 빌드하고 사용해볼 수 있어야 함."

> "사용자들은 비개발자이기에 python이나 library들은 설치되어있지 않다고 봐야 함."

---

## 현재 진행 상태

- [x] 요구사항 분석 완료
- [x] 기술 스택 결정
- [x] PLAN.md 작성
- [x] 전체 코드 구현 완료 (35+ 파일)
- [x] 정합성 검사 아키텍처 재설계 (2026-04-24)
  - [x] Excel JOIN 전용 파이프라인 분리
  - [x] Excel `parser_config` 저장 및 표 후보 영역 탐지
  - [x] Excel 정합성 검사: `value_conflict`, `missing_key`, `missing_column`
  - [x] Word 정합성 검사: 문단 + 표 행 블록 diff
  - [x] PowerPoint 정합성 검사: 슬라이드 추가/삭제 + 내부 항목 diff
  - [x] 정합성 검사 응답 `mode=excel|word|ppt` 기반으로 재구성
  - [x] JOIN Excel-only 제한
  - [x] 폴더 스캔 / 일괄 등록 / 파일 등록에 `parser_config` 반영
  - [x] 백엔드/프론트 검증: `venv/bin/pytest`, `npm run build` 통과
  - [x] 데모/성능 스크립트 추가 (`scripts/run_demo_checks.py`, `scripts/run_perf_checks.py`)
- [x] Windows 호환성 보완 (2026-04-22)
  - [x] `launcher.py`: frozen 모드 uvicorn 앱 객체 직접 전달
  - [x] `launcher.py`: `multiprocessing.freeze_support()` 추가
  - [x] `launcher.py`: `asyncio.WindowsSelectorEventLoopPolicy()` 추가 (Windows)
  - [x] `launcher.py`: 종료 안내 메시지 출력
  - [x] `office_data_joiner.spec`: deprecated `block_cipher` 제거, multiprocessing/encodings hidden imports 추가
  - [x] `backend/main.py`: deprecated `@app.on_event` → `lifespan` 방식으로 교체
  - [x] `backend/core/file_access.py`: tkinter 파일 선택창 최전면 보장 (`lift`, `focus_force`)
  - [x] `setup.bat`: Python 3.10+ 버전 체크 추가
  - [x] `README.md`: Windows 사용 안내 및 트러블슈팅 섹션 추가
  - [x] `CLAUDE.md`: CLI 에이전트용 프로젝트 가이드 최초 작성
- [ ] Windows 환경에서 setup.bat → build.bat → .exe 실행 테스트
- [ ] 실제 사용자 문서로 UAT (특히 Word/PPT 수정본 비교 품질 확인)

---

_최초 작성: 2026-04-21_  
_Windows 호환성 보완: 2026-04-22_  
_비교 아키텍처 재설계: 2026-04-24_
