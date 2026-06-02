# Everything SDK vendor directory

This directory is the OfficeWhere packaging location for the optional Everything SDK client DLL on Windows x64.

Expected release asset when present:

- `Everything64.dll`

OfficeWhere does **not** bundle or install `Everything.exe`. The DLL is only a client library used to talk to an already-running Everything IPC service/process. If Everything is not running, OfficeWhere falls back to normal filesystem discovery.

## Source and license

Official SDK page: https://www.voidtools.com/support/everything/sdk/
Official downloads page: https://www.voidtools.com/downloads/
Official license text: https://ftp.voidtools.com/en-us/License.txt

When adding or replacing `Everything64.dll`, use an official voidtools SDK distribution and keep `LICENSE.txt` in this directory. Prefer recording the SDK version/date and checksum in this README or release notes.

## Bundled DLL

Current bundled file:

- `Everything64.dll`
- SHA-256: `c7ab8b47f7dd4c41aa735f4ba40b35ad5460a86fa7abe0c94383f12bce33bfb6`

## Packaging

Windows Electron builds copy this directory to:

```text
resources/backend-source/vendor/everything/
```

The generic backend resource copy excludes this directory so non-Windows artifacts do not carry a Windows-only DLL.
