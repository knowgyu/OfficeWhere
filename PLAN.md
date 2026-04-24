# OfficeWhere PLAN

## 제품 방향

OfficeWhere는 업무·수업·연구 과정에서 흩어진 Office 문서를 파일 내용 기준으로 찾고, 수정본 차이를 확인하고, Excel 데이터를 통합하기 위한 로컬 데스크톱 앱이다.

핵심 원칙:

1. 사용자는 파일 시스템의 원본 문서를 그대로 유지한다.
2. 앱은 원본 파일을 복사하지 않고 경로·메타데이터·검색 색인만 저장한다.
3. Excel은 구조화 데이터 통합, Word/PPT는 수정본 비교, Text/Markdown은 검색에 집중한다.
4. 긴 작업은 진행 상태와 취소 동선을 제공한다.
5. Windows 비개발자도 Release zip 압축 해제 후 바로 실행할 수 있어야 한다.

## 현재 구현 범위

### 라이브러리 / 색인

- 대상 폴더 등록 및 삭제
- 지원 파일 자동 등록 / 재스캔
- mtime 기반 증분 재색인
- 재스캔 진행 상태 API와 전역 UI
  - 단계, 진행률, 현재 파일, 처리/등록/갱신/변경 없음/실패 수
  - 하단 중앙 스피너와 정지 버튼
  - 탭 이동 후에도 실행 상태 유지
- 재스캔 취소 API
- 첫 등록/재스캔 결과 문구 개선
  - 신규/갱신/등록 확인/변경 없음으로 표현
  - 실패처럼 보이는 “건너뜀” 중심 표현 제거
- 자동 재스캔 주기 입력
  - `반복 주기(시간)` 라벨
  - 1 이상 정수로 정규화
  - 1 미만 입력 시 사용자 경고

### 문서 검색

- SQLite FTS5 기반 파일명/경로/내용 검색
- 검색 결과 위치 표시
  - Excel: 행/열
  - Word: 단락, 표/행/열
  - PPT: 슬라이드
  - Text/Markdown: 단락/줄
- 검색 결과 클릭 시 OS 기본 앱으로 원본 열기
- 문서 형식 필터
  - Word/DOCX, PPT/PPTX, Markdown/MD, Text/TXT 다중 선택
  - 아무것도 선택하지 않으면 전체 검색
- 사용자가 누르고 싶어지는 별도 “검색 갱신” 주 동선 제거

### Excel 통합

- Excel 파일만 JOIN 대상 허용
- Excel 표 후보 영역 탐지와 `parser_config` 저장
- key 컬럼 기준 LEFT / OUTER / INNER JOIN
- 컬럼 선택, 미리보기, Excel 다운로드

### 버전 묶음 / 정합성 검사

- 파일명과 타입 기반 유사 파일 묶음 제안
- Excel 다중 파일 정합성 검사
  - `value_conflict`, `missing_key`, `missing_column`
- Word 2개 파일 문단/표 행 diff
- PPT 2개 파일 슬라이드/아이템 diff

### 데스크톱 / 배포

- Electron shell이 Python/FastAPI 백엔드를 child process로 실행
- 런타임 backend port 주입
- Electron preload bridge로 파일/폴더 선택 제공
- PyInstaller backend executable + Electron Windows zip 빌드
- GitHub Actions 태그 기반 Windows Release asset 생성

## 최근 변경 요약

### 2026-04-24 / 2026-04-25: 재스캔 UX와 검색 필터 개선

- 폴더 수만 보이는 상태에서 벗어나 파일 처리 단계와 진행률을 표시하도록 개선했다.
- 변경 파일이 거의 없을 때도 모든 파일을 무겁게 재분석하지 않도록 재스캔 경로를 증분 처리 중심으로 조정했다.
- 재스캔을 전역 상태로 관리해 설정 탭을 벗어나도 버튼 상태와 하단 진행 표시가 유지된다.
- 취소 요청 API와 UI 정지 버튼을 추가했다.
- 폴더 선택 후 대상 추가 버튼에 주의를 끄는 동적 강조 효과를 추가했다.
- 검색 탭의 필터를 문서 형식 다중 선택으로 바꾸고, 불필요한 주 검색 갱신 버튼을 제거했다.

### 2026-04-24: Electron 배포 경로 정리

- Electron을 기본 데스크톱 shell로 정했다.
- 기존 pywebview/PyInstaller launcher는 fallback 빌드 경로로 유지한다.
- GitHub Actions에서 Windows zip과 SHA256 파일을 릴리스 asset으로 올린다.

### 2026-04-24: 비교 아키텍처 분리

- Excel JOIN과 파일 비교 파이프라인을 분리했다.
- Word/PPT는 key 기반 표 모델이 아니라 문서 diff 엔진으로 처리한다.
- 등록 시 파일 타입별 parser 설정을 저장하고 실행 시 재사용한다.

## 후속 개선 후보

- 파일 시스템 watcher 또는 색인 캐시를 추가해 폴더 순회 자체를 더 줄이기
- 재스캔 취소 시 “취소로 처리하지 않은 파일 수”를 별도 집계
- 실제 사용자 문서로 Word/PPT diff 품질 UAT
- Windows fresh machine에서 setup/build/release zip smoke test 반복
- 다국어 UI, 테마, 튜토리얼 같은 제품 완성도 개선

## 검증 기준

릴리스 전 최소 검증:

```bash
./venv/bin/python -m pytest -q
cd frontend && npm run build
cd frontend && npm run build:electron
./frontend/node_modules/.bin/tsc --noEmit --pretty false --project frontend/tsconfig.json
```

선택 검증:

```bash
./venv/bin/python scripts/run_demo_checks.py
./venv/bin/python scripts/run_perf_checks.py
```

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 백엔드 | Python 3.10+, FastAPI, uvicorn |
| 데이터 처리 | pandas, openpyxl, xlrd, python-docx, python-pptx |
| 검색 | SQLite FTS5 |
| 저장소 | SQLite (`~/.officewhere/data.db`) |
| 프론트엔드 | React 18, TypeScript, Vite, Tailwind CSS |
| 데스크톱 | Electron, preload bridge |
| 패키징 | PyInstaller backend + electron-builder zip |
