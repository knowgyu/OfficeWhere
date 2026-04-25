# Electron Packaging Notes

Electron은 OfficeWhere의 기본 데스크톱 shell이다. Python/FastAPI/SQLite/Office parsing은 backend에 남고, renderer는 HTTP API만 호출한다.

## 현재 결정

- Electron main process가 backend executable을 실행하고 종료 시 정리한다.
- backend는 `127.0.0.1`의 사용 가능한 포트에 바인딩한다.
- preload bridge는 제한된 함수만 노출한다.
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
python backend_server.py --host 127.0.0.1 --port 8765

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
ELECTRON_RENDERER_URL=http://localhost:5173 npm run electron:dev
```

## Windows 빌드

```bat
build.bat
```

빌드 단계:

1. `frontend`: `npm ci`
2. renderer build: `npm run build`
3. Electron main/preload build: `npm run build:electron`
4. backend executable: `python -m PyInstaller office_data_joiner_backend.spec --clean -y`
5. Windows zip: `npm run package:win`

## GitHub Actions Release

태그 `vX.Y.Z`를 push하면 `.github/workflows/release.yml`이 Windows zip과 SHA256 파일을 Release asset으로 업로드한다.

수동 실행에서는 `release_tag`를 비우면 Actions artifact만 만들고, 값을 입력하면 해당 태그의 Release를 생성하거나 갱신한다.

## Windows 로컬 빌드 주의

`electron-builder`가 `winCodeSign` helper 압축을 풀 때 symlink 권한 오류가 나면 Windows Developer Mode를 켜거나 관리자 PowerShell/CMD에서 실행한다.

```bat
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
build.bat
```
