# OfficeWhere

OfficeWhere는 회사 폴더, 연구 자료, 수업 과제, 프로젝트 산출물처럼 여기저기 흩어진 Office 문서를 한 곳에서 찾고 비교하기 위한 데스크톱 도구입니다.

대상 폴더를 등록하면 Excel, Word, PowerPoint 문서를 읽어 검색용 문서 데이터를 만들고, 원본 문서는 복사하거나 수정하지 않습니다. 파일명뿐 아니라 문서 본문, Excel 셀, Word 문단/표, PowerPoint 슬라이드 내용까지 함께 찾을 수 있습니다.

## 사용 시나리오

### “그 자료가 어느 파일에 있었더라?”

보고서, 견적서, 회의자료, 과제 파일이 많아지면 파일명만으로는 필요한 내용을 다시 찾기 어렵습니다. OfficeWhere에서는 기억나는 단어만 입력해도 파일명과 본문을 함께 검색합니다. Excel 결과는 `몇 행 몇 열`인지, PowerPoint 결과는 `몇 번 슬라이드`인지까지 보여주기 때문에 파일을 열고 처음부터 뒤질 필요가 줄어듭니다.

### 여러 수정본 중 무엇이 바뀌었는지 확인해야 할 때

`사업계획_v1.pptx`, `사업계획_v2.pptx`, `사업계획_260426.pptx`처럼 수정본이 계속 생기는 업무에서는 최신본만 봐서는 무엇이 바뀌었는지 알기 어렵습니다. 변경 이력은 비슷한 이름의 Office 문서를 자동으로 묶고, 파일 사이 변경점을 보여줍니다. PowerPoint는 바뀐 슬라이드와 문구를, Excel은 바뀐 셀과 위치를 중심으로 확인할 수 있습니다.

### 같은 양식의 Excel을 여러 사람이 제출했을 때

지점별 실적표, 연구 참여자별 기록지, 조별 과제 취합표처럼 같은 양식의 Excel이 여러 개 들어오는 경우가 많습니다. OfficeWhere에서는 같은 문서 묶음에서 값이 달라진 셀, 새로 들어온 내용, 사라진 내용을 찾아볼 수 있습니다. 큰 표는 필요한 구간만 표로 열어 확인할 수 있어 전체 파일을 일일이 대조하는 부담을 줄입니다.

### 네트워크 드라이브나 공유 폴더에서 문서를 찾아야 할 때

회사에서 네트워크 드라이브나 팀 공유 폴더에 문서를 모아두는 경우에도, 로컬 PC에서 접근 가능한 경로라면 대상 폴더로 등록할 수 있습니다. 앱은 원본 파일을 읽기만 하므로 검색용 문서 데이터와 앱 데이터는 별도로 저장되고, 공유 폴더 안의 원본 문서를 삭제하거나 수정하지 않습니다.

## 지원 파일

OfficeWhere의 현재 제품 화면은 Office OOXML 문서만 등록합니다. 과거 실험용 Text/Markdown 색인은 현재 라이브러리 새로고침 시 app-owned DB에서 정리되며, 원본 파일은 삭제하지 않습니다.

| 형식 | 검색 | 변경 이력 | 비고 |
| --- | --- | --- | --- |
| `.xlsx` | 파일명 + 셀 내용 | 셀 값 추가/삭제/변경 | 표·셀 위치 중심으로 결과를 확인할 수 있습니다. |
| `.docx` | 파일명 + 문단 + 표 | 문단·표 변경 | 문단·표 단위 변경 확인을 지원합니다. |
| `.pptx` | 파일명 + 슬라이드 + 표 | 슬라이드·항목 변경 | 슬라이드 번호와 항목 중심으로 변경을 확인할 수 있습니다. |

여러 Excel 파일을 하나로 합치는 별도 기능은 현재 기본 제품 화면에 제공하지 않습니다. OfficeWhere의 현재 초점은 등록한 원본 문서를 안전하게 읽어 검색하고, 파일 사이 변경 근거를 확인하는 데 있습니다.

## 다운로드해서 사용하기

- [Releases](../../releases) 페이지에서 최신 배포 파일 다운로드
- Windows: `officewhere-vX.Y.Z-windows-x64.zip` 압축 해제 후 `OfficeWhere.exe` 실행
- macOS Apple Silicon: `officewhere-vX.Y.Z-mac-arm64.dmg` 또는 `.zip` 다운로드 후 실행
- 별도 설치 과정 없음
- Linux 패키지는 아직 제공하지 않습니다.

### macOS에서 "앱이 손상되어 열 수 없습니다" 메시지가 뜰 때

OfficeWhere는 아직 Apple Developer ID 코드 서명 및 공증(notarization)을 적용하지 않았습니다. macOS는 인터넷에서 다운로드한 미서명 앱을 실행할 때 Gatekeeper가 quarantine 속성을 검사하여 "앱이 손상되었다"는 메시지를 보여줍니다. 실제 파일 손상은 아니며, 다음 명령어로 quarantine 속성을 제거하면 정상적으로 실행됩니다.

`.dmg`로 설치한 경우 (앱을 응용 프로그램 폴더로 옮긴 뒤):

```bash
xattr -cr /Applications/OfficeWhere.app
```

`.zip`을 다운로드한 경우 (압축 해제 전):

```bash
xattr -d com.apple.quarantine ~/Downloads/officewhere-*.zip
```

이미 압축을 푼 `OfficeWhere.app`이 있다면:

```bash
xattr -cr /경로/OfficeWhere.app
```

macOS 정책상 직접 빌드한 앱(`./build.sh`)은 quarantine이 붙지 않으므로 이 단계가 필요하지 않습니다.

## 개발/문서 참고

- 문서 목차와 현재 상태는 [`docs/README.md`](docs/README.md)에 모아 둡니다.
- 테스트 작성/수정 기준은 [`docs/test-guidelines.md`](docs/test-guidelines.md)를 우선 참고합니다.
- 릴리스 전 검증은 [`docs/release-test-checklist.md`](docs/release-test-checklist.md)를 기준으로 합니다.

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
dev-web.bat -BackendPort 18766 -FrontendPort 15174
```

브라우저 주소:

```text
http://127.0.0.1:15173
```

### Linux / macOS

```bash
git pull
./setup.sh
./dev-web.sh
```

포트를 바꾸려면:

```bash
BACKEND_PORT=18766 FRONTEND_PORT=15174 ./dev-web.sh
```

브라우저 주소:

```text
http://127.0.0.1:15173
```

### 참고

- 종료: 실행 중인 터미널에서 `Ctrl+C`
- backend도 함께 종료됩니다.
- WSL에서도 실행은 가능하지만, Windows 네트워크 드라이브 경로 테스트는 Windows에서 `dev-web.bat`으로 실행하는 편이 안전합니다.

## 개발 검증 명령

일반 변경 후에는 영향 범위에 맞춰 아래 명령을 실행합니다.

```bash
./venv/bin/python -m pytest -q
./venv/bin/python -m compileall backend backend_server.py -q
cd frontend && npm run build
cd frontend && npm run build:electron
cd frontend && npx tsc -p tsconfig.e2e.json
cd frontend && npm run test:run
git diff --check
```

Electron E2E는 Linux에서 `libasound`, GTK, Xvfb 같은 시스템 라이브러리가 필요할 수 있습니다. 로컬 환경에서 앱 실행 전 단계가 시스템 라이브러리로 막히면 [`docs/ci-workflows-todo.md`](docs/ci-workflows-todo.md)의 E2E runner 준비 항목을 확인합니다.

## 직접 빌드하기

배포 파일 또는 로컬 패키지를 직접 만드는 방법입니다.

필요한 도구:

- Node.js LTS
- 개발/테스트용 Python 3.11 이상 (`setup.*`, `dev-web.*`, pytest 실행 시; 3.13 권장)
- Windows/macOS 배포 빌드는 앱 전용 backend runtime을 함께 포함

### Windows

```bat
setup.bat
build.bat
```

결과:

- `dist/electron/` 아래 Windows zip 생성
- zip에는 OfficeWhere 전용 backend runtime과 backend source가 함께 포함됨
- zip 압축 해제 후 `OfficeWhere.exe` 실행

### macOS

```bash
chmod +x setup.sh build.sh
./setup.sh
./build.sh
```

결과:

- frontend / Electron main 빌드 검증
- Apple Silicon macOS에서는 `dist/electron/` 아래 dmg/zip 생성
- dmg/zip에는 OfficeWhere 전용 backend runtime과 backend source가 함께 포함됨

### Linux

```bash
chmod +x setup.sh build.sh
./setup.sh
./build.sh
```

결과:

- frontend / Electron main 빌드 검증
- Linux packaged release는 아직 제공하지 않습니다.

## 데이터 저장 위치

OfficeWhere는 원본 문서를 복사하거나 수정하지 않습니다.
앱이 저장하는 것은 다음 데이터입니다.

- 파일 경로
- 메타데이터
- 검색용 문서 데이터
- 본문 서명
- 앱 설정 및 로컬 DB

데이터베이스 위치:

- Windows: `%APPDATA%\OfficeWhere\backend-data\data.db`
- macOS: `~/Library/Application Support/OfficeWhere/backend-data/data.db`
- Linux: `~/.config/OfficeWhere/backend-data/data.db`

주의:

- 원본 파일을 이동하거나 삭제하면 다시 등록해야 합니다.
- 앱을 초기화하려면 **설정 → 앱 데이터 관리**를 사용합니다.
- 앱 데이터 삭제는 DB·검색용 문서 데이터·캐시만 삭제합니다.
- 사용자가 등록한 원본 문서 폴더는 삭제하지 않습니다.

## 라이선스

OfficeWhere는 GNU General Public License v3.0 전용(GPL-3.0-only)으로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
