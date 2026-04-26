import { useEffect, useMemo, useState } from 'react'

import {
  api,
  AppDataCandidate,
  ClearAppDataResult,
  FileInfo,
  FileInspectResponse,
  LibraryRescanResponse,
  LibraryRescanStatus,
  LibrarySettings,
  NormalizedFileInspect,
  NormalizedPreview,
  SchemaResponse,
  formatParserConfigSummary,
  getCompareMode,
  normalizeFileType,
  isExcelFile,
  normalizeFileInspect,
  normalizeSchemaResponse,
} from '../api/client'
import {
  Badge,
  Button,
  Card,
  CardSection,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  FileTypeBadge,
  Icon,
  IconButton,
  SelectField,
  Spinner,
  Switch,
  TextField,
  useSnackbar,
} from '../ui'
import { useLibraryRescan } from '../contexts/LibraryRescanContext'
import {
  APP_TEXT_SIZE_DESCRIPTIONS,
  APP_TEXT_SIZE_LABELS,
  APP_TEXT_SIZE_ORDER,
  useDisplaySettings,
} from '../contexts/DisplaySettingsContext'
import PreviewPanel from './PreviewPanel'

function rescanTitle(status: LibraryRescanStatus | null, rescanning: boolean) {
  if (!rescanning && status?.stage === 'failed') return '대상 폴더 색인 실패'
  if (!rescanning && status?.stage === 'cancelled') return '대상 폴더 색인 정지됨'
  if (!rescanning) return '최근 색인 결과'
  if (status?.stage === 'scanning') return '대상 폴더 스캔 중'
  if (status?.stage === 'indexing') return '변경 확인 및 파일 색인 중'
  if (status?.stage === 'cancelling') return '정지 요청 처리 중'
  return '대상 폴더 색인 준비 중'
}

function rescanDetail(status: LibraryRescanStatus | null, summary: LibraryRescanResponse | null, rescanning: boolean) {
  if (rescanning && status) {
    const foundText = `발견 ${status.found}개`
    const progressText =
      status.total > 0
        ? `처리 ${status.processed}/${status.total} · ${Math.round(status.percent)}%`
        : status.folders_total > 0
          ? `폴더 ${status.folders_processed}/${status.folders_total}`
          : '진행률 계산 중'
    const current = status.current_file ? ` · 현재 ${status.current_file}` : ''
    return `${foundText} · ${progressText}${current}`
  }

  const source = summary ?? status?.summary
  if (!source) return '아직 실행 결과가 없습니다.'
  const checked = source.registered + source.updated + source.skipped
  const unchanged = source.skipped > 0 ? ` · 변경 없음 ${source.skipped}` : ''
  const cancelled = source.cancelled > 0 ? ` · 정지 ${source.cancelled}` : ''
  return `등록/확인 ${checked} · 신규 ${source.registered} · 갱신 ${source.updated}${unchanged}${cancelled} · 실패 ${source.failed}`
}

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const REGISTERED_FILE_PAGE_SIZE = 50
const SAFE_APP_DATA_IDS = new Set([
  'backend-data',
  'chromium-cache',
  'chromium-code-cache',
  'chromium-local-storage',
  'chromium-session-storage',
  'chromium-gpu-cache',
  'legacy-home-data',
])

function existingAppDataIds(candidates: AppDataCandidate[], ids: Set<string>) {
  return candidates
    .filter((candidate) => candidate.exists && ids.has(candidate.id))
    .map((candidate) => candidate.id)
}

function appDataSize(candidates: AppDataCandidate[], ids: string[]) {
  const selected = new Set(ids)
  return candidates.reduce(
    (total, candidate) => total + (selected.has(candidate.id) ? candidate.sizeBytes ?? 0 : 0),
    0,
  )
}

export default function FileManager() {
  const snackbar = useSnackbar()
  const { textSize, setTextSize } = useDisplaySettings()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTotal, setFileTotal] = useState(0)
  const [fileCountsByType, setFileCountsByType] = useState<Record<string, number>>({})
  const [fileOffset, setFileOffset] = useState(0)
  const [fileQuery, setFileQuery] = useState('')
  const [fileQueryDraft, setFileQueryDraft] = useState('')
  const [loading, setLoading] = useState(false)

  const [filePath, setFilePath] = useState('')
  const [keyColumn, setKeyColumn] = useState('')
  const [inspectedFile, setInspectedFile] = useState<NormalizedFileInspect | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [registering, setRegistering] = useState(false)

  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [schema, setSchema] = useState<NormalizedPreview | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<FileInfo | null>(null)
  const [librarySettings, setLibrarySettings] = useState<LibrarySettings>({
    watched_folders: [],
    auto_rescan_mode: 'interval',
    auto_rescan_interval_hours: 24,
    auto_rescan_daily_time: '03:00',
    last_rescan_at: null,
  })
  const [folderPathDraft, setFolderPathDraft] = useState('')
  const [folderRecursive, setFolderRecursive] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [folderPicking, setFolderPicking] = useState(false)
  const {
    status: rescanStatus,
    summary: rescanSummary,
    running: rescanning,
    completionKey: rescanCompletionKey,
    startRescan,
  } = useLibraryRescan()
  const [appDataPaths, setAppDataPaths] = useState<AppDataCandidate[]>([])
  const [appDataLoading, setAppDataLoading] = useState(false)
  const [selectedAppDataIds, setSelectedAppDataIds] = useState<string[]>([])
  const [appDataAdvancedOpen, setAppDataAdvancedOpen] = useState(false)
  const [clearAppDataOpen, setClearAppDataOpen] = useState(false)
  const [clearAppDataResult, setClearAppDataResult] = useState<ClearAppDataResult | null>(null)
  const appDataAvailable =
    typeof window !== 'undefined' &&
    Boolean(window.officeDataJoiner?.getAppDataPaths && window.officeDataJoiner?.clearAppData)

  const fetchFiles = async (nextOffset = fileOffset, nextQuery = fileQuery) => {
    setLoading(true)
    try {
      const response = await api.files.page({
        limit: REGISTERED_FILE_PAGE_SIZE,
        offset: nextOffset,
        query: nextQuery,
      })
      setFiles(response.data.items)
      setFileTotal(response.data.total)
      setFileCountsByType(response.data.counts_by_type ?? {})
      setFileOffset(response.data.offset)
      setFileQuery(nextQuery)
    } catch {
      snackbar.error('파일 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const fetchAppDataPaths = async () => {
    if (!appDataAvailable) return
    setAppDataLoading(true)
    try {
      const response = await api.app.getDataPaths()
      setAppDataPaths(response.data)
      setSelectedAppDataIds((current) => {
        if (current.length > 0) return current.filter((id) => response.data.some((item) => item.id === id))
        return existingAppDataIds(response.data, SAFE_APP_DATA_IDS)
      })
    } catch {
      snackbar.error('앱 데이터 경로를 불러오지 못했습니다.')
    } finally {
      setAppDataLoading(false)
    }
  }

  useEffect(() => {
    void fetchFiles(0, '')
    void fetchLibrarySettings()
    void fetchAppDataPaths()
  }, [])

  useEffect(() => {
    if (rescanCompletionKey === 0) return
    void fetchFiles(0, fileQuery)
    void fetchLibrarySettings()
  }, [rescanCompletionKey])

  const fetchLibrarySettings = async () => {
    setSettingsLoading(true)
    try {
      const response = await api.library.getSettings()
      setLibrarySettings(response.data)
    } catch {
      snackbar.error('라이브러리 설정을 불러오지 못했습니다.')
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveLibrarySettings = async (next: LibrarySettings) => {
    setSettingsLoading(true)
    try {
      const response = await api.library.updateSettings(next)
      setLibrarySettings(response.data)
      snackbar.success('대상 폴더 설정이 저장되었습니다.')
      return response.data
    } catch {
      snackbar.error('대상 폴더 설정 저장에 실패했습니다.')
      return null
    } finally {
      setSettingsLoading(false)
    }
  }

  const handlePickWatchedFolder = async () => {
    setFolderPicking(true)
    try {
      const response = await api.files.pickFolder()
      if (!response.data.cancelled && response.data.folder_path) {
        setFolderPathDraft(response.data.folder_path)
      }
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '폴더 선택창을 열지 못했습니다. 경로를 직접 입력해 주세요.'
      snackbar.error(detail)
    } finally {
      setFolderPicking(false)
    }
  }

  const handleAddWatchedFolder = async () => {
    const path = folderPathDraft.trim()
    if (!path) {
      snackbar.warn('대상 폴더 경로를 입력해 주세요.')
      return
    }
    const exists = librarySettings.watched_folders.some((folder) => folder.path === path)
    const next: LibrarySettings = {
      ...librarySettings,
      watched_folders: exists
        ? librarySettings.watched_folders.map((folder) =>
            folder.path === path ? { ...folder, recursive: folderRecursive } : folder,
          )
        : [...librarySettings.watched_folders, { path, recursive: folderRecursive }],
    }
    const saved = await saveLibrarySettings(next)
    if (!saved) return

    setFolderPathDraft('')
    await startRescan('added')
  }

  const handleRemoveWatchedFolder = async (path: string) => {
    await saveLibrarySettings({
      ...librarySettings,
      watched_folders: librarySettings.watched_folders.filter((folder) => folder.path !== path),
    })
  }

  const handleUpdateAutoRescan = async (patch: Partial<LibrarySettings>) => {
    await saveLibrarySettings({ ...librarySettings, ...patch })
  }

  const normalizeIntervalHours = (value: string | number) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 1) {
      snackbar.warn('반복 주기는 1 이상인 정수만 입력할 수 있습니다.')
      return null
    }
    return Math.floor(numeric)
  }

  const handleUpdateIntervalHours = async (value: string) => {
    const normalized = normalizeIntervalHours(value)
    if (normalized === null) return
    await handleUpdateAutoRescan({ auto_rescan_interval_hours: normalized })
  }

  const handleRescanLibrary = async () => {
    await startRescan('manual')
  }

  const openClearAppDataPreset = (candidateIds: string[]) => {
    if (candidateIds.length === 0) {
      snackbar.warn('삭제할 앱 데이터가 없습니다.')
      return
    }
    setSelectedAppDataIds(candidateIds)
    setClearAppDataOpen(true)
  }

  const toggleAppDataCandidate = (id: string) => {
    setSelectedAppDataIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const handleFileSearch = () => {
    const nextQuery = fileQueryDraft.trim()
    setFileOffset(0)
    void fetchFiles(0, nextQuery)
  }

  const clearFileSearch = () => {
    setFileQueryDraft('')
    setFileOffset(0)
    void fetchFiles(0, '')
  }

  const goToFilePage = (nextOffset: number) => {
    const boundedOffset = Math.max(0, nextOffset)
    setFileOffset(boundedOffset)
    void fetchFiles(boundedOffset, fileQuery)
  }

  const handleClearAppData = async () => {
    if (selectedAppDataIds.length === 0) {
      snackbar.warn('삭제할 앱 데이터 항목을 선택해 주세요.')
      return
    }
    setAppDataLoading(true)
    try {
      const response = await api.app.clearData(selectedAppDataIds, true)
      setClearAppDataResult(response.data)
      if (response.data.success) {
        snackbar.success('앱 데이터를 삭제했습니다. 앱을 재시작합니다.')
      } else {
        snackbar.error('일부 앱 데이터 삭제에 실패했습니다.')
      }
      setClearAppDataOpen(false)
      if (!response.data.restartScheduled) void fetchAppDataPaths()
    } catch {
      snackbar.error('앱 데이터 삭제 요청에 실패했습니다.')
    } finally {
      setAppDataLoading(false)
    }
  }

  const resetInspection = () => {
    setInspectedFile(null)
    setSelectedCandidateId('')
    setKeyColumn('')
  }

  const applyInspection = (payload: FileInspectResponse) => {
    const normalized = normalizeFileInspect(payload)
    const firstCandidateId = normalized.parserCandidates[0]?.id ?? ''

    setInspectedFile(normalized)
    setFilePath(normalized.path)
    setSelectedCandidateId(firstCandidateId)
    setKeyColumn(
      normalized.keyRequired ? normalized.suggestedKey || normalized.keyOptions[0] || '' : '',
    )
  }

  const selectedCandidate = useMemo(() => {
    if (!inspectedFile || inspectedFile.compareMode !== 'excel') return null
    return (
      inspectedFile.parserCandidates.find((candidate) => candidate.id === selectedCandidateId) ??
      inspectedFile.parserCandidates[0] ??
      null
    )
  }, [inspectedFile, selectedCandidateId])

  const effectivePreview = useMemo(() => {
    if (!inspectedFile) return null
    if (!selectedCandidate) return inspectedFile.preview
    return {
      ...inspectedFile.preview,
      table: selectedCandidate.table,
      summary:
        selectedCandidate.summary.length > 0 ? selectedCandidate.summary : inspectedFile.preview.summary,
    }
  }, [inspectedFile, selectedCandidate])

  const availableColumns = selectedCandidate?.table.columns ?? inspectedFile?.keyOptions ?? []
  const effectiveParserConfig = selectedCandidate?.parserConfig ?? inspectedFile?.parserConfig ?? {}
  const keyRequired = inspectedFile?.keyRequired ?? false
  const normalizedFolderDraft = folderPathDraft.trim()
  const hasPendingNewFolder =
    Boolean(normalizedFolderDraft) &&
    !librarySettings.watched_folders.some((folder) => folder.path === normalizedFolderDraft)
  const safeResetIds = useMemo(() => existingAppDataIds(appDataPaths, SAFE_APP_DATA_IDS), [appDataPaths])
  const fullResetIds = useMemo(
    () => appDataPaths.filter((candidate) => candidate.exists && candidate.id === 'user-data-root').map((candidate) => candidate.id),
    [appDataPaths],
  )
  const safeResetSize = appDataSize(appDataPaths, safeResetIds)
  const fullResetSize = appDataSize(appDataPaths, fullResetIds)
  const selectedAppDataPaths = appDataPaths.filter((item) => selectedAppDataIds.includes(item.id))
  const selectedAppDataSize = appDataSize(appDataPaths, selectedAppDataIds)
  const selectedFullReset = selectedAppDataIds.includes('user-data-root')
  const visibleFileStart = fileTotal === 0 ? 0 : fileOffset + 1
  const visibleFileEnd = Math.min(fileOffset + files.length, fileTotal)
  const hasPreviousFilePage = fileOffset > 0
  const hasNextFilePage = fileOffset + files.length < fileTotal
  const fileTypeCounts = Object.entries(fileCountsByType)

  const handleInspectPath = async () => {
    if (!filePath.trim()) {
      snackbar.warn('파일 경로를 입력해 주세요.')
      return
    }
    setInspecting(true)
    try {
      const response = await api.files.inspect({ path: filePath.trim() })
      applyInspection(response.data)
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '파일 검사에 실패했습니다.'
      snackbar.error(detail)
      resetInspection()
    } finally {
      setInspecting(false)
    }
  }

  const handlePickFile = async () => {
    setPicking(true)
    try {
      const response = await api.files.pick()
      if (!response.data.cancelled && response.data.file) {
        applyInspection(response.data.file)
      }
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '파일 선택창을 열지 못했습니다.'
      snackbar.error(detail)
    } finally {
      setPicking(false)
    }
  }

  const handleCandidateChange = (candidateId: string) => {
    if (!inspectedFile || inspectedFile.compareMode !== 'excel') return
    const candidate =
      inspectedFile.parserCandidates.find((item) => item.id === candidateId) ??
      inspectedFile.parserCandidates[0]

    setSelectedCandidateId(candidateId)
    if (!candidate) return

    const nextColumns = candidate.table.columns
    if (nextColumns.length === 0) return

    if (!nextColumns.includes(keyColumn)) {
      const nextKey = inspectedFile.suggestedKey
      setKeyColumn(nextKey && nextColumns.includes(nextKey) ? nextKey : nextColumns[0] ?? '')
    }
  }

  const handleRegister = async () => {
    if (!filePath.trim()) {
      snackbar.warn('파일 경로를 입력해 주세요.')
      return
    }
    if (!inspectedFile) {
      snackbar.warn('먼저 파일 검사를 실행해 주세요.')
      return
    }
    if (keyRequired && !keyColumn.trim()) {
      snackbar.warn('Excel 등록에는 기준 컬럼이 필요합니다.')
      return
    }

    setRegistering(true)
    try {
      await api.files.register({
        path: filePath.trim(),
        key_column: keyRequired ? keyColumn.trim() : '',
        parser_config: effectiveParserConfig,
      })
      snackbar.success(`"${inspectedFile.name}" 등록 완료.`)
      setFilePath('')
      resetInspection()
      await fetchFiles(0, fileQuery)
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '파일 등록에 실패했습니다.'
      snackbar.error(detail)
    } finally {
      setRegistering(false)
    }
  }

  const handleDelete = async (file: FileInfo) => {
    try {
      await api.files.delete(file.id)
      snackbar.success(`"${file.name}" 등록 해제됨.`)
      const nextOffset =
        files.length === 1 && fileOffset > 0
          ? Math.max(0, fileOffset - REGISTERED_FILE_PAGE_SIZE)
          : fileOffset
      await fetchFiles(nextOffset, fileQuery)
    } catch {
      snackbar.error('파일 삭제에 실패했습니다.')
    } finally {
      setConfirmDelete(null)
    }
  }

  const handlePreview = async (file: FileInfo) => {
    setPreviewFile(file)
    setSchema(null)
    setSchemaLoading(true)
    try {
      const response = await api.files.schema(file.id)
      setSchema(normalizeSchemaResponse(response.data as SchemaResponse, file.file_type))
    } catch {
      setSchema(null)
    } finally {
      setSchemaLoading(false)
    }
  }

  const registeredSummary = (file: FileInfo) => {
    const fileType = normalizeFileType(file.file_type)
    const mode = getCompareMode(undefined, file.file_type)
    const parserSummary = formatParserConfigSummary(file.parser_config ?? undefined)
    if (mode === 'excel') {
      return [
        parserSummary.join(' · ') || `등록 컬럼 ${file.column_count}개`,
        file.key_column ? `기준 컬럼 ${file.key_column}` : '기준 컬럼 미지정',
        'Excel 통합과 여러 파일 비교',
      ]
    }
    if (mode === 'word') return ['문단/표 행 변경 확인', '2개 파일 비교', '기준 컬럼 불필요']
    if (fileType === 'PowerPoint') return ['슬라이드 변경 확인', '추가/삭제 및 내용 변경', '기준 컬럼 불필요']
    return ['검색 내용 미리보기', '변경점 확인 제외', '기준 컬럼 불필요']
  }

  return (
    <div className="space-y-6">
      <Card variant="elevated">
        <CardSection
          title="화면 표시"
          description="앱 전체 글자 크기를 조정합니다. 검색 결과, 설정, 버전 관리, Excel 표 내용에 함께 적용됩니다. Ctrl + / Ctrl - / Ctrl + 휠도 전체 화면에서 동작합니다."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {APP_TEXT_SIZE_ORDER.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setTextSize(size)}
                className={`state-host relative text-left rounded-md border p-4 transition-colors ${
                  textSize === size
                    ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/40'
                    : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-low)]'
                }`}
              >
                <span className="state-layer" />
                <span className="relative flex items-center justify-between gap-2">
                  <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                    {APP_TEXT_SIZE_LABELS[size]}
                  </span>
                  {textSize === size && <Icon name="check_circle" size={20} filled className="text-[var(--md-sys-color-primary)]" />}
                </span>
                <span className="relative block type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-2">
                  {APP_TEXT_SIZE_DESCRIPTIONS[size]}
                </span>
              </button>
            ))}
          </div>
        </CardSection>
      </Card>
      <Card variant="elevated">
        <CardSection
          title="대상 폴더"
          description="자주 쓰는 문서 폴더를 등록하면 검색과 버전 관리에 바로 사용할 수 있습니다. K:/ 같은 네트워크 드라이브도 접근 가능하면 추가할 수 있고, 앱은 원본 문서를 읽기만 합니다."
          trailing={
            <Button
              variant="filled"
              leadingIcon="sync"
              onClick={handleRescanLibrary}
              loading={rescanning}
              disabled={settingsLoading || librarySettings.watched_folders.length === 0}
            >
              자동 등록 / 재스캔
            </Button>
          }
        >
          <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
            <div className="flex-1 min-w-0">
              <TextField
                leadingIcon="folder"
                placeholder="검색/검사 대상 폴더 경로"
                value={folderPathDraft}
                onChange={(event) => setFolderPathDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAddWatchedFolder()
                }}
              />
            </div>
            <Button
              variant="tonal"
              leadingIcon="drive_folder_upload"
              onClick={handlePickWatchedFolder}
              loading={folderPicking}
              disabled={settingsLoading || rescanning}
            >
              폴더 찾기
            </Button>
            <Button
              variant={hasPendingNewFolder ? 'filled' : 'outlined'}
              leadingIcon={hasPendingNewFolder ? 'add_circle' : 'add'}
              iconFilled={hasPendingNewFolder}
              onClick={handleAddWatchedFolder}
              loading={settingsLoading}
              disabled={folderPicking || rescanning}
              className={hasPendingNewFolder ? 'attention-pulse' : ''}
            >
              대상 추가
            </Button>
          </div>
          <Switch
            checked={folderRecursive}
            onChange={(event) => setFolderRecursive(event.target.checked)}
            label="하위 폴더 포함"
            description="프로젝트/연도별 하위 폴더까지 자동 등록합니다."
          />

          {librarySettings.watched_folders.length === 0 ? (
            <EmptyState
              icon="folder_off"
              title="지정된 대상 폴더가 없습니다"
              description="먼저 자주 쓰는 작업 폴더(업무/연구/강의/프로젝트 등)를 추가한 뒤 자동 등록을 실행하세요."
              compact
            />
          ) : (
            <div className="space-y-2">
              {librarySettings.watched_folders.map((folder) => (
                <div
                  key={folder.path}
                  className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-4 py-3 flex items-center gap-3"
                >
                  <Icon name="folder" size={20} className="text-[var(--md-sys-color-primary)]" />
                  <div className="min-w-0 flex-1">
                    <p className="type-title-sm text-[var(--md-sys-color-on-surface)] break-all">
                      {folder.path}
                    </p>
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                      {folder.recursive ? '하위 폴더 포함' : '현재 폴더만'}
                    </p>
                  </div>
                  <IconButton
                    icon="delete"
                    label="대상 폴더 제거"
                    size="sm"
                    onClick={() => void handleRemoveWatchedFolder(folder.path)}
                    disabled={rescanning}
                  />
                </div>
              ))}
            </div>
          )}

          {(rescanning || rescanSummary) && (
            <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-4 py-3 flex items-start gap-3">
              <div className="mt-0.5 text-[var(--md-sys-color-primary)]">
                {rescanning ? <Spinner size={20} /> : <Icon name="task_alt" size={20} filled />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                  {rescanTitle(rescanStatus, rescanning)}
                </p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  {rescanDetail(rescanStatus, rescanSummary, rescanning)}
                </p>
                {rescanning && rescanStatus && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--md-sys-color-surface-container-high)]">
                    <div
                      className="h-full rounded-full bg-[var(--md-sys-color-primary)] transition-[width] duration-300"
                      style={{ width: `${Math.min(Math.max(rescanStatus.percent, 4), 100)}%` }}
                    />
                  </div>
                )}
                {!rescanning && rescanSummary && rescanSummary.failed > 0 && (
                  <details className="mt-2 space-y-2">
                    <summary className="type-label-lg text-[var(--md-sys-color-error)] cursor-pointer">
                      실패 항목 자세히 보기 ({rescanSummary.failed}개)
                    </summary>
                    <div className="mt-2 space-y-2">
                      {rescanSummary.results
                        .filter((item) => !item.success)
                        .map((item) => (
                          <div
                            key={item.path}
                            className="rounded-sm bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] p-3"
                          >
                            <p className="type-title-sm break-all">
                              {item.name}: {item.error_hint || item.error}
                            </p>
                            <p className="type-body-sm break-all opacity-80">
                              {item.error_code || 'unknown'}
                              {item.diagnostic_id ? ` · 진단 ID ${item.diagnostic_id}` : ''}
                              {item.error ? ` · 상세: ${item.error}` : ''}
                            </p>
                          </div>
                        ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}

          <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4">
            <div>
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">자동 재스캔 주기</p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                등록한 폴더를 주기적으로 확인해 새 파일과 수정된 파일을 검색 대상으로 반영합니다.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px_140px] gap-3 items-end">
              <SelectField
                label="자동 재스캔"
                value={librarySettings.auto_rescan_mode}
                onChange={(event) =>
                  void handleUpdateAutoRescan({
                    auto_rescan_mode: event.target.value as LibrarySettings['auto_rescan_mode'],
                  })
                }
              >
                <option value="manual">수동으로만 실행</option>
                <option value="interval">주기 반복</option>
                <option value="daily">매일 정시</option>
              </SelectField>
              {librarySettings.auto_rescan_mode === 'interval' && (
                <TextField
                  label="반복 주기(시간)"
                  type="number"
                  min={1}
                  max={168}
                  step={1}
                  value={librarySettings.auto_rescan_interval_hours}
                  onChange={(event) => void handleUpdateIntervalHours(event.target.value)}
                />
              )}
              {librarySettings.auto_rescan_mode === 'daily' && (
                <TextField
                  label="실행 시각"
                  type="time"
                  value={librarySettings.auto_rescan_daily_time}
                  onChange={(event) =>
                    void handleUpdateAutoRescan({
                      auto_rescan_daily_time: event.target.value,
                    })
                  }
                />
              )}
              <div className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                마지막 재스캔
                <br />
                <span className="text-[var(--md-sys-color-on-surface)]">
                  {librarySettings.last_rescan_at
                    ? new Date(librarySettings.last_rescan_at).toLocaleString('ko-KR')
                    : '아직 없음'}
                </span>
              </div>
            </div>
          </div>
        </CardSection>
      </Card>

      <Card variant="elevated">
        <CardSection
          title="앱 데이터 관리"
          description="검색 색인과 앱 설정처럼 앱이 만든 데이터만 초기화합니다. 원본 문서와 대상 폴더는 삭제하지 않습니다."
          trailing={
            appDataAvailable ? (
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="tonal"
                  leadingIcon="refresh"
                  onClick={() => void fetchAppDataPaths()}
                  loading={appDataLoading}
                >
                  경로 새로고침
                </Button>
              </div>
            ) : null
          }
        >
          {!appDataAvailable ? (
            <EmptyState
              icon="desktop_windows"
              title="Electron 앱에서만 사용할 수 있습니다"
              description="브라우저/개발 서버 모드에서는 앱 userData 경로를 안전하게 확인할 수 없어 삭제 기능을 비활성화합니다."
              compact
            />
          ) : appDataPaths.length === 0 ? (
            <EmptyState
              icon="folder_managed"
              title="앱 데이터 경로를 불러오세요"
              description="경로 새로고침을 누르면 초기화 가능한 앱 데이터를 확인합니다."
              compact
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="type-title-md text-[var(--md-sys-color-on-surface)]">
                        검색/앱 설정 초기화
                      </p>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        검색 색인, 앱 화면 설정, 임시 캐시를 다시 만듭니다. 문제가 생겼을 때 먼저 시도할 안전한 초기화입니다.
                      </p>
                    </div>
                    <Badge tone={safeResetIds.length > 0 ? 'success' : 'neutral'}>
                      {safeResetIds.length > 0 ? formatBytes(safeResetSize) : '삭제할 항목 없음'}
                    </Badge>
                  </div>
                  <Button
                    variant="filled"
                    leadingIcon="restart_alt"
                    onClick={() => openClearAppDataPreset(safeResetIds)}
                    disabled={safeResetIds.length === 0 || appDataLoading}
                  >
                    초기화 후 재시작
                  </Button>
                </div>

                <div className="rounded-md border border-[var(--md-sys-color-error)]/50 bg-[var(--md-sys-color-error-container)]/20 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="type-title-md text-[var(--md-sys-color-on-surface)]">
                        문제 해결용 전체 초기화
                      </p>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        앱 프로필 전체를 새로 만듭니다. 원본 문서는 삭제하지 않지만 앱 설정과 세션은 초기화됩니다.
                      </p>
                    </div>
                    <Badge tone={fullResetIds.length > 0 ? 'warning' : 'neutral'}>
                      {fullResetIds.length > 0 ? formatBytes(fullResetSize) : '삭제할 항목 없음'}
                    </Badge>
                  </div>
                  <Button
                    variant="outlined"
                    leadingIcon="warning"
                    className="!text-[var(--md-sys-color-error)]"
                    onClick={() => openClearAppDataPreset(fullResetIds)}
                    disabled={fullResetIds.length === 0 || appDataLoading}
                  >
                    전체 초기화
                  </Button>
                </div>
              </div>

              <details
                className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4"
                open={appDataAdvancedOpen}
                onToggle={(event) => setAppDataAdvancedOpen(event.currentTarget.open)}
              >
                <summary className="type-label-lg text-[var(--md-sys-color-primary)] cursor-pointer">
                  고급 보기: 삭제 대상 직접 선택
                </summary>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-2">
                  문제 해결을 위해 세부 항목을 직접 고를 때만 사용하세요.
                </p>
                <div className="mt-3 space-y-2">
                  {appDataPaths.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-4 py-3 flex items-start gap-3"
                    >
                      <Checkbox
                        checked={selectedAppDataIds.includes(candidate.id)}
                        onChange={() => toggleAppDataCandidate(candidate.id)}
                        disabled={!candidate.exists || appDataLoading}
                        label=""
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{candidate.label}</p>
                          <Badge tone={candidate.exists ? 'success' : 'neutral'}>
                            {candidate.exists ? formatBytes(candidate.sizeBytes) : '없음'}
                          </Badge>
                          {candidate.dangerous && <Badge tone="warning">전체 초기화</Badge>}
                        </div>
                        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                          {candidate.description}
                        </p>
                        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] break-all">
                          {candidate.path}
                        </p>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="outlined"
                    leadingIcon="delete_sweep"
                    className="!text-[var(--md-sys-color-error)]"
                    onClick={() => setClearAppDataOpen(true)}
                    disabled={selectedAppDataIds.length === 0 || appDataLoading}
                  >
                    선택한 항목 삭제
                  </Button>
                </div>
              </details>
            </div>
          )}
          {clearAppDataResult && (
            <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-2">
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">최근 삭제 결과</p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                backend 종료 {clearAppDataResult.backendStopped ? '확인' : '타임아웃'} · 삭제 {clearAppDataResult.deleted.length}개 · 실패 {clearAppDataResult.failed.length}개
              </p>
              {clearAppDataResult.failed.map((item) => (
                <p key={`${item.id}-${item.path}`} className="type-body-sm text-[var(--md-sys-color-error)] break-all">
                  {item.path}: {item.error}
                </p>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      <Card variant="elevated">
        <CardSection
          title="개별 파일 추가"
          description="대상 폴더 밖에 있는 파일만 수동으로 추가하세요. Excel은 어떤 행을 제목으로 볼지와 기준 컬럼을 확인한 뒤 등록합니다."
          trailing={
            <div className="flex gap-2 flex-wrap">
              <Chip label="Excel · 통합 + 비교" tone="success" icon="table_chart" as="span" />
              <Chip label="Word / PPT · 변경 비교" tone="primary" icon="article" as="span" />
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
              <div className="flex-1 min-w-0">
                <TextField
                  leadingIcon="folder_open"
                  placeholder="파일 경로 입력 또는 파일 찾기 사용"
                  value={filePath}
                  onChange={(event) => {
                    setFilePath(event.target.value)
                    if (inspectedFile && event.target.value !== inspectedFile.path) {
                      resetInspection()
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleInspectPath()
                  }}
                />
              </div>
              <Button
                variant="outlined"
                leadingIcon="find_in_page"
                onClick={handleInspectPath}
                loading={inspecting}
              >
                경로 검사
              </Button>
              <Button
                variant="tonal"
                leadingIcon="upload_file"
                onClick={handlePickFile}
                loading={picking}
              >
                파일 찾기
              </Button>
            </div>

            {inspectedFile && (
              <InspectionCard
                inspectedFile={inspectedFile}
                selectedCandidateId={selectedCandidateId}
                effectivePreview={effectivePreview}
                effectiveParserConfig={effectiveParserConfig}
                keyColumn={keyColumn}
                onKeyColumn={setKeyColumn}
                onCandidateChange={handleCandidateChange}
                availableColumns={availableColumns}
                onRegister={handleRegister}
                registering={registering}
              />
            )}
          </div>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            지원 형식 · .xlsx · .xls · .docx · .pptx · .txt · .md
          </p>
        </CardSection>
      </Card>

      <Card variant="outlined" className="overflow-hidden">
        <header className="px-6 py-4 space-y-4 border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
            <h3 className="type-title-md text-[var(--md-sys-color-on-surface)]">
              등록된 파일 <span className="text-[var(--md-sys-color-on-surface-variant)]">({fileTotal})</span>
            </h3>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              전체 목록을 한 번에 띄우지 않고 최근 50개 또는 검색 결과만 보여줍니다. 등록 해제는 목록에서만 제거하며 원본 파일은 삭제하지 않습니다.
            </p>
            </div>
            <IconButton
              icon="refresh"
              label="새로고침"
              variant="tonal"
              onClick={() => void fetchFiles(fileOffset, fileQuery)}
              disabled={loading}
            />
          </div>
          <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
            <div className="flex-1 min-w-[240px]">
              <TextField
                leadingIcon="search"
                placeholder="파일명 또는 경로로 검색"
                value={fileQueryDraft}
                onChange={(event) => setFileQueryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleFileSearch()
                }}
              />
            </div>
            <Button variant="filled" leadingIcon="search" onClick={handleFileSearch} disabled={loading}>
              검색
            </Button>
            {fileQuery && (
              <Button variant="text" leadingIcon="close" onClick={clearFileSearch} disabled={loading}>
                검색 해제
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip
              label={
                fileTotal === 0
                  ? '표시 0개'
                  : `표시 ${visibleFileStart}-${visibleFileEnd} / 전체 ${fileTotal}`
              }
              tone="primary"
              icon="view_list"
              as="span"
            />
            {fileQuery && <Chip label={`검색어 · ${fileQuery}`} tone="secondary" icon="search" as="span" />}
            {fileTypeCounts.map(([fileType, count]) => (
              <Chip key={fileType} label={`${fileType} ${count}`} tone="neutral" as="span" />
            ))}
          </div>
        </header>

        {loading ? (
          <div className="px-6 py-10 flex items-center justify-center gap-2 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
            <Spinner size={18} /> 불러오는 중…
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon="library_add"
            title="아직 등록된 파일이 없습니다"
            description="파일 경로를 입력하거나 '파일 찾기'로 Excel / Word / PPT / 텍스트(.txt, .md) 파일을 추가해 보세요."
            compact
          />
        ) : (
          <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {files.map((file) => (
              <li
                key={file.id}
                className="px-6 py-4 flex items-start justify-between gap-4 hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors"
              >
                <button
                  type="button"
                  onClick={() => handlePreview(file)}
                  className="flex-1 min-w-0 text-left group"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="type-title-sm text-[var(--md-sys-color-primary)] group-hover:underline">
                      {file.name}
                    </span>
                    <FileTypeBadge fileType={file.file_type} />
                    {isExcelFile(file.file_type) ? (
                      <Badge tone="success">통합 가능</Badge>
                    ) : ['Text', 'Markdown'].includes(normalizeFileType(file.file_type)) ? (
                      <Badge tone="neutral">검색용</Badge>
                    ) : (
                      <Badge tone="warning">검색/비교용</Badge>
                    )}
                  </div>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1 break-all">
                    {file.path}
                  </p>
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {registeredSummary(file).map((item) => (
                      <Chip key={item} label={item} tone="neutral" as="span" />
                    ))}
                  </div>
                </button>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {file.created_at ? file.created_at.replace('T', ' ').slice(0, 19) : '-'}
                  </p>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {isExcelFile(file.file_type) && file.key_column
                      ? `기준 컬럼 ${file.key_column}`
                      : '기준 컬럼 없음'}
                  </p>
                  <IconButton
                    icon="delete"
                    label={`${file.name} 삭제`}
                    variant="standard"
                    size="sm"
                    onClick={() => setConfirmDelete(file)}
                    className="text-[var(--md-sys-color-error)]"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {fileTotal > REGISTERED_FILE_PAGE_SIZE && (
          <footer className="px-6 py-4 flex items-center justify-between gap-3 border-t border-[var(--md-sys-color-outline-variant)] flex-wrap">
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {visibleFileStart}-{visibleFileEnd} / {fileTotal}개
            </p>
            <div className="flex gap-2">
              <Button
                variant="outlined"
                leadingIcon="chevron_left"
                onClick={() => goToFilePage(fileOffset - REGISTERED_FILE_PAGE_SIZE)}
                disabled={!hasPreviousFilePage || loading}
              >
                이전
              </Button>
              <Button
                variant="outlined"
                trailingIcon="chevron_right"
                onClick={() => goToFilePage(fileOffset + REGISTERED_FILE_PAGE_SIZE)}
                disabled={!hasNextFilePage || loading}
              >
                다음
              </Button>
            </div>
          </footer>
        )}
      </Card>

      <Dialog
        open={clearAppDataOpen}
        onClose={() => setClearAppDataOpen(false)}
        size="lg"
        icon="warning"
        title="앱 데이터 삭제 확인"
        description={
          selectedFullReset
            ? '앱 프로필 전체를 새로 만드는 초기화입니다. 원본 문서와 대상 폴더 파일은 삭제하지 않습니다.'
            : '선택한 앱 데이터만 삭제합니다. 원본 문서와 대상 폴더 파일은 삭제하지 않습니다.'
        }
        actions={
          <>
            <Button variant="text" onClick={() => setClearAppDataOpen(false)}>
              취소
            </Button>
            <Button
              variant="filled"
              leadingIcon="delete_forever"
              className="!bg-[var(--md-sys-color-error)] !text-[var(--md-sys-color-on-error)]"
              onClick={handleClearAppData}
              loading={appDataLoading}
            >
              삭제 후 재시작
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="type-body-md text-[var(--md-sys-color-on-surface)]">
            {selectedFullReset
              ? '문제 해결용 전체 초기화는 앱 프로필 전체를 삭제해 앱 설정과 세션을 새로 만듭니다. 등록된 대상 폴더의 실제 문서 파일과 사용자의 작업 폴더는 삭제하지 않습니다.'
              : '선택한 앱 소유 데이터만 삭제합니다. 등록된 대상 폴더의 실제 문서 파일과 사용자의 작업 폴더는 삭제하지 않습니다.'}
          </p>
          <Badge tone="warning">삭제 예정 {formatBytes(selectedAppDataSize)}</Badge>
          <div className="space-y-2">
            {selectedAppDataPaths.map((candidate) => (
              <div key={candidate.id} className="rounded-md bg-[var(--md-sys-color-surface-container-lowest)] p-3">
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{candidate.label}</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] break-all">
                  {candidate.path}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        size="lg"
        icon="preview"
        title={previewFile?.name}
        description={previewFile?.path}
        actions={
          <Button variant="filled" onClick={() => setPreviewFile(null)}>
            닫기
          </Button>
        }
      >
        {previewFile && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <FileTypeBadge fileType={previewFile.file_type} />
              {isExcelFile(previewFile.file_type) && previewFile.key_column && (
                <Chip label={`기준 컬럼 ${previewFile.key_column}`} tone="primary" as="span" />
              )}
              {formatParserConfigSummary(previewFile.parser_config ?? undefined).map((item) => (
                <Chip key={item} label={item} tone="neutral" as="span" />
              ))}
            </div>

            {schemaLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
                <Spinner size={18} /> 미리보기 불러오는 중…
              </div>
            ) : schema ? (
              <PreviewPanel preview={schema} />
            ) : (
              <EmptyState
                icon="error_outline"
                title="미리보기를 불러올 수 없습니다"
                description="파일 경로가 변경되었거나 잠겨있을 수 있습니다."
                compact
              />
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        icon="delete"
        title="등록 해제"
        description={confirmDelete?.name}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmDelete(null)}>
              취소
            </Button>
            <Button
              variant="filled"
              leadingIcon="delete"
              className="!bg-[var(--md-sys-color-error)] !text-[var(--md-sys-color-on-error)]"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              해제
            </Button>
          </>
        }
      >
        <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)]">
          이 파일의 등록 정보와 인덱스를 삭제합니다. 원본 파일은 영향받지 않습니다.
        </p>
      </Dialog>
    </div>
  )
}

function InspectionCard({
  inspectedFile,
  selectedCandidateId,
  effectivePreview,
  effectiveParserConfig,
  keyColumn,
  onKeyColumn,
  onCandidateChange,
  availableColumns,
  onRegister,
  registering,
}: {
  inspectedFile: NormalizedFileInspect
  selectedCandidateId: string
  effectivePreview: NormalizedPreview | null
  effectiveParserConfig: NormalizedFileInspect['parserConfig']
  keyColumn: string
  onKeyColumn: (value: string) => void
  onCandidateChange: (id: string) => void
  availableColumns: string[]
  onRegister: () => void
  registering: boolean
}) {
  const parserSummary = formatParserConfigSummary(effectiveParserConfig)
  const keyRequired = inspectedFile.keyRequired

  return (
    <div className="rounded-md bg-[var(--md-sys-color-primary-container)] p-5 space-y-5 animate-slide-up">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <p className="type-title-md text-[var(--md-sys-color-on-primary-container)]">
            {inspectedFile.name}
          </p>
          <p className="type-body-sm text-[var(--md-sys-color-on-primary-container)] opacity-80 break-all">
            {inspectedFile.path}
          </p>
          <div className="flex gap-2 flex-wrap pt-1">
            <FileTypeBadge fileType={inspectedFile.fileType} />
            <Badge tone="primary">
              {inspectedFile.fileType === 'Text' || inspectedFile.fileType === 'Markdown'
                ? '검색 등록용'
                : inspectedFile.compareMode === 'excel'
                ? '표 통합/비교'
                : inspectedFile.compareMode === 'word'
                  ? '문서 변경 비교'
                  : '슬라이드 변경 비교'}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {inspectedFile.capabilitySummary.map((item) => (
            <Chip key={item} label={item} tone="primary" as="span" icon="check" />
          ))}
        </div>
      </div>

      {inspectedFile.compareMode === 'excel' && inspectedFile.parserCandidates.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="type-title-sm text-[var(--md-sys-color-on-primary-container)]">
              표 후보 영역
            </p>
            <p className="type-body-sm text-[var(--md-sys-color-on-primary-container)] opacity-80">
              실제 데이터 표로 사용할 영역을 선택하세요. 선택값은 다음 검색/비교 때 그대로 사용됩니다.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {inspectedFile.parserCandidates.map((candidate) => {
              const active = candidate.id === selectedCandidateId
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onCandidateChange(candidate.id)}
                  aria-pressed={active}
                  className={`text-left rounded-md p-4 border-2 transition-all state-host relative ${
                    active
                      ? 'bg-[var(--md-sys-color-surface-container-lowest)] border-[var(--md-sys-color-primary)] shadow-elev-2'
                      : 'bg-[var(--md-sys-color-surface-container-lowest)]/60 border-transparent hover:border-[var(--md-sys-color-outline-variant)]'
                  }`}
                >
                  <span className="state-layer" />
                  <div className="flex items-center gap-2">
                    <Icon
                      name={active ? 'check_circle' : 'grid_on'}
                      size={18}
                      filled={active}
                      className={
                        active
                          ? 'text-[var(--md-sys-color-primary)]'
                          : 'text-[var(--md-sys-color-on-surface-variant)]'
                      }
                    />
                    <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                      {candidate.label}
                    </p>
                  </div>
                  {candidate.summary.length > 0 && (
                    <div className="mt-3 flex gap-1.5 flex-wrap">
                      {candidate.summary.map((item) => (
                        <Chip key={item} label={item} tone="neutral" as="span" />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,280px)_1fr] gap-4">
        <div className="space-y-3">
          <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-3">
            <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)] uppercase">
              등록 옵션
            </p>
            {keyRequired ? (
              <div className="space-y-2">
                {availableColumns.length > 0 ? (
                  <SelectField
                    label="기준 컬럼"
                    value={keyColumn}
                    onChange={(event) => onKeyColumn(event.target.value)}
                  >
                    <option value="">기준 컬럼 선택</option>
                    {availableColumns.map((column) => (
                      <option key={column} value={column}>
                        {column}
                        {column === inspectedFile.suggestedKey ? ' (추천)' : ''}
                      </option>
                    ))}
                  </SelectField>
                ) : (
                  <TextField
                    label="기준 컬럼"
                    placeholder="예: ID, 사번, 과제명"
                    value={keyColumn}
                    onChange={(event) => onKeyColumn(event.target.value)}
                  />
                )}
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  추천 기준 컬럼 · <strong>{inspectedFile.suggestedKey || '없음'}</strong>
                </p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  기준 컬럼은 여러 Excel 파일에서 같은 행을 맞춰 통합하거나 값 차이를 찾는 데 사용됩니다.
                </p>
              </div>
            ) : (
              <div className="rounded-md bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 space-y-1">
                <p className="type-body-md text-[var(--md-sys-color-on-surface)]">
                  이 형식은 기준 컬럼 없이 등록됩니다.
                </p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  {inspectedFile.fileType === 'Text' || inspectedFile.fileType === 'Markdown'
                    ? '검색과 내용 미리보기에 사용할 수 있습니다.'
                    : '검색과 2개 파일 변경 비교에 사용할 수 있습니다.'}
                </p>
              </div>
            )}

            {parserSummary.length > 0 && (
              <div className="space-y-1">
                <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)] uppercase">
                  저장될 표 읽기 설정
                </p>
                {parserSummary.map((item) => (
                  <p
                    key={item}
                    className="type-body-sm text-[var(--md-sys-color-on-surface)] font-mono"
                  >
                    {item}
                  </p>
                ))}
              </div>
            )}
          </div>

          <Button
            variant="filled"
            leadingIcon="add_circle"
            onClick={onRegister}
            loading={registering}
            fullWidth
          >
            현재 설정으로 등록
          </Button>
        </div>

        <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)] mb-3">미리보기</p>
          {effectivePreview && <PreviewPanel preview={effectivePreview} />}
        </div>
      </div>
    </div>
  )
}
