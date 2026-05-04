# OfficeWhere Release Test Checklist

Use this checklist before publishing a release tag.

## Automated verification
- [ ] `./venv/bin/python -m pytest` passes.
- [ ] `cd frontend && npm run build` passes.
- [ ] `cd frontend && npm run build:electron` passes.
- [ ] `git diff --check` passes.
- [ ] `./venv/bin/python -m compileall backend backend_server.py -q` passes.
- [ ] `./venv/bin/python scripts/run_demo_checks.py` passes.

## Document registration and search
- [ ] Register a folder containing Excel, Word, and PowerPoint files.
- [ ] Search by filename + body.
- [ ] Search by filename only.
- [ ] Search by body only.
- [ ] Filter search results to Excel.

## File/library scale UX
- [ ] File Manager shows a bounded page, not the full registered file list.
- [ ] File Manager search narrows the file page.
- [ ] File Manager search/paging still helps users find registered Excel files without exposing unfinished merge screens.

## Version management
- [ ] Same Office filename in two folders appears as a “same filename” group.
- [ ] `v1.0`, `v1.1`, `260426`, or `2026-04-26` filename variants appear as a version-family group.
- [ ] Text and Markdown files are not offered as supported registration/search formats.
- [ ] Opening a group loads a timeline/detail view and calculates only that group’s adjacent version changes on demand.
- [ ] While version changes are calculated, progress is visible as completed/total comparisons.
- [ ] Word changes show page labels and side-by-side “기존 내용” / “변경 후 내용” panels.
- [ ] Excel search and value changes show worksheet coordinates such as `예산현황 시트 | 5행 E열`.
- [ ] Settings / Library → 화면 표시 changes app-wide text size across search, settings, version management, and Excel previews.
- [ ] Version Management keeps the selected group visible after opening another group.
- [ ] Excel added/removed cell content appears under 추가/삭제된 내용, and missing rows/columns show actual content previews rather than only row/column labels.
- [ ] Excel version groups show a prominent `표로 보기` button that opens a large modal grid.
- [ ] Excel `값 변경` and `추가/삭제된 내용` sections are collapsed by default and expand on click.
- [ ] Excel version history uses cell/used-range comparison and does not rely on saved table/parser settings.
- [ ] Version Management auto-detected groups remain one column on a wide screen.
- [ ] Version group cards do not show `최신 후보` / `이전 후보` labels.
- [ ] Main navigation does not expose unfinished Excel merge/preview surfaces.
- [ ] The Excel grid highlights added/removed/changed cells in green/red/yellow and cell click shows detailed history.
- [ ] Large Excel grids show partial-range guidance and keep horizontal scrolling, including Shift + mouse wheel.
- [ ] PowerPoint changes show slide numbers and titles for added/removed/changed slides.
- [ ] If a group exceeds the latest-file detail limit, the UI explains only the displayed/latest files were analyzed.
- [ ] Content-evidence wording avoids internal terms such as “fingerprint”.
- [ ] Version Management view-size controls enlarge text without breaking the main card layout.

## Data safety
- [ ] App-data safe reset copy says original documents are not deleted.
- [ ] App-data reset exits the app after cleanup and does not relaunch into a hidden process.
- [ ] First X-button close asks whether to run in background, quit, or cancel; “remember this choice” persists to Settings.
- [ ] Tray menu can reopen OfficeWhere and can quit the background process.
- [ ] Full reset remains behind a stronger warning/advanced path.
- [ ] Original watched folders and Office documents remain untouched after app-data cleanup.
- [ ] A mapped/network drive folder can be added when the current OS user can access it.
- [ ] On a Windows PC with corporate document protection enabled, protected `.xlsx` / `.docx` / `.pptx` files index in the packaged app.
- [ ] Search, indexing, and version management read source documents only; they do not delete, move, rename, or save originals.
- [ ] The OS “open file” action is understood as handing the document to Office; manual user edits in Office are outside app-controlled read-only scanning.

## Release
- [ ] Version is bumped in `frontend/package.json` and `frontend/package-lock.json`.
- [ ] Release notes summarize user-visible changes.
- [ ] Git tag `vX.Y.Z` points at the verified commit.
- [ ] Push the verified branch/tag. Tag push builds Actions artifacts and publishes a GitHub Release.
- [ ] If manually rebuilding, run `workflow_dispatch` with `release_tag` set to the verified tag.
- [ ] Confirm the GitHub Release contains Windows x64 zip, macOS arm64 dmg/zip, and matching SHA256 files.
- [ ] From the previous packaged Windows version, confirm the update dialog shows `zip 다운로드`, downloads/verifies the zip into the Downloads folder, opens the file location, and leaves the current app/data untouched.
- [ ] Confirm a missing/bad `.sha256.txt` aborts before extraction/replacement and the current app remains usable.
- [ ] Confirm a download or SHA256 verification failure leaves the current app usable and shows a clear modal error.
- [ ] Confirm a disposable rollback simulation leaves the old `OfficeWhere.exe` runnable and records the restore/failure in the update log.
- [ ] Confirm a permission-protected install folder does not affect update download because the updater writes only to the Downloads folder.
- [ ] Confirm the Windows zip contains `resources/python-runtime/python.exe` and `resources/backend-source/backend_server.py`.
