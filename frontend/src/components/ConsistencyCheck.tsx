import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckResponse,
  FileInfo,
  LibraryGroupDetail,
  LibraryGroupKind,
  LibraryGroupSummary,
  api,
  getCompareMode,
  normalizeFileType,
  normalizeCheckResponse,
} from '../api/client'
import {
  Badge,
  Button,
  Card,
  CardSection,
  Checkbox,
  Chip,
  EmptyState,
  FileTypeBadge,
  Spinner,
  TextField,
  useSnackbar,
} from '../ui'
import { TutorialStep } from '../tutorial'
import {
  CompareMetadataWarnings,
  ExcelCheckResult,
  ExcelDiffGridModal,
  GroupTimeline,
  PptCheckResult,
  WordCheckResult,
  buildExcelGridFocuses,
  type CompareSelection,
  type CompareSlot,
  type ExcelGridModalState,
  type HistoryDiffState,
  type HistoryTransition,
} from './consistency'

const CHECK_FILE_PAGE_SIZE = 60
const GROUP_PAGE_SIZE = 50
type GroupFilter = 'all' | LibraryGroupKind
type GroupFileTypeFilter = 'all' | 'Excel' | 'Word' | 'PowerPoint'
type GroupSort = 'recent' | 'count' | 'name'

const MODE_GUIDE: Record<string, string> = {
  excel: 'Excel은 여러 파일을 동시에 비교합니다. 같은 항목의 행을 맞춰 값 차이와 행/열 추가·삭제를 찾습니다.',
  word: 'Word는 2개 파일만 비교합니다. 추가·삭제·수정된 문단과 표 행을 카드 형태로 보여줍니다.',
  ppt: 'PPT는 2개 파일만 비교합니다. 슬라이드 추가/삭제와 슬라이드 내 항목 변경을 보여줍니다.',
  none: '자동 감지된 문서 그룹에서 바로 비교하거나, 필요할 때만 수동 선택을 열어 직접 고를 수 있습니다.',
}

const isCheckableFile = (file: FileInfo) =>
  ['Excel', 'Word', 'PowerPoint'].includes(normalizeFileType(file.file_type))

const groupKindLabel = (kind: LibraryGroupKind) =>
  kind === 'exact_name_conflict' ? '같은 제목 후보' : '수정본 묶음'

const GROUP_FILTER_OPTIONS: { value: GroupFilter; label: string }[] = [
  { value: 'all', label: '전체 보기' },
  { value: 'exact_name_conflict', label: '같은 제목 후보' },
  { value: 'version_family', label: '수정본 묶음' },
]

const GROUP_FILE_TYPE_OPTIONS: { value: GroupFileTypeFilter; label: string }[] = [
  { value: 'all', label: '모든 형식' },
  { value: 'Excel', label: '.xlsx' },
  { value: 'Word', label: '.docx' },
  { value: 'PowerPoint', label: '.pptx' },
]

const GROUP_SORT_OPTIONS: { value: GroupSort; label: string }[] = [
  { value: 'recent', label: '최근 수정순' },
  { value: 'count', label: '파일 많은 순' },
  { value: 'name', label: '이름순' },
]

const versionGroupAnchorId = (groupId: string) =>
  `version-group-${groupId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

const groupSummaryFromDetail = (detail: LibraryGroupDetail): LibraryGroupSummary => {
  const { files: _files, ...summary } = detail
  return summary
}

export default function ConsistencyCheck({
  tutorialStep,
  libraryDataRevision = 0,
  onTutorialStep,
}: {
  tutorialStep?: TutorialStep | null
  libraryDataRevision?: number
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const snackbar = useSnackbar()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTotal, setFileTotal] = useState(0)
  const [fileOffset, setFileOffset] = useState(0)
  const [fileQuery, setFileQuery] = useState('')
  const [fileQueryDraft, setFileQueryDraft] = useState('')
  const [filesLoading, setFilesLoading] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [groups, setGroups] = useState<LibraryGroupSummary[]>([])
  const [groupTotal, setGroupTotal] = useState(0)
  const [groupOffset, setGroupOffset] = useState(0)
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [groupQuery, setGroupQuery] = useState('')
  const [groupQueryDraft, setGroupQueryDraft] = useState('')
  const [groupFileType, setGroupFileType] = useState<GroupFileTypeFilter>('all')
  const [groupSort, setGroupSort] = useState<GroupSort>('recent')
  const [showDuplicateGroups, setShowDuplicateGroups] = useState(false)
  const [groupFilterOpen, setGroupFilterOpen] = useState(false)
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupIndexState, setGroupIndexState] = useState<{
    state: string
    stale: boolean
    updatedAt?: string | null
    error?: string | null
  }>({ state: 'missing', stale: false })
  const [groupLoadingId, setGroupLoadingId] = useState<string | null>(null)
  const [activeGroupDetail, setActiveGroupDetail] = useState<LibraryGroupDetail | null>(null)
  const [groupDetailFiles, setGroupDetailFiles] = useState<FileInfo[]>([])
  const [settingLatestFileId, setSettingLatestFileId] = useState<number | null>(null)
  const [clearingLatestGroupId, setClearingLatestGroupId] = useState<string | null>(null)
  const [historyState, setHistoryState] = useState<HistoryDiffState | null>(null)
  const [compareSelections, setCompareSelections] = useState<Record<string, CompareSelection>>({})
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingScrollGroupId, setPendingScrollGroupId] = useState<string | null>(null)
  const [excelGridModal, setExcelGridModal] = useState<ExcelGridModalState | null>(null)
  const historyRunRef = useRef(0)
  const groupRefreshTimerRef = useRef<number | null>(null)
  const manualResultRef = useRef<HTMLDivElement | null>(null)

  const fetchFiles = async (nextOffset = fileOffset, nextQuery = fileQuery) => {
    setFilesLoading(true)
    try {
      const response = await api.files.page({
        limit: CHECK_FILE_PAGE_SIZE,
        offset: nextOffset,
        query: nextQuery,
        fileTypes: ['Excel', 'Word', 'PowerPoint'],
      })
      setFiles(response.data.items)
      setFileTotal(response.data.total)
      setFileOffset(response.data.offset)
      setFileQuery(nextQuery)
    } catch {
      /* silent */
    } finally {
      setFilesLoading(false)
    }
  }

  const fetchGroups = async (
    nextOffset = groupOffset,
    nextFilter = groupFilter,
    nextQuery = groupQuery,
    nextFileType = groupFileType,
    nextSort = groupSort,
    nextShowDuplicates = showDuplicateGroups,
  ) => {
    setGroupsLoading(true)
    try {
      const response = await api.library.groups({
        limit: GROUP_PAGE_SIZE,
        offset: nextOffset,
        kind: nextFilter === 'all' ? undefined : nextFilter,
        query: nextQuery,
        fileType: nextFileType === 'all' ? undefined : nextFileType,
        sort: nextSort,
        includeDuplicates: nextShowDuplicates,
        cacheOnly: true,
      })
      setGroups(response.data.groups)
      setGroupTotal(response.data.total)
      setGroupIndexState({
        state: response.data.derived_index_state ?? 'ready',
        stale: Boolean(response.data.derived_index_stale),
        updatedAt: response.data.derived_index_updated_at,
        error: response.data.derived_index_error,
      })
      if (response.data.derived_index_stale) {
        if (groupRefreshTimerRef.current !== null) window.clearTimeout(groupRefreshTimerRef.current)
        groupRefreshTimerRef.current = window.setTimeout(() => {
          groupRefreshTimerRef.current = null
          void fetchGroups(nextOffset, nextFilter, nextQuery, nextFileType, nextSort, nextShowDuplicates)
        }, 1600)
      }
      setGroupOffset(response.data.offset)
      setGroupFilter(nextFilter)
      setGroupQuery(nextQuery)
      setGroupFileType(nextFileType)
      setGroupSort(nextSort)
      setShowDuplicateGroups(nextShowDuplicates)
      return { total: response.data.total, groups: response.data.groups }
    } catch {
      /* silent */
      return { total: 0, groups: [] }
    } finally {
      setGroupsLoading(false)
    }
  }

  useEffect(() => {
    void fetchFiles(0, '')
    void fetchGroups(0, 'all')
    return () => {
      if (groupRefreshTimerRef.current !== null) window.clearTimeout(groupRefreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (libraryDataRevision === 0) return
    setActiveGroupDetail(null)
    setHistoryState(null)
    setSelectedIds(new Set())
    void fetchFiles(0, fileQuery)
    void fetchGroups(0, groupFilter, groupQuery, groupFileType, groupSort, showDuplicateGroups)
  }, [libraryDataRevision])

  useEffect(() => {
    if (!pendingScrollGroupId || activeGroupDetail?.id !== pendingScrollGroupId) return
    const anchorId = versionGroupAnchorId(pendingScrollGroupId)
    window.requestAnimationFrame(() => {
      const element = document.getElementById(anchorId)
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setPendingScrollGroupId(null)
    })
  }, [activeGroupDetail?.id, pendingScrollGroupId])

  const knownFilesById = useMemo(() => {
    const byId = new Map<number, FileInfo>()
    files.forEach((file) => byId.set(file.id, file))
    groupDetailFiles.forEach((file) => byId.set(file.id, file))
    activeGroupDetail?.files.forEach((file) => byId.set(file.id, file))
    groups.forEach((group) => {
      if (group.latest_file) byId.set(group.latest_file.id, group.latest_file)
      if (group.previous_file) byId.set(group.previous_file.id, group.previous_file)
    })
    return byId
  }, [activeGroupDetail, files, groupDetailFiles, groups])

  const selectedFiles = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => knownFilesById.get(id))
        .filter((file): file is FileInfo => Boolean(file)),
    [knownFilesById, selectedIds],
  )
  const selectedMode = selectedFiles[0]
    ? getCompareMode(undefined, selectedFiles[0].file_type)
    : null

  const validateFilesForCheck = (candidateFiles: FileInfo[]): string | null => {
    if (candidateFiles.length < 2) return '최소 2개 파일을 선택해 주세요.'
    if (candidateFiles.some((file) => !isCheckableFile(file))) {
      return '변경점 확인은 Word, PowerPoint, Excel 파일만 지원합니다.'
    }
    const modes = new Set(candidateFiles.map((file) => getCompareMode(undefined, file.file_type)))
    if (modes.size > 1) return '파일 타입이 섞이면 검사할 수 없습니다.'
    const mode = getCompareMode(undefined, candidateFiles[0].file_type)
    if ((mode === 'word' || mode === 'ppt') && candidateFiles.length !== 2) {
      return `${mode === 'word' ? 'Word' : 'PPT'} 비교는 정확히 2개 파일이 필요합니다.`
    }
    return null
  }

  const runCheckForFiles = async (candidateFiles: FileInfo[]) => {
    const validationError = validateFilesForCheck(candidateFiles)
    if (validationError) {
      snackbar.warn(validationError)
      return
    }

    const ids = candidateFiles.map((file) => file.id)
    setSelectedIds(new Set(ids))
    setGroupDetailFiles(candidateFiles)
    setLoading(true)
    setResult(null)
    try {
      const response = await api.check.run({ file_ids: ids })
      const normalized = normalizeCheckResponse(response.data)
      setResult(normalized)
      snackbar.success('선택한 파일 비교 결과가 바로 아래에 열렸습니다.')
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '변경점 확인에 실패했습니다.'
      snackbar.error(detail)
    } finally {
      setLoading(false)
    }
  }

  const toggleFile = (file: FileInfo) => {
    if (!isCheckableFile(file)) {
      snackbar.warn('이 파일 형식은 검색 등록은 가능하지만 변경점 확인은 지원하지 않습니다.')
      return
    }
    const next = new Set(selectedIds)
    const isSelected = next.has(file.id)
    const fileMode = getCompareMode(undefined, file.file_type)

    if (isSelected) {
      next.delete(file.id)
      setSelectedIds(next)
      setResult(null)
      return
    }

    if (selectedMode && fileMode !== selectedMode) {
      snackbar.warn('변경점 확인은 같은 파일 타입만 함께 선택할 수 있습니다.')
      return
    }
    if ((fileMode === 'word' || fileMode === 'ppt') && next.size >= 2) {
      snackbar.warn(`${fileMode === 'word' ? 'Word' : 'PPT'} 비교는 2개 파일까지만 선택할 수 있습니다.`)
      return
    }

    next.add(file.id)
    setSelectedIds(next)
    setResult(null)
  }

  const handleCheck = () => {
    void runCheckForFiles(selectedFiles)
  }

  useEffect(() => {
    if (!loading && !result) return undefined
    const frame = window.requestAnimationFrame(() => {
      manualResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      manualResultRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loading, result])

  const loadGroupDetail = async (group: LibraryGroupSummary): Promise<LibraryGroupDetail | null> => {
    if (activeGroupDetail?.id === group.id) return activeGroupDetail

    setGroupLoadingId(group.id)
    try {
      const response = await api.library.groupDetail(group.id)
      const detail = response.data
      setActiveGroupDetail(detail)
      setGroupDetailFiles(detail.files)
      return detail
    } catch {
      snackbar.error('문서 묶음 상세 정보를 불러오지 못했습니다.')
      return null
    } finally {
      setGroupLoadingId(null)
    }
  }

  const defaultCompareSelection = (detail: LibraryGroupDetail): CompareSelection => ({
    fromId: detail.previous_file?.id ?? detail.files[1]?.id ?? null,
    toId: detail.latest_file?.id ?? detail.files[0]?.id ?? null,
  })

  const normalizeCompareSelection = (
    detail: LibraryGroupDetail,
    selection?: CompareSelection | null,
  ): CompareSelection => {
    const fileIds = new Set(detail.files.map((file) => file.id))
    const defaults = defaultCompareSelection(detail)
    let fromId = selection?.fromId && fileIds.has(selection.fromId) ? selection.fromId : defaults.fromId
    let toId = selection?.toId && fileIds.has(selection.toId) ? selection.toId : defaults.toId

    if (fromId === toId) {
      const alternate = detail.files.find((file) => file.id !== toId)?.id ?? null
      fromId = alternate
    }

    return { fromId, toId }
  }

  const buildHistoryTransitions = (
    detail: LibraryGroupDetail,
    selection: CompareSelection,
  ): HistoryTransition[] => {
    const fromFile = selection.fromId
      ? detail.files.find((file) => file.id === selection.fromId)
      : undefined
    const toFile = selection.toId
      ? detail.files.find((file) => file.id === selection.toId)
      : undefined

    if (!fromFile || !toFile || fromFile.id === toFile.id) return []

    return [
      {
        id: `${fromFile.id}->${toFile.id}`,
        fromFile,
        toFile,
        status: 'pending' as const,
        result: null,
      },
    ]
  }

  const runHistoryDiffs = async (
    detail: LibraryGroupDetail,
    requestedSelection?: CompareSelection | null,
  ) => {
    const runId = historyRunRef.current + 1
    historyRunRef.current = runId
    const isCurrentRun = () => historyRunRef.current === runId
    const selection = normalizeCompareSelection(detail, requestedSelection ?? compareSelections[detail.id])
    setCompareSelections((current) => ({ ...current, [detail.id]: selection }))
    const transitions = buildHistoryTransitions(detail, selection)
    const total = transitions.length
    const truncated = detail.file_count > detail.files.length
    setHistoryState({
      groupId: detail.id,
      transitions,
      loading: total > 0,
      completed: 0,
      total,
      truncated,
    })

    if (total === 0) return

    const runTransition = async (transition: HistoryTransition) => {
      if (!isCurrentRun()) return
      setHistoryState((current) =>
        current?.groupId === detail.id && isCurrentRun()
          ? {
              ...current,
              transitions: current.transitions.map((item) =>
                item.id === transition.id ? { ...item, status: 'loading' } : item,
              ),
            }
          : current,
      )

      try {
        const response = await api.check.run({
          file_ids: [transition.fromFile.id, transition.toFile.id],
        })
        if (!isCurrentRun()) return
        const normalized = normalizeCheckResponse(response.data)
        setHistoryState((current) =>
          current?.groupId === detail.id && isCurrentRun()
            ? {
                ...current,
                completed: Math.min(current.completed + 1, current.total),
                transitions: current.transitions.map((item) =>
                  item.id === transition.id
                    ? { ...item, status: 'done', result: normalized, error: undefined }
                    : item,
                ),
              }
            : current,
        )
      } catch (error) {
        if (!isCurrentRun()) return
        const detailMessage =
          (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          '이 파일 사이의 변경점을 계산하지 못했습니다.'
        setHistoryState((current) =>
          current?.groupId === detail.id && isCurrentRun()
            ? {
                ...current,
                completed: Math.min(current.completed + 1, current.total),
                transitions: current.transitions.map((item) =>
                  item.id === transition.id
                    ? { ...item, status: 'error', error: detailMessage }
                    : item,
                ),
              }
            : current,
        )
      }
    }

    await runTransition(transitions[0])

    setHistoryState((current) =>
      current?.groupId === detail.id && isCurrentRun() ? { ...current, loading: false } : current,
    )
  }

  const changeCompareSelection = (
    detail: LibraryGroupDetail,
    file: FileInfo,
    slot: CompareSlot,
  ) => {
    const currentSelection = normalizeCompareSelection(detail, compareSelections[detail.id])
    const nextSelection =
      slot === 'from'
        ? { ...currentSelection, fromId: file.id }
        : { ...currentSelection, toId: file.id }

    if (nextSelection.fromId === nextSelection.toId) {
      snackbar.warn('서로 다른 두 파일을 1번과 2번으로 선택해 주세요.')
      return
    }

    setCompareSelections((current) => ({ ...current, [detail.id]: nextSelection }))
    void runHistoryDiffs(detail, nextSelection)
  }

  const selectGroup = async (group: LibraryGroupSummary) => {
    if (activeGroupDetail?.id === group.id) {
      setActiveGroupDetail(null)
      setHistoryState(null)
      setGroupDetailFiles([])
      return false
    }

    const detail = await loadGroupDetail(group)
    if (!detail) return false
    if (!tutorialStep) setPendingScrollGroupId(detail.id)
    await runHistoryDiffs(detail, compareSelections[detail.id])
    return true
  }

  const openGuidedGroup = async (group: LibraryGroupSummary) => {
    const opened = await selectGroup(group)
    if (!opened) return
    const normalizedType = normalizeFileType(group.file_type)
    if (tutorialStep === 'version-ppt' && normalizedType === 'PowerPoint') {
      onTutorialStep?.('version-ppt-review')
    } else if (tutorialStep === 'version-excel' && normalizedType === 'Excel') {
      onTutorialStep?.('version-excel-review')
    }
  }

  const setGroupLatestFile = async (detail: LibraryGroupDetail, file: FileInfo) => {
    if (detail.files[0]?.id === file.id) {
      snackbar.info('이미 최신 파일로 표시되어 있습니다.')
      return
    }

    setSettingLatestFileId(file.id)
    setGroupLoadingId(detail.id)
    try {
      const response = await api.library.setGroupLatestFile(detail.id, file.id)
      const updated = response.data
      setActiveGroupDetail(updated)
      setGroupDetailFiles(updated.files)
      setGroups((current) =>
        current.map((group) => (group.id === updated.id ? groupSummaryFromDetail(updated) : group)),
      )
      setHistoryState(null)
      const nextSelection = defaultCompareSelection(updated)
      setCompareSelections((current) => ({ ...current, [updated.id]: nextSelection }))
      snackbar.success('최신 파일로 지정했습니다.')
      void runHistoryDiffs(updated, nextSelection)
    } catch (error) {
      const detailMessage =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '최신 파일을 지정하지 못했습니다.'
      snackbar.error(detailMessage)
    } finally {
      setSettingLatestFileId(null)
      setGroupLoadingId(null)
    }
  }

  const clearGroupLatestFile = async (detail: LibraryGroupDetail) => {
    if (!detail.manual_latest_file_id) {
      snackbar.info('이미 자동 최신 정렬을 사용 중입니다.')
      return
    }

    setClearingLatestGroupId(detail.id)
    setGroupLoadingId(detail.id)
    try {
      const response = await api.library.clearGroupLatestFile(detail.id)
      const updated = response.data
      setActiveGroupDetail(updated)
      setGroupDetailFiles(updated.files)
      setGroups((current) =>
        current.map((group) => (group.id === updated.id ? groupSummaryFromDetail(updated) : group)),
      )
      setHistoryState(null)
      const nextSelection = defaultCompareSelection(updated)
      setCompareSelections((current) => ({ ...current, [updated.id]: nextSelection }))
      snackbar.success('자동 최신 정렬로 되돌렸습니다.')
      void runHistoryDiffs(updated, nextSelection)
    } catch (error) {
      const detailMessage =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '자동 최신 정렬로 되돌리지 못했습니다.'
      snackbar.error(detailMessage)
    } finally {
      setClearingLatestGroupId(null)
      setGroupLoadingId(null)
    }
  }

  const openExcelGrid = async (detail: LibraryGroupDetail, currentHistoryState: HistoryDiffState | null) => {
    if (normalizeFileType(detail.file_type) !== 'Excel') {
      snackbar.warn('표로 보기는 Excel 묶음에서만 사용할 수 있습니다.')
      return false
    }

    const focuses = currentHistoryState ? buildExcelGridFocuses(currentHistoryState.transitions) : []
    setExcelGridModal({
      detail,
      loading: true,
      data: null,
      error: '',
    })
    try {
      const response = await api.check.excelGrid({
        file_ids: detail.files.map((file) => file.id),
        focuses,
      })
      setExcelGridModal({
        detail,
        loading: false,
        data: response.data,
        error: '',
      })
      return true
    } catch (error) {
      const detailMessage =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Excel 표를 불러오지 못했습니다.'
      setExcelGridModal({
        detail,
        loading: false,
        data: null,
        error: detailMessage,
      })
      return false
    }
  }

  const openGuidedExcelGrid = async (detail: LibraryGroupDetail, currentHistoryState: HistoryDiffState | null) => {
    const opened = await openExcelGrid(detail, currentHistoryState)
    if (opened && tutorialStep === 'excel-table') onTutorialStep?.('excel-table-cell')
  }

  const openFile = async (file: FileInfo) => {
    try {
      await api.files.open(file.id)
    } catch {
      snackbar.error('파일을 열지 못했습니다. 경로가 바뀌었는지 확인해 주세요.')
    }
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

  const changeGroupFilter = (nextFilter: GroupFilter) => {
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, nextFilter, groupQuery, groupFileType, groupSort, showDuplicateGroups)
  }

  const changeGroupFileType = (nextFileType: GroupFileTypeFilter) => {
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, groupFilter, groupQuery, nextFileType, groupSort, showDuplicateGroups)
  }

  const changeGroupSort = (nextSort: GroupSort) => {
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, groupFilter, groupQuery, groupFileType, nextSort, showDuplicateGroups)
  }

  const changeDuplicateGroups = (nextShowDuplicates: boolean) => {
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, groupFilter, groupQuery, groupFileType, groupSort, nextShowDuplicates)
  }

  const handleGroupSearch = () => {
    const nextQuery = groupQueryDraft.trim()
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, groupFilter, nextQuery, groupFileType, groupSort, showDuplicateGroups).then((response) => {
      if (tutorialStep !== 'version-excel-search') return
      if (response.groups.some((group) => normalizeFileType(group.file_type) === 'Excel')) {
        onTutorialStep?.('version-excel')
      } else {
        snackbar.warn('예제 Excel 묶음을 찾지 못했습니다. 검색어를 확인하거나 필터를 초기화해 주세요.')
      }
    })
  }

  const clearGroupSearch = () => {
    setGroupQueryDraft('')
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, groupFilter, '', groupFileType, groupSort, showDuplicateGroups)
  }

  const resetGroupFilters = () => {
    setGroupQueryDraft('')
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, 'all', '', 'all', 'recent', false)
  }

  const scrollToManualPicker = () => {
    setManualOpen(true)
    window.requestAnimationFrame(() => {
      document
        .getElementById('manual-version-picker')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const goToGroupPage = (nextOffset: number) => {
    const boundedOffset = Math.max(0, nextOffset)
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(boundedOffset, groupFilter, groupQuery, groupFileType, groupSort, showDuplicateGroups)
  }

  const visibleFileStart = fileTotal === 0 ? 0 : fileOffset + 1
  const visibleFileEnd = Math.min(fileOffset + files.length, fileTotal)
  const hasPreviousFilePage = fileOffset > 0
  const hasNextFilePage = fileOffset + files.length < fileTotal
  const visibleGroupStart = groupTotal === 0 ? 0 : groupOffset + 1
  const visibleGroupEnd = Math.min(groupOffset + groups.length, groupTotal)
  const hasPreviousGroupPage = groupOffset > 0
  const hasNextGroupPage = groupOffset + groups.length < groupTotal
  const groupFilterLabel =
    GROUP_FILTER_OPTIONS.find((option) => option.value === groupFilter)?.label ?? '전체 보기'
  const groupFileTypeLabel =
    GROUP_FILE_TYPE_OPTIONS.find((option) => option.value === groupFileType)?.label ?? '모든 형식'
  const groupSortLabel =
    GROUP_SORT_OPTIONS.find((option) => option.value === groupSort)?.label ?? '최근 수정순'
  const activeFilterCount =
    (groupFilter === 'all' ? 0 : 1) +
    (groupFileType === 'all' ? 0 : 1) +
    (groupSort === 'recent' ? 0 : 1) +
    (showDuplicateGroups ? 1 : 0)
  const hasActiveGroupFilters =
    Boolean(groupQuery) ||
    groupFilter !== 'all' ||
    groupFileType !== 'all' ||
    groupSort !== 'recent' ||
    showDuplicateGroups
  const tutorialOpenTargetType =
    tutorialStep === 'version-ppt'
      ? 'PowerPoint'
      : tutorialStep === 'version-excel'
        ? 'Excel'
        : null
  const tutorialOpenTargetGroupId = tutorialOpenTargetType
    ? (groups.find((group) => normalizeFileType(group.file_type) === tutorialOpenTargetType)?.id ?? null)
    : null

  if (fileTotal === 0 && groupTotal === 0 && !filesLoading && !groupsLoading) {
    return (
      <Card variant="outlined">
        <EmptyState
          icon="fact_check"
          title="먼저 파일을 등록해 주세요"
          description="변경 이력은 등록된 Office 파일 사이의 수정본과 변경점을 확인합니다."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card variant="elevated">
        <CardSection
          title="변경 이력"
          description="검토가 필요한 문서 그룹을 찾아 확인하세요. 문서가 많으면 문서명, 폴더명, 형식으로 좁혀볼 수 있습니다."
          trailing={
            <Chip
              label={
                groupTotal > groups.length
                  ? `표시 ${visibleGroupStart}-${visibleGroupEnd} / ${groupTotal}`
                  : `${groupTotal}개 그룹`
              }
              tone="primary"
              icon="view_list"
              as="span"
            />
          }
        >
          <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4">
            <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
              <div className="min-w-[260px] flex-1">
                <TextField
                  leadingIcon="search"
                  placeholder="문서명, 파일명, 폴더명으로 찾기"
                  value={groupQueryDraft}
                  onChange={(event) => setGroupQueryDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleGroupSearch()
                  }}
                  helper="예: 사업예산, 주간보고, 프로젝트명, 부서명"
                />
              </div>
              <Button
                variant="filled"
                leadingIcon="search"
                onClick={handleGroupSearch}
                disabled={groupsLoading}
                className={tutorialStep === 'version-excel-search' ? 'attention-pulse tour-target' : ''}
                data-tour-target={tutorialStep === 'version-excel-search' ? 'version-excel-search' : undefined}
              >
                찾기
              </Button>
              <Button
                variant={groupFilterOpen || activeFilterCount > 0 ? 'tonal' : 'outlined'}
                leadingIcon="tune"
                onClick={() => setGroupFilterOpen((value) => !value)}
                aria-expanded={groupFilterOpen}
              >
                필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
              </Button>
              {groupQuery && (
                <Button variant="text" leadingIcon="close" onClick={clearGroupSearch} disabled={groupsLoading}>
                  지우기
                </Button>
              )}
              <Button
                variant="text"
                leadingIcon="restart_alt"
                onClick={resetGroupFilters}
                disabled={groupsLoading || !hasActiveGroupFilters}
              >
                필터 초기화
              </Button>
            </div>
            {groupFilterOpen && (
              <div className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/70 p-3 shadow-elev-1">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                  <div>
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">묶음 기준</p>
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {GROUP_FILTER_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          size="sm"
                          variant={groupFilter === option.value ? 'tonal' : 'outlined'}
                          onClick={() => changeGroupFilter(option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">문서 형식</p>
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {GROUP_FILE_TYPE_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          size="sm"
                          variant={groupFileType === option.value ? 'tonal' : 'outlined'}
                          onClick={() => changeGroupFileType(option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">정렬 기준</p>
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {GROUP_SORT_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          size="sm"
                          variant={groupSort === option.value ? 'tonal' : 'outlined'}
                          onClick={() => changeGroupSort(option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">같은 내용 문서</p>
                    <div className="mt-2 space-y-2">
                      <Button
                        size="sm"
                        variant={showDuplicateGroups ? 'tonal' : 'outlined'}
                        leadingIcon={showDuplicateGroups ? 'visibility' : 'visibility_off'}
                        onClick={() => changeDuplicateGroups(!showDuplicateGroups)}
                      >
                        같은 내용 문서도 표시
                      </Button>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        변경점이 없는 동일 내용 문서는 기본적으로 숨깁니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                <Chip label={`묶음 · ${groupFilterLabel}`} tone="neutral" as="span" />
                <Chip label={`형식 · ${groupFileTypeLabel}`} tone="neutral" as="span" />
                <Chip label={`정렬 · ${groupSortLabel}`} tone="neutral" as="span" />
                {showDuplicateGroups && <Chip label="같은 내용 문서 포함" tone="neutral" as="span" />}
              </div>
              <Button
                variant="outlined"
                leadingIcon="library_add_check"
                onClick={scrollToManualPicker}
              >
                직접 파일 고르기
              </Button>
            </div>
            {hasActiveGroupFilters && (
              <div className="flex gap-2 flex-wrap">
                {groupQuery && <Chip label={`검색어 · ${groupQuery}`} tone="secondary" icon="search" as="span" />}
                {groupFilter !== 'all' && <Chip label={`묶음 · ${groupFilterLabel}`} tone="primary" as="span" />}
                {groupFileType !== 'all' && <Chip label={`형식 · ${groupFileTypeLabel}`} tone="neutral" as="span" />}
                {groupSort !== 'recent' && <Chip label={`정렬 · ${groupSortLabel}`} tone="neutral" as="span" />}
                {showDuplicateGroups && <Chip label="같은 내용 문서 포함" tone="neutral" as="span" />}
              </div>
            )}
          </div>

          {groupIndexState.stale && (
            <div className="mx-5 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-secondary-container)]/45 px-4 py-3 type-body-sm text-[var(--md-sys-color-on-secondary-container)]">
              <span className="font-medium">문서 묶음 정보를 준비 중입니다.</span>
              <span className="ml-2 text-[var(--md-sys-color-on-surface-variant)]">
                준비된 결과를 먼저 보여주고, 완료되면 자동으로 새로고침합니다.
              </span>
            </div>
          )}

          {groupsLoading ? (
            <div className="px-6 py-10 flex items-center justify-center gap-2 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
              <Spinner size={18} /> 그룹 불러오는 중…
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon="task_alt"
              title="자동 감지된 변경 이력 묶음이 없습니다"
              description="같은 제목이거나 파일명에 날짜·수정본 표시가 붙은 Office 문서를 등록하면 이곳에 표시됩니다."
              compact
            />
          ) : (
            <div className="space-y-3">
              {groups.map((group) => {
                const normalizedType = normalizeFileType(group.file_type)
                const highlightOpen = tutorialOpenTargetGroupId === group.id
                const highlightExcelGrid = tutorialStep === 'excel-table' && activeGroupDetail?.id === group.id
                const highlightReview =
                  activeGroupDetail?.id === group.id &&
                  (((tutorialStep === 'version-ppt-review' || tutorialStep === 'version-ppt-detail') &&
                    normalizedType === 'PowerPoint') ||
                    (tutorialStep === 'version-excel-review' && normalizedType === 'Excel'))
                return (
                  <GroupCard
                    key={group.id}
                    group={group}
                    activeDetail={activeGroupDetail?.id === group.id ? activeGroupDetail : null}
                    historyState={historyState?.groupId === group.id ? historyState : null}
                    compareSelection={
                      activeGroupDetail?.id === group.id
                        ? normalizeCompareSelection(activeGroupDetail, compareSelections[group.id])
                        : null
                    }
                    loading={groupLoadingId === group.id}
                    onOpen={() => void openGuidedGroup(group)}
                    onOpenFile={(file) => void openFile(file)}
                    onOpenExcelGrid={(detail, state) => void openGuidedExcelGrid(detail, state)}
                    onSelectCompareSlot={(detail, file, slot) => changeCompareSelection(detail, file, slot)}
                    onSetLatestFile={(detail, file) => void setGroupLatestFile(detail, file)}
                    onClearLatestFile={(detail) => void clearGroupLatestFile(detail)}
                    settingLatestFileId={settingLatestFileId}
                    clearingLatestGroupId={clearingLatestGroupId}
                    highlightOpen={highlightOpen}
                    openTourTarget={highlightOpen ? (tutorialStep ?? undefined) : undefined}
                    highlightExcelGrid={highlightExcelGrid}
                    excelGridTourTarget={highlightExcelGrid ? (tutorialStep ?? undefined) : undefined}
                    highlightReview={highlightReview}
                    reviewTourTarget={highlightReview ? (tutorialStep ?? undefined) : undefined}
                    tutorialStep={tutorialStep}
                    onTutorialStep={onTutorialStep}
                  />
                )
              })}
            </div>
          )}

          {groupTotal > GROUP_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-3">
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                {visibleGroupStart}-{visibleGroupEnd} / {groupTotal}개 그룹
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outlined"
                  leadingIcon="chevron_left"
                  onClick={() => goToGroupPage(groupOffset - GROUP_PAGE_SIZE)}
                  disabled={!hasPreviousGroupPage || groupsLoading}
                >
                  이전
                </Button>
                <Button
                  variant="outlined"
                  trailingIcon="chevron_right"
                  onClick={() => goToGroupPage(groupOffset + GROUP_PAGE_SIZE)}
                  disabled={!hasNextGroupPage || groupsLoading}
                >
                  다음
                </Button>
              </div>
            </div>
          )}
        </CardSection>
      </Card>

      <Card id="manual-version-picker" variant="outlined">
        <CardSection
          title="직접 비교할 파일 고르기"
          description="자동 묶음에 없는 문서를 비교할 때만 열어 사용하세요. 현재 페이지와 검색 결과만 보여줍니다."
          trailing={
            <Button
              variant={manualOpen ? 'tonal' : 'outlined'}
              leadingIcon={manualOpen ? 'expand_less' : 'expand_more'}
              onClick={() => setManualOpen((value) => !value)}
            >
              {manualOpen ? '접기' : '열기'}
            </Button>
          }
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={`선택 ${selectedFiles.length}개`} tone="primary" icon="task_alt" as="span" />
            {selectedMode && <Chip label={`비교 방식 · ${selectedMode.toUpperCase()}`} tone="secondary" as="span" />}
            {selectedFiles.slice(0, 3).map((file) => (
              <Chip key={file.id} label={file.name} tone="neutral" as="span" />
            ))}
            {selectedFiles.length > 3 && <Chip label={`외 ${selectedFiles.length - 3}개`} tone="neutral" as="span" />}
            <Button
              variant="filled"
              leadingIcon="play_arrow"
              onClick={handleCheck}
              loading={loading}
              disabled={selectedFiles.length < 2}
            >
              선택한 파일 비교하기
            </Button>
          </div>

          {(loading || result) && (
            <div ref={manualResultRef} tabIndex={-1} className="outline-none">
              <ManualCompareResultPanel loading={loading} result={result} selectedFiles={selectedFiles} />
            </div>
          )}

          {manualOpen && (
            <div className="space-y-4 pt-2">
              <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
                <div className="flex-1 min-w-[240px]">
                  <TextField
                    leadingIcon="search"
                    placeholder="비교할 Office 파일명 또는 경로 검색"
                    value={fileQueryDraft}
                    onChange={(event) => setFileQueryDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleFileSearch()
                    }}
                  />
                </div>
                <Button variant="filled" leadingIcon="search" onClick={handleFileSearch} disabled={filesLoading}>
                  검색
                </Button>
                {fileQuery && (
                  <Button variant="text" leadingIcon="close" onClick={clearFileSearch} disabled={filesLoading}>
                    검색 해제
                  </Button>
                )}
              </div>

              <div className="flex gap-2 flex-wrap">
                <Chip
                  label={fileTotal === 0 ? '표시 0개' : `표시 ${visibleFileStart}-${visibleFileEnd} / ${fileTotal}`}
                  tone="neutral"
                  icon="view_list"
                  as="span"
                />
                <Chip label={MODE_GUIDE[selectedMode ?? 'none']} tone="neutral" as="span" />
              </div>

              {filesLoading ? (
                <div className="px-6 py-10 flex items-center justify-center gap-2 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
                  <Spinner size={18} /> 불러오는 중…
                </div>
              ) : files.length === 0 ? (
                <EmptyState
                  icon="search_off"
                  title="표시할 Office 파일이 없습니다"
                  description="검색어를 바꾸거나 설정에서 Word/PPT/Excel 파일을 등록해 주세요."
                  compact
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {files.map((file) => {
                    const checked = selectedIds.has(file.id)
                    const fileMode = getCompareMode(undefined, file.file_type)
                    const unsupported = !isCheckableFile(file)
                    const disabled =
                      !checked &&
                      Boolean(
                        unsupported ||
                          (selectedMode && fileMode !== selectedMode) ||
                          ((selectedMode === 'word' || selectedMode === 'ppt') && selectedIds.size >= 2),
                      )
                    return (
                      <label
                        key={file.id}
                        className={`flex items-start gap-3 px-3 py-3 rounded-md border transition-colors ${
                          disabled
                            ? 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] opacity-50 cursor-not-allowed'
                            : checked
                              ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/30 cursor-pointer'
                              : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-low)] cursor-pointer'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleFile(file)}
                          aria-label={file.name}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="type-title-sm text-[var(--md-sys-color-on-surface)] truncate">
                              {file.name}
                            </p>
                            <FileTypeBadge fileType={file.file_type} />
                          </div>
                          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
                            {unsupported
                              ? '검색에는 사용할 수 있음 · 변경점 확인 제외'
                              : fileMode === 'excel'
                                ? '셀 위치 기준 · 여러 파일 비교'
                                : `${fileMode === 'word' ? '문서 변경' : '슬라이드 변경'} · 2개 비교`}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}

              {fileTotal > CHECK_FILE_PAGE_SIZE && (
                <div className="flex items-center justify-between gap-3 flex-wrap pt-3">
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {visibleFileStart}-{visibleFileEnd} / {fileTotal}개
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outlined"
                      leadingIcon="chevron_left"
                      onClick={() => goToFilePage(fileOffset - CHECK_FILE_PAGE_SIZE)}
                      disabled={!hasPreviousFilePage || filesLoading}
                    >
                      이전
                    </Button>
                    <Button
                      variant="outlined"
                      trailingIcon="chevron_right"
                      onClick={() => goToFilePage(fileOffset + CHECK_FILE_PAGE_SIZE)}
                      disabled={!hasNextFilePage || filesLoading}
                    >
                      다음
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardSection>
      </Card>

      {excelGridModal && (
        <ExcelDiffGridModal
          modal={excelGridModal}
          onClose={() => setExcelGridModal(null)}
          highlightReview={tutorialStep === 'excel-table-cell' || tutorialStep === 'excel-table-history'}
          tutorialStep={tutorialStep}
          onTutorialStep={onTutorialStep}
        />
      )}
    </div>
  )
}

function manualResultSummary(result: CheckResponse | null) {
  if (!result) return ''
  if (result.mode === 'excel') {
    const count = result.issues.reduce((total, issue) => total + issue.conflicts.length, 0)
    return `${count.toLocaleString('ko-KR')}개 셀/값 변경`
  }
  if (result.mode === 'word') {
    return `${result.diffs.length.toLocaleString('ko-KR')}개 문단/표 변경`
  }
  return `${result.slides.length.toLocaleString('ko-KR')}개 슬라이드 변경`
}

function ManualCompareResultPanel({
  loading,
  result,
  selectedFiles,
}: {
  loading: boolean
  result: CheckResponse | null
  selectedFiles: FileInfo[]
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[var(--md-sys-color-primary)]/35 bg-[var(--md-sys-color-surface-container-lowest)] shadow-elev-1">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-primary-container)]/18 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
            {loading ? '선택한 파일을 비교하는 중입니다' : '선택한 파일 비교 결과가 열렸습니다'}
          </p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate">
            {selectedFiles.map((file) => file.name).join(' · ')}
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-1 type-label-md text-[var(--md-sys-color-on-surface-variant)]">
            <Spinner size={14} /> 계산 중
          </span>
        ) : result ? (
          <Badge tone="primary">{manualResultSummary(result)}</Badge>
        ) : null}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-5 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          <Spinner size={18} /> 결과가 준비되면 이 자리에서 바로 펼쳐집니다.
        </div>
      ) : result ? (
        <div className="space-y-4 p-4">
          <CompareMetadataWarnings metadata={result.metadata} />
          {result.mode === 'excel' && <ExcelCheckResult result={result} />}
          {result.mode === 'word' && <WordCheckResult diffs={result.diffs} />}
          {result.mode === 'ppt' && <PptCheckResult slides={result.slides} />}
        </div>
      ) : null}
    </div>
  )
}

function GroupCard({
  group,
  activeDetail,
  historyState,
  compareSelection,
  loading,
  onOpen,
  onOpenFile,
  onOpenExcelGrid,
  onSelectCompareSlot,
  onSetLatestFile,
  onClearLatestFile,
  settingLatestFileId,
  clearingLatestGroupId,
  highlightOpen = false,
  openTourTarget,
  highlightExcelGrid = false,
  excelGridTourTarget,
  highlightReview = false,
  reviewTourTarget,
  tutorialStep,
  onTutorialStep,
}: {
  group: LibraryGroupSummary
  activeDetail: LibraryGroupDetail | null
  historyState: HistoryDiffState | null
  compareSelection: CompareSelection | null
  loading: boolean
  onOpen: () => void
  onOpenFile: (file: FileInfo) => void
  onOpenExcelGrid: (detail: LibraryGroupDetail, historyState: HistoryDiffState | null) => void
  onSelectCompareSlot: (detail: LibraryGroupDetail, file: FileInfo, slot: CompareSlot) => void
  onSetLatestFile: (detail: LibraryGroupDetail, file: FileInfo) => void
  onClearLatestFile: (detail: LibraryGroupDetail) => void
  settingLatestFileId: number | null
  clearingLatestGroupId: string | null
  highlightOpen?: boolean
  openTourTarget?: TutorialStep
  highlightExcelGrid?: boolean
  excelGridTourTarget?: TutorialStep
  highlightReview?: boolean
  reviewTourTarget?: TutorialStep
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const historyLoading = loading || (!activeDetail && Boolean(historyState?.loading))

  return (
    <div
      id={versionGroupAnchorId(group.id)}
      className={`scroll-mt-24 overflow-hidden rounded-xl border bg-[var(--md-sys-color-surface-container-lowest)] transition-colors ${
        activeDetail
          ? 'border-[var(--md-sys-color-primary)]/45 shadow-elev-1'
          : 'border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-surface-container-low)]'
      }`}
    >
      <div className="grid grid-cols-1 gap-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/70 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 flex-wrap">
            <FileTypeBadge fileType={group.file_type} />
            <Badge tone={group.group_kind === 'exact_name_conflict' ? 'warning' : 'neutral'}>
              {groupKindLabel(group.group_kind)}
            </Badge>
            <Badge tone="neutral">{group.file_count}개 파일</Badge>
          </div>
          <p className="truncate type-title-md text-[var(--md-sys-color-on-surface)]" title={group.latest_file?.name ?? group.base_name}>
            {group.latest_file?.name ?? group.base_name}
          </p>
          <p className="mt-1 truncate type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            {group.base_name}
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            variant={activeDetail ? 'tonal' : 'filled'}
            size="sm"
            leadingIcon={activeDetail ? 'expand_less' : 'timeline'}
            onClick={onOpen}
            loading={historyLoading}
            className={highlightOpen && !activeDetail ? 'attention-pulse tour-target' : ''}
            data-tour-target={highlightOpen && !activeDetail ? openTourTarget : undefined}
          >
            {activeDetail ? '접기' : '변경점 보기'}
          </Button>
        </div>
      </div>

      {activeDetail && (
        <GroupTimeline
          detail={activeDetail}
          historyState={historyState}
          compareSelection={compareSelection}
          onOpenFile={onOpenFile}
          onOpenExcelGrid={() => onOpenExcelGrid(activeDetail, historyState)}
          onSelectCompareSlot={(file, slot) => onSelectCompareSlot(activeDetail, file, slot)}
          onSetLatestFile={(file) => onSetLatestFile(activeDetail, file)}
          onClearLatestFile={() => onClearLatestFile(activeDetail)}
          settingLatestFileId={settingLatestFileId}
          clearingLatestGroupId={clearingLatestGroupId}
          highlightExcelGrid={highlightExcelGrid}
          excelGridTourTarget={excelGridTourTarget}
          highlightReview={highlightReview}
          reviewTourTarget={reviewTourTarget}
          tutorialStep={tutorialStep}
          onTutorialStep={onTutorialStep}
        />
      )}
    </div>
  )
}
