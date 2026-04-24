import axios from 'axios'

const BASE = import.meta.env.DEV ? 'http://localhost:8765' : ''

declare global {
  interface Window {
    pywebview?: {
      api?: {
        pickFolder?: () => Promise<FolderPickResponse & { error?: string }>
        pickFile?: () => Promise<FilePickResponse & { error?: string }>
      }
    }
  }
}

export type FileType = 'Excel' | 'Word' | 'PowerPoint' | 'Unknown'
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
}

export interface ExcelConflictEntry {
  fileId: number
  fileName: string
  columns: string[]
  values: string[]
  rowCount: number
}

export type ExcelIssueType = 'value_conflict' | 'missing_key' | 'missing_column'

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
  action: 'registered' | 'updated' | 'skipped' | 'failed'
  file_id?: number
  error?: string
}

export interface LibraryRescanResponse {
  registered: number
  updated: number
  skipped: number
  failed: number
  results: LibraryRescanResult[]
}

export interface LibraryFileGroup {
  id: string
  file_type: string
  canonical_name: string
  title: string
  confidence: string
  files: FileInfo[]
  recommended_action: 'excel_integrate' | 'compare_latest'
}

export interface LibraryGroupsResponse {
  groups: LibraryFileGroup[]
}

const desktopApi = () =>
  typeof window !== 'undefined' ? window.pywebview?.api : undefined

function desktopError(message: string): never {
  throw { response: { data: { detail: message } } }
}

async function pickFileWithBestAvailableDialog() {
  const bridge = desktopApi()
  if (bridge?.pickFile) {
    const data = await bridge.pickFile()
    if (data.error) desktopError(data.error)
    return { data }
  }
  return axios.post<FilePickResponse>(`${BASE}/api/files/pick`)
}

async function pickFolderWithBestAvailableDialog() {
  const bridge = desktopApi()
  if (bridge?.pickFolder) {
    const data = await bridge.pickFolder()
    if (data.error) desktopError(data.error)
    return { data }
  }
  return axios.post<FolderPickResponse>(`${BASE}/api/files/pick-folder`)
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

export function normalizeFileType(fileType: unknown): FileType {
  const raw = toStringValue(fileType).trim().toLowerCase()
  if (raw.includes('excel')) return 'Excel'
  if (raw.includes('word')) return 'Word'
  if (raw.includes('power') || raw === 'ppt' || raw === 'pptx') return 'PowerPoint'
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

function buildCapabilitySummary(mode: CompareMode): string[] {
  if (mode === 'excel') return ['JOIN 지원', '멀티 파일 정합성 검사', '표 영역 parser_config 저장']
  if (mode === 'word') return ['2문서 diff', '문단/표 블록 비교', 'key 없이 등록 가능']
  return ['2문서 diff', '슬라이드 추가/삭제 감지', '슬라이드 항목 변경 비교']
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
  const compareMode = getCompareMode(payload.compare_mode, fileType)
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
    ...buildCapabilitySummary(compareMode),
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
  const compareMode = getCompareMode(payload.compare_mode, normalizedType)
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
      rowCount: toNumberValue(record.row_count ?? record.rowCount, 0),
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
      rowCount: 0,
    }
  })
}

function normalizeExcelIssues(value: unknown): ExcelCheckIssue[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    const rawType = toStringValue(record.type ?? record.issue_type).toLowerCase()
    const type: ExcelIssueType =
      rawType === 'missing_key' || rawType === 'missing key'
        ? 'missing_key'
        : rawType === 'missing_column'
          || rawType === 'missing column'
          ? 'missing_column'
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
          ? '일부 파일에 key가 없습니다.'
          : type === 'missing_column'
            ? '일부 파일에 컬럼이 없습니다.'
            : '같은 key에서 값 차이가 발견되었습니다.'),
      conflicts,
    }
  })
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
        return [
          {
            id: `ppt-slide-${index}`,
            type: changeType === 'slide_insert' ? 'inserted_slide' as const : 'removed_slide' as const,
            slideNumber,
            matchedSlideNumber,
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
    list: () => axios.get<FileInfo[]>(`${BASE}/api/files`),
    inspect: (data: FileInspectRequest) =>
      axios.post<FileInspectResponse>(`${BASE}/api/files/inspect`, data),
    pick: pickFileWithBestAvailableDialog,
    register: (data: FileRegisterRequest) =>
      axios.post<FileRegisterResponse>(`${BASE}/api/files`, data),
    delete: (id: number) => axios.delete(`${BASE}/api/files/${id}`),
    schema: (id: number) => axios.get<SchemaResponse>(`${BASE}/api/files/${id}/schema`),
    suggestKey: (id: number) =>
      axios.get<{ columns?: string[]; suggested_key_column?: string }>(
        `${BASE}/api/files/${id}/suggest-key`
      ),
    pickFolder: pickFolderWithBestAvailableDialog,
    scanFolder: (data: FolderScanRequest) =>
      axios.post<FolderScanResponse>(`${BASE}/api/files/scan-folder`, data),
    bulkRegister: (data: BulkRegisterRequest) =>
      axios.post<BulkRegisterResponse>(`${BASE}/api/files/bulk-register`, data),
    open: (id: number) => axios.post(`${BASE}/api/files/${id}/open`),
  },
  query: {
    join: (data: JoinRequest) => axios.post<JoinResponse>(`${BASE}/api/query/join`, data),
    export: (data: JoinRequest) =>
      axios.post(`${BASE}/api/query/export`, data, { responseType: 'blob' }),
  },
  check: {
    run: (data: CheckRequest) => axios.post<unknown>(`${BASE}/api/check`, data),
  },
  search: {
    query: (data: { query: string; limit?: number }) =>
      axios.post<SearchResponse>(`${BASE}/api/search`, data),
    reindex: () => axios.post<ReindexResponse>(`${BASE}/api/search/reindex`),
    getSettings: () => axios.get<SchedulerSettings>(`${BASE}/api/search/settings`),
    updateSettings: (data: SchedulerSettings) =>
      axios.put<SchedulerSettings>(`${BASE}/api/search/settings`, data),
  },
  library: {
    getSettings: () => axios.get<LibrarySettings>(`${BASE}/api/library/settings`),
    updateSettings: (data: LibrarySettings) =>
      axios.put<LibrarySettings>(`${BASE}/api/library/settings`, data),
    rescan: () => axios.post<LibraryRescanResponse>(`${BASE}/api/library/rescan`),
    groups: () => axios.get<LibraryGroupsResponse>(`${BASE}/api/library/groups`),
  },
}

export interface FileInspectRequest {
  path: string
}
