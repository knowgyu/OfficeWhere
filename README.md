# OfficeWhere

OfficeWhere는 흩어져 있는 Excel, Word, PowerPoint, Markdown, 텍스트 문서를
한 곳에서 **검색, Excel 통합, 버전 관리**할 수 있는 데스크톱 도구입니다.

- 대상 폴더를 등록하면 문서를 자동 색인합니다.
- 파일명뿐 아니라 문서 본문까지 검색합니다.
- Excel은 행/열 위치, Word는 문단/표, PowerPoint는 슬라이드 단위로 결과를 보여줍니다.
- 원본 문서는 복사하거나 수정하지 않고 읽기만 합니다.

## 주요 기능

### 문서 검색

- 지원 대상: Excel, Word, PowerPoint, Markdown, 텍스트
- 검색 범위:
  - 파일명
  - 문서 본문
  - Excel 셀 내용
  - Word 문단/표
  - PowerPoint 슬라이드/표
- 결과 위치 예시:
  - `예산현황.xlsx · 예산현황 시트 · 12행 E열`
  - `보고서.pptx · 6번 슬라이드`
  - `계약서.docx · 문단/표 위치`

### Excel 통합

- 여러 Excel 파일을 공통 key 컬럼 기준으로 병합합니다.
- 지원 방식:
  - LEFT JOIN
  - OUTER JOIN
  - INNER JOIN
- 결과는 다시 `.xlsx`로 내보낼 수 있습니다.

### 버전 관리

- 비슷한 이름의 Office 문서를 자동으로 묶습니다.
- 같은 계열 문서의 변경점을 확인합니다.
- 지원 내용:
  - Excel: 셀 값 변경, 내용 추가/삭제, 관련 행/열 위치
  - Word: 문단/표 변경
  - PowerPoint: 슬라이드 추가/삭제, 슬라이드 내부 텍스트 변경

### 라이브러리 관리

- 자주 쓰는 자료 폴더를 등록합니다.
- 새 파일이 추가되면 증분 색인합니다.
- 네트워크 드라이브도 로컬 경로처럼 읽을 수 있으면 등록할 수 있습니다.

## 지원 파일

| 형식 | 검색 | 버전 관리 | Excel 통합 |
| --- | --- | --- | --- |
| `.xlsx`, `.xls` | 파일명 + 셀 내용 | key 컬럼 기준 값·내용 차이 | 지원 |
| `.docx` | 파일명 + 문단 + 표 | 문단·표 변경 | 미지원 |
| `.pptx` | 파일명 + 슬라이드 + 표 | 슬라이드·항목 변경 | 미지원 |
| `.md`, `.txt` | 파일명 + 단락/줄 | 미지원 | 미지원 |

## Use cases

### 필요한 문서 위치 찾기

- 상황:
  - 예전에 받은 단가표, 견적서, 보고서가 어느 파일에 있는지 모름
  - 파일은 많은데 제목만으로 찾기 어려움
- 사용:
  - **문서 검색**에서 키워드 입력
- 결과:
  - 파일명과 본문 검색 결과를 함께 확인
  - Excel은 `몇 행 몇 열`인지까지 확인
  - PowerPoint는 `몇 번 슬라이드`인지 확인

### 여러 Excel 파일 합치기

- 상황:
  - 거래처별, 지점별, 담당자별 Excel 양식이 여러 개 있음
  - 한 장의 통합 파일이 필요함
- 사용:
  - **Excel 통합**에서 공통 key 컬럼 선택
  - LEFT / OUTER / INNER JOIN 방식 선택
- 결과:
  - 여러 파일을 하나의 Excel로 병합
  - 누락 데이터까지 포함해 비교 가능
  - `.xlsx`로 다운로드

### 문서 버전 변경점 확인하기

- 상황:
  - `보고서_v1.pptx`, `보고서_v2.pptx`처럼 수정본이 여러 개 있음
  - 최신본에서 무엇이 바뀌었는지 확인해야 함
- 사용:
  - **버전 관리**에서 문서 묶음 열기
- 결과:
  - PowerPoint: 바뀐 슬라이드와 텍스트 확인
  - Word: 문단/표 변경 확인
  - Excel: 셀 값 추가/삭제/변경 확인

### 같은 양식의 값 불일치 찾기

- 상황:
  - 여러 지점이 같은 Excel 양식을 제출함
  - 같은 항목인데 값이 서로 다른 부분을 찾아야 함
- 사용:
  - Excel 파일들을 등록
  - **버전 관리**에서 같은 양식 묶음 확인
- 결과:
  - 예: `5행 E열 값 다름`
  - 파일별 값을 나란히 비교
  - 내용이 추가되거나 삭제된 셀도 확인

## 다운로드해서 사용하기

- [Releases](../../releases) 페이지에서 최신 Windows zip 다운로드
- 파일명 예시: `officewhere-vX.Y.Z-windows-x64.zip`
- 압축 해제 후 `OfficeWhere.exe` 실행
- 별도 설치 과정 없음

## 웹 브라우저에서 빠르게 테스트하기

릴리스 파일을 다시 받지 않고 repo를 clone해서 브라우저로 확인하는 개발/검증용 실행입니다.
로컬 Python backend와 Vite frontend를 함께 실행합니다.

### Windows

```bat
git pull
setup.bat
dev-web.bat
```

포트를 바꾸려면:

```bat
dev-web.bat -BackendPort 8876 -FrontendPort 5174
```

브라우저 주소:

```text
http://127.0.0.1:5174
```

### Linux / macOS

```bash
git pull
./setup.sh
./dev-web.sh
```

포트를 바꾸려면:

```bash
BACKEND_PORT=8876 FRONTEND_PORT=5174 ./dev-web.sh
```

브라우저 주소:

```text
http://127.0.0.1:5174
```

### 참고

- 종료: 실행 중인 터미널에서 `Ctrl+C`
- backend도 함께 종료됩니다.
- WSL에서도 실행은 가능하지만, Windows 네트워크 드라이브나 `K:\...` 경로 테스트는 Windows에서 `dev-web.bat`으로 실행하는 편이 안전합니다.

## 직접 빌드하기

배포 파일 또는 로컬 패키지를 직접 만드는 방법입니다.

필요한 도구:

- Python 3.10 이상
- Node.js LTS

### Windows

```bat
setup.bat
build.bat
```

결과:

- `dist/electron/` 아래 Windows zip 생성
- zip 압축 해제 후 `OfficeWhere.exe` 실행

### Linux / macOS

```bash
chmod +x setup.sh build.sh
./setup.sh
./build.sh
```

결과:

- frontend / Electron main / backend 패키징 검증
- Windows 배포 zip은 생성하지 않음

현재 GitHub Release 자동 빌드는 Windows zip만 생성합니다.
macOS 데스크톱 앱 배포본은 아직 정식 검증 대상이 아니며, 별도 작업이 필요합니다.

- Electron mac target 설정
- macOS에서 backend 실행 파일 빌드
- 앱 서명 및 공증 설정
- macOS 파일 선택/앱 데이터 경로 검증

## 데이터 저장 위치

OfficeWhere는 원본 문서를 복사하거나 수정하지 않습니다.
앱이 저장하는 것은 다음 데이터입니다.

- 파일 경로
- 메타데이터
- 검색 색인
- 내용 fingerprint
- 앱 설정 및 로컬 DB

데이터베이스 위치:

- Windows: `%APPDATA%\OfficeWhere\backend-data\data.db`
- macOS: `~/Library/Application Support/OfficeWhere/backend-data/data.db`
- Linux: `~/.config/OfficeWhere/backend-data/data.db`

주의:

- 원본 파일을 이동하거나 삭제하면 다시 등록해야 합니다.
- 앱을 초기화하려면 **설정 → 앱 데이터 관리**를 사용합니다.
- 앱 데이터 삭제는 DB·색인·캐시만 삭제합니다.
- 사용자가 등록한 원본 문서 폴더는 삭제하지 않습니다.
