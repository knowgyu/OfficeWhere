# OfficeWhere

OfficeWhere는 Excel, Word, PowerPoint, Markdown, 텍스트 파일을 한 곳에 등록해 검색·비교·통합할 수 있는 데스크톱 도구입니다.

- **문서 검색**: 파일명/경로/본문을 검색하고 Word 단락, PPT 슬라이드, Excel 행·열, 텍스트 줄 위치를 보여줍니다.
- **Excel 통합**: 여러 Excel 파일을 key 컬럼 기준으로 LEFT / OUTER / INNER 방식으로 합칩니다.
- **버전 비교 / 정합성 검사**: Excel 값 차이, Word 문단·표 변경, PPT 슬라이드·항목 변경을 확인합니다.
- **라이브러리 관리**: 대상 폴더를 등록하고 지원 문서를 증분 색인합니다.
- **Windows 배포**: Electron 앱과 Python 백엔드를 함께 묶은 zip으로 배포합니다.

## 지원 파일

| 형식 | 검색 | 비교/검사 | 통합 |
| --- | --- | --- | --- |
| `.xlsx`, `.xls` | 파일명/내용 | key 기준 값·컬럼 차이 | 지원 |
| `.docx` | 문단/표 | 문단·표 행 diff | 미지원 |
| `.pptx` | 슬라이드/표 | 슬라이드 추가·삭제 및 내부 diff | 미지원 |
| `.md`, `.txt` | 단락/줄 | 미지원 | 미지원 |

## 주요 사용 흐름

### 1. 폴더 등록 후 검색

1. **설정 / 라이브러리**에서 대상 폴더를 선택합니다.
2. **대상 추가** 후 **자동 등록 / 재스캔**을 실행합니다.
3. 진행 중에는 앱 하단 중앙에 재스캔 상태, 진행률, 현재 처리 파일, 정지 버튼이 표시됩니다.
4. **문서 검색** 탭에서 키워드를 입력합니다.
5. 필요하면 Word/DOCX, PPT/PPTX, Markdown/MD, Text/TXT 필터를 다중 선택합니다. 아무것도 선택하지 않으면 전체 검색입니다.

### 2. Excel 파일 통합

1. Excel 파일을 등록하고 key 컬럼을 확인합니다.
2. **Excel 통합**에서 파일과 컬럼을 선택합니다.
3. JOIN 방식을 선택한 뒤 미리보기 또는 Excel 다운로드를 실행합니다.

### 3. 수정본 비교

1. 비교할 Word/PPT/Excel 파일을 등록합니다.
2. **버전 묶음 / 정합성**에서 유사 파일 묶음을 확인합니다.
3. Word/PPT는 2개 파일 비교, Excel은 여러 파일 정합성 검사를 실행합니다.

## 개발 환경 설정

Python 3.10 이상과 Node.js LTS가 필요합니다.

### Windows

```bat
setup.bat
```

### macOS / Linux

```bash
chmod +x setup.sh
./setup.sh
```

수동 설정이 필요하면 다음 순서로 진행합니다.

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt

cd frontend
npm ci
```

## 개발 서버 실행

백엔드:

```bash
source venv/bin/activate        # Windows: venv\Scripts\activate
python backend_server.py --host 127.0.0.1 --port 8765
```

프론트엔드:

```bash
cd frontend
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

Electron shell:

```bash
cd frontend
npm run electron:dev
```

Vite 개발 서버를 Electron 창에 붙이려면 다음처럼 실행합니다.

```bash
ELECTRON_RENDERER_URL=http://localhost:5173 npm run electron:dev
```

## 빌드

### Windows 배포 zip

```bat
build.bat
```

빌드 단계:

1. React/Vite renderer build
2. Electron main/preload TypeScript build
3. PyInstaller backend executable build
4. `electron-builder` Windows x64 zip 생성

최종 사용자는 Release zip을 압축 해제한 뒤 `OfficeWhere.exe`를 실행하면 됩니다.

### macOS / Linux 검증 빌드

```bash
chmod +x build.sh
./build.sh
```

Linux/macOS의 `build.sh`는 로컬 검증용입니다. Windows 배포 zip은 Windows 또는 GitHub Actions에서 생성합니다.

## 검증

```bash
source venv/bin/activate
pytest -q

cd frontend
npm run build
npm run build:electron
```

추가 수동 검증용 데모 문서:

```bash
python scripts/generate_demo_cases.py
python scripts/run_demo_checks.py
python scripts/run_perf_checks.py
```

## GitHub Release

`.github/workflows/release.yml`은 태그가 push되면 Windows runner에서 앱을 빌드하고 Release asset을 업로드합니다.

```bash
git tag v0.1.4
git push origin main v0.1.4
```

생성 asset:

- `officewhere-vX.Y.Z-windows-x64.zip`
- `officewhere-vX.Y.Z-windows-x64.sha256.txt`

## 데이터 저장 위치

사용자 데이터베이스는 기본적으로 사용자 홈 아래에 저장됩니다.

- 앱 메타데이터: `~/.officewhere/data.db`
- 등록 파일 원본: DB에 복사하지 않고 경로와 메타데이터만 저장

파일을 이동하거나 삭제하면 해당 파일은 다시 등록해야 합니다.

## 문제 해결

| 증상 | 확인할 내용 |
| --- | --- |
| 개발 서버가 열리지 않음 | 백엔드가 `127.0.0.1:8765`에서 실행 중인지 확인 |
| 포트 충돌 | 다른 프로세스가 8765 포트를 사용하는지 확인 |
| 파일 선택창이 보이지 않음 | OS 창 뒤에 가려졌는지 확인하거나 경로를 직접 입력 |
| Windows 실행 차단 | 코드 서명이 없는 내부 배포 zip이면 SmartScreen 경고가 나타날 수 있음 |
| 빌드 실패 | `setup.bat` 또는 `setup.sh` 완료 후 다시 빌드 |

## 관련 문서

- `PLAN.md`: 현재 제품 범위와 릴리스 계획
- `ARCHITECTURE.md`: 백엔드/프론트엔드 구조와 주요 설계 결정
- `docs/electron-migration.md`: Electron 패키징 메모
- `examples/README.md`: 데모 문서 생성 및 검증 방법
