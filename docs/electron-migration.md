# Electron Packaging Notes

Electron은 OfficeWhere의 기본 데스크톱 shell이다. Python/FastAPI/SQLite/Office parsing은 backend에 남고, renderer는 HTTP API만 호출한다.

## 현재 결정

- Electron main process가 backend server를 실행하고 종료 시 정리한다.
- backend는 `127.0.0.1`의 사용 가능한 포트에 바인딩한다.
- preload bridge는 OfficeWhere용 제한된 함수만 `window.officeWhere`에 노출한다. 현재 주요 범위는 backend URL, 파일/폴더 선택, 앱 버전/로그/앱 데이터 경로, 앱 데이터 정리, 창 닫기/시작 프로그램 설정, 예제 라이브러리 경로, 업데이트 확인/다운로드, 릴리스 페이지 열기, 폴더에서 보기이다.
- renderer는 Office 파일을 직접 파싱하지 않는다.
- API key나 외부 provider 설정이 생기면 backend 설정 계층에서 관리한다.

## 개발 실행

```bash
source venv/bin/activate
python backend_server.py --host 127.0.0.1 --port 18765

cd frontend
npm run dev
```

Electron shell:

```bash
cd frontend
npm run electron:dev
```

Vite dev server를 붙일 때:

```bash
ELECTRON_RENDERER_URL=http://localhost:15173 npm run electron:dev
```

## Windows 빌드

```bat
build.bat
```

빌드 단계:

1. `frontend`: `npm ci`
2. renderer build: `npm run build`
3. Electron main/preload build: `npm run build:electron`
4. Windows runtime 준비 + zip: `npm run package:win`

Packaged Windows app은 `resources/python-runtime/python.exe`로 `resources/backend-source/backend_server.py`를 실행한다. 사용자는 Python이나 pip를 별도로 설치하지 않는다.

Windows runtime은 repo에 vendoring하지 않는다. `npm run package:win`이 Windows runner에서 공식 Python embeddable zip을 다운로드하고 `requirements.txt`를 `site-packages`에 설치한다. Linux/macOS에서 계약만 확인할 때는 다음 dry-run을 사용한다.

```bash
python ../scripts/prepare_python_runtime.py win-x64 --dry-run
```

실제 Windows zip에는 최소한 다음 파일들이 있어야 한다.

```text
resources/python-runtime/python.exe
resources/python-runtime/site-packages/
resources/backend-source/backend_server.py
```

## macOS 빌드

```bash
cd frontend
npm run package:mac
```

`package:win`/`package:mac`은 `scripts/prepare_python_runtime.py`를 먼저 실행해 platform runtime을 준비한 뒤 Electron Builder로 zip/dmg를 만든다. 생성된 runtime 바이너리는 git에 커밋하지 않고 `.gitignore`로 제외한다. Release workflow는 각 runner에서 runtime을 캐시하고 패키징한다.

## Renderer HTTP client

Renderer는 native `fetch` 기반 `frontend/src/api/http.ts`만 직접 사용한다. 이 wrapper는 기존 API client 계약을 위해 성공 응답을 `{ data }`로, HTTP 오류를 `{ response: { status, data } }`로 맞춘다. 새 API module은 이 wrapper를 재사용하고, Axios 같은 추가 HTTP dependency는 native `fetch`로 부족한 요구가 생길 때만 다시 도입한다.

## Backend 환경 변수

OfficeWhere backend는 `OW_*` 환경 변수만 읽는다.

| Environment variable | 용도 |
| --- | --- |
| `OW_HOST` | backend bind host |
| `OW_PORT` | backend bind port |
| `OW_DATA_DIR` | SQLite data directory |
| `OW_LOG_LEVEL` | uvicorn log level |
| `OW_MAX_WORKERS` | Office parsing worker cap |
| `OW_RESCAN_BATCH_FLUSH_FILE_LIMIT` | rescan staging flush file-count threshold diagnostic override |
| `OW_RESCAN_BATCH_FLUSH_CHUNK_LIMIT` | rescan staging flush chunk-count threshold diagnostic override |
| `OW_RESCAN_BATCH_FLUSH_INTERVAL_SECONDS` | rescan staging flush interval diagnostic override |
| `OW_RESCAN_INITIAL_STAGING_FILE_THRESHOLD` | initial staging DB threshold diagnostic override |

Electron 개발 실행에서 Python interpreter를 직접 지정할 때도 `OW_*` 이름을 우선한다.

| Environment variable | 용도 |
| --- | --- |
| `OW_PYTHON` | 개발 실행 또는 packaged 진단 시 Python executable override |

## GitHub Actions Release

태그 `vX.Y.Z`를 push하면 `.github/workflows/release.yml`이 Windows zip, macOS dmg/zip, SHA256 파일을 만들고 GitHub Release에 게시한다.

수동 빌드가 필요하면 `workflow_dispatch`를 실행한다. `release_tag`를 비우면 Actions artifact만 만들고, 값을 입력하면 해당 태그의 Release asset으로 게시한다.

앱 내 업데이트는 GitHub Release의 정확한 `officewhere-v<version>-windows-x64.zip`과 함께 게시되는 `officewhere-v<version>-windows-x64.sha256.txt` 검증 파일을 사용한다. 사용자가 **zip 다운로드**를 누르면 앱이 Windows 다운로드 폴더에 zip을 받고 SHA256을 검증한 뒤 파일 위치를 연다. 포터블 배포판은 실행 중인 앱 폴더를 자동 교체하지 않으므로, 사용자가 받은 zip을 원하는 위치에 풀고 새 `OfficeWhere.exe`를 실행한다.

## Windows 로컬 빌드 주의

`electron-builder`가 `winCodeSign` helper 압축을 풀 때 symlink 권한 오류가 나면 Windows Developer Mode를 켜거나 관리자 PowerShell/CMD에서 실행한다.

```bat
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
build.bat
```
