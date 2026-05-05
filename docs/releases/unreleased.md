# OfficeWhere Unreleased

Current `main` contains changes after the `v0.7.12` tag. Move or rewrite these notes when preparing the next `vX.Y.Z` release note.

## Added / changed

- Added Vitest/RTL/MSW frontend unit and component test baseline.
- Added Playwright Electron E2E specs for boot, golden path, search filters, version comparison, same-content documents, rescan cancel, app-data IPC, and update-check IPC.
- Added backend E2E data-directory guard so E2E runs cannot write to normal OfficeWhere app-data locations.
- Added `.github/workflows/frontend-tests.yml` for renderer build, Electron main build, E2E TypeScript check, and Vitest.
- Kept generated macOS Python runtime files out of git; only the mac runtime staging README/placeholders remain tracked.

## Verification notes

- At the time this note was drafted, GitHub `Frontend tests` had passed on commit `71e8ca7`; rerun the release checklist on the final tag commit.
- Full Electron E2E execution still needs runner system dependencies before it becomes a hard CI gate.
