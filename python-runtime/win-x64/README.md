# OfficeWhere bundled Python runtime (Windows x64)

This directory vendors the official Python 3.13.13 Windows embeddable package
and exact-pinned site-packages used by packaged OfficeWhere Windows releases.

Source runtime: https://www.python.org/downloads/release/python-31313/
Runtime file: `python-3.13.13-embed-amd64.zip`

OfficeWhere launches this private `python.exe` directly so packaged releases can
run the backend without requiring users to install Python or run pip.

Vendored packages are the exact pins in the repository root `requirements.txt`.
Package test directories, console-script shims, `__pycache__`, and `.pyc` files
are intentionally omitted from this committed runtime because the packaged app
imports the libraries directly and does not run package test suites.

`python313._pth` intentionally exposes:

- `python313.zip` and `.` for the embeddable standard library/runtime DLLs
- `site-packages` for vendored Python dependencies
- `..\backend-source` for the backend source copied into Electron resources
- `import site` for normal package initialization
