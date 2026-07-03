# OfficeWhere bundled Python runtimes

OfficeWhere packaged builds launch an app-local Python runtime from Electron
resources so users do not need to install Python or pip.

Runtime layout by platform:

- Windows x64 source: `python-runtime/win-x64/`
  - Packaged path: `resources/python-runtime/python.exe`
- macOS arm64 source: `python-runtime/mac-arm64/`
  - Packaged path: `Contents/Resources/python-runtime/bin/python3`

The platform folders are staging locations for generated runtimes. Packaging
commands run `scripts/prepare_python_runtime.py` first, then Electron Builder
copies the prepared runtime into the app bundle.

- `npm run package:win` downloads the official Python Windows embeddable zip
  and installs the root `requirements.txt` packages into `win-x64/site-packages`.
- `npm run package:mac` downloads a macOS arm64 standalone Python build and
  installs the same requirements into that runtime.

Only README/placeholders are committed. Generated Python binaries and packages
stay out of git, but packaged releases still include the runtime so users can
run OfficeWhere without installing Python.

Operational rules:

- Treat `requirements.txt` as the packaged backend dependency contract. If a
  runtime dependency changes, update that file and let the platform packaging
  script regenerate the runtime.
- Build Windows runtimes on Windows. `win-x64 --dry-run` is useful on Linux for
  checking the download/packaging plan, but wheel installation into the
  embeddable Python runtime is a Windows packaging step.
- Do not commit generated `python.exe`, `bin/python3`, `site-packages`, `.pyd`,
  `.dll`, `.so`, or cache files. Commit only these README/placeholders.
- Do not replace this with PyInstaller unless there is a clear regression:
  Electron intentionally starts a private Python interpreter plus
  `resources/backend-source/backend_server.py`.
