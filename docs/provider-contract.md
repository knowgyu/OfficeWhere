# OfficeWhere Provider Contract

OfficeWhere can be used by local automation such as a future `where-desk` Codex skill as a **document exploration provider**. The provider boundary is HTTP/API based. External tools must not read or write OfficeWhere's SQLite database directly.

## Contract summary

| Field | Value |
| --- | --- |
| Contract version | `v1` |
| Runtime transport | Local loopback HTTP |
| Provider base path | `/api/provider/v1` |
| Source document policy | Read-only |
| SQLite access policy | Forbidden for external clients |
| Primary client | Local desktop app, future `where-desk`/Codex CLI orchestration |

The provider API is intentionally separate from business-agent orchestration. OfficeWhere answers document questions; external orchestration decides which questions to ask and how to combine OfficeWhere with MailWhere or other tools.

## Discovery

Packaged Electron uses a dynamic loopback backend port. External CLI integrations must not assume the development default port. After the Electron main process starts the backend and `/api/health` succeeds, it writes a user-scoped discovery document:

```text
<Electron userData>/provider-discovery.json
```

The document is local metadata only. It carries no API key or source document contents. Shape:

```json
{
  "provider": "OfficeWhere",
  "contract_version": "v1",
  "app_version": "0.11.1",
  "api_base_path": "/api/provider/v1",
  "base_url": "http://127.0.0.1:<dynamic-port>",
  "health_url": "http://127.0.0.1:<dynamic-port>/api/provider/v1/health",
  "manifest_url": "http://127.0.0.1:<dynamic-port>/api/provider/v1/manifest",
  "pid": 12345,
  "discovery_id": "runtime-generated UUID",
  "generated_at": "2026-05-22T12:00:00.000Z",
  "updated_at": "2026-05-22T12:00:00.000Z",
  "stale_rule": "Treat this discovery document as stale unless ..."
}
```

Writes are atomic (`provider-discovery.json.<pid>.<discovery_id>.tmp` then rename). On clean app shutdown, Electron makes a best-effort deletion and removes only the discovery file that matches its `pid` and `discovery_id`, so a newer instance is not deleted by an older shutdown path. If cleanup is interrupted, clients must apply the stale rule below.

### Consumer validation rule

Treat `provider-discovery.json` as stale unless all checks pass:

1. `provider === "OfficeWhere"`, `contract_version === "v1"`, and `api_base_path === "/api/provider/v1"`.
2. `pid` is still alive for the local OS user/session.
3. `GET health_url` returns `provider`, `contract_version`, and `app_version` values that agree with the discovery file.
4. `GET manifest_url` returns `provider`, `contract_version`, `app_version`, and `api_base_path` values that agree with the discovery file.

When the backend base URL is known and validated, clients should call:

```http
GET /api/provider/v1/manifest
```

The manifest remains the authoritative capability contract and returns:

- provider name and app version
- contract version and base path
- source-document and SQLite access policies
- supported capabilities
- provider-safe operations
- state-changing maintenance operations that must not be called automatically

## Provider-safe operations

| Operation | Endpoint | Safety | Purpose |
| --- | --- | --- | --- |
| Health | `GET /api/provider/v1/health` | Read-only | Check provider availability and version |
| Manifest | `GET /api/provider/v1/manifest` | Read-only | Read automation contract |
| Search | `POST /api/provider/v1/search` | Read-only | Search indexed file names and content |
| Files | `GET /api/provider/v1/files` | Read-only | Bounded registered file listing; excludes missing files by default |
| Duplicates | `GET /api/provider/v1/duplicates` | Read-only | Same-content duplicate groups |
| Groups | `GET /api/provider/v1/groups` | Read-only | Cache-only version/library group summaries |
| Group detail | `GET /api/provider/v1/groups/{group_id}` | Read-only | Cache-only version/library group detail |
| Compare | `POST /api/provider/v1/compare` | Source-read-only, app-cache-write | Compare registered documents; may update app-owned comparison cache |

`compare` may write app-owned cache rows. It must not modify source Office/PDF files.

Provider group endpoints are cache-only snapshots. They do not refresh or repair the derived group index, mark repair state, or generate missing content fingerprints through the provider path; if the group cache is stale or missing, clients should treat that as a current provider snapshot and ask the user before invoking maintenance endpoints such as library rescan.

## Maintenance operations outside the default provider path

These existing endpoints are useful for the desktop UI, but a business agent must call them only on explicit user intent:

| Endpoint | Why it is not provider-safe by default |
| --- | --- |
| `POST /api/search/reindex` | Rebuilds app-owned search indexes and can be expensive |
| `POST /api/library/rescan/start` | Scans watched folders and updates registered files/index state |
| `PUT /api/search/settings` | Changes scheduler behavior |
| `PUT /api/library/settings` | Changes watched folders/exclusion/auto-rescan behavior |
| `POST /api/files`, `DELETE /api/files/*` | Mutates registered file state |
| `POST /api/files/{id}/open` | Launches external OS/application behavior |

## Client rules for where-desk/Codex CLI

1. Use `/api/provider/v1/manifest` first when a base URL is available.
2. Never read OfficeWhere SQLite directly.
3. Treat returned source paths as local-only sensitive data; show/open them only when the user asks.
4. Prefer read-only provider endpoints for autonomous exploration.
5. Require explicit user intent before triggering rescan, reindex, settings changes, file registration/deletion, or OS-level open/show operations.
6. Preserve OfficeWhere's role as provider. Keep multi-step business workflow logic in `where-desk` or another external orchestrator.

## Performance note

The provider layer is intentionally thin. It delegates to the existing search/check/library code paths and keeps SQLite query shapes intact. The expected overhead is one normal Python function layer plus FastAPI routing, which is negligible compared with Office/PDF parsing, SQLite FTS search, and file-system IO.
