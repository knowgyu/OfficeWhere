# OfficeWhere Release Test Checklist

Use this checklist before publishing a release tag.

## Automated verification
- [ ] `./venv/bin/python -m pytest` passes.
- [ ] `cd frontend && npm run build` passes.
- [ ] `git diff --check` passes.
- [ ] `./venv/bin/python -m compileall -q backend` passes.

## Document registration and search
- [ ] Register a folder containing Excel, Word, PowerPoint, text, and Markdown files.
- [ ] Search by filename + body.
- [ ] Search by filename only.
- [ ] Search by body only.
- [ ] Filter search results to Excel.

## File/library scale UX
- [ ] File Manager shows a bounded page, not the full registered file list.
- [ ] File Manager search narrows the file page.
- [ ] Join Query can find Excel files through the paged picker.

## Version management
- [ ] Same Office filename in two folders appears as a “same filename” group.
- [ ] `v1.0`, `v1.1`, `260426`, or `2026-04-26` filename variants appear as a version-family group.
- [ ] Text and Markdown files do not appear in version-management groups.
- [ ] Opening a group loads a timeline/detail view and calculates only that group’s adjacent version changes on demand.
- [ ] While version changes are calculated, progress is visible as completed/total comparisons.
- [ ] Word changes show page labels and side-by-side “기존 내용” / “변경 후 내용” panels.
- [ ] Excel search and value changes show worksheet coordinates such as `예산현황 시트 | 5행 E열`.
- [ ] PowerPoint changes show slide numbers and titles for added/removed/changed slides.
- [ ] If a group exceeds the latest-file detail limit, the UI explains only the displayed/latest files were analyzed.
- [ ] Content-evidence wording avoids internal terms such as “fingerprint”.
- [ ] Version Management view-size controls enlarge text without breaking the main card layout.

## Data safety
- [ ] App-data safe reset copy says original documents are not deleted.
- [ ] Full reset remains behind a stronger warning/advanced path.
- [ ] Original watched folders and Office documents remain untouched after app-data cleanup.
- [ ] A mapped/network drive folder can be added when the current OS user can access it.
- [ ] Search, indexing, and version management read source documents only; they do not delete, move, rename, or save originals.
- [ ] The OS “open file” action is understood as handing the document to Office; manual user edits in Office are outside app-controlled read-only scanning.

## Release
- [ ] Version is bumped in `frontend/package.json` and `frontend/package-lock.json`.
- [ ] Release notes summarize user-visible changes.
- [ ] Git tag `vX.Y.Z` points at the verified commit.
- [ ] If publishing through GitHub Actions, push `main` and the `vX.Y.Z` tag.
- [ ] Confirm the GitHub Release contains the Windows zip and `.sha256.txt` asset.
