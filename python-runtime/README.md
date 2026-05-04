# OfficeWhere bundled Python runtimes

OfficeWhere packaged builds launch an app-local Python runtime from Electron
resources so users do not need to install Python or pip.

Runtime layout by platform:

- Windows x64 source: `python-runtime/win-x64/`
  - Packaged path: `resources/python-runtime/python.exe`
- macOS arm64 source: `python-runtime/mac-arm64/`
  - Packaged path: `Contents/Resources/python-runtime/bin/python3`

The macOS folder is a staging location for a relocatable Python 3.13 runtime.
`npm run package:mac` runs `scripts/prepare_python_runtime.py mac-arm64` before
Electron Builder. That preparation step downloads a Python 3.13 macOS arm64
standalone build, unpacks it to `python-runtime/mac-arm64`, and installs the
root `requirements.txt` packages into that app-local runtime.

The committed README/placeholders document the required layout without
vendoring a large macOS binary into the repository. Release builders should run
the packaging command on macOS arm64 so pip can install native packages into the
bundled runtime before the `.app`/`.dmg` is produced.
