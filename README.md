# excel-db

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
npm install
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

빌드 결과물: `dist/excel-db/excel-db.exe` (Windows) 또는 `dist/excel-db/excel-db` (macOS/Linux)

> **참고**: 빌드 전 `setup.bat` / `setup.sh`로 가상환경을 먼저 구성해야 합니다.  
> 프론트엔드 빌드(`frontend/dist`)도 자동으로 포함됩니다.

---

## 5. 기능 설명

### 파일 관리

- **파일 등록**: 파일 경로와 key 컬럼명을 입력하여 등록합니다.
  - key 컬럼 자동 추천: 컬럼명에 `과제`, `id`, `번호`, `name` 등 포함 시 우선 추천
- **파일 목록**: 등록된 파일의 이름, 형식, key 컬럼, 컬럼 수 확인
- **미리보기**: 파일 행 클릭 시 컬럼 목록 + 샘플 데이터(최대 5행) 모달 표시
- **삭제**: 등록 해제 (원본 파일은 삭제되지 않음)

### JOIN 쿼리

- 파일 체크박스로 JOIN 대상 선택
- 각 파일에서 가져올 컬럼 선택 (key 컬럼은 자동 포함)
- JOIN 방식 선택: `OUTER` (전체) / `LEFT` (첫 번째 파일 기준) / `INNER` (교집합)
- **미리보기**: 결과 테이블 표시 (정렬, 검색, 페이지네이션 지원)
- **Excel 다운로드**: 결과를 `.xlsx`로 저장

### 정합성 검사

- 2개 이상 파일 선택 후 "검사 실행"
- key 정규화 후 동일 key에 대해 유사 컬럼명 그룹별 값 비교
- 결과:
  - **conflict** (빨강): 값이 서로 다름
  - **warning** (노랑): 값이 유사하지만 완전히 동일하지 않음
- 원본 key 변형 값도 함께 표시

---

## 6. 기술 스택

| 구분 | 기술 |
|------|------|
| 백엔드 | Python 3.10+, FastAPI, uvicorn |
| 데이터 처리 | pandas, openpyxl, xlrd, python-docx, python-pptx |
| 유사도 매칭 | rapidfuzz (threshold: 85) |
| 데이터베이스 | SQLite (`~/.excel-db/data.db`) |
| 프론트엔드 | React 18, TypeScript, Vite, Tailwind CSS |
| HTTP 클라이언트 | axios |
| 패키징 | PyInstaller (--onedir) |

---

## 7. 주의사항

- 포트 **8765** 고정 사용 (일반적인 8000/8080 충돌 방지)
- 파일 데이터는 서버에 저장되지 않으며, 메타데이터(경로, key 컬럼 등)만 SQLite에 저장됩니다.
- 파일 경로가 변경되거나 삭제된 경우 해당 파일을 다시 등록해야 합니다.
- Windows 경로(`C:\Users\...`) 및 한글 파일명 모두 지원합니다.
