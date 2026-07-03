import { del, get, post, put } from './http'
import { apiPath } from './transport'
import type { FileInfo } from './shared'

export interface WatchedFolder {
  path: string
  recursive: boolean
}

export interface LibrarySettings {
  watched_folders: WatchedFolder[]
  excluded_folder_names: string[]
  auto_rescan_mode: 'manual' | 'interval' | 'daily'
  auto_rescan_interval_hours: number
  auto_rescan_daily_time: string
  fast_worker_count: number
  last_rescan_at?: string | null
}

export interface LibraryRescanResult {
  path: string
  name: string
  success: boolean
  action: 'registered' | 'updated' | 'skipped' | 'missing' | 'recovered' | 'purged_missing' | 'failed' | 'cancelled'
  file_id?: number
  error?: string
  diagnostic_id?: string
  error_code?: string
  error_stage?: string
  error_type?: string
  error_hint?: string
}

export interface LibraryRescanResponse {
  registered: number
  updated: number
  skipped: number
  failed: number
  results: LibraryRescanResult[]
  cancelled: number
  pruned_unsupported: number
  missing: number
  recovered: number
  purged_missing: number
  discovery_source?: string
  discovery_hint?: string | null
  discovery_help_url?: string | null
}

export type LibraryRescanMode = 'normal' | 'fast'

export interface LibraryRescanStatus {
  running: boolean
  stage: 'idle' | 'queued' | 'scanning' | 'indexing' | 'saving' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  message: string
  mode: LibraryRescanMode
  worker_count: number
  started_at?: string | null
  updated_at?: string | null
  folders_total: number
  folders_processed: number
  found: number
  total: number
  processed: number
  percent: number
  eta_seconds?: number | null
  registered: number
  updated: number
  skipped: number
  failed: number
  cancelled: number
  pruned_unsupported: number
  missing: number
  recovered: number
  purged_missing: number
  cancel_requested: boolean
  current_file?: string | null
  summary?: LibraryRescanResponse | null
  error?: string | null
  discovery_source?: string
  discovery_hint?: string | null
  discovery_help_url?: string | null
}

export type LibraryGroupKind = 'exact_name_conflict' | 'version_family'

export interface LibraryGroupSummary {
  id: string
  group_kind: LibraryGroupKind
  file_type: string
  base_name: string
  canonical_name: string
  title: string
  file_count: number
  confidence: string
  reason: string
  latest_file?: FileInfo | null
  previous_file?: FileInfo | null
  manual_latest_file_id?: number | null
  tokens_summary: string[]
  content_status: 'pending' | 'partial' | 'not_enough_content' | 'same_content' | 'content_differs'
  fingerprint_coverage: number
  fingerprint_unique_count: number
  content_evidence: string
}

export interface LibraryGroupDetail extends LibraryGroupSummary {
  files: FileInfo[]
}

export interface LibraryGroupsResponse {
  total: number
  groups: LibraryGroupSummary[]
  limit: number
  offset: number
  counts_by_kind: Partial<Record<LibraryGroupKind, number>>
  derived_index_state?: 'missing' | 'ready' | 'stale' | 'refreshing' | 'repair_needed' | 'error'
  derived_index_stale?: boolean
  derived_index_updated_at?: string | null
  derived_index_error?: string | null
}

export interface LibraryGroupsParams {
  kind?: LibraryGroupKind
  fileType?: string
  query?: string
  sort?: 'recent' | 'name' | 'count' | 'content'
  limit?: number
  offset?: number
  includeDuplicates?: boolean
  cacheOnly?: boolean
}

export async function getLibraryGroups(params: LibraryGroupsParams = {}) {
  const searchParams = new URLSearchParams()
  if (params.kind) searchParams.set('kind', params.kind)
  if (params.fileType) searchParams.set('type', params.fileType)
  if (params.query) searchParams.set('q', params.query)
  if (params.sort) searchParams.set('sort', params.sort)
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
  if (params.includeDuplicates) searchParams.set('include_duplicates', 'true')
  if (params.cacheOnly) searchParams.set('cache_only', 'true')

  const url = await apiPath('/api/library/groups')
  const suffix = searchParams.toString()
  return get<LibraryGroupsResponse>(suffix ? `${url}?${suffix}` : url)
}

export const libraryApi = {
  getSettings: async () => get<LibrarySettings>(await apiPath('/api/library/settings')),
  updateSettings: (data: LibrarySettings) =>
    apiPath('/api/library/settings').then((url) => put<LibrarySettings>(url, data)),
  rescan: async (mode: LibraryRescanMode = 'normal') =>
    post<LibraryRescanResponse>(await apiPath('/api/library/rescan'), { mode }),
  startRescan: async (mode: LibraryRescanMode = 'normal') =>
    post<LibraryRescanStatus>(await apiPath('/api/library/rescan/start'), { mode }),
  rescanStatus: async () => get<LibraryRescanStatus>(await apiPath('/api/library/rescan/status')),
  cancelRescan: async () => post<LibraryRescanStatus>(await apiPath('/api/library/rescan/cancel')),
  groups: getLibraryGroups,
  groupDetail: async (id: string) =>
    get<LibraryGroupDetail>(await apiPath(`/api/library/groups/${encodeURIComponent(id)}`)),
  setGroupLatestFile: (id: string, fileId: number) =>
    apiPath(`/api/library/groups/${encodeURIComponent(id)}/latest-file`).then((url) =>
      put<LibraryGroupDetail>(url, { file_id: fileId })
    ),
  clearGroupLatestFile: (id: string) =>
    apiPath(`/api/library/groups/${encodeURIComponent(id)}/latest-file`).then((url) =>
      del<LibraryGroupDetail>(url)
    ),
}
