# Electron Migration

## Status

- Electron shell added as the default desktop packaging path.
- Python/FastAPI/SQLite/Office parsing remains in the backend.
- Legacy `launcher.py` and `office_data_joiner.spec` remain for manual fallback builds.
- Windows 11 portable zip is produced through `electron-builder`.
- GitHub Actions release build for `v0.1.1` completed successfully.
- Release assets published:
  - `office-data-joiner-v0.1.1-windows-x64.zip`
  - `office-data-joiner-v0.1.1-windows-x64.sha256.txt`
- AI features are not implemented in this migration.

## Decisions

- Electron owns desktop lifecycle, native dialogs, single instance behavior, backend process supervision, and user-visible startup/crash errors.
- The renderer continues to call the backend over HTTP. It does not parse Office files directly.
- The backend binds to `127.0.0.1` on a runtime-selected port chosen by Electron.
- The backend data directory is passed through `--data-dir` / `ODJ_DATA_DIR`.
- Electron preload exposes only:
  - `getBackendBaseUrl`
  - `pickFile`
  - `pickFolder`
  - `getAppVersion`
  - `getLogPath`
- API keys and future AI provider settings belong in the backend service/config layer, not the renderer or Electron preload.

## Development

Run backend and browser UI separately:

```bash
source venv/bin/activate
python backend_server.py --host 127.0.0.1 --port 8765

cd frontend
npm run dev
```

Run the Electron shell against a built renderer:

```bash
cd frontend
npm run electron:dev
```

To use a live Vite renderer with Electron:

```bash
cd frontend
ELECTRON_RENDERER_URL=http://localhost:5173 npm run electron:dev
```

## Build

Windows default:

```bat
build.bat
```

Build stages:

1. `frontend`: `npm ci`
2. Renderer build: `npm run build`
3. Electron main/preload build: `npm run build:electron`
4. Backend executable: `python -m PyInstaller office_data_joiner_backend.spec --clean -y`
5. Windows zip: `npm run package:win`

The backend executable is copied into Electron resources as `resources/backend`.
The renderer build is copied into Electron resources as `resources/renderer`.

## Release History

### v0.1.1

- Tag pushed: `v0.1.1`
- GitHub Actions workflow: `Build Windows Release`
- Workflow result: success
- Release URL: `https://github.com/knowgyu/office-data-joiner/releases/tag/v0.1.1`
- Windows smoke result from downloaded release zip: app runs successfully.
- `frontend/package-lock.json` was regenerated with npm 10 after Windows `npm ci` reported missing lockfile entries for Babel/React type transitive packages.

## Windows Local Build Notes

If local `build.bat` fails during `electron-builder` with a `winCodeSign` symlink error, the failure is caused by Windows refusing to create symlinks while extracting Electron Builder's helper archive:

```text
ERROR: Cannot create symbolic link
... electron-builder\Cache\winCodeSign\...\darwin\...\libcrypto.dylib
```

Those `darwin` files are bundled inside Electron Builder's helper archive; the Windows app does not directly use them. Options:

- Prefer GitHub Actions release artifacts for reproducible Windows builds.
- For local builds, run from an elevated PowerShell/CMD or enable Windows Developer Mode, then clear the cache:

```bat
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
build.bat
```

## Reliability Checklist

- [x] `/api/health` endpoint added.
- [x] Runtime backend port selection added.
- [x] Backend startup health polling added.
- [x] Backend stdout/stderr log file added.
- [x] Backend crash/error dialog added.
- [x] App quit cleanup for backend child process added.
- [x] Single instance lock added.
- [x] Native file/folder dialog bridge added.
- [x] Renderer API base URL injection added.
- [x] Worker counts capped from CPU count and `ODJ_MAX_WORKERS`.
- [x] Windows 11 fresh unzip/manual double-click validation.
- [x] GitHub Actions artifact/release download manual smoke test.

## Windows 11 Manual Validation

Validated against `v0.1.1` release zip:

- Fresh unzip and double-click app: pass
- No console window shown for app shell: pass
- GitHub Actions release asset creation: pass
- Electron app startup with bundled backend: pass
- Backend log file path visible on failure: implemented, not manually forced during release smoke test
- Office file inspect/register/search/open: basic app operation confirmed; full matrix remains a recommended regression test
- Folder scan and library rescan: recommended regression test
- Port conflict fallback: implemented through runtime port selection; recommended regression test
- Re-launch focuses existing window: implemented through single instance lock; recommended regression test
- App quit terminates backend process: recommended regression test

## AI Extension Notes

Future AI support should be added behind a backend provider abstraction, for example:

- `backend/services/ai/providers/base.py`
- `backend/services/ai/providers/openai.py`
- backend settings stored in SQLite or environment variables

Electron and renderer code should only call backend API endpoints. They should not store provider keys or call remote AI APIs directly.
