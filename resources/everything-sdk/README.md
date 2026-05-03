# Everything SDK resources

OfficeWhere uses the official voidtools Everything SDK DLLs as an optional
Windows-only path discovery accelerator.

- `Everything64.dll` and `Everything32.dll` are intentionally tracked here so a
  Windows user can `git pull`, build, and run without typing DLL paths.
- Development scripts and packaged Electron builds look here automatically.
- Users only need the normal Everything app installed and running. If Everything
  is not installed/running, OfficeWhere falls back to its normal filesystem
  scanner.
- Keep `LICENSE.voidtools.txt` with any package that includes these DLLs.

Source:

- Download page: https://www.voidtools.com/downloads/
- SDK help: https://www.voidtools.com/support/everything/sdk/
- License: https://www.voidtools.com/License.txt

Bundled files were extracted from the official `Everything-SDK.zip`.

SHA-256:

- `Everything32.dll`: `c28cd066af36cae4403a9933847aff01db928787d86751f014a1fa60d8b97fda`
- `Everything64.dll`: `c7ab8b47f7dd4c41aa735f4ba40b35ad5460a86fa7abe0c94383f12bce33bfb6`
- `LICENSE.voidtools.txt`: `1d3ca646798a6d88b5c6ef0910f39a8390fefadf4d09fdf86ab31bc8da03b57f`
