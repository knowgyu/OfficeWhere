import axios from 'axios'
import { libraryApi } from './library'
import { apiPath, getOfficeWhereBridge } from './transport'
import type {
  AppResetState,
  CloseBehavior,
  ExampleLibraryPathResponse,
  FolderPickResponse,
  SchemaResetState,
  TutorialLibraryCleanupResult,
  UpdateCheckResult,
} from './transport'
import type { CellValue, CompareMode, FileInfo, FileType } from './shared'

export { getBackendBaseUrl, getOfficeWhereBridge } from './transport'
export type {
  AppDataCandidate,
  AppResetReason,
  AppResetState,
  ClearAppDataResult,
  CloseBehavior,
  ExampleLibraryPathResponse,
  FolderPickResponse,
  SchemaResetState,
  TutorialLibraryCleanupResult,
  UpdateAssetInfo,
  UpdateCheckResult,
  UpdateInstallResult,
} from './transport'
export type { CellValue, CompareMode, FileInfo, FileType } from './shared'
export { getLibraryGroups } from './library'
export type {
  LibraryGroupDetail,
  LibraryGroupKind,
  LibraryGroupSummary,
  LibraryGroupsParams,
  LibraryGroupsResponse,
  LibraryRescanMode,
  LibraryRescanResponse,
  LibraryRescanResult,
  LibraryRescanStatus,
  LibrarySettings,
  WatchedFolder,
} from './library'

export interface ClearRegisteredFilesResult {
  deleted: number
  message: string
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

export interface DuplicateFileItem extends FileInfo {
  content_chars: number
  chunk_count: number
}

export interface DuplicateFileGroup {
  content_signature: string
  file_count: number
  distinct_name_count: number
  total_content_chars: number
  latest_mtime?: number | null
  file_types: string[]
  files: DuplicateFileItem[]
}

export interface DuplicateFilesResponse {
  total: number
  groups: DuplicateFileGroup[]
  limit: number
  offset: number
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
  preview: NormalizedPreview
  capabilitySummary: string[]
}

export interface FilePickResponse {
  cancelled: boolean
  file: FileInspectResponse | null
}

export interface FileRegisterRequest {
  path: string
}

export interface FileRegisterResponse {
  id: number
  name: string
  file_type?: string
  columns?: string[]
}

export interface SchemaResponse {
  file_type?: string
  compare_mode?: CompareMode | string
  comparison_mode?: CompareMode | string
  preview?: unknown
  summary?: unknown
  columns?: string[]
  sample?: CellValue[][]
  blocks?: unknown[]
  slides?: unknown[]
  [key: string]: unknown
}

export interface CheckRequest {
  file_ids: number[]
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
  sheet_name?: string
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
}

export interface ExcelDiffGridCell {
  sheet_name?: string
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
  sheet_name?: string
  row_index: number
  row_number: number
  cells: ExcelDiffGridCell[]
}

export interface ExcelDiffGridSection {
  id: string
  sheet_name?: string
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
  sheet_name: string
  partial: boolean
  omitted_focus_count: number
  sections: ExcelDiffGridSection[]
}

export interface ExcelConflictEntry {
  fileId: number
  fileName: string
  sheetName: string
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
  sheetName: string
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

export type CompareWarningType =
  | 'truncated'
  | 'high_change_ratio'
  | 'source_may_be_newer'
  | 'simplified_comparison'
  | 'artifact_missing'
  | 'artifact_version_mismatch'
  | 'artifact_rebuilt_or_refresh_needed'

export interface CompareWarning {
  type: CompareWarningType
  severity: 'info' | 'warning'
  message: string
  fileIds: number[]
  details: Record<string, unknown>
}

export interface CompareMetadata {
  warnings: CompareWarning[]
  usedLastIndexSnapshot: boolean
  sourceStatChecked: boolean
  sourceStatErrorCount: number
  comparedCellCount: number | null
  changedCellCount: number | null
  totalCandidateCellCount: number | null
  simplified: boolean
  artifactStatus: string | null
}

export type CheckResponse =
  | {
      mode: 'excel'
      metadata: CompareMetadata
      totalKeys: number
      matchedKeys: number
      issues: ExcelCheckIssue[]
    }
  | {
      mode: 'word'
      metadata: CompareMetadata
      diffs: WordDiffCard[]
    }
  | {
      mode: 'ppt'
      metadata: CompareMetadata
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

export interface BulkRegisterItem {
  path: string
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
  normalized_hash?: string | null
  content_hash?: string | null
  content_chars?: number | null
  chunk_count?: number | null
}

export type SearchScope = 'filename_content' | 'filename' | 'content'

export interface SearchRequest {
  query: string
  limit?: number
  file_limit?: number
  file_types?: string[]
  search_scope?: SearchScope
  modified_from?: string
  modified_to?: string
}

export interface SearchResponse {
  query: string
  total: number
  results: SearchResult[]
  file_count: number
  file_limit: number
  has_more: boolean
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

async function getDuplicateFiles(params: { limit?: number; offset?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset))

  const url = await apiPath('/api/files/duplicates')
  const suffix = searchParams.toString()
  return axios.get<DuplicateFilesResponse>(suffix ? `${url}?${suffix}` : url)
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

function buildCapabilitySummary(mode: CompareMode, _fileType: FileType): string[] {
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

function normalizePreview(payload: unknown, mode: CompareMode): NormalizedPreview {
  const record = isRecord(payload) ? payload : {}

  const table = normalizeTable(record.preview ?? record)
  const summary = uniqueStrings([
    ...toStringArray(record.summary),
    ...toStringArray(record.highlights),
  ])
  const blocks = normalizePreviewBlocks(record.blocks ?? record.items ?? record.preview_blocks)
  const slides = normalizeSlides(record.slides ?? record.preview_slides)

  if (mode === 'excel') {
    return {
      mode,
      table,
      blocks: [],
      slides: [],
      summary,
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
  const preview = normalizePreview(payload.preview ?? payload, compareMode)
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

  return normalizePreview(payload.preview ?? payload, compareMode)
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
      sheetName: toStringValue(record.sheet_name ?? record.sheetName),
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
      sheetName: toStringValue(record.sheet_name ?? record.sheetName),
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
    const key = toStringValue(record.key_normalized ?? record.key)

    return {
      id: toStringValue(record.id) || `excel-issue-${index}`,
      type,
      severity: toStringValue(record.severity) === 'warning' ? 'warning' : 'conflict',
      sheetName: toStringValue(record.sheet_name ?? record.sheetName),
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

function normalizeCompareWarningType(value: unknown): CompareWarningType {
  const raw = toStringValue(value).trim().toLowerCase()
  if (
    raw === 'truncated' ||
    raw === 'high_change_ratio' ||
    raw === 'source_may_be_newer' ||
    raw === 'simplified_comparison' ||
    raw === 'artifact_missing' ||
    raw === 'artifact_version_mismatch' ||
    raw === 'artifact_rebuilt_or_refresh_needed'
  ) {
    return raw
  }
  return 'source_may_be_newer'
}

function normalizeCompareWarnings(value: unknown): CompareWarning[] {
  if (!Array.isArray(value)) return []

  return value.map((entry): CompareWarning => {
    const record = isRecord(entry) ? entry : {}
    const details = isRecord(record.details) ? record.details : {}
    const severity: CompareWarning['severity'] =
      toStringValue(record.severity) === 'info' ? 'info' : 'warning'
    return {
      type: normalizeCompareWarningType(record.type ?? record.warning_type ?? record.warningType),
      severity,
      message:
        toStringValue(record.message) ||
        (severity === 'info'
          ? '비교 참고 정보가 있습니다.'
          : '비교 결과를 확인할 때 참고할 사항이 있습니다.'),
      fileIds: toNumberArray(record.file_ids ?? record.fileIds),
      details,
    }
  })
}

function normalizeCompareMetadata(value: unknown): CompareMetadata {
  const record = isRecord(value) ? value : {}
  const comparedCellCount = record.compared_cell_count ?? record.comparedCellCount
  const changedCellCount = record.changed_cell_count ?? record.changedCellCount
  const totalCandidateCellCount = record.total_candidate_cell_count ?? record.totalCandidateCellCount
  return {
    warnings: normalizeCompareWarnings(record.warnings),
    usedLastIndexSnapshot: Boolean(record.used_last_index_snapshot ?? record.usedLastIndexSnapshot ?? true),
    sourceStatChecked: Boolean(record.source_stat_checked ?? record.sourceStatChecked ?? false),
    sourceStatErrorCount: toNumberValue(record.source_stat_error_count ?? record.sourceStatErrorCount, 0),
    comparedCellCount:
      comparedCellCount === null || comparedCellCount === undefined
        ? null
        : toNumberValue(comparedCellCount, 0),
    changedCellCount:
      changedCellCount === null || changedCellCount === undefined
        ? null
        : toNumberValue(changedCellCount, 0),
    totalCandidateCellCount:
      totalCandidateCellCount === null || totalCandidateCellCount === undefined
        ? null
        : toNumberValue(totalCandidateCellCount, 0),
    simplified: Boolean(record.simplified ?? false),
    artifactStatus:
      record.artifact_status === null || record.artifactStatus === null
        ? null
        : toStringValue(record.artifact_status ?? record.artifactStatus) || null,
  }
}

export function normalizeCheckResponse(payload: unknown): CheckResponse {
  const record = isRecord(payload) ? payload : {}
  const mode = getCompareMode(record.mode, record.file_type)

  if (mode === 'word') {
    const source = isRecord(record.word) ? record.word : record
    const metadata = normalizeCompareMetadata(record.metadata ?? source.metadata)
    return {
      mode: 'word',
      metadata,
      diffs: normalizeWordDiffs(source.changes ?? source.diffs ?? source.issues ?? source.cards),
    }
  }

  if (mode === 'ppt') {
    const source = isRecord(record.ppt) ? record.ppt : record
    const metadata = normalizeCompareMetadata(record.metadata ?? source.metadata)
    return {
      mode: 'ppt',
      metadata,
      slides: normalizePptSlides(source),
    }
  }

  const source = isRecord(record.excel) ? record.excel : record
  const metadata = normalizeCompareMetadata(record.metadata ?? source.metadata)
  return {
    mode: 'excel',
    metadata,
    totalKeys: toNumberValue(source.total_keys ?? source.totalKeys, 0),
    matchedKeys: toNumberValue(source.matched_keys ?? source.matchedKeys, 0),
    issues: normalizeExcelIssues(source.issues),
  }
}

export const api = {
  files: {
    list: async () => axios.get<FileInfo[]>(await apiPath('/api/files')),
    page: getFilePage,
    duplicates: getDuplicateFiles,
    inspect: (data: FileInspectRequest) =>
      apiPath('/api/files/inspect').then((url) => axios.post<FileInspectResponse>(url, data)),
    pick: pickFileWithBestAvailableDialog,
    register: (data: FileRegisterRequest) =>
      apiPath('/api/files').then((url) => axios.post<FileRegisterResponse>(url, data)),
    delete: async (id: number) => axios.delete(await apiPath(`/api/files/${id}`)),
    deleteAll: async () => axios.delete<ClearRegisteredFilesResult>(await apiPath('/api/files')),
    schema: async (id: number) => axios.get<SchemaResponse>(await apiPath(`/api/files/${id}/schema`)),
    pickFolder: pickFolderWithBestAvailableDialog,
    scanFolder: (data: FolderScanRequest) =>
      apiPath('/api/files/scan-folder').then((url) => axios.post<FolderScanResponse>(url, data)),
    bulkRegister: (data: BulkRegisterRequest) =>
      apiPath('/api/files/bulk-register').then((url) => axios.post<BulkRegisterResponse>(url, data)),
    open: async (id: number) => axios.post(await apiPath(`/api/files/${id}/open`)),
    showInFolder: async (id: number, filePath?: string) => {
      const bridge = getOfficeWhereBridge()
      if (filePath && bridge?.showItemInFolder) {
        try {
          await bridge.showItemInFolder(filePath)
          return { data: { message: '폴더 열기 요청을 보냈습니다.' } }
        } catch {
          // Fall through to the backend reveal command for development builds or
          // unexpected shell API failures.
        }
      }
      return axios.post(await apiPath(`/api/files/${id}/show-in-folder`))
    },
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
    checkForUpdates: async () => {
      const electron = electronApi()
      if (!electron?.checkForUpdates) {
        return {
          data: {
            currentVersion: '',
            latestVersion: '',
            updateAvailable: false,
            releaseUrl: '',
          } satisfies UpdateCheckResult,
        }
      }
      return { data: await electron.checkForUpdates() }
    },
    installUpdate: async () => {
      const electron = electronApi()
      if (!electron?.installUpdate) desktopError('Electron 앱에서만 업데이트를 적용할 수 있습니다.')
      return { data: await electron.installUpdate() }
    },
    openReleasePage: async () => {
      const electron = electronApi()
      if (!electron?.openReleasePage) {
        window.open('https://github.com/knowgyu/OfficeWhere/releases/latest', '_blank', 'noopener,noreferrer')
        return { data: undefined }
      }
      await electron.openReleasePage()
      return { data: undefined }
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
    createTutorialLibrary: async () =>
      axios.post<ExampleLibraryPathResponse>(await apiPath('/api/app/tutorial-library')),
    cleanupTutorialLibrary: async (path?: string) =>
      axios.delete<TutorialLibraryCleanupResult>(await apiPath('/api/app/tutorial-library'), {
        data: { path },
      }),
    consumeSchemaResetState: async () => {
      try {
        return await axios.get<SchemaResetState>(await apiPath('/api/app/schema-reset-state'))
      } catch {
        return { data: { resetPending: false } as SchemaResetState }
      }
    },
  },
  library: libraryApi,
}

export interface FileInspectRequest {
  path: string
}
