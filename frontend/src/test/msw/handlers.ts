import { http, HttpResponse } from 'msw'
import type {
  ClearRegisteredFilesResult,
  DuplicateFilesResponse,
  ExampleLibraryPathResponse,
  ExcelDiffGridResponse,
  FileInspectResponse,
  FileListResponse,
  FilePickResponse,
  FileRegisterResponse,
  FolderPickResponse,
  ReindexResponse,
  SchedulerSettings,
  SchemaResetState,
  SchemaResponse,
  SearchResponse,
  TutorialLibraryCleanupResult,
} from '../../api/client'
import type { FileInfo } from '../../api/shared'
import type {
  LibraryGroupDetail,
  LibraryGroupsResponse,
  LibraryRescanResponse,
  LibraryRescanStatus,
  LibrarySettings,
} from '../../api/library'

/**
 * Default MSW handlers covering every backend endpoint the frontend touches.
 *
 * Strategy (from PRD §Mock strategy):
 * - Default responses are shape-correct empty stubs. TypeScript types are
 *   imported from the API modules so handler payloads break at compile time
 *   when the API contract changes.
 * - Tests that need realistic data override per-spec via `server.use(...)`.
 * - setup.ts uses `onUnhandledRequest: 'error'`, so a new endpoint added in
 *   client.ts/library.ts without a default here fails the first test that
 *   triggers it. That is intentional: it forces handlers to stay in sync.
 */

const idleRescanStatus: LibraryRescanStatus = {
  running: false,
  stage: 'idle',
  message: '',
  mode: 'normal',
  worker_count: 1,
  folders_total: 0,
  folders_processed: 0,
  found: 0,
  total: 0,
  processed: 0,
  percent: 0,
  registered: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  cancelled: 0,
  pruned_unsupported: 0,
  missing: 0,
  recovered: 0,
  purged_missing: 0,
  cancel_requested: false,
}

const emptyLibrarySettings: LibrarySettings = {
  watched_folders: [],
  excluded_folder_names: [],
  auto_rescan_mode: 'manual',
  auto_rescan_interval_hours: 24,
  auto_rescan_daily_time: '03:00',
  fast_worker_count: 4,
}

const emptyRescanResponse: LibraryRescanResponse = {
  registered: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  results: [],
  cancelled: 0,
  pruned_unsupported: 0,
  missing: 0,
  recovered: 0,
  purged_missing: 0,
}

const emptyGroupsResponse: LibraryGroupsResponse = {
  total: 0,
  groups: [],
  limit: 50,
  offset: 0,
  counts_by_kind: {},
}

const emptyGroupDetail: LibraryGroupDetail = {
  id: '',
  group_kind: 'version_family',
  file_type: '',
  base_name: '',
  canonical_name: '',
  title: '',
  file_count: 0,
  confidence: '',
  reason: '',
  tokens_summary: [],
  content_status: 'pending',
  fingerprint_coverage: 0,
  fingerprint_unique_count: 0,
  content_evidence: '',
  files: [],
}

const emptyFileListResponse: FileListResponse = {
  total: 0,
  items: [],
  counts_by_type: {},
  limit: 60,
  offset: 0,
}

const emptyDuplicatesResponse: DuplicateFilesResponse = {
  total: 0,
  groups: [],
  limit: 50,
  offset: 0,
}

const emptySearchResponse: SearchResponse = {
  query: '',
  total: 0,
  results: [],
  file_count: 0,
  file_limit: 20,
  has_more: false,
}

const emptySchedulerSettings: SchedulerSettings = {
  mode: 'manual',
  interval_hours: 24,
  daily_time: '03:00',
}

export const handlers = [
  // --- /api/health ---
  http.get('*/api/health', () =>
    HttpResponse.json({ status: 'ok', version: '0.0.0-test', db_path: '/tmp/test.db' }),
  ),

  // --- /api/files ---
  http.get('*/api/files', () => HttpResponse.json<FileInfo[]>([])),
  http.post('*/api/files', () =>
    HttpResponse.json<FileRegisterResponse>({ id: 1, name: 'mock.xlsx', file_type: 'Excel' }),
  ),
  http.delete('*/api/files', () =>
    HttpResponse.json<ClearRegisteredFilesResult>({ deleted: 0, message: '' }),
  ),
  http.get('*/api/files/page', () => HttpResponse.json<FileListResponse>(emptyFileListResponse)),
  http.get('*/api/files/duplicates', () =>
    HttpResponse.json<DuplicateFilesResponse>(emptyDuplicatesResponse),
  ),
  http.post('*/api/files/inspect', () =>
    HttpResponse.json<FileInspectResponse>({ path: '', name: '', file_type: '' }),
  ),
  http.post('*/api/files/pick', () =>
    HttpResponse.json<FilePickResponse>({ cancelled: true, file: null }),
  ),
  http.post('*/api/files/pick-folder', () =>
    HttpResponse.json<FolderPickResponse>({ cancelled: true, folder_path: '' }),
  ),
  http.post('*/api/files/scan-folder', () =>
    HttpResponse.json({ files: [], skipped: [], excluded: [] }),
  ),
  http.post('*/api/files/bulk-register', () =>
    HttpResponse.json({ registered: 0, failed: 0, results: [] }),
  ),
  http.get('*/api/files/:id/schema', () => HttpResponse.json<SchemaResponse>({ file_type: '' })),
  http.delete('*/api/files/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/files/:id/open', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/files/:id/show-in-folder', () => new HttpResponse(null, { status: 204 })),

  // --- /api/check ---
  http.post('*/api/check', () => HttpResponse.json({ mode: 'excel' })),
  http.post('*/api/check/excel-grid', () =>
    HttpResponse.json<ExcelDiffGridResponse>({
      latest_file: { file_id: 0, file_name: '' },
      row_count: 0,
      column_count: 0,
      sheet_name: '',
      partial: false,
      omitted_focus_count: 0,
      sections: [],
    }),
  ),

  // --- /api/search ---
  http.post('*/api/search', () => HttpResponse.json<SearchResponse>(emptySearchResponse)),
  http.post('*/api/search/reindex', () =>
    HttpResponse.json<ReindexResponse>({ success: 0, failed: 0, skipped: 0 }),
  ),
  http.get('*/api/search/settings', () =>
    HttpResponse.json<SchedulerSettings>(emptySchedulerSettings),
  ),
  http.put('*/api/search/settings', () =>
    HttpResponse.json<SchedulerSettings>(emptySchedulerSettings),
  ),

  // --- /api/library ---
  http.get('*/api/library/settings', () =>
    HttpResponse.json<LibrarySettings>(emptyLibrarySettings),
  ),
  http.put('*/api/library/settings', () =>
    HttpResponse.json<LibrarySettings>(emptyLibrarySettings),
  ),
  http.post('*/api/library/rescan', () =>
    HttpResponse.json<LibraryRescanResponse>(emptyRescanResponse),
  ),
  http.post('*/api/library/rescan/start', () =>
    HttpResponse.json<LibraryRescanStatus>(idleRescanStatus),
  ),
  http.get('*/api/library/rescan/status', () =>
    HttpResponse.json<LibraryRescanStatus>(idleRescanStatus),
  ),
  http.post('*/api/library/rescan/cancel', () =>
    HttpResponse.json<LibraryRescanStatus>(idleRescanStatus),
  ),
  http.get('*/api/library/groups', () =>
    HttpResponse.json<LibraryGroupsResponse>(emptyGroupsResponse),
  ),
  http.get('*/api/library/groups/:id', () =>
    HttpResponse.json<LibraryGroupDetail>(emptyGroupDetail),
  ),
  http.put('*/api/library/groups/:id/latest-file', () =>
    HttpResponse.json<LibraryGroupDetail>(emptyGroupDetail),
  ),
  http.delete('*/api/library/groups/:id/latest-file', () =>
    HttpResponse.json<LibraryGroupDetail>(emptyGroupDetail),
  ),

  // --- /api/app ---
  http.get('*/api/app/example-library-path', () =>
    HttpResponse.json<ExampleLibraryPathResponse>({ available: false, path: '' }),
  ),
  http.post('*/api/app/tutorial-library', () =>
    HttpResponse.json<ExampleLibraryPathResponse>({ available: true, path: '/tmp/tutorial' }),
  ),
  http.delete('*/api/app/tutorial-library', () =>
    HttpResponse.json<TutorialLibraryCleanupResult>({
      success: true,
      removed: [],
      deletedFileRecords: 0,
      removedWatchedFolders: 0,
      failed: [],
    }),
  ),
  http.get('*/api/app/schema-reset-state', () =>
    HttpResponse.json<SchemaResetState>({ resetPending: false }),
  ),
]
