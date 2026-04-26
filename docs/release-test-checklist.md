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

## Version grouping / consistency
- [ ] Same Office filename in two folders appears as a “same filename” group.
- [ ] `v1.0`, `v1.1`, `260426`, or `2026-04-26` filename variants appear as a version-family group.
- [ ] Text and Markdown files do not appear in consistency/version groups.
- [ ] Opening a group loads a timeline/detail view on demand.
- [ ] Word/PPT latest-two compare runs successfully.
- [ ] Excel latest-two compare runs successfully.
- [ ] Excel bounded group compare runs successfully for small groups, and large groups clearly show the latest-200-file limit.
- [ ] “내용 같음/내용 다름” appears only when fingerprint evidence is available.

## Data safety
- [ ] App-data safe reset copy says original documents are not deleted.
- [ ] Full reset remains behind a stronger warning/advanced path.
- [ ] Original watched folders and Office documents remain untouched after app-data cleanup.

## Release
- [ ] Version is bumped in `frontend/package.json` and `frontend/package-lock.json`.
- [ ] Release notes summarize user-visible changes.
- [ ] Git tag `vX.Y.Z` points at the verified commit.
- [ ] If publishing through GitHub Actions, push `main` and the `vX.Y.Z` tag.
- [ ] Confirm the GitHub Release contains the Windows zip and `.sha256.txt` asset.
