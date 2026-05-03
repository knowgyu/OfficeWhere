# Electron Packaging Notes

Electron은 OfficeWhere의 기본 데스크톱 shell이다. Python/FastAPI/SQLite/Office parsing은 backend에 남고, renderer는 HTTP API만 호출한다.

## 현재 결정

- Electron main process가 backend server를 실행하고 종료 시 정리한다.
- backend는 `127.0.0.1`의 사용 가능한 포트에 바인딩한다.
- preload bridge는 OfficeWhere용 제한된 함수만 `window.officeWhere`에 노출한다.
  - `getBackendBaseUrl`
  - `pickFile`
  - `pickFolder`
  - `getAppVersion`
  - `getLogPath`
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

1. bundled Python runtime 확인: `python-runtime/win-x64/python.exe`
2. `frontend`: `npm ci`
3. renderer build: `npm run build`
4. Electron main/preload build: `npm run build:electron`
5. Windows zip: `npm run package:win`

Packaged Windows app은 `resources/python-runtime/python.exe`로 `resources/backend-source/backend_server.py`를 실행한다. 사용자는 Python이나 pip를 별도로 설치하지 않는다.

## Backend 환경 변수

OfficeWhere backend는 `OW_*` 환경 변수만 읽는다.

| Environment variable | 용도 |
| --- | --- |
| `OW_HOST` | backend bind host |
| `OW_PORT` | backend bind port |
| `OW_DATA_DIR` | SQLite data directory |
| `OW_LOG_LEVEL` | uvicorn log level |
| `OW_MAX_WORKERS` | Office parsing worker cap |

Electron 개발 실행에서 Python interpreter를 직접 지정할 때도 `OW_*` 이름을 우선한다.

| Environment variable | 용도 |
| --- | --- |
| `OW_PYTHON` | 개발 실행 또는 packaged 진단 시 Python executable override |

## GitHub Actions Release

태그 `vX.Y.Z`를 push하면 `.github/workflows/release.yml`이 embedded Python runtime을 포함한 Windows zip과 SHA256 파일을 Actions artifact로 만든다. 태그 push만으로는 GitHub Release를 만들지 않는다.

GitHub Release를 publish하려면 `workflow_dispatch`를 수동 실행하고 `release_tag`에 대상 태그를 입력한다. `release_tag`를 비우면 Actions artifact만 만든다.

앱 내 업데이트는 GitHub Release의 정확한 `officewhere-v<version>-windows-x64.zip`과 함께 게시되는 `officewhere-v<version>-windows-x64.sha256.txt` 검증 파일을 사용한다. 사용자가 **zip 다운로드**를 누르면 앱이 Windows 다운로드 폴더에 zip을 받고 SHA256을 검증한 뒤 파일 위치를 연다. 포터블 배포판은 실행 중인 앱 폴더를 자동 교체하지 않으므로, 사용자가 받은 zip을 원하는 위치에 풀고 새 `OfficeWhere.exe`를 실행한다.

## Windows 로컬 빌드 주의

`electron-builder`가 `winCodeSign` helper 압축을 풀 때 symlink 권한 오류가 나면 Windows Developer Mode를 켜거나 관리자 PowerShell/CMD에서 실행한다.

```bat
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
build.bat
```
