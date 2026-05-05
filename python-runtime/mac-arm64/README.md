# OfficeWhere bundled Python runtime (macOS arm64)

This directory is the source folder for the macOS packaged Python runtime.
Electron Builder copies it to `Contents/Resources/python-runtime` for mac builds.

Required executable contract:

```text
python-runtime/mac-arm64/bin/python3
```

The runtime should be a relocatable Python 3.13 arm64 build with the packages
from the repository root `requirements.txt`. The Electron main process launches
`Resources/python-runtime/bin/python3` against `Resources/backend-source/backend_server.py`.

Run this from `frontend/` on a macOS arm64 build machine:

```bash
npm run prepare:python-runtime:mac
npm run package:mac
```

The preparation script downloads a Python 3.13 macOS arm64 standalone archive,
copies its runtime here, and installs `requirements.txt` into that runtime. It
intentionally avoids PyInstaller; Electron starts this private `bin/python3`
directly.

This repository does not vendor the macOS Python binary from Linux. Verify the
final app bundle contains `Contents/Resources/python-runtime/bin/python3`.
