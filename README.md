# Office Data Joiner

Excel / Word / PPT 파일들을 마치 데이터베이스처럼 관리하는 도구입니다.  
다만 기능은 파일 타입별로 다르게 동작합니다.

- **Excel**: 표 영역을 추출해 Excel 통합 / 정합성 검사
- **Word**: 문단 + 표 행 기준 diff
- **PowerPoint**: 슬라이드 추가/삭제 + 슬라이드 내부 변경 diff

---

## 1. 이런 상황에 씁니다

### 시나리오 A — 파일 내용으로 문서 찾기

> PPT가 70개 있는데, 6개월 전에 작성한 제안서에 "클라우드 마이그레이션 비용 추정" 내용이 있었던 것 같은데 어느 파일인지 기억이 안 남.

**문서 검색** 탭에서 `클라우드 마이그레이션 비용` 입력 → 결과:
```
📄 2024_인프라제안서_v2.pptx
  슬라이드 14  ·  "클라우드 마이그레이션 예상 비용: 연 1.2억..."

📄 IT전략보고서_최종.pptx
  슬라이드 8   ·  "클라우드 전환에 따른 초기 비용 분석..."
```
파일명·슬라이드 번호까지 즉시 확인하고, 결과를 클릭해 원본 파일을 바로 엽니다.

---

### 시나리오 B — 같은 문서 수정본 간 변경 찾기

> 지난주 Word 초안과 오늘 수정본이 있는데, 본문에 어떤 내용이 추가됐고 표 안의 승인 상태가 어떻게 바뀌었는지 한 번에 보고 싶음.

대상 폴더를 설정해두면 앱이 유사한 Word 버전 묶음을 제안 → **버전 묶음 / 정합성**에서 최신 2개 비교:
```
[REPLACE] paragraph:2
  before: 본 문서는 1차 초안이다.
  after : 본 문서는 2차 수정본이다.

[REPLACE] table:1/row:3
  before: 승인 | 대기
  after : 승인 | 완료
```
수정본에서 달라진 블록만 빠르게 확인.

---

### 시나리오 C — 여러 팀 Excel 취합

> 10개 팀에서 같은 양식 Excel을 제출받음. 복사·붙여넣기로 통합하다 행이 빠지거나 중복됨.

대상 폴더 자동 등록 → **Excel 통합**에서 Excel만 선택 → 통합 Excel 다운로드.

---

## 2. 기능 개요

- **설정 / 라이브러리**: 검색·검사 대상 폴더를 지정하고 `.xlsx`, `.xls`, `.docx`, `.pptx` 파일을 자동 등록/색인합니다.
  - Excel은 표 후보 영역과 key 컬럼을 선택합니다.
  - Word/PPT는 key 없이 비교 전용으로 등록합니다.
- **문서 검색**: 등록된 모든 파일의 파일명·경로·내용을 검색합니다. 슬라이드 번호, 행/열 위치까지 표시하고 원본 파일을 바로 엽니다.
- **Excel 통합**: 등록된 **Excel 파일만** key 기준으로 LEFT / OUTER / INNER 방식으로 합칩니다.
- **버전 묶음 / 정합성**:
  - 파일명+타입 기반으로 유사/버전 파일 묶음을 자동 제안
  - Excel: key/value/column diff
  - Word: 문단/표 블록 diff
  - PPT: 슬라이드 diff
- **비개발자 실행**: `.exe` 더블클릭으로 서버 시작 + 브라우저 자동 오픈.

---

## 3. 개발 환경 설정

**Python 3.10 이상 필수.**

### Windows

```bat
setup.bat
```

### macOS / Linux

```bash
chmod +x setup.sh
./setup.sh
```

설정 후 가상환경 활성화:

```bash
# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

---

## 4. 개발 서버 실행

### 백엔드 (FastAPI)

```bash
python -m uvicorn backend.main:app --port 8765 --reload
```

### 프론트엔드 (React + Vite)

```bash
cd frontend
npm ci
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

---

## 5. .exe 빌드 방법

### Windows

```bat
build.bat
```

### macOS / Linux

```bash
chmod +x build.sh
./build.sh
```

빌드 결과물: `dist/office-data-joiner/office-data-joiner.exe` (Windows) 또는 `dist/office-data-joiner/office-data-joiner` (macOS/Linux)

> **참고**: 빌드 전 `setup.bat` / `setup.sh`로 가상환경을 먼저 구성해야 합니다.  
> 프론트엔드 빌드(`frontend/dist`)도 자동으로 포함됩니다.
> 기존 `dist/office-data-joiner` 산출물이 있어도 `build.bat` / `build.sh`를 다시 실행하면 덮어써서 재빌드합니다.

### GitHub Release 자동 빌드

`.github/workflows/release.yml`은 Windows runner에서 실행파일을 빌드한 뒤, `dist/office-data-joiner/` 전체를 zip으로 묶어 Release asset으로 올립니다.

- 태그 릴리스: `git tag v0.1.0 && git push origin v0.1.0`
- 수동 실행: GitHub Actions → `Build Windows Release` → `Run workflow`
  - `release_tag` 비움: Actions artifact만 생성
  - `release_tag` 입력: 해당 태그의 GitHub Release를 생성하거나 갱신하고 zip + SHA256 파일 업로드

생성 자산:

- `office-data-joiner-<version>-windows-x64.zip`
- `office-data-joiner-<version>-windows-x64.sha256.txt`

최종 사용자 사용법:

1. GitHub Releases에서 zip 파일 다운로드
2. 원하는 폴더에 압축 해제
3. 압축 해제한 폴더 안의 `office-data-joiner.exe` 실행

---

## 6. 기능 설명

### 설정 / 라이브러리

- **대상 폴더**: 검색과 정합성 검사에 사용할 폴더를 저장합니다.
- **자동 등록 / 재스캔**: 대상 폴더의 지원 파일을 등록하고 검색 색인을 생성합니다. 변경되지 않은 파일은 건너뜁니다.
- **개별 파일 추가**: 대상 폴더 밖의 파일은 경로 입력이나 **OS 파일 선택창**으로 등록합니다.
  - Excel은 등록 전 **표 후보 영역(parser_config)**, 컬럼 목록, 샘플 데이터, 추천 key 컬럼을 먼저 확인할 수 있습니다.
  - Excel 표는 첫 행이 아니라 `C3` 같은 위치에서 시작해도 탐지합니다.
  - Word/PPT는 key 없이 등록되며, 비교 시 문서 diff 엔진을 사용합니다.
- **파일 목록**: 등록된 파일의 이름, 형식, key 컬럼, 컬럼 수 확인
- **미리보기**:
  - Excel: 선택된 표 영역의 컬럼 + 샘플 행
  - Word: 문단/표 블록 미리보기
  - PPT: 슬라이드 제목/항목 미리보기
- **삭제**: 등록 해제 (원본 파일은 삭제되지 않음)

### Excel 통합

- **Excel 파일만** 통합 대상 선택 가능
- 각 파일에서 가져올 컬럼 선택 (key 컬럼은 자동 포함)
- 통합 방식 선택: `OUTER` (전체) / `LEFT` (사용자가 선택한 기준 파일) / `INNER` (교집합)
- 등록 시 저장된 `parser_config` 기준으로 표를 다시 읽어 통합
- **미리보기**: 결과 테이블 표시 (정렬, 검색, 페이지네이션 지원)
- **Excel 다운로드**: 결과를 `.xlsx`로 저장

### 버전 묶음 / 정합성 검사

- 파일명에서 날짜, 버전, `final`, `최종`, `수정본` 같은 토큰을 제거해 같은 문서 후보를 묶습니다.
- Word/PPT는 묶음에서 최신 2개 파일 비교를 기본 액션으로 제안합니다.
- Excel은 묶음 전체를 대상으로 정합성 검사하거나 Excel 통합으로 이어질 수 있습니다.
- 내용 유사도 기반 묶음은 후속 개선 항목입니다.

- **Excel**
  - 다중 파일 선택 가능
  - `value_conflict`, `missing_key`, `missing_column`을 표시
  - key 정규화 후 같은 key의 셀 값 차이와 컬럼 추가/누락을 함께 확인
- **Word**
  - 정확히 2개 파일 비교
  - 문단 + 표 행을 순서 보존 블록으로 추출해 `insert/delete/replace` diff 표시
- **PowerPoint**
  - 정확히 2개 파일 비교
  - 슬라이드 추가/삭제와 매칭된 슬라이드 내부 항목 변경 표시

### 파일 검색

- 등록된 모든 파일의 파일명/경로를 부분 검색하고, 내용을 키워드로 전문 검색합니다. (SQLite FTS5, 한글 지원)
- 검색 결과에 **파일명 + 위치** 표시:
  - PPT: `슬라이드 14`
  - Word: `단락 3` / `표 1, 행 2, 열 1`
  - Excel: `행 5, 열 담당자`
- 키워드 하이라이트, 파일별 그룹핑
- 검색 결과 클릭 시 OS 기본 앱으로 원본 파일 열기
- 인덱싱 스케줄: 수동 / N시간마다 / 매일 HH:MM 중 선택
- 변경된 파일만 재인덱싱 (mtime 기반 증분)
- **성능**: 검색 응답 0.5초 미만. 초기 인덱싱은 파일당 0.5~1.5초 (1회).

### 검증

```bash
source venv/bin/activate
pytest
cd frontend && npm run build
python scripts/run_demo_checks.py
python scripts/run_perf_checks.py
```

### 실사용 예제 / 성능 스크립트

- 설계 문서: `ARCHITECTURE.md`
- 데모 문서 생성: `python scripts/generate_demo_cases.py`
- 데모 비교 실행: `python scripts/run_demo_checks.py`
- 성능 측정: `python scripts/run_perf_checks.py`
- 생성 결과물: `examples/demo_cases/`

---

## 7. 기술 스택

| 구분 | 기술 |
|------|------|
| 백엔드 | Python 3.10+, FastAPI, uvicorn |
| 데이터 처리 | pandas, openpyxl, xlrd, python-docx, python-pptx |
| 유사도 매칭 | rapidfuzz (threshold: 85) |
| 전문 검색 | SQLite FTS5 (unicode61 tokenizer) |
| 데이터베이스 | SQLite (`~/.office-data-joiner/data.db`) |
| 프론트엔드 | React 18, TypeScript, Vite, Tailwind CSS |
| HTTP 클라이언트 | axios |
| 패키징 | PyInstaller (--onedir) |

---

## 8. 리소스 사용량

| 상태 | 메모리 | CPU |
|------|--------|-----|
| 대기 중 (미사용) | ~80 MB | 0% |
| 검색 중 | ~85 MB | <5% (순간) |
| 인덱싱 중 (PPT 파싱) | ~150~200 MB (피크) | 1코어 50~100% |

- DB 크기: 파일 70개(PPT 40슬라이드 기준) 기준 약 5~10 MB
- 인덱싱은 백그라운드 스케줄러가 처리하며, 변경된 파일만 재처리합니다.

---

## 9. Windows 사용 시 주의사항

### 파일 경로 입력

파일 경로를 직접 입력할 때는 Windows 탐색기에서 **주소 표시줄 경로를 그대로 붙여넣기** 하면 됩니다.

```
예) C:\Users\홍길동\Documents\과제현황.xlsx
```

또는 **"파일 찾기" 버튼**을 클릭하면 OS 파일 선택창이 열립니다 (경로 직접 입력 불필요).

### 포트 충돌

포트 `8765`가 이미 사용 중이면 서버가 시작되지 않습니다. 작업 관리자에서 해당 포트를 사용하는 프로세스를 종료하거나, `launcher.py`의 `PORT` 값을 변경하세요.

### 앱 종료

`.exe` 실행 시 콘솔 창이 열립니다. 앱을 종료하려면 **이 콘솔 창을 닫으세요**. 브라우저 탭만 닫으면 서버가 계속 실행됩니다.

### Python 버전

`setup.bat`은 Python 3.10 미만이면 오류를 출력하고 종료합니다. [python.org](https://python.org)에서 3.10 이상을 설치하세요.

### SmartScreen 경고

GitHub Release에서 받은 `.exe`는 코드 서명이 없으므로 Windows SmartScreen 경고가 뜰 수 있습니다. 내부 배포용이라면 일반적인 현상이며, 조직 보안 정책상 실행이 막히는 환경은 별도 코드 서명이 필요합니다.

---

## 10. 주의사항

- 포트 **8765** 고정 사용 (일반적인 8000/8080 충돌 방지)
- 파일 데이터는 서버에 저장되지 않으며, 메타데이터(경로, key 컬럼, `parser_config` 등)만 SQLite에 저장됩니다.
- 파일 경로가 변경되거나 삭제된 경우 해당 파일을 다시 등록해야 합니다.
- Windows 경로(`C:\Users\...`) 및 한글 파일명 모두 지원합니다.
- Word/PPT JOIN은 지원하지 않습니다. Word/PPT는 정합성 검사와 검색 전용입니다.

---

## 11. 트러블슈팅

| 증상 | 해결 방법 |
|------|-----------|
| `.exe` 실행 후 브라우저가 열리지 않음 | 콘솔 창 오류 메시지 확인 후 `http://127.0.0.1:8765` 직접 접속 |
| "포트가 이미 사용 중" 오류 | 작업 관리자에서 8765 포트 프로세스 종료 후 재실행 |
| 파일 선택창이 뜨지 않음 | 경로 직접 입력 후 "경로 검사" 버튼 사용 |
| 한글 파일명 깨짐 | Python 3.10+, Windows 10 이상에서만 지원 |
| `setup.bat` Python 버전 오류 | Python 3.10 이상 설치 후 재실행 |
| PyInstaller 빌드 실패 | `setup.bat` 먼저 실행 후 `build.bat` 실행 |
| GitHub Release zip을 풀었는데 실행이 막힘 | SmartScreen 또는 조직 보안 정책 확인, 필요하면 코드 서명 적용 |
