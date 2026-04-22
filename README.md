# Office Data Joiner

Excel / Word / PPT 파일들을 마치 데이터베이스처럼 관리하는 도구입니다.  
여러 파일에 공통 key 컬럼(예: "과제명")이 있을 때 JOIN, 정합성 검사를 수행합니다.

---

## 1. 개요

- **파일 등록**: `.xlsx`, `.xls`, `.docx`, `.pptx` 파일을 등록하고 key 컬럼을 지정합니다.
- **JOIN 쿼리**: 등록된 여러 파일을 key 기준으로 LEFT / OUTER / INNER JOIN합니다.
- **정합성 검사**: 파일 간 동일 key에 대해 컬럼 값이 일치하는지 검사합니다.
- **비개발자 실행**: `.exe` 더블클릭으로 서버 시작 + 브라우저 자동 오픈.

---

## 2. 개발 환경 설정

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

## 3. 개발 서버 실행

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

## 4. .exe 빌드 방법

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

---

## 5. 기능 설명

### 파일 관리

- **파일 등록**: 파일 경로를 직접 입력하거나, 백엔드가 여는 **OS 파일 선택창**으로 실제 파일 경로를 가져와 등록합니다.
  - 등록 전 컬럼 목록, 샘플 데이터, 추천 key 컬럼을 먼저 확인할 수 있습니다.
  - key 컬럼 자동 추천: 컬럼명에 `과제`, `id`, `번호`, `name` 등 포함 시 우선 추천
- **파일 목록**: 등록된 파일의 이름, 형식, key 컬럼, 컬럼 수 확인
- **미리보기**: 파일 행 클릭 시 컬럼 목록 + 샘플 데이터(최대 5행) 모달 표시
- **삭제**: 등록 해제 (원본 파일은 삭제되지 않음)

### JOIN 쿼리

- 파일 체크박스로 JOIN 대상 선택
- 각 파일에서 가져올 컬럼 선택 (key 컬럼은 자동 포함)
- JOIN 방식 선택: `OUTER` (전체) / `LEFT` (사용자가 선택한 기준 파일) / `INNER` (교집합)
- **미리보기**: 결과 테이블 표시 (정렬, 검색, 페이지네이션 지원)
- **Excel 다운로드**: 결과를 `.xlsx`로 저장

### 정합성 검사

- 2개 이상 파일 선택 후 "검사 실행"
- key 정규화 후 동일 key에 대해 유사 컬럼명 그룹별 값 비교
- duplicate key 규칙:
  - 같은 파일에서 동일 normalized key가 여러 행으로 존재해도, 같은 column group의 값 집합이 동일하면 허용합니다.
  - 같은 파일 안에서 값 집합이 갈라지면 `conflict`로 처리합니다.
- 결과:
  - **conflict** (빨강): 값이 서로 다름
  - **warning** (노랑): 값이 비어 있거나, 유사하지만 완전히 동일하지 않음
- 원본 key 변형 값도 함께 표시

### 검증

```bash
source venv/bin/activate
pytest
cd frontend && npm run build
```

---

## 6. 기술 스택

| 구분 | 기술 |
|------|------|
| 백엔드 | Python 3.10+, FastAPI, uvicorn |
| 데이터 처리 | pandas, openpyxl, xlrd, python-docx, python-pptx |
| 유사도 매칭 | rapidfuzz (threshold: 85) |
| 데이터베이스 | SQLite (`~/.office-data-joiner/data.db`) |
| 프론트엔드 | React 18, TypeScript, Vite, Tailwind CSS |
| HTTP 클라이언트 | axios |
| 패키징 | PyInstaller (--onedir) |

---

## 7. Windows 사용 시 주의사항

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

---

## 8. 주의사항

- 포트 **8765** 고정 사용 (일반적인 8000/8080 충돌 방지)
- 파일 데이터는 서버에 저장되지 않으며, 메타데이터(경로, key 컬럼 등)만 SQLite에 저장됩니다.
- 파일 경로가 변경되거나 삭제된 경우 해당 파일을 다시 등록해야 합니다.
- Windows 경로(`C:\Users\...`) 및 한글 파일명 모두 지원합니다.

---

## 9. 트러블슈팅

| 증상 | 해결 방법 |
|------|-----------|
| `.exe` 실행 후 브라우저가 열리지 않음 | 콘솔 창 오류 메시지 확인 후 `http://127.0.0.1:8765` 직접 접속 |
| "포트가 이미 사용 중" 오류 | 작업 관리자에서 8765 포트 프로세스 종료 후 재실행 |
| 파일 선택창이 뜨지 않음 | 경로 직접 입력 후 "경로 검사" 버튼 사용 |
| 한글 파일명 깨짐 | Python 3.10+, Windows 10 이상에서만 지원 |
| `setup.bat` Python 버전 오류 | Python 3.10 이상 설치 후 재실행 |
| PyInstaller 빌드 실패 | `setup.bat` 먼저 실행 후 `build.bat` 실행 |
