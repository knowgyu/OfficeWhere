import axios from 'axios'

export interface AppDataCandidate {
  id: string
  label: string
  path: string
  exists: boolean
  sizeBytes?: number
  description: string
  dangerous?: boolean
}

export interface ClearAppDataResult {
  success: boolean
  deleted: string[]
  failed: { id: string; path: string; error: string }[]
  backendStopped: boolean
  exitScheduled?: boolean
}

export type CloseBehavior = 'ask' | 'hide' | 'quit'
export type AppResetReason = 'safe' | 'full' | 'custom'

export interface AppResetState {
  resetPending: boolean
  reason?: AppResetReason
  resetAt?: string
}

export interface ExampleLibraryPathResponse {
  available: boolean
  path: string
  reason?: string
}

declare global {
  interface OfficeWhereBridge {
    getBackendBaseUrl?: () => Promise<string>
    pickFolder?: () => Promise<FolderPickResponse & { error?: string }>
    pickFile?: () => Promise<{ cancelled: boolean; path: string; error?: string }>
    getAppVersion?: () => Promise<string>
    getLogPath?: () => Promise<string>
    getAppDataPaths?: () => Promise<AppDataCandidate[]>
    clearAppData?: (candidateIds: string[], exitAfterClear?: boolean) => Promise<ClearAppDataResult>
    consumeResetState?: () => Promise<AppResetState>
    getCloseBehavior?: () => Promise<CloseBehavior>
    setCloseBehavior?: (behavior: CloseBehavior) => Promise<CloseBehavior>
    getExampleLibraryPath?: () => Promise<ExampleLibraryPathResponse>
  }

  interface Window {
    officeWhere?: OfficeWhereBridge
  }
}

let backendBaseUrlPromise: Promise<string> | null = null
const configuredDevBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/$/, '')

export function getOfficeWhereBridge(): OfficeWhereBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.officeWhere
}

export async function getBackendBaseUrl(): Promise<string> {
  if (!backendBaseUrlPromise) {
    const bridge = getOfficeWhereBridge()
    backendBaseUrlPromise = bridge?.getBackendBaseUrl
      ? bridge.getBackendBaseUrl()
      : Promise.resolve(import.meta.env.DEV ? configuredDevBackendUrl || '' : '')
  }

  return backendBaseUrlPromise
}

async function apiPath(path: string): Promise<string> {
  const baseUrl = await getBackendBaseUrl()
  return `${baseUrl}${path}`
}

export type FileType = 'Excel' | 'Word' | 'PowerPoint' | 'Text' | 'Markdown' | 'Unknown'
export type CompareMode = 'excel' | 'word' | 'ppt'
export type CellValue = string | number | boolean | null | undefined

export interface ExcelParserConfig {
  sheet_name: string
  header_row: number
  start_col: number
  end_col: number
  end_row?: number | null
}

export type ParserConfig = ExcelParserConfig | Record<string, unknown>

export interface FileInfo {
  id: number
  name: string
  path: string
  file_type: string
  key_column: string
  column_count: number
  created_at?: string
  file_mtime?: number | null
  parser_config?: ParserConfig | null
  compare_capabilities?: string[]
}

export interface FileListResponse {
  total: number
  items: FileInfo[]
  counts_by_type: Record<string, number>
  limit: number
  offset: number
}

export interface FileListParams {
  query?: string
  fileTypes?: string[]
  limit?: number
  offset?: number
  sort?: string
}

export interface PreviewBlock {
  id: string
  blockType: string
  location: string
  text: string
}

export interface PreviewSlideItem {
  id: string
  itemType: string
  beforeText: string
  afterText: string
  location: string
}

export interface PreviewSlide {
  id: string
  slideNumber: number
  title: string
  signature: string
  items: PreviewSlideItem[]
}

export interface PreviewTable {
  columns: string[]
  rows: string[][]
}

export interface ExcelTableCandidate {
  id: string
  label: string
  summary: string[]
  parserConfig: ParserConfig
  table: PreviewTable
  score?: number
}

export interface NormalizedPreview {
  mode: CompareMode
  table: PreviewTable
  blocks: PreviewBlock[]
  slides: PreviewSlide[]
  summary: string[]
}

export interface FileInspectResponse {
  path: string
  name: string
  file_type: string
  compare_mode?: CompareMode | string
  comparison_mode?: CompareMode | string
  suggested_key_column?: string | null
  parser_config?: ParserConfig | null
  parser_candidates?: unknown[]
  table_candidates?: unknown[]
  preview?: unknown
  summary?: unknown
  columns?: string[]
  sample?: CellValue[][]
  [key: string]: unknown
}

export interface NormalizedFileInspect {
  path: string
  name: string
  fileType: FileType
  compareMode: CompareMode
  keyRequired: boolean
  suggestedKey: string
  keyOptions: string[]
  parserConfig: ParserConfig
  parserCandidates: ExcelTableCandidate[]
  preview: NormalizedPreview
  capabilitySummary: string[]
}

export interface FilePickResponse {
  cancelled: boolean
  file: FileInspectResponse | null
}

export interface FileRegisterRequest {
  path: string
  key_column?: string
  parser_config?: ParserConfig
}

export interface FileRegisterResponse {
  id: number
  name: string
  file_type?: string
  parser_config?: ParserConfig | null
  columns?: string[]
}

export interface SchemaResponse {
  file_type?: string
  compare_mode?: CompareMode | string
  comparison_mode?: CompareMode | string
  parser_config?: ParserConfig | null
  preview?: unknown
  summary?: unknown
  columns?: string[]
  sample?: CellValue[][]
  blocks?: unknown[]
  slides?: unknown[]
  [key: string]: unknown
}

export interface JoinFileSpec {
  file_id: number
  columns: string[]
}

export interface JoinRequest {
  files: JoinFileSpec[]
  join_type: 'left' | 'outer' | 'inner'
  base_file_id?: number
}

export interface JoinResponse {
  columns: string[]
  data: string[][]
  total_rows: number
}

export interface CheckRequest {
  file_ids: number[]
  comparison_scope?: 'registered_table' | 'version_history'
}

export type ExcelDiffHighlight = 'added' | 'removed' | 'changed'

export interface ExcelDiffFocusHistory {
  change_type: ExcelDiffHighlight
  from_file_id?: number | null
  from_file_name?: string
  to_file_id?: number | null
  to_file_name?: string
  before?: string
  after?: string
  label?: string
}

export interface ExcelDiffGridFocus {
  key: string
  column: string
  change_type: ExcelDiffHighlight
  histories: ExcelDiffFocusHistory[]
}

export interface ExcelDiffGridRequest {
  file_ids: number[]
  focuses: ExcelDiffGridFocus[]
}

export interface ExcelDiffGridColumn {
  index: number
  letter: string
  name: string
  is_key: boolean
}

export interface ExcelDiffGridCell {
  row_index: number
  row_number: number
  column_index: number
  column_letter: string
  column_name: string
  value: string
  highlight: ExcelDiffHighlight | null
  histories: ExcelDiffFocusHistory[]
}

export interface ExcelDiffGridRow {
  row_index: number
  row_number: number
  key_value: string
  cells: ExcelDiffGridCell[]
}

export interface ExcelDiffGridSection {
  id: string
  title: string
  description: string
  partial: boolean
  row_start: number
  row_end: number
  col_start: number
  col_end: number
  columns: ExcelDiffGridColumn[]
  rows: ExcelDiffGridRow[]
}

export interface ExcelDiffGridResponse {
  latest_file: {
    file_id: number
    file_name: string
  }
  row_count: number
  column_count: number
  key_column: string
  sheet_name: string
  partial: boolean
  omitted_focus_count: number
  sections: ExcelDiffGridSection[]
}

export interface ExcelConflictEntry {
  fileId: number
  fileName: string
  columns: string[]
  values: string[]
  rowNumbers: number[]
  columnLetters: string[]
  cellRefs: string[]
  rowCount: number
  rowValues: string[][]
}

export type ExcelIssueType =
  | 'value_conflict'
  | 'value_added'
  | 'value_removed'
  | 'value_presence'
  | 'missing_key'
  | 'missing_column'

export interface ExcelCheckIssue {
  id: string
  type: ExcelIssueType
  severity: 'conflict' | 'warning'
  key: string
  keyVariants: string[]
  columnGroup: string
  message: string
  conflicts: ExcelConflictEntry[]
}

export interface WordDiffCard {
  id: string
  type: 'insert' | 'delete' | 'replace'
  blockType: string
  location: string
  pageLabel: string
  beforeText: string
  afterText: string
}

export interface PptSlideCard {
  id: string
  type: 'inserted_slide' | 'removed_slide' | 'matched_slide_change'
  slideNumber: number
  matchedSlideNumber?: number
  title: string
  itemType: string
  beforeText: string
  afterText: string
  description: string
}

export type CheckResponse =
  | {
      mode: 'excel'
      totalKeys: number
      matchedKeys: number
      issues: ExcelCheckIssue[]
    }
  | {
      mode: 'word'
      diffs: WordDiffCard[]
    }
  | {
      mode: 'ppt'
      slides: PptSlideCard[]
    }

export interface ScannedFileInfo extends FileInspectResponse {
  error?: string
}

export interface FolderScanRequest {
  folder_path: string
  recursive?: boolean
}

export interface FolderScanResponse {
  folder_path: string
  total_found: number
  files: ScannedFileInfo[]
}

export interface FolderPickResponse {
  cancelled: boolean
  folder_path: string
}

export interface BulkRegisterItem {
  path: string
  key_column?: string
  parser_config?: ParserConfig
}

export interface BulkRegisterRequest {
  files: BulkRegisterItem[]
}

export interface BulkRegisterResult {
  path: string
  name: string
  success: boolean
  file_id?: number
  error?: string
}

export interface BulkRegisterResponse {
  registered: number
  failed: number
  results: BulkRegisterResult[]
}

export interface SearchResult {
  file_id: number
  name: string
  path: string
  file_type: string
  location: string
  snippet: string
}

export type SearchScope = 'filename_content' | 'filename' | 'content'

export interface SearchRequest {
  query: string
  limit?: number
  file_types?: string[]
  search_scope?: SearchScope
  modified_from?: string
  modified_to?: string
}

export interface SearchResponse {
  query: string
  total: number
  results: SearchResult[]
}

export interface SchedulerSettings {
  mode: 'manual' | 'interval' | 'daily'
  interval_hours: number
  daily_time: string
  last_reindex_at?: string
}

export interface ReindexResponse {
  success: number
  failed: number
  skipped: number
}

export interface WatchedFolder {
  path: string
  recursive: boolean
}

export interface LibrarySettings {
  watched_folders: WatchedFolder[]
  auto_rescan_mode: 'manual' | 'interval' | 'daily'
  auto_rescan_interval_hours: number
  auto_rescan_daily_time: string
  last_rescan_at?: string | null
}

export interface LibraryRescanResult {
  path: string
  name: string
  success: boolean
  action: 'registered' | 'updated' | 'skipped' | 'failed' | 'cancelled'
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
}

export interface LibraryRescanStatus {
  running: boolean
  stage: 'idle' | 'queued' | 'scanning' | 'indexing' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  message: string
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
  cancel_requested: boolean
  current_file?: string | null
  summary?: LibraryRescanResponse | null
  error?: string | null
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
  recommended_action: 'excel_integrate' | 'compare_latest'
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
}

export interface LibraryGroupsParams {
  kind?: LibraryGroupKind
  fileType?: string
  query?: string
  sort?: 'recent' | 'name' | 'count' | 'content'
  limit?: number
  offset?: number
}

const electronApi = () => getOfficeWhereBridge()

function desktopError(message: string): never {
  throw { response: { data: { detail: message } } }
}

async function pickFileWithBestAvailableDialog() {
  const electron = electronApi()
  if (electron?.pickFile) {
    const picked = await electron.pickFile()
    if (picked.error) desktopError(picked.error)
    if (picked.cancelled || !picked.path) {
      return { data: { cancelled: true, file: null } }
    }

    const inspected = await axios.post<FileInspectResponse>(
      await apiPath('/api/files/inspect'),
      { path: picked.path }
    )
    return { data: { cancelled: false, file: inspected.data } }
  }

  return axios.post<FilePickResponse>(await apiPath('/api/files/pick'))
}

async function pickFolderWithBestAvailableDialog() {
  const electron = electronApi()
  if (electron?.pickFolder) {
    const data = await electron.pickFolder()
    if (data.error) desktopError(data.error)
    return { data }
  }

  return axios.post<FolderPickResponse>(await apiPath('/api/files/pick-folder'))
}

async function getFilePage(params: FileListParams = {}) {
  const searchParams = new URLSearchParams()
  if (params.query) searchParams.set('q', params.query)
  params.fileTypes?.forEach((fileType) => searchParams.append('file_types', fileType))
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
  if (params.sort) searchParams.set('sort', params.sort)

  const url = await apiPath('/api/files/page')
  const suffix = searchParams.toString()
  return axios.get<FileListResponse>(suffix ? `${url}?${suffix}` : url)
}

async function getLibraryGroups(params: LibraryGroupsParams = {}) {
  const searchParams = new URLSearchParams()
  if (params.kind) searchParams.set('kind', params.kind)
  if (params.fileType) searchParams.set('type', params.fileType)
  if (params.query) searchParams.set('q', params.query)
  if (params.sort) searchParams.set('sort', params.sort)
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset))

  const url = await apiPath('/api/library/groups')
  const suffix = searchParams.toString()
  return axios.get<LibraryGroupsResponse>(suffix ? `${url}?${suffix}` : url)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toStringValue = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  return String(value)
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => toStringValue(item)).filter((item) => item.length > 0)
}

const toMatrix = (value: unknown): string[][] => {
  if (!Array.isArray(value)) return []
  return value.map((row) =>
    Array.isArray(row) ? row.map((cell) => toStringValue(cell)) : [toStringValue(row)]
  )
}

const toNumberValue = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)))

const uniqueNumbers = (values: number[]): number[] =>
  Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0)))

const toNumberArray = (value: unknown): number[] => {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return values
    .map((item) => toNumberValue(item, Number.NaN))
    .filter((item) => Number.isFinite(item))
}

export function normalizeFileType(fileType: unknown): FileType {
  const raw = toStringValue(fileType).trim().toLowerCase()
  if (raw.includes('excel')) return 'Excel'
  if (raw.includes('word')) return 'Word'
  if (raw.includes('power') || raw === 'ppt' || raw === 'pptx') return 'PowerPoint'
  if (raw.includes('markdown') || raw === 'md') return 'Markdown'
  if (raw.includes('text') || raw === 'txt') return 'Text'
  return 'Unknown'
}

export function getCompareMode(input: unknown, fileType?: unknown): CompareMode {
  const raw = toStringValue(input).trim().toLowerCase()
  if (raw === 'excel') return 'excel'
  if (raw === 'word') return 'word'
  if (raw === 'ppt' || raw === 'powerpoint') return 'ppt'

  const normalizedType = normalizeFileType(fileType)
  if (normalizedType === 'Excel') return 'excel'
  if (normalizedType === 'Word') return 'word'
  return 'ppt'
}

export function getFileTypeLabel(fileType: unknown): string {
  const normalized = normalizeFileType(fileType)
  if (normalized !== 'Unknown') return normalized
  return toStringValue(fileType) || 'Unknown'
}

export function isExcelFile(fileType: unknown): boolean {
  return normalizeFileType(fileType) === 'Excel'
}

export function formatColumnIndex(column: number): string {
  let current = Math.max(1, column)
  let output = ''

  while (current > 0) {
    const remainder = (current - 1) % 26
    output = String.fromCharCode(65 + remainder) + output
    current = Math.floor((current - 1) / 26)
  }

  return output || '-'
}

export function formatParserConfigSummary(parserConfig: ParserConfig | null | undefined): string[] {
  if (!isRecord(parserConfig) || !('sheet_name' in parserConfig) || !('header_row' in parserConfig)) {
    return []
  }

  const sheetName = toStringValue(parserConfig.sheet_name) || '시트 미상'
  const headerRow = toNumberValue(parserConfig.header_row, 1)
  const startColValue = toNumberValue(parserConfig.start_col, 1)
  const endColValue = toNumberValue(parserConfig.end_col, startColValue)
  const endRowValue =
    parserConfig.end_row === null || parserConfig.end_row === undefined
      ? null
      : toNumberValue(parserConfig.end_row, 0)
  const startCol = formatColumnIndex(startColValue)
  const endCol = formatColumnIndex(endColValue)
  const rowSummary =
    endRowValue && endRowValue > 0
      ? `${startCol}${headerRow}:${endCol}${endRowValue}`
      : `${startCol}:${endCol}`

  return [
    `${sheetName} 시트`,
    `헤더 ${headerRow}행`,
    `영역 ${rowSummary}`,
  ]
}

function buildCapabilitySummary(mode: CompareMode, fileType: FileType): string[] {
  if (fileType === 'Text' || fileType === 'Markdown') {
    return ['본문 검색 가능', '내용 미리보기 가능', '버전 관리 제외']
  }
  if (mode === 'excel') return ['Excel 문서', '검색 및 비교 가능', '표 내용 확인 가능']
  if (mode === 'word') return ['Word 문서', '2개 문서 비교', '문단/표 행 변경 확인']
  return ['2개 발표자료 비교', '슬라이드 추가/삭제 확인', '슬라이드 내용 변경 확인']
}

function normalizePreviewBlocks(value: unknown): PreviewBlock[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    return {
      id: toStringValue(record.id) || `block-${index}`,
      blockType:
        toStringValue(record.block_type) ||
        toStringValue(record.type) ||
        toStringValue(record.kind) ||
        'block',
      location:
        toStringValue(record.location) ||
        toStringValue(record.path) ||
        toStringValue(record.index) ||
        `#${index + 1}`,
      text:
        toStringValue(record.text) ||
        toStringValue(record.content) ||
        toStringValue(record.normalized_text),
    }
  })
}

function normalizeSlideItems(value: unknown, prefix: string): PreviewSlideItem[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    return {
      id: `${prefix}-item-${index}`,
      itemType:
        toStringValue(record.item_type) ||
        toStringValue(record.type) ||
        toStringValue(record.kind) ||
        'item',
      beforeText:
        toStringValue(record.before_text) ||
        toStringValue(record.text) ||
        toStringValue(record.old_text),
      afterText:
        toStringValue(record.after_text) ||
        toStringValue(record.text) ||
        toStringValue(record.new_text),
      location:
        toStringValue(record.location) ||
        toStringValue(record.position) ||
        `item ${index + 1}`,
    }
  })
}

function normalizeSlides(value: unknown): PreviewSlide[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    return {
      id: toStringValue(record.id) || `slide-${index}`,
      slideNumber: toNumberValue(record.slide_number ?? record.slide_no ?? record.number, index + 1),
      title: toStringValue(record.title) || `슬라이드 ${index + 1}`,
      signature: toStringValue(record.signature),
      items: normalizeSlideItems(record.items ?? record.changes ?? record.elements, `slide-${index}`),
    }
  })
}

function normalizeTable(value: unknown): PreviewTable {
  const record = isRecord(value) ? value : {}
  const columns = uniqueStrings(
    toStringArray(record.columns ?? record.headers ?? record.header ?? record.preview_columns)
  )
  const rows = toMatrix(record.sample ?? record.rows ?? record.data ?? record.preview_rows)
  return { columns, rows }
}

function normalizeParserConfig(value: unknown): ParserConfig {
  if (!isRecord(value)) return {}

  if ('sheet_name' in value || 'header_row' in value || 'start_col' in value || 'end_col' in value) {
    return {
      sheet_name: toStringValue(value.sheet_name),
      header_row: toNumberValue(value.header_row, 1),
      start_col: toNumberValue(value.start_col, 1),
      end_col: toNumberValue(value.end_col, toNumberValue(value.start_col, 1)),
      end_row:
        value.end_row === null || value.end_row === undefined ? null : toNumberValue(value.end_row, 0),
    } satisfies ExcelParserConfig
  }

  return { ...value }
}

function buildCandidateLabel(index: number, parserConfig: ParserConfig): string {
  const summary = formatParserConfigSummary(parserConfig)
  return summary[0] ? `후보 ${index + 1} · ${summary.join(' · ')}` : `후보 ${index + 1}`
}

function normalizeExcelCandidates(value: unknown): ExcelTableCandidate[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const parserConfig = normalizeParserConfig(record.parser_config ?? record.config ?? record)
    const table = normalizeTable(record.preview ?? record)
    const summary = uniqueStrings([
      ...formatParserConfigSummary(parserConfig),
      record.score !== undefined ? `점수 ${toNumberValue(record.score).toFixed(1)}` : '',
    ])

    return {
      id: toStringValue(record.id) || `candidate-${index}`,
      label: toStringValue(record.label) || buildCandidateLabel(index, parserConfig),
      summary,
      parserConfig,
      table,
      score: record.score === undefined ? undefined : toNumberValue(record.score),
    }
  })
}

function normalizePreview(
  payload: unknown,
  mode: CompareMode,
  parserCandidates: ExcelTableCandidate[],
  parserConfig: ParserConfig
): NormalizedPreview {
  const record = isRecord(payload) ? payload : {}

  const table = normalizeTable(record.preview ?? record)
  const summary = uniqueStrings([
    ...toStringArray(record.summary),
    ...toStringArray(record.highlights),
    ...formatParserConfigSummary(parserConfig),
  ])
  const blocks = normalizePreviewBlocks(record.blocks ?? record.items ?? record.preview_blocks)
  const slides = normalizeSlides(record.slides ?? record.preview_slides)

  if (mode === 'excel') {
    const fallbackTable = parserCandidates[0]?.table ?? table
    const fallbackSummary = parserCandidates[0]?.summary ?? summary
    return {
      mode,
      table: {
        columns: fallbackTable.columns.length > 0 ? fallbackTable.columns : table.columns,
        rows: fallbackTable.rows.length > 0 ? fallbackTable.rows : table.rows,
      },
      blocks: [],
      slides: [],
      summary: summary.length > 0 ? summary : fallbackSummary,
    }
  }

  return {
    mode,
    table,
    blocks,
    slides,
    summary,
  }
}

export function normalizeFileInspect(payload: FileInspectResponse): NormalizedFileInspect {
  const fileType = normalizeFileType(payload.file_type)
  const compareMode = getCompareMode(payload.compare_mode ?? payload.comparison_mode, fileType)
  const parserCandidates = normalizeExcelCandidates(payload.table_candidates ?? payload.parser_candidates)
  const parserConfig =
    normalizeParserConfig(payload.parser_config) ||
    parserCandidates[0]?.parserConfig ||
    {}
  const preview = normalizePreview(payload.preview ?? payload, compareMode, parserCandidates, parserConfig)
  const fallbackColumns = preview.table.columns
  const keyOptions = uniqueStrings([
    ...fallbackColumns,
    ...toStringArray(payload.columns),
    ...parserCandidates.flatMap((candidate) => candidate.table.columns),
  ])
  const capabilitySummary = uniqueStrings([
    ...toStringArray(payload.summary),
    ...toStringArray(payload.compare_capabilities),
    ...buildCapabilitySummary(compareMode, fileType),
  ])

  return {
    path: payload.path,
    name: payload.name,
    fileType,
    compareMode,
    keyRequired: compareMode === 'excel',
    suggestedKey: toStringValue(payload.suggested_key_column),
    keyOptions,
    parserConfig:
      Object.keys(parserConfig).length > 0
        ? parserConfig
        : parserCandidates[0]?.parserConfig ?? {},
    parserCandidates,
    preview,
    capabilitySummary,
  }
}

export function normalizeSchemaResponse(
  payload: SchemaResponse,
  fileType: unknown
): NormalizedPreview {
  const normalizedType = normalizeFileType(payload.file_type ?? fileType)
  const compareMode = getCompareMode(payload.compare_mode ?? payload.comparison_mode, normalizedType)
  const parserConfig = normalizeParserConfig(payload.parser_config)
  const parserCandidates = normalizeExcelCandidates(
    payload.table_candidates ?? payload.parser_candidates
  )

  return normalizePreview(payload.preview ?? payload, compareMode, parserCandidates, parserConfig)
}

export function getSchemaColumns(payload: SchemaResponse, fileType: unknown): string[] {
  const normalized = normalizeSchemaResponse(payload, fileType)
  return normalized.table.columns
}

function normalizeExcelConflictEntries(value: unknown): ExcelConflictEntry[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    return {
      fileId: toNumberValue(record.file_id ?? record.fileId, index),
      fileName: toStringValue(record.file_name ?? record.fileName) || `파일 ${index + 1}`,
      columns: toStringArray(record.columns ?? record.column_names),
      values: toStringArray(record.values ?? record.value),
      rowNumbers: toNumberArray(record.row_numbers ?? record.rowNumbers ?? record.row_number ?? record.rowNumber),
      columnLetters: toStringArray(
        record.column_letters ?? record.columnLetters ?? record.column_letter ?? record.columnLetter,
      ),
      cellRefs: toStringArray(record.cell_refs ?? record.cellRefs ?? record.cell_ref ?? record.cellRef),
      rowCount: toNumberValue(record.row_count ?? record.rowCount, 0),
      rowValues: toMatrix(record.row_values ?? record.rowValues),
    }
  })
}

function normalizeExcelFileRefs(value: unknown, column: string, fallbackValue: string): ExcelConflictEntry[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    return {
      fileId: toNumberValue(record.file_id ?? record.fileId, index),
      fileName: toStringValue(record.file_name ?? record.fileName) || `파일 ${index + 1}`,
      columns: column ? [column] : [],
      values: fallbackValue ? [fallbackValue] : [],
      rowNumbers: [],
      columnLetters: [],
      cellRefs: [],
      rowCount: 0,
      rowValues: [],
    }
  })
}

function normalizeExcelIssues(value: unknown): ExcelCheckIssue[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const rawType = toStringValue(record.type ?? record.issue_type).toLowerCase()
    const type: ExcelIssueType =
      rawType === 'missing_key' || rawType === 'missing key'
        ? 'missing_key'
        : rawType === 'missing_column' || rawType === 'missing column'
          ? 'missing_column'
          : rawType === 'value_added' || rawType === 'value added'
            ? 'value_added'
            : rawType === 'value_removed' || rawType === 'value removed'
              ? 'value_removed'
              : rawType === 'value_presence' || rawType === 'value presence'
                ? 'value_presence'
                : 'value_conflict'
    const columnGroup = toStringValue(record.column_group ?? record.column ?? record.column_name)
    const conflicts = [
      ...normalizeExcelConflictEntries(record.conflicts ?? record.entries ?? record.values),
      ...normalizeExcelFileRefs(record.present_in, columnGroup, '있음'),
      ...normalizeExcelFileRefs(record.missing_in, columnGroup, '누락'),
    ]
    const key = toStringValue(record.key_normalized ?? record.key ?? record.key_value)

    return {
      id: toStringValue(record.id) || `excel-issue-${index}`,
      type,
      severity: toStringValue(record.severity) === 'warning' ? 'warning' : 'conflict',
      key,
      keyVariants: uniqueStrings(toStringArray(record.key_variants ?? record.keyVariants)),
      columnGroup,
      message:
        toStringValue(record.message) ||
        (type === 'missing_key'
          ? '일부 파일에 기준 항목이 없습니다.'
          : type === 'missing_column'
            ? '일부 파일에만 있는 표 내용입니다.'
            : type === 'value_added'
              ? '새 값이 추가되었습니다.'
              : type === 'value_removed'
                ? '기존 값이 삭제되었습니다.'
                : type === 'value_presence'
                  ? '일부 파일에만 값이 있습니다.'
                  : '같은 기준 항목에서 값 차이가 발견되었습니다.'),
      conflicts,
    }
  })
}

function pageNumbersFromBlocks(blocks: unknown[]): number[] {
  return uniqueNumbers(
    blocks
      .map((block) => (isRecord(block) ? toNumberValue(block.page_number ?? block.pageNumber, 0) : 0))
      .filter((value) => value > 0),
  )
}

function formatWordPageLabel(beforePages: number[], afterPages: number[]): string {
  const before = beforePages.length > 0 ? `${beforePages.join(', ')}쪽` : ''
  const after = afterPages.length > 0 ? `${afterPages.join(', ')}쪽` : ''
  if (before && after && before !== after) return `${before} → ${after}`
  return after || before || '쪽 정보 없음'
}

function normalizeWordDiffs(value: unknown): WordDiffCard[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const rawType = toStringValue(record.type ?? record.diff_type).toLowerCase()
    const beforeBlocks = Array.isArray(record.before) ? record.before : []
    const afterBlocks = Array.isArray(record.after) ? record.after : []
    const type: WordDiffCard['type'] =
      rawType === 'insert' || rawType === 'delete' || rawType === 'replace'
        ? rawType
        : toStringValue(record.change_type) === 'insert'
          ? 'insert'
          : toStringValue(record.change_type) === 'delete'
            ? 'delete'
            : 'replace'
    const firstBefore = isRecord(beforeBlocks[0]) ? beforeBlocks[0] : {}
    const firstAfter = isRecord(afterBlocks[0]) ? afterBlocks[0] : {}
    const beforePages = pageNumbersFromBlocks(beforeBlocks)
    const afterPages = pageNumbersFromBlocks(afterBlocks)

    return {
      id: toStringValue(record.id) || `word-diff-${index}`,
      type,
      blockType:
        toStringValue(record.block_type) ||
        toStringValue(firstBefore.block_type) ||
        toStringValue(firstAfter.block_type) ||
        toStringValue(record.item_type) ||
        toStringValue(record.kind) ||
        'block',
      location:
        toStringValue(record.location) ||
        toStringValue(firstBefore.location) ||
        toStringValue(firstAfter.location) ||
        toStringValue(record.path) ||
        toStringValue(record.index) ||
        `#${index + 1}`,
      pageLabel: formatWordPageLabel(beforePages, afterPages),
      beforeText:
        toStringValue(record.before_text) ||
        toStringValue(record.old_text) ||
        toStringValue(record.left_text) ||
        beforeBlocks.map((block) => toStringValue(isRecord(block) ? block.text : block)).join('\n'),
      afterText:
        toStringValue(record.after_text) ||
        toStringValue(record.new_text) ||
        toStringValue(record.right_text) ||
        afterBlocks.map((block) => toStringValue(isRecord(block) ? block.text : block)).join('\n'),
    }
  })
}

function normalizePptSlides(payload: Record<string, unknown>): PptSlideCard[] {
  if (Array.isArray(payload.changes)) {
    return payload.changes.flatMap((entry, index): PptSlideCard[] => {
      const record = isRecord(entry) ? entry : {}
      const changeType = toStringValue(record.change_type)
      const slideNumber = toNumberValue(record.slide_number_before ?? record.slide_number_after, index + 1)
      const matchedSlideNumber = toNumberValue(record.slide_number_after, slideNumber)
      const title =
        toStringValue(record.title_after) ||
        toStringValue(record.title_before) ||
        `슬라이드 ${slideNumber}`

      if (changeType === 'slide_insert' || changeType === 'slide_delete') {
        const oneSidedSlideNumber =
          changeType === 'slide_insert'
            ? toNumberValue(record.slide_number_after, index + 1)
            : toNumberValue(record.slide_number_before, index + 1)
        return [
          {
            id: `ppt-slide-${index}`,
            type: changeType === 'slide_insert' ? 'inserted_slide' as const : 'removed_slide' as const,
            slideNumber: oneSidedSlideNumber,
            title,
            itemType: 'slide',
            beforeText: toStringValue(record.title_before),
            afterText: toStringValue(record.title_after),
            description:
              changeType === 'slide_insert'
                ? '새 슬라이드가 추가되었습니다.'
                : '기존 슬라이드가 제거되었습니다.',
          },
        ]
      }

      const itemChanges = Array.isArray(record.item_changes) ? record.item_changes : []
      if (itemChanges.length === 0) {
        return [
          {
            id: `ppt-slide-${index}`,
            type: 'matched_slide_change' as const,
            slideNumber,
            matchedSlideNumber,
            title,
            itemType: 'title',
            beforeText: toStringValue(record.title_before),
            afterText: toStringValue(record.title_after),
            description: '슬라이드 제목이 변경되었습니다.',
          },
        ]
      }

      return itemChanges.map((change, changeIndex) => {
        const itemRecord = isRecord(change) ? change : {}
        const beforeBlocks = Array.isArray(itemRecord.before) ? itemRecord.before : []
        const afterBlocks = Array.isArray(itemRecord.after) ? itemRecord.after : []
        const firstBefore = isRecord(beforeBlocks[0]) ? beforeBlocks[0] : {}
        const firstAfter = isRecord(afterBlocks[0]) ? afterBlocks[0] : {}
        return {
          id: `ppt-slide-${index}-${changeIndex}`,
          type: 'matched_slide_change' as const,
          slideNumber,
          matchedSlideNumber,
          title,
          itemType:
            toStringValue(firstBefore.item_type) ||
            toStringValue(firstAfter.item_type) ||
            'item',
          beforeText: beforeBlocks.map((block) => toStringValue(isRecord(block) ? block.text : block)).join('\n'),
          afterText: afterBlocks.map((block) => toStringValue(isRecord(block) ? block.text : block)).join('\n'),
          description: '매칭된 슬라이드에서 항목 변경이 발견되었습니다.',
        }
      })
    })
  }

  const inserted = Array.isArray(payload.inserted_slides) ? payload.inserted_slides : []
  const removed = Array.isArray(payload.removed_slides) ? payload.removed_slides : []
  const changed =
    Array.isArray(payload.matched_slide_changes)
      ? payload.matched_slide_changes
      : Array.isArray(payload.changed_items)
        ? payload.changed_items
        : Array.isArray(payload.slides)
          ? payload.slides
          : []

  const insertedCards = inserted.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const slideNumber = toNumberValue(record.slide_number ?? record.slide_no, index + 1)
    const title = toStringValue(record.title) || `슬라이드 ${slideNumber}`

    return {
      id: `ppt-inserted-${index}`,
      type: 'inserted_slide' as const,
      slideNumber,
      title,
      itemType: 'slide',
      beforeText: '',
      afterText: toStringValue(record.text),
      description: '새 슬라이드가 추가되었습니다.',
    }
  })

  const removedCards = removed.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const slideNumber = toNumberValue(record.slide_number ?? record.slide_no, index + 1)
    const title = toStringValue(record.title) || `슬라이드 ${slideNumber}`

    return {
      id: `ppt-removed-${index}`,
      type: 'removed_slide' as const,
      slideNumber,
      title,
      itemType: 'slide',
      beforeText: toStringValue(record.text),
      afterText: '',
      description: '기존 슬라이드가 제거되었습니다.',
    }
  })

  const changedCards = changed.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const slideNumber = toNumberValue(record.slide_number ?? record.slide_no, index + 1)
    const matchedSlideNumber = toNumberValue(
      record.matched_slide_number ?? record.target_slide_number,
      slideNumber
    )
    const title = toStringValue(record.title) || `슬라이드 ${slideNumber}`

    return {
      id: `ppt-changed-${index}`,
      type: 'matched_slide_change' as const,
      slideNumber,
      matchedSlideNumber,
      title,
      itemType:
        toStringValue(record.item_type) || toStringValue(record.kind) || 'item',
      beforeText:
        toStringValue(record.before_text) ||
        toStringValue(record.old_text) ||
        toStringValue(record.left_text),
      afterText:
        toStringValue(record.after_text) ||
        toStringValue(record.new_text) ||
        toStringValue(record.right_text),
      description:
        toStringValue(record.description) || '매칭된 슬라이드에서 항목 변경이 발견되었습니다.',
    }
  })

  return [...insertedCards, ...removedCards, ...changedCards]
}

export function normalizeCheckResponse(payload: unknown): CheckResponse {
  const record = isRecord(payload) ? payload : {}
  const mode = getCompareMode(record.mode, record.file_type)

  if (mode === 'word') {
    const source = isRecord(record.word) ? record.word : record
    return {
      mode: 'word',
      diffs: normalizeWordDiffs(source.changes ?? source.diffs ?? source.issues ?? source.cards),
    }
  }

  if (mode === 'ppt') {
    const source = isRecord(record.ppt) ? record.ppt : record
    return {
      mode: 'ppt',
      slides: normalizePptSlides(source),
    }
  }

  const source = isRecord(record.excel) ? record.excel : record
  return {
    mode: 'excel',
    totalKeys: toNumberValue(source.total_keys ?? source.totalKeys, 0),
    matchedKeys: toNumberValue(source.matched_keys ?? source.matchedKeys, 0),
    issues: normalizeExcelIssues(source.issues),
  }
}

export const api = {
  files: {
    list: async () => axios.get<FileInfo[]>(await apiPath('/api/files')),
    page: getFilePage,
    inspect: (data: FileInspectRequest) =>
      apiPath('/api/files/inspect').then((url) => axios.post<FileInspectResponse>(url, data)),
    pick: pickFileWithBestAvailableDialog,
    register: (data: FileRegisterRequest) =>
      apiPath('/api/files').then((url) => axios.post<FileRegisterResponse>(url, data)),
    delete: async (id: number) => axios.delete(await apiPath(`/api/files/${id}`)),
    schema: async (id: number) => axios.get<SchemaResponse>(await apiPath(`/api/files/${id}/schema`)),
    suggestKey: (id: number) =>
      apiPath(`/api/files/${id}/suggest-key`).then((url) =>
        axios.get<{ columns?: string[]; suggested_key_column?: string }>(url)
      ),
    pickFolder: pickFolderWithBestAvailableDialog,
    scanFolder: (data: FolderScanRequest) =>
      apiPath('/api/files/scan-folder').then((url) => axios.post<FolderScanResponse>(url, data)),
    bulkRegister: (data: BulkRegisterRequest) =>
      apiPath('/api/files/bulk-register').then((url) => axios.post<BulkRegisterResponse>(url, data)),
    open: async (id: number) => axios.post(await apiPath(`/api/files/${id}/open`)),
  },
  query: {
    join: (data: JoinRequest) =>
      apiPath('/api/query/join').then((url) => axios.post<JoinResponse>(url, data)),
    export: (data: JoinRequest) =>
      apiPath('/api/query/export').then((url) => axios.post(url, data, { responseType: 'blob' })),
  },
  check: {
    run: (data: CheckRequest) =>
      apiPath('/api/check').then((url) => axios.post<unknown>(url, data)),
    excelGrid: (data: ExcelDiffGridRequest) =>
      apiPath('/api/check/excel-grid').then((url) => axios.post<ExcelDiffGridResponse>(url, data)),
  },
  search: {
    query: (data: SearchRequest) =>
      apiPath('/api/search').then((url) => axios.post<SearchResponse>(url, data)),
    reindex: async () => axios.post<ReindexResponse>(await apiPath('/api/search/reindex')),
    getSettings: async () => axios.get<SchedulerSettings>(await apiPath('/api/search/settings')),
    updateSettings: (data: SchedulerSettings) =>
      apiPath('/api/search/settings').then((url) => axios.put<SchedulerSettings>(url, data)),
  },
  app: {
    getDataPaths: async () => {
      const electron = electronApi()
      if (!electron?.getAppDataPaths) desktopError('Electron 앱에서만 앱 데이터 경로를 확인할 수 있습니다.')
      return { data: await electron.getAppDataPaths() }
    },
    clearData: async (candidateIds: string[], exitAfterClear = true) => {
      const electron = electronApi()
      if (!electron?.clearAppData) desktopError('Electron 앱에서만 앱 데이터를 삭제할 수 있습니다.')
      return { data: await electron.clearAppData(candidateIds, exitAfterClear) }
    },
    consumeResetState: async () => {
      const electron = electronApi()
      if (!electron?.consumeResetState) {
        return { data: { resetPending: false } as AppResetState }
      }
      return { data: await electron.consumeResetState() }
    },
    getCloseBehavior: async () => {
      const electron = electronApi()
      if (!electron?.getCloseBehavior) desktopError('Electron 앱에서만 닫기 동작을 설정할 수 있습니다.')
      return { data: await electron.getCloseBehavior() }
    },
    setCloseBehavior: async (behavior: CloseBehavior) => {
      const electron = electronApi()
      if (!electron?.setCloseBehavior) desktopError('Electron 앱에서만 닫기 동작을 설정할 수 있습니다.')
      return { data: await electron.setCloseBehavior(behavior) }
    },
    getExampleLibraryPath: async () => {
      const electron = electronApi()
      if (electron?.getExampleLibraryPath) {
        const desktopResult = await electron.getExampleLibraryPath()
        if (desktopResult.available) return { data: desktopResult }
        try {
          const backendResult = await axios.get<ExampleLibraryPathResponse>(
            await apiPath('/api/app/example-library-path'),
          )
          if (backendResult.data.available) return backendResult
        } catch {
          // Keep the clearer Electron-side unavailable reason below.
        }
        return { data: desktopResult }
      }
      try {
        return await axios.get<ExampleLibraryPathResponse>(await apiPath('/api/app/example-library-path'))
      } catch {
        // Fall through to explicit Vite configuration or a clear unavailable result.
      }
      const configuredPath = import.meta.env.VITE_EXAMPLE_LIBRARY_PATH?.trim()
      return {
        data: configuredPath
          ? { available: true, path: configuredPath }
          : {
              available: false,
              path: '',
              reason: '브라우저 개발 모드에서는 예제 폴더 자동 지정이 비활성화되어 있습니다.',
            },
      }
    },
  },
  library: {
    getSettings: async () => axios.get<LibrarySettings>(await apiPath('/api/library/settings')),
    updateSettings: (data: LibrarySettings) =>
      apiPath('/api/library/settings').then((url) => axios.put<LibrarySettings>(url, data)),
    rescan: async () => axios.post<LibraryRescanResponse>(await apiPath('/api/library/rescan')),
    startRescan: async () => axios.post<LibraryRescanStatus>(await apiPath('/api/library/rescan/start')),
    rescanStatus: async () => axios.get<LibraryRescanStatus>(await apiPath('/api/library/rescan/status')),
    cancelRescan: async () => axios.post<LibraryRescanStatus>(await apiPath('/api/library/rescan/cancel')),
    groups: getLibraryGroups,
    groupDetail: async (id: string) =>
      axios.get<LibraryGroupDetail>(await apiPath(`/api/library/groups/${encodeURIComponent(id)}`)),
    setGroupLatestFile: (id: string, fileId: number) =>
      apiPath(`/api/library/groups/${encodeURIComponent(id)}/latest-file`).then((url) =>
        axios.put<LibraryGroupDetail>(url, { file_id: fileId })
      ),
    clearGroupLatestFile: (id: string) =>
      apiPath(`/api/library/groups/${encodeURIComponent(id)}/latest-file`).then((url) =>
        axios.delete<LibraryGroupDetail>(url)
      ),
  },
}

export interface FileInspectRequest {
  path: string
}
