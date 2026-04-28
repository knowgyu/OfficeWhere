# Search and Version Management UX Notes

## Why this exists

OfficeWhere search and version management are user-facing review surfaces. They should hide implementation details from parsers and reduce duplicate/noisy evidence before adding more controls.

This file is the durable decision record for the search/version-management UX choices made after the performance pass. Local `.omx/plans/*` files can be regenerated, so product-facing behavior decisions should be kept here before release.

Related performance narrative: `docs/performance-experiment-log.md`. Backend indexing/search tradeoffs: `docs/indexing-performance-fast-mode.md`.

## Decisions

- Search result cards already show the file name in the card header. Do not repeat a filename-only match as another row under the same card.
- If the query matches a file name, highlight the matching part in the card header instead of rendering a duplicate `파일명` row.
- Keep body snippets focused on the actual document text. Body result rows should keep their match snippet and a short location label.
- Word search locations should follow the version-management style: show best-effort page labels based on DOCX page-break metadata, not raw `paragraph:<n>` parser locations.
- PowerPoint search locations should show slide numbers only. Hide parser internals such as `shape:<n>` and table row identifiers from search results.
- Version management should default to meaningful candidates:
  - show same-name groups when extracted content differs or cannot yet be confidently judged;
  - hide same-name groups whose extracted content fingerprint is the same by default;
  - provide a secondary duplicate-file toggle so users can reveal those same-name/same-content groups when needed.
- Keep version-name detection based on existing prefix/suffix version/date/status tokens. Do not broaden filename heuristics without tests because false positives make the version tab noisy.
- Keep version-group sorting simple and cheap. Default to the existing recent-modified order; do not introduce a new “needs attention” ranking unless user traces show sorting is a real problem.
- File-type filter copy should be extension-first (`.xlsx`, `.docx`, `.pptx`) because users are filtering concrete document formats, not learning Office category names.

## Non-goals

- Do not add semantic ranking or BM25 scoring back into the search UI.
- Do not store extra Word/PPT comparison summaries just to make the version list faster; load detailed diffs lazily.
- Do not expose parser implementation labels (`paragraph`, `shape`, `row`) in normal search results.
- Do not modify or normalize user source documents.

## Verification focus

- Filename-only search still returns matching files, but the visible duplicate filename row is gone.
- Filename matches in the card title are visibly highlighted.
- Word search results show page-style labels after reindexing.
- PPT search results show `슬라이드 N` without shape/row detail after reindexing.
- Version management hides same-name/same-content duplicates by default and can reveal them via the duplicate toggle.
- `.xlsx`, `.docx`, `.pptx` filter labels remain wired to the existing backend file-type filters.
