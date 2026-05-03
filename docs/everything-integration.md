# Everything acceleration

OfficeWhere can use Everything as an optional Windows-only accelerator for finding Office file paths during library refresh.

## Normal user flow

1. Install and run the normal Everything app.
2. Use OfficeWhere normally.

No DLL path, environment variable, or command-line setting is required. OfficeWhere tracks the official Everything SDK DLLs under `resources/everything-sdk`, and packaged Windows builds include them automatically. If Everything is unavailable, OfficeWhere silently uses the normal filesystem scanner.

## Development / test build flow

For local Windows testing:

```powershell
git pull
.\dev-web.bat
```

Then add a watched folder in the UI and run document refresh. The repo already includes the SDK DLLs, and `dev-web.bat` points OfficeWhere at `resources\everything-sdk` automatically.

`scripts/setup_everything_sdk.ps1` is kept only as a maintainer refresh helper when updating the bundled DLLs from the official SDK zip.

## Release gate

Do not tag or release Everything support until Windows manual validation passes:

- Everything installed/running: accelerated discovery is used and finds the same files as the normal scanner.
- Everything closed, Lite/no IPC, or SDK unavailable: OfficeWhere falls back to filesystem scanning.
- UNC/network-looking roots: OfficeWhere uses filesystem scanning.
- Source Office documents are never modified.

Any release that bundles `Everything64.dll`/`Everything32.dll` must also include `resources/everything-sdk/LICENSE.voidtools.txt`.
