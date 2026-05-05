import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'

import {
  api,
  AppDataCandidate,
  AppStartupSettings,
  ClearAppDataResult,
  CloseBehavior,
  FileInfo,
  LibraryRescanResponse,
  LibraryRescanStatus,
  LibrarySettings,
  NormalizedPreview,
  SchemaResponse,
  getOfficeWhereBridge,
  normalizeSchemaResponse,
} from '../api/client'
import {
  Badge,
  Button,
  Card,
  CardSection,
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
  useDisplaySettings,
} from '../contexts/DisplaySettingsContext'
import { TutorialStep } from '../tutorial'
import AppDataManagementSection from './file-manager/AppDataManagementSection'
import { formatBytes } from './file-manager/format'
import GeneralSettingsSection from './file-manager/GeneralSettingsSection'
import RegisteredFilesSection from './file-manager/RegisteredFilesSection'
import PreviewPanel from './PreviewPanel'

function rescanTitle(status: LibraryRescanStatus | null, rescanning: boolean) {
  if (!rescanning && status?.stage === 'failed') return '대상 폴더 확인 실패'
  if (!rescanning && status?.stage === 'cancelled') return '대상 폴더 확인 정지됨'
  if (!rescanning) return '최근 문서 확인 결과'
  if (status?.stage === 'scanning') return '대상 폴더 스캔 중'
  if (status?.stage === 'indexing') return '변경된 파일 확인 중'
  if (status?.stage === 'saving') return '확인 결과 저장 중'
  if (status?.stage === 'cancelling') return '정지 요청 처리 중'
  return '대상 폴더 확인 준비 중'
}

function rescanDetail(status: LibraryRescanStatus | null, summary: LibraryRescanResponse | null, rescanning: boolean) {
  if (rescanning && status) {
    const foundText = `발견 ${status.found}개`
    const modeText = status.mode === 'fast' ? `빠르게 확인 중` : ''
    const progressText =
      status.total > 0
        ? `처리 ${status.processed}/${status.total} · ${Math.round(status.percent)}%`
        : status.folders_total > 0
          ? `폴더 ${status.folders_processed}/${status.folders_total}`
          : '진행률 계산 중'
    const current = status.current_file ? ` · 현재 ${status.current_file}` : ''
    const cleanupText = status.pruned_unsupported > 0 ? `정리 ${status.pruned_unsupported}개` : ''
    return [foundText, modeText, progressText, cleanupText].filter(Boolean).join(' · ') + current
  }

  const source = summary ?? status?.summary
  if (!source) return '아직 실행 결과가 없습니다.'
  const checked = source.registered + source.updated + source.skipped
  const unchanged = source.skipped > 0 ? ` · 변경 없음 ${source.skipped}` : ''
  const cancelled = source.cancelled > 0 ? ` · 정지 ${source.cancelled}` : ''
  const cleanup = source.pruned_unsupported > 0 ? ` · 이전 미지원 항목 정리 ${source.pruned_unsupported}` : ''
  return `등록/확인 ${checked} · 신규 ${source.registered} · 갱신 ${source.updated}${unchanged}${cancelled}${cleanup} · 실패 ${source.failed}`
}

const REGISTERED_FILE_PAGE_SIZE = 50
const INDEX_WORKER_MIN = 4
const INDEX_WORKER_MAX = 32
const INDEX_WORKER_STEP = 4
const INDEX_WORKER_RECOMMENDED = 24
const DEFAULT_EXCLUDED_FOLDER_NAMES = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'bower_components',
  'vendor',
  'venv',
  '.venv',
  'env',
  '.tox',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.cache',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  '.next',
  '.nuxt',
  '.gradle',
  '.m2',
  '.cargo',
  '.rustup',
  '.vscode',
  '.idea',
  '.vs',
  'AppData',
  'Library',
  'Application Support',
  '.codex',
  '.claude',
  '.omx',
  '.omc',
]
const SAFE_APP_DATA_IDS = new Set([
  'backend-data',
  'chromium-cache',
  'chromium-code-cache',
  'chromium-local-storage',
  'chromium-session-storage',
  'chromium-gpu-cache',
  'legacy-home-data',
])

const CLOSE_BEHAVIOR_LABELS: Record<CloseBehavior, string> = {
  ask: '닫을 때 물어보기',
  hide: '트레이로 보내기',
  quit: '앱 종료',
}

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

function normalizeIndexWorkerCount(value: number) {
  const bounded = Math.min(Math.max(value, INDEX_WORKER_MIN), INDEX_WORKER_MAX)
  return Math.min(
    Math.max(Math.round(bounded / INDEX_WORKER_STEP) * INDEX_WORKER_STEP, INDEX_WORKER_MIN),
    INDEX_WORKER_MAX,
  )
}

function workerCountLabel(value: number) {
  if (value <= 8) return '안정 우선'
  if (value < INDEX_WORKER_RECOMMENDED) return '일반 PC'
  if (value === INDEX_WORKER_RECOMMENDED) return '추천'
  return '고성능 PC'
}

function normalizeExcludedFolderNames(values: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  values.forEach((value) => {
    const name = value.trim()
    if (!name) return
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    output.push(name)
  })
  return output
}

export default function FileManager({
  tutorialStep,
  exampleLibraryPath = '',
  libraryDataRevision = 0,
  focusFolderInputRequest = 0,
  onTutorialStep,
  onReplayOnboarding,
}: {
  tutorialStep?: TutorialStep | null
  exampleLibraryPath?: string
  libraryDataRevision?: number
  focusFolderInputRequest?: number
  onTutorialStep?: (step: TutorialStep | null) => void
  onReplayOnboarding?: () => void
}) {
  const snackbar = useSnackbar()
  const { textSize, setTextSize, themeMode, resolvedTheme, setThemeMode } = useDisplaySettings()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTotal, setFileTotal] = useState(0)
  const [fileCountsByType, setFileCountsByType] = useState<Record<string, number>>({})
  const [fileOffset, setFileOffset] = useState(0)
  const [fileQuery, setFileQuery] = useState('')
  const [fileQueryDraft, setFileQueryDraft] = useState('')
  const [loading, setLoading] = useState(false)

  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [schema, setSchema] = useState<NormalizedPreview | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)

  const [confirmDeleteFiles, setConfirmDeleteFiles] = useState<FileInfo[]>([])
  const [confirmClearAllFilesOpen, setConfirmClearAllFilesOpen] = useState(false)
  const [deletingFiles, setDeletingFiles] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [focusedFileId, setFocusedFileId] = useState<number | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const dragSelectionRef = useRef<{ active: boolean; anchorIndex: number; selecting: boolean } | null>(null)
  const [tourRefreshStartKey, setTourRefreshStartKey] = useState<number | null>(null)
  const [librarySettings, setLibrarySettings] = useState<LibrarySettings>({
    watched_folders: [],
    excluded_folder_names: [...DEFAULT_EXCLUDED_FOLDER_NAMES],
    auto_rescan_mode: 'interval',
    auto_rescan_interval_hours: 24,
    auto_rescan_daily_time: '03:00',
    fast_worker_count: INDEX_WORKER_RECOMMENDED,
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
  const [indexSettingsOpen, setIndexSettingsOpen] = useState(false)
  const [indexWorkerDraft, setIndexWorkerDraft] = useState(INDEX_WORKER_RECOMMENDED)
  const [excludedFolderDraft, setExcludedFolderDraft] = useState<string[]>(DEFAULT_EXCLUDED_FOLDER_NAMES)
  const [excludedFolderInput, setExcludedFolderInput] = useState('')
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>('ask')
  const [closeBehaviorLoading, setCloseBehaviorLoading] = useState(false)
  const [startupSettings, setStartupSettings] = useState<AppStartupSettings>({
    supported: false,
    enabled: false,
    executablePath: '',
    reason: '데스크톱 앱에서만 시작프로그램 설정을 사용할 수 있습니다.',
  })
  const [startupSettingsLoading, setStartupSettingsLoading] = useState(false)
  const officeWhereBridge = getOfficeWhereBridge()
  const appDataAvailable = Boolean(officeWhereBridge?.getAppDataPaths && officeWhereBridge?.clearAppData)
  const closeBehaviorAvailable = Boolean(
    officeWhereBridge?.getCloseBehavior && officeWhereBridge?.setCloseBehavior,
  )
  const startupSettingsAvailable = Boolean(
    officeWhereBridge?.getStartupSettings && officeWhereBridge?.setStartupSettings,
  )

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

  const fetchCloseBehavior = async () => {
    if (!closeBehaviorAvailable) return
    setCloseBehaviorLoading(true)
    try {
      const response = await api.app.getCloseBehavior()
      setCloseBehavior(response.data)
    } catch {
      snackbar.error('창 닫기 동작 설정을 불러오지 못했습니다.')
    } finally {
      setCloseBehaviorLoading(false)
    }
  }

  const fetchStartupSettings = async () => {
    if (!startupSettingsAvailable) return
    setStartupSettingsLoading(true)
    try {
      const response = await api.app.getStartupSettings()
      setStartupSettings(response.data)
    } catch {
      snackbar.error('시작프로그램 설정을 불러오지 못했습니다.')
    } finally {
      setStartupSettingsLoading(false)
    }
  }

  useEffect(() => {
    void fetchFiles(0, '')
    void fetchLibrarySettings()
    void fetchAppDataPaths()
    void fetchCloseBehavior()
    void fetchStartupSettings()
  }, [])

  useEffect(() => {
    if (rescanCompletionKey === 0) return
    void fetchFiles(0, fileQuery)
    void fetchLibrarySettings()
  }, [rescanCompletionKey])

  useEffect(() => {
    if (libraryDataRevision === 0) return
    void fetchFiles(0, fileQuery)
    void fetchLibrarySettings()
  }, [libraryDataRevision])

  useEffect(() => {
    if (focusFolderInputRequest === 0) return undefined
    const timer = window.setTimeout(() => {
      folderInputRef.current?.focus()
      folderInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [focusFolderInputRequest])

  useEffect(() => {
    if (tutorialStep !== 'example-folder' || !exampleLibraryPath) return
    setFolderPathDraft(exampleLibraryPath)
    setFolderRecursive(true)
  }, [exampleLibraryPath, tutorialStep])

  useEffect(() => {
    if (tourRefreshStartKey === null || rescanning) return
    if (rescanCompletionKey > tourRefreshStartKey) {
      setTourRefreshStartKey(null)
      const currentSummary = rescanStatus?.summary ?? rescanSummary
      const handled = (currentSummary?.registered ?? rescanStatus?.registered ?? 0)
        + (currentSummary?.updated ?? rescanStatus?.updated ?? 0)
        + (currentSummary?.skipped ?? rescanStatus?.skipped ?? 0)
      const failed = currentSummary?.failed ?? rescanStatus?.failed ?? 0
      if (rescanStatus?.stage === 'completed' && handled > 0 && failed === 0) {
        onTutorialStep?.('search')
      } else {
        snackbar.warn('예제 문서가 아직 준비되지 않았습니다. 문서 새로고침을 다시 실행해 주세요.')
      }
    }
  }, [onTutorialStep, rescanCompletionKey, rescanStatus, rescanSummary, rescanning, snackbar, tourRefreshStartKey])

  useEffect(() => {
    const stopDrag = () => {
      dragSelectionRef.current = null
    }
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    return () => {
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
    }
  }, [])

  useEffect(() => {
    if (!indexSettingsOpen) return
    setIndexWorkerDraft(normalizeIndexWorkerCount(librarySettings.fast_worker_count ?? INDEX_WORKER_RECOMMENDED))
    setExcludedFolderDraft(
      normalizeExcludedFolderNames(
        librarySettings.excluded_folder_names?.length
          ? librarySettings.excluded_folder_names
          : DEFAULT_EXCLUDED_FOLDER_NAMES,
      ),
    )
    setExcludedFolderInput('')
  }, [indexSettingsOpen, librarySettings.fast_worker_count, librarySettings.excluded_folder_names])

  useEffect(() => {
    if (confirmDeleteFiles.length === 0) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      void handleDeleteFiles(confirmDeleteFiles)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [confirmDeleteFiles])

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

  const saveLibrarySettings = async (
    next: LibrarySettings,
    successMessage = '대상 폴더 설정이 저장되었습니다.',
  ) => {
    setSettingsLoading(true)
    try {
      const response = await api.library.updateSettings(next)
      setLibrarySettings(response.data)
      if (successMessage) snackbar.success(successMessage)
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
    if (tutorialStep === 'example-folder') {
      onTutorialStep?.('document-refresh')
      snackbar.success('임시 예제 폴더를 추가했습니다. 문서 새로고침을 한 번 눌러 확인해 보세요.')
      return
    }
    await startRescan('added', 'fast')
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

  const handleUpdateCloseBehavior = async (behavior: CloseBehavior) => {
    setCloseBehaviorLoading(true)
    try {
      const response = await api.app.setCloseBehavior(behavior)
      setCloseBehavior(response.data)
      snackbar.success(`창 닫기 동작이 "${CLOSE_BEHAVIOR_LABELS[response.data]}"로 저장되었습니다.`)
    } catch {
      snackbar.error('창 닫기 동작을 저장하지 못했습니다.')
    } finally {
      setCloseBehaviorLoading(false)
    }
  }

  const handleUpdateStartupSettings = async (enabled: boolean) => {
    setStartupSettingsLoading(true)
    try {
      const response = await api.app.setStartupSettings(enabled)
      setStartupSettings(response.data)
      if (!response.data.supported) {
        snackbar.warn(response.data.reason || '이 환경에서는 시작프로그램 설정을 사용할 수 없습니다.')
        return
      }
      snackbar.success(
        response.data.enabled
          ? '시작프로그램에 등록했습니다. 앱 위치를 옮기면 다시 켜 주세요.'
          : '시작프로그램 등록을 껐습니다.',
      )
    } catch {
      snackbar.error('시작프로그램 설정을 저장하지 못했습니다.')
    } finally {
      setStartupSettingsLoading(false)
    }
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
    if (tutorialStep === 'document-refresh') setTourRefreshStartKey(rescanCompletionKey)
    await startRescan('manual', 'fast')
  }

  const handleSaveIndexWorkerCount = async () => {
    const value = normalizeIndexWorkerCount(indexWorkerDraft)
    const excludedFolderNames = normalizeExcludedFolderNames(excludedFolderDraft)
    const saved = await saveLibrarySettings(
      { ...librarySettings, fast_worker_count: value, excluded_folder_names: excludedFolderNames },
      '문서 확인 속도 설정을 저장했습니다.',
    )
    if (saved) setIndexSettingsOpen(false)
  }

  const addExcludedFolderName = () => {
    const next = normalizeExcludedFolderNames([...excludedFolderDraft, excludedFolderInput])
    if (next.length === excludedFolderDraft.length && excludedFolderInput.trim()) {
      snackbar.warn('이미 제외 목록에 있습니다.')
    }
    setExcludedFolderDraft(next)
    setExcludedFolderInput('')
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

  const visibleSelectedFiles = () => files.filter((file) => selectedFileIds.has(file.id))

  const openDeleteConfirm = (targets: FileInfo[]) => {
    if (targets.length === 0) {
      snackbar.warn('등록 해제할 파일을 선택해 주세요.')
      return
    }
    setConfirmDeleteFiles(targets)
  }

  const openClearAllFilesConfirm = () => {
    if (fileTotal === 0) {
      snackbar.warn('등록 해제할 파일이 없습니다.')
      return
    }
    setConfirmClearAllFilesOpen(true)
  }

  const toggleRegisteredFileSelection = (file: FileInfo, selected?: boolean) => {
    setSelectedFileIds((current) => {
      const next = new Set(current)
      const shouldSelect = selected ?? !next.has(file.id)
      if (shouldSelect) next.add(file.id)
      else next.delete(file.id)
      return next
    })
  }

  const selectVisibleFileRange = (fromIndex: number, toIndex: number, selected: boolean) => {
    const start = Math.max(0, Math.min(fromIndex, toIndex))
    const end = Math.min(files.length - 1, Math.max(fromIndex, toIndex))
    setSelectedFileIds((current) => {
      const next = new Set(current)
      files.slice(start, end + 1).forEach((file) => {
        if (selected) next.add(file.id)
        else next.delete(file.id)
      })
      return next
    })
  }

  const isUnsafeDeleteKeyTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
  }

  const handleRegisteredFilesKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Delete') return
    if (isUnsafeDeleteKeyTarget(event.target)) return
    const selected = visibleSelectedFiles()
    const focused = focusedFileId ? files.find((file) => file.id === focusedFileId) : null
    const targets = selected.length > 0 ? selected : focused ? [focused] : []
    if (targets.length === 0) return
    event.preventDefault()
    openDeleteConfirm(targets)
  }

  const handleFileRowPointerDown = (
    event: ReactPointerEvent<HTMLLIElement>,
    file: FileInfo,
    index: number,
  ) => {
    if (!selectionMode || event.button !== 0 || isUnsafeDeleteKeyTarget(event.target)) return
    const selecting = !selectedFileIds.has(file.id)
    dragSelectionRef.current = { active: true, anchorIndex: index, selecting }
    toggleRegisteredFileSelection(file, selecting)
    event.preventDefault()
  }

  const handleFileRowPointerEnter = (index: number) => {
    const drag = dragSelectionRef.current
    if (!drag?.active) return
    selectVisibleFileRange(drag.anchorIndex, index, drag.selecting)
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
        snackbar.success(
          response.data.restartScheduled
            ? '앱 데이터를 삭제했습니다. 앱을 다시 시작합니다.'
            : '앱 데이터를 삭제했습니다. 앱을 종료합니다. 다시 실행해 주세요.',
        )
      } else {
        snackbar.error('일부 앱 데이터 삭제에 실패했습니다.')
      }
      setClearAppDataOpen(false)
      if (!response.data.exitScheduled) void fetchAppDataPaths()
    } catch {
      snackbar.error('앱 데이터 삭제 요청에 실패했습니다.')
    } finally {
      setAppDataLoading(false)
    }
  }

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
  const selectedFiles = files.filter((file) => selectedFileIds.has(file.id))
  const selectedCount = selectedFiles.length
  const selectionVisible = selectionMode || selectedCount > 0

  const handleDeleteFiles = async (targets: FileInfo[]) => {
    if (targets.length === 0) return
    const deleted: FileInfo[] = []
    const failed: FileInfo[] = []
    setDeletingFiles(true)
    try {
      for (const file of targets) {
        try {
          await api.files.delete(file.id)
          deleted.push(file)
        } catch {
          failed.push(file)
        }
      }

      setSelectedFileIds((current) => {
        const next = new Set(current)
        deleted.forEach((file) => next.delete(file.id))
        return next
      })

      if (failed.length > 0) {
        snackbar.error(`등록 해제 실패 ${failed.length}개 · 성공 ${deleted.length}개`)
      } else if (deleted.length === 1) {
        snackbar.success(`"${deleted[0].name}" 등록 해제됨.`)
      } else {
        snackbar.success(`${deleted.length}개 파일 등록을 해제했습니다.`)
      }

      const nextOffset =
        files.length <= deleted.length && fileOffset > 0
          ? Math.max(0, fileOffset - REGISTERED_FILE_PAGE_SIZE)
          : fileOffset
      await fetchFiles(nextOffset, fileQuery)
    } finally {
      setDeletingFiles(false)
      setConfirmDeleteFiles([])
    }
  }

  const handleClearAllFiles = async () => {
    setDeletingFiles(true)
    try {
      const response = await api.files.deleteAll()
      setSelectedFileIds(new Set())
      setSelectionMode(false)
      setFileOffset(0)
      setFileQuery('')
      setFileQueryDraft('')
      snackbar.success(`${response.data.deleted}개 파일 등록을 모두 해제했습니다.`)
      await fetchFiles(0, '')
    } catch {
      snackbar.error('전체 등록 해제에 실패했습니다.')
    } finally {
      setDeletingFiles(false)
      setConfirmClearAllFilesOpen(false)
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

  return (
    <div className="space-y-6">
      <Card variant="elevated" className="console-panel">
        <CardSection
          title="대상 폴더"
          description="자주 쓰는 문서 폴더를 등록하면 검색과 변경 이력 확인에 사용합니다. 앱은 원본 문서를 읽기만 하며, 파일을 수정하거나 이동하지 않습니다."
          trailing={
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <Button
                variant="outlined"
                leadingIcon="tune"
                onClick={() => setIndexSettingsOpen(true)}
                disabled={settingsLoading}
              >
                문서 확인 속도 설정
              </Button>
              <Button
                variant="filled"
                leadingIcon="sync"
                onClick={handleRescanLibrary}
                loading={rescanning}
                disabled={settingsLoading || rescanning || librarySettings.watched_folders.length === 0}
                className={tutorialStep === 'document-refresh' ? 'attention-pulse tour-target' : ''}
                data-tour-target={tutorialStep === 'document-refresh' ? 'document-refresh' : undefined}
                title="새 파일이나 수정된 파일을 다시 확인합니다."
              >
                문서 새로고침
              </Button>
            </div>
          }
        >
          <div
            className={`flex gap-2 items-start flex-wrap md:flex-nowrap ${
              tutorialStep === 'example-folder'
                ? 'tour-target rounded-2xl ring-1 ring-[var(--md-sys-color-primary)]/25'
                : ''
            }`}
            data-tour-target={tutorialStep === 'example-folder' ? 'example-folder' : undefined}
          >
            <div className="flex-1 min-w-0">
              <TextField
                ref={folderInputRef}
                leadingIcon="folder"
                placeholder="검색/검사 대상 폴더 경로"
                value={folderPathDraft}
                onChange={(event) => setFolderPathDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAddWatchedFolder()
                }}
                helper={tutorialStep === 'example-folder' ? '튜토리얼용 임시 폴더 경로가 미리 입력되어 있습니다.' : undefined}
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
              className={
                tutorialStep === 'example-folder'
                  ? 'attention-pulse'
                  : hasPendingNewFolder
                    ? 'attention-pulse'
                    : ''
              }
            >
              대상 추가
            </Button>
          </div>
          <Switch
            checked={folderRecursive}
            onChange={(event) => setFolderRecursive(event.target.checked)}
            label="하위 폴더 포함"
            description="프로젝트/연도별 하위 폴더까지 문서 새로고침 대상에 포함합니다."
          />

          {librarySettings.watched_folders.length === 0 ? (
            <EmptyState
              icon="folder_off"
              title="지정된 대상 폴더가 없습니다"
              description="먼저 자주 쓰는 작업 폴더(업무/연구/강의/프로젝트 등)를 추가한 뒤 문서 새로고침을 실행하세요."
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
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">자동 새로고침 주기</p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                등록한 폴더를 주기적으로 확인해 새 파일과 수정된 파일을 검색 대상으로 반영합니다.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px_140px] gap-3 items-end">
              <SelectField
                label="자동 새로고침"
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
                마지막 새로고침
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

      <RegisteredFilesSection
        files={files}
        fileTotal={fileTotal}
        fileOffset={fileOffset}
        pageSize={REGISTERED_FILE_PAGE_SIZE}
        fileQuery={fileQuery}
        fileQueryDraft={fileQueryDraft}
        fileTypeCounts={fileTypeCounts}
        loading={loading}
        deletingFiles={deletingFiles}
        selectedFileIds={selectedFileIds}
        selectedFiles={selectedFiles}
        selectedCount={selectedCount}
        selectionMode={selectionMode}
        selectionVisible={selectionVisible}
        visibleFileStart={visibleFileStart}
        visibleFileEnd={visibleFileEnd}
        hasPreviousFilePage={hasPreviousFilePage}
        hasNextFilePage={hasNextFilePage}
        onToggleSelectionMode={() => {
          setSelectionMode((value) => !value)
          if (selectionMode) setSelectedFileIds(new Set())
        }}
        onOpenDeleteConfirm={openDeleteConfirm}
        onOpenClearAllFilesConfirm={openClearAllFilesConfirm}
        onRefresh={() => void fetchFiles(fileOffset, fileQuery)}
        onQueryDraftChange={setFileQueryDraft}
        onSearch={handleFileSearch}
        onClearSearch={clearFileSearch}
        onRegisteredFilesKeyDown={handleRegisteredFilesKeyDown}
        onFileFocus={setFocusedFileId}
        onFilePointerDown={handleFileRowPointerDown}
        onFilePointerEnter={handleFileRowPointerEnter}
        onToggleRegisteredFileSelection={toggleRegisteredFileSelection}
        onPreview={(file) => void handlePreview(file)}
        onPage={goToFilePage}
      />

      <GeneralSettingsSection
        textSize={textSize}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        closeBehavior={closeBehavior}
        closeBehaviorLabels={CLOSE_BEHAVIOR_LABELS}
        closeBehaviorAvailable={closeBehaviorAvailable}
        closeBehaviorLoading={closeBehaviorLoading}
        startupSettings={startupSettings}
        startupSettingsAvailable={startupSettingsAvailable}
        startupSettingsLoading={startupSettingsLoading}
        onTextSizeChange={setTextSize}
        onThemeModeChange={setThemeMode}
        onCloseBehaviorChange={(behavior) => void handleUpdateCloseBehavior(behavior)}
        onStartupSettingsChange={(enabled) => void handleUpdateStartupSettings(enabled)}
      />

      {onReplayOnboarding && (
        <Card variant="outlined" className="overflow-hidden">
          <CardSection
            className="p-3"
            title="처음 둘러보기"
            description="튜토리얼 동안만 임시 예제 문서를 만들어 핵심 흐름을 다시 확인합니다."
            trailing={
              <Button variant="tonal" size="sm" leadingIcon="play_circle" onClick={onReplayOnboarding}>
                다시 보기
              </Button>
            }
          />
        </Card>
      )}

      <AppDataManagementSection
        appDataAvailable={appDataAvailable}
        appDataPaths={appDataPaths}
        appDataLoading={appDataLoading}
        selectedAppDataIds={selectedAppDataIds}
        appDataAdvancedOpen={appDataAdvancedOpen}
        clearAppDataResult={clearAppDataResult}
        safeResetIds={safeResetIds}
        safeResetSize={safeResetSize}
        fullResetIds={fullResetIds}
        fullResetSize={fullResetSize}
        onRefreshPaths={() => void fetchAppDataPaths()}
        onOpenPreset={openClearAppDataPreset}
        onToggleCandidate={toggleAppDataCandidate}
        onToggleAdvanced={setAppDataAdvancedOpen}
        onOpenSelectedDelete={() => setClearAppDataOpen(true)}
      />


      <Dialog
        open={indexSettingsOpen}
        onClose={() => setIndexSettingsOpen(false)}
        size="md"
        icon="tune"
        title="문서 확인 속도 설정"
        description="한 번에 확인할 문서 수와 건너뛸 폴더 이름을 정합니다."
        actions={
          <>
            <Button variant="text" onClick={() => setIndexSettingsOpen(false)}>
              취소
            </Button>
            <Button
              variant="filled"
              leadingIcon="save"
              onClick={handleSaveIndexWorkerCount}
              loading={settingsLoading}
            >
              저장
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">동시 확인 수</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  높을수록 빨라질 수 있지만 CPU/RAM/디스크 사용량이 늘어납니다.
                </p>
              </div>
              <Badge tone={indexWorkerDraft === INDEX_WORKER_RECOMMENDED ? 'success' : 'neutral'}>
                {workerCountLabel(indexWorkerDraft)}
              </Badge>
            </div>

            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-4xl font-semibold tracking-tight text-[var(--md-sys-color-on-surface)]">
                  {indexWorkerDraft}
                </p>
                <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                  개 동시 확인
                </p>
              </div>
              <div className="text-right type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                4 단위 · 최대 32
              </div>
            </div>

            <input
              type="range"
              min={INDEX_WORKER_MIN}
              max={INDEX_WORKER_MAX}
              step={INDEX_WORKER_STEP}
              value={indexWorkerDraft}
              onChange={(event) => setIndexWorkerDraft(normalizeIndexWorkerCount(Number(event.target.value)))}
              className="w-full accent-[var(--md-sys-color-primary)]"
              aria-label="동시 문서 확인 수"
            />
            <div className="grid grid-cols-4 gap-2 type-label-sm text-[var(--md-sys-color-on-surface-variant)]">
              {[4, 16, 24, 32].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIndexWorkerDraft(value)}
                  className={`rounded-full border px-2 py-1 transition-colors ${
                    indexWorkerDraft === value
                      ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
                      : 'border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]'
                  }`}
                >
                  {value}
                  {value === INDEX_WORKER_RECOMMENDED ? ' 추천' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">제외 폴더</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  이름이 같은 폴더는 확인하지 않습니다. 불필요한 폴더를 건너뛰면 큰 폴더에서도 빠르게 시작합니다.
                </p>
              </div>
              <Button
                variant="text"
                onClick={() => setExcludedFolderDraft([...DEFAULT_EXCLUDED_FOLDER_NAMES])}
              >
                기본값
              </Button>
            </div>

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <TextField
                  label="폴더 이름 추가"
                  placeholder="예: node_modules"
                  value={excludedFolderInput}
                  onChange={(event) => setExcludedFolderInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    addExcludedFolderName()
                  }}
                />
              </div>
              <Button variant="tonal" leadingIcon="add" onClick={addExcludedFolderName}>
                추가
              </Button>
            </div>

            <div className="max-h-40 overflow-auto rounded-md bg-[var(--md-sys-color-surface-container-low)] p-2">
              <div className="flex flex-wrap gap-2">
                {excludedFolderDraft.length === 0 ? (
                  <span className="type-body-sm px-2 py-1 text-[var(--md-sys-color-on-surface-variant)]">
                    제외 폴더가 없습니다.
                  </span>
                ) : (
                  excludedFolderDraft.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        setExcludedFolderDraft((current) =>
                          current.filter((item) => item.toLocaleLowerCase() !== name.toLocaleLowerCase()),
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 py-1 type-label-sm text-[var(--md-sys-color-on-surface)] transition-colors hover:bg-[var(--md-sys-color-error-container)] hover:text-[var(--md-sys-color-on-error-container)]"
                      title="클릭하면 제외 목록에서 제거"
                    >
                      {name}
                      <Icon name="close" size={14} />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            네트워크 폴더나 외장 저장장치에서는 동시 확인 수를 너무 높이면 오히려 느려질 수 있습니다. 제외 폴더는 이름 기준으로만 적용됩니다.
          </p>
        </div>
      </Dialog>

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
              삭제 후 앱 다시 시작
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="type-body-md text-[var(--md-sys-color-on-surface)]">
            {selectedFullReset
              ? '문제 해결용 전체 초기화는 앱 프로필 전체를 삭제합니다. 삭제 후 앱은 자동으로 다시 시작되며, 다음 실행 때 앱 설정과 세션을 새로 만듭니다. 등록된 대상 폴더의 실제 문서 파일과 사용자의 작업 폴더는 삭제하지 않습니다.'
              : '선택한 앱 소유 데이터만 삭제합니다. 삭제 후 앱은 자동으로 다시 시작되며, 다음 실행 때 필요한 데이터를 새로 만듭니다. 등록된 대상 폴더의 실제 문서 파일과 사용자의 작업 폴더는 삭제하지 않습니다.'}
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
        open={confirmClearAllFilesOpen}
        onClose={() => setConfirmClearAllFilesOpen(false)}
        size="sm"
        icon="delete_forever"
        title="전체 등록 해제"
        description={`${fileTotal}개 파일의 등록 정보와 검색 준비 데이터를 모두 제거합니다.`}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmClearAllFilesOpen(false)} disabled={deletingFiles}>
              취소
            </Button>
            <Button
              variant="filled"
              leadingIcon="delete_forever"
              className="!bg-[var(--md-sys-color-error)] !text-[var(--md-sys-color-on-error)]"
              onClick={() => void handleClearAllFiles()}
              loading={deletingFiles}
              autoFocus
            >
              전체 등록 해제
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)]">
            앱의 등록 목록과 검색 준비 데이터만 비웁니다. 원본 문서와 대상 폴더는 삭제하거나 이동하지 않습니다.
          </p>
          <div className="rounded-md border border-[var(--md-sys-color-error)]/40 bg-[var(--md-sys-color-error-container)]/20 p-3">
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">다시 검색하려면 문서 새로고침이 필요합니다.</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              대상 폴더 설정은 유지됩니다.
            </p>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmDeleteFiles.length > 0}
        onClose={() => setConfirmDeleteFiles([])}
        size="sm"
        icon="delete"
        title={confirmDeleteFiles.length > 1 ? `${confirmDeleteFiles.length}개 파일 등록 해제` : '등록 해제'}
        description={confirmDeleteFiles.length === 1 ? confirmDeleteFiles[0]?.name : '선택한 파일의 등록 정보와 검색 준비 데이터를 제거합니다.'}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmDeleteFiles([])} disabled={deletingFiles}>
              취소
            </Button>
            <Button
              variant="filled"
              leadingIcon="delete"
              className="!bg-[var(--md-sys-color-error)] !text-[var(--md-sys-color-on-error)]"
              onClick={() => void handleDeleteFiles(confirmDeleteFiles)}
              loading={deletingFiles}
              autoFocus
            >
              등록 해제
            </Button>
          </>
        }
      >
        <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)]">
          앱 목록과 검색 준비 데이터에서만 제거합니다. 원본 파일은 삭제하거나 이동하지 않습니다.
        </p>
        {confirmDeleteFiles.length > 1 && (
          <div className="mt-3 max-h-48 space-y-2 overflow-auto rounded-md bg-[var(--md-sys-color-surface-container-lowest)] p-2">
            {confirmDeleteFiles.map((file) => (
              <p key={file.id} className="truncate type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                {file.name}
              </p>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  )
}
