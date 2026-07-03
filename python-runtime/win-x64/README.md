# OfficeWhere bundled Python runtime (Windows x64)

This directory is generated during Windows packaging.

`npm run package:win` runs:

```bat
python ..\scripts\prepare_python_runtime.py win-x64
```

That command downloads the official Python 3.13.13 Windows embeddable package,
installs the exact pins from the repository root `requirements.txt` into
`site-packages`, and writes `python313._pth` so the packaged app can import both
vendored packages and `resources/backend-source`.

The generated files are intentionally ignored by git. Electron Builder still
copies this directory into the Windows zip at `resources/python-runtime`, so end
users can run OfficeWhere without installing Python or pip.

Run the real preparation on Windows or in GitHub Actions Windows runners. From
Linux/macOS, use `python ../scripts/prepare_python_runtime.py win-x64 --dry-run`
only to validate the URL and output paths; dependency installation is skipped
there because Windows wheels must be installed into the Windows embeddable
runtime.

After packaging, verify the zip contains:

```text
resources/python-runtime/python.exe
resources/python-runtime/site-packages/
resources/backend-source/backend_server.py
```
