import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  CheckResponse,
  ExcelDiffGridCell,
  ExcelDiffGridFocus,
  ExcelDiffGridResponse,
  ExcelDiffHighlight,
  ExcelCheckIssue,
  FileInfo,
  LibraryGroupDetail,
  LibraryGroupKind,
  LibraryGroupSummary,
  PptSlideCard,
  WordDiffCard,
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
  Icon,
  Spinner,
  StatCard,
  TextField,
  useSnackbar,
} from '../ui'
import { EXAMPLE_EXCEL_QUERY, EXAMPLE_PPT_QUERY, TutorialStep } from '../tutorial'

const CHECK_FILE_PAGE_SIZE = 60
const GROUP_PAGE_SIZE = 50
const VERSION_LIST_PREVIEW_LIMIT = 5
type GroupFilter = 'all' | LibraryGroupKind
type GroupFileTypeFilter = 'all' | 'Excel' | 'Word' | 'PowerPoint'
type GroupSort = 'recent' | 'count' | 'name'
type HistoryTransitionStatus = 'pending' | 'loading' | 'done' | 'error'
type CompareSlot = 'from' | 'to'

interface CompareSelection {
  fromId: number | null
  toId: number | null
}

interface HistoryTransition {
  id: string
  fromFile: FileInfo
  toFile: FileInfo
  status: HistoryTransitionStatus
  result: CheckResponse | null
  error?: string
}

interface HistoryDiffState {
  groupId: string
  transitions: HistoryTransition[]
  loading: boolean
  completed: number
  total: number
  truncated: boolean
}

interface ExcelGridModalState {
  detail: LibraryGroupDetail
  loading: boolean
  data: ExcelDiffGridResponse | null
  error: string
}

const MODE_GUIDE: Record<string, string> = {
  excel: 'Excel은 여러 파일을 동시에 비교합니다. 같은 항목의 행을 맞춰 값 차이와 행/열 추가·삭제를 찾습니다.',
  word: 'Word는 2개 파일만 비교합니다. 추가·삭제·수정된 문단과 표 행을 카드 형태로 보여줍니다.',
  ppt: 'PPT는 2개 파일만 비교합니다. 슬라이드 추가/삭제와 슬라이드 내 항목 변경을 보여줍니다.',
  none: '자동 감지된 문서 그룹에서 바로 비교하거나, 필요할 때만 수동 선택을 열어 직접 고를 수 있습니다.',
}

const DIFF_TYPE_KO: Record<string, string> = {
  insert: '추가',
  delete: '삭제',
  replace: '수정',
}

const BLOCK_TYPE_KO: Record<string, string> = {
  paragraph: '문단',
  table_row: '표 행',
  table: '표',
  text: '텍스트',
  slide: '슬라이드',
}

const PPT_TYPE_KO: Record<string, string> = {
  inserted_slide: '슬라이드 추가',
  removed_slide: '슬라이드 제거',
  matched_slide_change: '슬라이드 변경',
}

const isCheckableFile = (file: FileInfo) =>
  ['Excel', 'Word', 'PowerPoint'].includes(normalizeFileType(file.file_type))

const blockTypeLabel = (type: string) => BLOCK_TYPE_KO[type] ?? type

const groupKindLabel = (kind: LibraryGroupKind) =>
  kind === 'exact_name_conflict' ? '같은 제목' : '버전명 감지'

const GROUP_FILTER_OPTIONS: { value: GroupFilter; label: string }[] = [
  { value: 'all', label: '전체 보기' },
  { value: 'exact_name_conflict', label: '같은 제목' },
  { value: 'version_family', label: '버전명 감지' },
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

const excelChangeTypeFromIssue = (
  issue: ExcelCheckIssue,
  beforeValue: string,
  afterValue: string,
): ExcelDiffHighlight => {
  if (issue.type === 'value_added') return 'added'
  if (issue.type === 'value_removed') return 'removed'
  if (issue.type === 'value_presence') {
    if (isEmptyExcelValue(beforeValue) && !isEmptyExcelValue(afterValue)) return 'added'
    if (!isEmptyExcelValue(beforeValue) && isEmptyExcelValue(afterValue)) return 'removed'
  }
  return 'changed'
}

const excelHighlightRank = (type: ExcelDiffHighlight) => {
  if (type === 'removed') return 3
  if (type === 'changed') return 2
  return 1
}

const isEmptyExcelValue = (value: string) => {
  const normalized = value.trim()
  return !normalized || normalized === '(빈 값)' || normalized === '-'
}

const excelConflictText = (conflict?: ExcelCheckIssue['conflicts'][number]) =>
  conflict?.values.join(' | ') || ''

const displayExcelGridValue = (value?: string | null) => {
  const text = value ?? ''
  return text === '(빈 값)' ? '' : text
}

function buildExcelGridFocuses(transitions: HistoryTransition[]): ExcelDiffGridFocus[] {
  const focusMap = new Map<string, ExcelDiffGridFocus>()
  const addFocus = (
    key: string,
    column: string,
    changeType: ExcelDiffHighlight,
    history: ExcelDiffGridFocus['histories'][number],
  ) => {
    if (!key || !column) return
    const focusKey = `${key}::${column}`
    const existing = focusMap.get(focusKey)
    if (existing) {
      existing.histories.push(history)
      if (excelHighlightRank(changeType) > excelHighlightRank(existing.change_type)) {
        existing.change_type = changeType
      }
      return
    }

    focusMap.set(focusKey, {
      key,
      column,
      change_type: changeType,
      histories: [history],
    })
  }

  transitions.forEach((transition) => {
    if (transition.status !== 'done' || transition.result?.mode !== 'excel') return

    transition.result.issues.forEach((issue) => {
      if (issue.type === 'missing_column' && issue.columnGroup) {
        issue.conflicts.forEach((conflict) => {
          const changeType = conflict.fileId === transition.toFile.id ? 'added' : 'removed'
          conflict.rowValues.forEach((row) => {
            const key = row[0] ?? ''
            const value = row[row.length - 1] ?? ''
            addFocus(key, issue.columnGroup, changeType, {
              change_type: changeType,
              from_file_id: transition.fromFile.id,
              from_file_name: transition.fromFile.name,
              to_file_id: transition.toFile.id,
              to_file_name: transition.toFile.name,
              before: changeType === 'added' ? '' : value,
              after: changeType === 'added' ? value : '',
              label: `${transition.fromFile.name} → ${transition.toFile.name}`,
            })
          })
        })
        return
      }

      if (issue.type === 'missing_key') {
        issue.conflicts.forEach((conflict) => {
          const changeType = conflict.fileId === transition.toFile.id ? 'added' : 'removed'
          conflict.rowValues.forEach((row) => {
            const key = row[0] ?? issue.key
            conflict.columns.slice(1).forEach((column, columnIndex) => {
              const value = row[columnIndex + 1] ?? ''
              addFocus(key, column, changeType, {
                change_type: changeType,
                from_file_id: transition.fromFile.id,
                from_file_name: transition.fromFile.name,
                to_file_id: transition.toFile.id,
                to_file_name: transition.toFile.name,
                before: changeType === 'added' ? '' : value,
                after: changeType === 'added' ? value : '',
                label: `${transition.fromFile.name} → ${transition.toFile.name}`,
              })
            })
          })
        })
        return
      }

      if (!issue.key || !issue.columnGroup) return

      const beforeConflict = issue.conflicts.find((conflict) => conflict.fileId === transition.fromFile.id)
      const afterConflict = issue.conflicts.find((conflict) => conflict.fileId === transition.toFile.id)
      const before = excelConflictText(beforeConflict)
      const after = excelConflictText(afterConflict)
      const changeType = excelChangeTypeFromIssue(issue, before, after)
      const history = {
        change_type: changeType,
        from_file_id: transition.fromFile.id,
        from_file_name: transition.fromFile.name,
        to_file_id: transition.toFile.id,
        to_file_name: transition.toFile.name,
        before,
        after,
        label: `${transition.fromFile.name} → ${transition.toFile.name}`,
      }
      addFocus(issue.key, issue.columnGroup, changeType, history)
    })
  })

  return Array.from(focusMap.values())
}

const formatDate = (value?: string | number | null) => {
  if (!value) return '날짜 정보 없음'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return '날짜 정보 없음'
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const pathTail = (path: string) => {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-3).join(' / ') || path
}

const versionGroupAnchorId = (groupId: string) =>
  `version-group-${groupId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

const groupSummaryFromDetail = (detail: LibraryGroupDetail): LibraryGroupSummary => {
  const { files: _files, ...summary } = detail
  return summary
}

export default function ConsistencyCheck({
  tutorialStep,
  onTutorialStep,
}: {
  tutorialStep?: TutorialStep | null
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
  const tutorialAppliedGroupFiltersRef = useRef(false)
  const groupRefreshTimerRef = useRef<number | null>(null)

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
    } catch {
      /* silent */
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
    if (tutorialStep !== 'version-ppt') return
    tutorialAppliedGroupFiltersRef.current = true
    setGroupQueryDraft(EXAMPLE_PPT_QUERY)
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, 'version_family', EXAMPLE_PPT_QUERY, 'PowerPoint', 'recent', false)
  }, [tutorialStep])

  useEffect(() => {
    if (tutorialStep !== 'version-excel-search') return
    tutorialAppliedGroupFiltersRef.current = true
    setGroupQueryDraft(EXAMPLE_EXCEL_QUERY)
    setGroupFilter('version_family')
    setGroupFileType('Excel')
    setGroupSort('recent')
    setShowDuplicateGroups(false)
    setActiveGroupDetail(null)
    setHistoryState(null)
  }, [tutorialStep])

  useEffect(() => {
    if (tutorialStep !== 'done' && tutorialStep !== null) return
    if (!tutorialAppliedGroupFiltersRef.current) return
    tutorialAppliedGroupFiltersRef.current = false
    setGroupQueryDraft('')
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(0, 'all', '', 'all', 'recent', false)
  }, [tutorialStep])

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
          comparison_scope: 'version_history',
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
          '이 버전 사이의 변경점을 계산하지 못했습니다.'
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
    setPendingScrollGroupId(detail.id)
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
    const nextFilter = tutorialStep === 'version-excel-search' ? 'version_family' : groupFilter
    const nextFileType = tutorialStep === 'version-excel-search' ? 'Excel' : groupFileType
    const nextSort = tutorialStep === 'version-excel-search' ? 'recent' : groupSort
    const nextShowDuplicates = tutorialStep === 'version-excel-search' ? false : showDuplicateGroups
    void fetchGroups(0, nextFilter, nextQuery, nextFileType, nextSort, nextShowDuplicates).then(() => {
      if (tutorialStep === 'version-excel-search') onTutorialStep?.('version-excel')
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
          description="버전 관리는 등록된 Office 파일 사이의 버전과 변경점을 확인합니다."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card variant="elevated">
        <CardSection
          title="문서 비교"
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
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">문서 구분</p>
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
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">중복 파일</p>
                    <div className="mt-2 space-y-2">
                      <Button
                        size="sm"
                        variant={showDuplicateGroups ? 'tonal' : 'outlined'}
                        leadingIcon={showDuplicateGroups ? 'visibility' : 'visibility_off'}
                        onClick={() => changeDuplicateGroups(!showDuplicateGroups)}
                      >
                        내용 같은 중복도 보기
                      </Button>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        기본값은 이름은 같아도 내용까지 같은 파일을 숨깁니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                <Chip label={`구분 · ${groupFilterLabel}`} tone="neutral" as="span" />
                <Chip label={`형식 · ${groupFileTypeLabel}`} tone="neutral" as="span" />
                <Chip label={`정렬 · ${groupSortLabel}`} tone="neutral" as="span" />
                {showDuplicateGroups && <Chip label="내용 같은 중복 포함" tone="neutral" as="span" />}
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
                {groupFilter !== 'all' && <Chip label={`구분 · ${groupFilterLabel}`} tone="primary" as="span" />}
                {groupFileType !== 'all' && <Chip label={`형식 · ${groupFileTypeLabel}`} tone="neutral" as="span" />}
                {groupSort !== 'recent' && <Chip label={`정렬 · ${groupSortLabel}`} tone="neutral" as="span" />}
                {showDuplicateGroups && <Chip label="내용 같은 중복 포함" tone="neutral" as="span" />}
              </div>
            )}
          </div>

          {groupIndexState.stale && (
            <div className="mx-5 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-secondary-container)]/45 px-4 py-3 type-body-sm text-[var(--md-sys-color-on-secondary-container)]">
              <span className="font-medium">문서 묶음 정보를 백그라운드에서 준비 중입니다.</span>
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
              title="자동 감지된 버전 그룹이 없습니다"
              description="같은 제목이거나 파일명에 버전/날짜가 붙은 Office 문서를 등록하면 이곳에 표시됩니다."
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
          title="수동으로 직접 고르기"
          description="자동 그룹에 없는 특수 케이스만 열어서 사용하세요. 1만 개 문서에서도 현재 페이지와 검색 결과만 보여줍니다."
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
            {selectedMode && <Chip label={`모드 · ${selectedMode.toUpperCase()}`} tone="secondary" as="span" />}
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
                선택 파일 변경점 확인
              </Button>
          </div>

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
                              ? '검색 등록 가능 · 변경점 확인 제외'
                              : fileMode === 'excel'
                                ? '셀 좌표 기준 · 여러 파일 비교'
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

      {result?.mode === 'excel' && <ExcelCheckResult result={result} />}
      {result?.mode === 'word' && <WordCheckResult diffs={result.diffs} />}
      {result?.mode === 'ppt' && <PptCheckResult slides={result.slides} />}
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
      <div className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="type-label-sm uppercase tracking-[0.08em] text-[var(--md-sys-color-on-surface-variant)]">
                비교 대상
              </span>
              <FileTypeBadge fileType={group.file_type} />
              <Badge tone={group.group_kind === 'exact_name_conflict' ? 'warning' : 'neutral'}>
                {groupKindLabel(group.group_kind)}
              </Badge>
            </div>
            <p className="type-title-md text-[var(--md-sys-color-on-surface)] break-words">
              {group.base_name}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Badge tone="neutral">{group.file_count}개 파일</Badge>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {(group.latest_file || group.previous_file) && (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {group.latest_file && (
              <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">현재 기준 파일</p>
                    <p className="mt-1 truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={group.latest_file.name}>
                      {group.latest_file.name}
                    </p>
                  </div>
                  <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(group.latest_file!)}>
                    열기
                  </Button>
                </div>
              </div>
            )}
            {group.previous_file && (
              <div className="rounded-lg border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">직전 비교 대상</p>
                    <p className="mt-1 truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={group.previous_file.name}>
                      {group.previous_file.name}
                    </p>
                  </div>
                  <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(group.previous_file!)}>
                    열기
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={activeDetail ? 'tonal' : 'filled'}
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

function GroupTimeline({
  detail,
  historyState,
  compareSelection,
  onOpenFile,
  onOpenExcelGrid,
  onSelectCompareSlot,
  onSetLatestFile,
  onClearLatestFile,
  settingLatestFileId,
  clearingLatestGroupId,
  highlightExcelGrid = false,
  excelGridTourTarget,
  highlightReview = false,
  reviewTourTarget,
  tutorialStep,
  onTutorialStep,
}: {
  detail: LibraryGroupDetail
  historyState: HistoryDiffState | null
  compareSelection: CompareSelection | null
  onOpenFile: (file: FileInfo) => void
  onOpenExcelGrid: () => void
  onSelectCompareSlot: (file: FileInfo, slot: CompareSlot) => void
  onSetLatestFile: (file: FileInfo) => void
  onClearLatestFile: () => void
  settingLatestFileId: number | null
  clearingLatestGroupId: string | null
  highlightExcelGrid?: boolean
  excelGridTourTarget?: TutorialStep
  highlightReview?: boolean
  reviewTourTarget?: TutorialStep
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const [showAllVersions, setShowAllVersions] = useState(false)
  useEffect(() => {
    setShowAllVersions(false)
  }, [detail.id])

  const selectedFromFile = compareSelection?.fromId
    ? detail.files.find((file) => file.id === compareSelection.fromId) ?? null
    : null
  const selectedToFile = compareSelection?.toId
    ? detail.files.find((file) => file.id === compareSelection.toId) ?? null
    : null
  const visibleFiles = showAllVersions
    ? detail.files
    : detail.files.slice(0, VERSION_LIST_PREVIEW_LIMIT)
  const hiddenFileCount = Math.max(0, detail.files.length - visibleFiles.length)
  const progressLabel = historyState
    ? historyState.total === 0
      ? '비교할 이전 버전 없음'
      : historyState.loading
        ? '선택한 두 파일 계산 중…'
        : '선택한 두 파일 계산 완료'
    : '변경점 계산 준비 중'
  const shouldMarkReviewContainer =
    highlightReview && reviewTourTarget !== 'version-ppt-review' && reviewTourTarget !== 'version-ppt-detail'

  return (
    <div className="border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="type-label-sm uppercase tracking-[0.08em] text-[var(--md-sys-color-on-surface-variant)]">
            변경 증거
          </p>
          <p className="mt-1 type-title-sm text-[var(--md-sys-color-on-surface)]">변경점 상세</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Chip label={`${detail.files.length}/${detail.file_count}개 표시`} tone="neutral" as="span" />
          {detail.manual_latest_file_id && (
            <Button
              variant="outlined"
              size="sm"
              leadingIcon="auto_awesome"
              loading={clearingLatestGroupId === detail.id}
              disabled={Boolean(settingLatestFileId) || Boolean(historyState?.loading)}
              onClick={onClearLatestFile}
            >
              자동 최신으로
            </Button>
          )}
          {normalizeFileType(detail.file_type) === 'Excel' && (
            <Button
              variant="filled"
              leadingIcon="table_chart"
              className={`shadow-elev-1 ${highlightExcelGrid ? 'attention-pulse tour-target' : ''}`}
              data-tour-target={highlightExcelGrid ? excelGridTourTarget : undefined}
              loading={Boolean(historyState?.loading)}
              disabled={Boolean(historyState?.loading)}
              onClick={onOpenExcelGrid}
            >
              표로 보기
            </Button>
          )}
        </div>
      </div>

      <div
        className={`rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4 ${
          shouldMarkReviewContainer ? 'tour-target tour-review-target tour-version-review-target' : ''
        }`}
        data-tour-target={shouldMarkReviewContainer ? reviewTourTarget : undefined}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">변경 내용</p>
            <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              1번 파일에서 2번 파일로 바뀐 내용만 보여줍니다.
            </p>
            {shouldMarkReviewContainer && (
              <span className="tour-evidence-note tour-version-note mt-2">
                <Icon name="auto_awesome" size={14} />
                변경 증거를 찾았습니다
              </span>
            )}
          </div>
          <Badge tone={historyState?.loading ? 'warning' : 'neutral'}>
            {historyState?.loading && <Spinner size={14} />} {progressLabel}
          </Badge>
        </div>
        {historyState?.truncated && (
          <p className="rounded-lg border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            최신 {detail.files.length}개만 표시되어 이 범위 안의 변경점만 계산했습니다.
          </p>
        )}
        <SelectedCompareBar
          fromFile={selectedFromFile}
          toFile={selectedToFile}
          onOpenFile={onOpenFile}
        />
        <HistoryTransitions
          transitions={historyState?.transitions ?? []}
          highlightReview={highlightReview}
          onOpenFile={onOpenFile}
          tutorialStep={tutorialStep}
          onTutorialStep={onTutorialStep}
        />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">파일 버전 순서</p>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          별표로 최신 기준을 바꾸고, 1/2로 비교할 두 파일을 고릅니다.
        </p>
      </div>
      <ol className="overflow-hidden rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]">
        {visibleFiles.map((file, index) => {
          const isLatest = index === 0
          const isManualLatest = detail.manual_latest_file_id === file.id
          const isSelectedFrom = selectedFromFile?.id === file.id
          const isSelectedTo = selectedToFile?.id === file.id
          const canSelectFrom = selectedToFile?.id !== file.id && !historyState?.loading
          const canSelectTo = selectedFromFile?.id !== file.id && !historyState?.loading
          const latestActionDisabled =
            Boolean(settingLatestFileId) ||
            Boolean(clearingLatestGroupId) ||
            Boolean(historyState?.loading)
          return (
            <li
              key={file.id}
              className={`grid grid-cols-1 gap-3 border-t border-[var(--md-sys-color-outline-variant)] p-3 first:border-t-0 lg:grid-cols-[5.75rem_minmax(0,1fr)_auto_auto] lg:items-center ${
                isSelectedFrom || isSelectedTo
                  ? 'bg-[var(--md-sys-color-primary-container)]/18'
                  : isLatest
                    ? 'bg-[var(--md-sys-color-surface-container-low)]'
                    : ''
                }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={isLatest}
                  aria-label={
                    isLatest
                      ? isManualLatest
                        ? '직접 지정한 최신 기준 파일'
                        : '현재 최신 기준 파일'
                      : '최신 기준으로 지정'
                  }
                  title={
                    isLatest
                      ? isManualLatest
                        ? '직접 지정한 최신 기준 파일'
                        : '현재 최신 기준 파일'
                      : '최신 기준으로 지정'
                  }
                  disabled={!isLatest && latestActionDisabled}
                  onClick={() => {
                    if (!isLatest) onSetLatestFile(file)
                  }}
                  className={`state-host relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    isLatest
                      ? 'cursor-default border-amber-300 bg-amber-100 text-amber-800 shadow-[0_1px_0_rgba(255,255,255,0.85)_inset]'
                      : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-on-surface-variant)] hover:border-[var(--md-sys-color-primary)] hover:text-[var(--md-sys-color-primary)] disabled:cursor-not-allowed disabled:opacity-40'
                  }`}
                >
                  <span className="state-layer" />
                  {settingLatestFileId === file.id ? (
                    <Spinner size={16} />
                  ) : (
                    <Icon name="star" size={18} filled={isLatest} />
                  )}
                </button>
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full type-label-md ${
                    isLatest
                      ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]'
                      : 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
                  }`}
                >
                  {index + 1}
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="type-title-sm text-[var(--md-sys-color-on-surface)] truncate" title={file.name}>
                    {file.name}
                  </p>
                  <FileTypeBadge fileType={file.file_type} />
                  {isManualLatest && <Badge tone="success">직접 지정</Badge>}
                  {isSelectedFrom && <Badge tone="warning">비교 1</Badge>}
                  {isSelectedTo && <Badge tone="success">비교 2</Badge>}
                </div>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  수정/등록 · {formatDate(file.file_mtime ?? file.created_at)}
                </p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate" title={file.path}>
                  위치 · {pathTail(file.path)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 lg:justify-end">
                <span className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">비교</span>
                <Button
                  variant={isSelectedFrom ? 'filled' : 'outlined'}
                  size="sm"
                  disabled={Boolean(historyState?.loading) || (!canSelectFrom && !isSelectedFrom)}
                  onClick={() => onSelectCompareSlot(file, 'from')}
                  className="h-8 px-3"
                >
                  1
                </Button>
                <Button
                  variant={isSelectedTo ? 'filled' : 'outlined'}
                  size="sm"
                  disabled={Boolean(historyState?.loading) || (!canSelectTo && !isSelectedTo)}
                  onClick={() => onSelectCompareSlot(file, 'to')}
                  className="h-8 px-3"
                >
                  2
                </Button>
              </div>
              <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
                <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(file)}>
                  열기
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      {detail.files.length > VERSION_LIST_PREVIEW_LIMIT && (
        <div className="flex justify-center">
          <Button
            variant="text"
            size="sm"
            leadingIcon={showAllVersions ? 'expand_less' : 'expand_more'}
            onClick={() => setShowAllVersions((value) => !value)}
          >
            {showAllVersions ? '최근 5개만 보기' : `모두 보기 (${hiddenFileCount}개 더)`}
          </Button>
        </div>
      )}
    </div>
  )
}

function SelectedCompareBar({
  fromFile,
  toFile,
  onOpenFile,
}: {
  fromFile: FileInfo | null
  toFile: FileInfo | null
  onOpenFile: (file: FileInfo) => void
}) {
  return (
    <div className="sticky top-2 z-10 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/95 px-3 py-2 shadow-elev-1 backdrop-blur">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <ComparedFilePill marker="1" label="이전 기준" file={fromFile} tone="warning" onOpenFile={onOpenFile} />
        <Icon
          name="arrow_forward"
          size={18}
          className="hidden text-[var(--md-sys-color-on-surface-variant)] lg:block"
        />
        <ComparedFilePill marker="2" label="변경 후" file={toFile} tone="success" onOpenFile={onOpenFile} />
      </div>
    </div>
  )
}

function ComparedFilePill({
  marker,
  label,
  file,
  tone,
  onOpenFile,
}: {
  marker: string
  label: string
  file: FileInfo | null
  tone: 'warning' | 'success'
  onOpenFile: (file: FileInfo) => void
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--md-sys-color-surface-container-low)] px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Badge tone={tone}>{marker}</Badge>
        <div className="min-w-0">
          <p className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">{label}</p>
          <p className="truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={file?.name ?? ''}>
            {file?.name ?? '선택 필요'}
          </p>
        </div>
      </div>
      {file && (
        <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(file)}>
          열기
        </Button>
      )}
    </div>
  )
}

function HistoryTransitions({
  transitions,
  highlightReview = false,
  onOpenFile,
  tutorialStep,
  onTutorialStep,
}: {
  transitions: HistoryTransition[]
  highlightReview?: boolean
  onOpenFile: (file: FileInfo) => void
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  if (transitions.length === 0) {
    return (
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        비교할 이전 버전이 없습니다. 같은 문서의 다른 버전을 더 등록하면 변경점이 표시됩니다.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {transitions.map((transition, index) => (
        <HistoryTransitionCard
          key={transition.id}
          transition={transition}
          highlightReview={highlightReview && index === 0}
          onOpenFile={onOpenFile}
          tutorialStep={tutorialStep}
          onTutorialStep={onTutorialStep}
        />
      ))}
    </div>
  )
}

function changeCount(result: CheckResponse | null) {
  if (!result) return 0
  if (result.mode === 'excel') return result.issues.length
  if (result.mode === 'word') return result.diffs.length
  return result.slides.length
}

function HistoryTransitionCard({
  transition,
  highlightReview = false,
  onOpenFile,
  tutorialStep,
  onTutorialStep,
}: {
  transition: HistoryTransition
  highlightReview?: boolean
  onOpenFile: (file: FileInfo) => void
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const count = changeCount(transition.result)
  const statusTone =
    transition.status === 'error'
      ? 'danger'
      : transition.status === 'done'
        ? count > 0
          ? 'warning'
          : 'success'
        : 'neutral'
  const statusLabel =
    transition.status === 'loading'
      ? '계산 중'
      : transition.status === 'error'
        ? '실패'
        : transition.status === 'done'
          ? count > 0
            ? `${count}건 변경`
            : '변경 없음'
          : '대기'

  return (
    <div
      className={`rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3 space-y-3 ${
        highlightReview ? 'tour-version-evidence-card' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <div className="min-w-0 rounded-md border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">이전 버전</p>
                  <p className="mt-1 truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={transition.fromFile.name}>
                    {transition.fromFile.name}
                  </p>
                </div>
                <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(transition.fromFile)}>
                  열기
                </Button>
              </div>
            </div>
            <Icon
              name="arrow_forward"
              size={18}
              className="hidden text-[var(--md-sys-color-on-surface-variant)] lg:block"
            />
            <div className="min-w-0 rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">다음 버전</p>
                  <p className="mt-1 truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={transition.toFile.name}>
                    {transition.toFile.name}
                  </p>
                </div>
                <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(transition.toFile)}>
                  열기
                </Button>
              </div>
            </div>
          </div>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            두 버전 사이의 변경 증거만 분리해 표시합니다.
          </p>
        </div>
        <Badge tone={statusTone}>
          {transition.status === 'loading' && <Spinner size={14} />} {statusLabel}
        </Badge>
      </div>

      {transition.status === 'error' && (
        <p className="rounded-lg border border-[var(--md-sys-color-error)]/60 bg-[var(--md-sys-color-error-container)]/50 px-3 py-2 type-body-sm text-[var(--md-sys-color-error)]">
          {transition.error ?? '이 버전 사이의 변경점을 계산하지 못했습니다.'}
        </p>
      )}
      {transition.status === 'done' && transition.result && (
        <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3">
          <HistoryTransitionResult
            result={transition.result}
            highlightReview={highlightReview}
            tutorialStep={tutorialStep}
            onTutorialStep={onTutorialStep}
          />
        </div>
      )}
    </div>
  )
}

function HistoryTransitionResult({
  result,
  highlightReview = false,
  tutorialStep,
  onTutorialStep,
}: {
  result: CheckResponse
  highlightReview?: boolean
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  if (result.mode === 'excel') return <ExcelCheckResult result={result} compact />
  return (
    <div className="space-y-3">
      <div className="xl:hidden">
        <p className="tour-evidence-note attention-pulse max-w-full whitespace-normal">
          <Icon name="open_in_full" size={14} />
          창을 조금 넓히면 이전/변경 후 내용을 나란히 볼 수 있어요.
        </p>
      </div>
      {result.mode === 'word' ? (
        <WordCheckResult diffs={result.diffs} compact />
      ) : (
        <PptCheckResult
          slides={result.slides}
          compact
          highlightReview={highlightReview}
          tutorialStep={tutorialStep}
          onTutorialStep={onTutorialStep}
        />
      )}
    </div>
  )
}

function formatExcelLocation(conflict: ExcelCheckIssue['conflicts'][number]) {
  const rows = conflict.rowNumbers.length > 0 ? `${conflict.rowNumbers.join(', ')}행` : ''
  const columns = conflict.columnLetters.length > 0 ? `${conflict.columnLetters.join(', ')}열` : ''
  const rowColumnText = [rows, columns].filter(Boolean).join(' ')

  if (conflict.cellRefs.length > 0) {
    const cells = conflict.cellRefs.slice(0, 4).join(', ')
    const suffix = conflict.cellRefs.length > 4 ? ` 외 ${conflict.cellRefs.length - 4}개` : ''
    return rowColumnText ? `${rowColumnText} (${cells}${suffix})` : `${cells}${suffix}`
  }
  return rowColumnText || '-'
}

function firstExcelLocation(issue: ExcelCheckIssue) {
  const located = issue.conflicts.find(
    (conflict) => conflict.rowNumbers.length > 0 || conflict.columnLetters.length > 0 || conflict.cellRefs.length > 0,
  )
  return located ? formatExcelLocation(located) : ''
}

function isExcelContentChange(issue: ExcelCheckIssue) {
  return issue.type !== 'value_conflict'
}

function excelIssueTitle(issue: ExcelCheckIssue) {
  if (issue.type === 'value_conflict') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 값 변경` : '셀 값 변경'
  }
  if (issue.type === 'value_added') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 내용 추가` : '셀 내용 추가'
  }
  if (issue.type === 'value_removed') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 내용 삭제` : '셀 내용 삭제'
  }
  if (issue.type === 'value_presence') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 내용 있음/없음` : '셀 내용 있음/없음'
  }
  return issue.message
}

function conflictStatus(conflict: ExcelCheckIssue['conflicts'][number]) {
  return conflict.values.join(' | ') || (conflict.rowValues.length > 0 ? '내용 있음' : '-')
}

type UiTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'tertiary'

type ExcelDigestRow = {
  id: string
  issue: ExcelCheckIssue
  label: string
  tone: UiTone
  icon: string
  location: string
  beforeText: string
  latestText: string
}

const EXCEL_ISSUE_META: Record<
  ExcelCheckIssue['type'],
  { label: string; tone: UiTone; icon: string }
> = {
  value_conflict: { label: '값 변경', tone: 'warning', icon: 'change_circle' },
  value_added: { label: '추가', tone: 'success', icon: 'add_circle' },
  value_removed: { label: '삭제', tone: 'danger', icon: 'do_not_disturb_on' },
  value_presence: { label: '있음/없음', tone: 'warning', icon: 'rule' },
  missing_key: { label: '행 추가/삭제', tone: 'warning', icon: 'difference' },
  missing_column: { label: '열 추가/삭제', tone: 'warning', icon: 'view_column' },
}

function emptyExcelValueLabel(value: string) {
  return isEmptyExcelValue(value) ? '(빈 값)' : value
}

function excelConflictDisplayText(conflict?: ExcelCheckIssue['conflicts'][number]) {
  if (!conflict) return '-'
  const text = conflictStatus(conflict)
  return emptyExcelValueLabel(text)
}

function buildExcelDigestRows(issues: ExcelCheckIssue[]): ExcelDigestRow[] {
  return issues.map((issue) => {
    const meta = EXCEL_ISSUE_META[issue.type]
    const firstConflict = issue.conflicts[0]
    const lastConflict = issue.conflicts[issue.conflicts.length - 1]
    const location = firstExcelLocation(issue) || '-'
    const beforeText = excelConflictDisplayText(firstConflict)
    const latestText =
      lastConflict && lastConflict !== firstConflict ? excelConflictDisplayText(lastConflict) : ''

    return {
      id: issue.id,
      issue,
      label: meta.label,
      tone: meta.tone,
      icon: meta.icon,
      location,
      beforeText,
      latestText: latestText || (issue.type === 'value_removed' ? '(빈 값)' : issue.message),
    }
  })
}

function ExcelCheckResult({
  result,
  compact = false,
}: {
  result: Extract<CheckResponse, { mode: 'excel' }>
  compact?: boolean
}) {
  const valueConflicts = result.issues.filter((issue) => issue.type === 'value_conflict')
  const contentChanges = result.issues.filter(isExcelContentChange)

  if (compact && result.issues.length === 0) {
    return (
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        Excel 변경점이 없습니다.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="전체 항목" value={result.totalKeys} icon="tag" />
          <StatCard
            label="값 변경"
            value={valueConflicts.length}
            icon="report_problem"
            tone={valueConflicts.length > 0 ? 'danger' : 'neutral'}
          />
          <StatCard
            label="추가/삭제"
            value={contentChanges.length}
            icon="difference"
            tone={contentChanges.length > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      {result.issues.length === 0 ? (
        <Card variant="outlined" className="px-6 py-8 text-center">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">Excel 변경점이 없습니다.</p>
          <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            비교한 파일 사이에서 표시할 값 변경이나 추가/삭제를 찾지 못했습니다.
          </p>
        </Card>
      ) : (
        <ExcelChangeDigest result={result} compact={compact} />
      )}
    </div>
  )
}

function ExcelChangeDigest({
  result,
  compact,
}: {
  result: Extract<CheckResponse, { mode: 'excel' }>
  compact: boolean
}) {
  const rows = useMemo(() => buildExcelDigestRows(result.issues), [result.issues])
  const changedCount = rows.filter((row) => row.issue.type === 'value_conflict').length
  const addedCount = rows.filter((row) => row.issue.type === 'value_added').length
  const removedCount = rows.filter((row) => row.issue.type === 'value_removed').length
  const otherCount = rows.length - changedCount - addedCount - removedCount
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null

  return (
    <Card variant="outlined" className="overflow-hidden">
      <header className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon name="troubleshoot" size={20} className="text-[var(--md-sys-color-primary)]" />
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">변경점 빠른 보기</p>
            </div>
            <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              변경·추가·삭제된 셀만 한 표에 모아 보여줍니다. 행을 누르면 아래에서 파일별 값을 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Badge tone={changedCount > 0 ? 'warning' : 'neutral'}>{changedCount}건 변경</Badge>
            <Badge tone={addedCount > 0 ? 'success' : 'neutral'}>{addedCount}건 추가</Badge>
            <Badge tone={removedCount > 0 ? 'danger' : 'neutral'}>{removedCount}건 삭제</Badge>
            {otherCount > 0 && <Badge tone="neutral">{otherCount}건 기타</Badge>}
          </div>
        </div>
      </header>

      <div className={`grid grid-cols-1 ${compact ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : 'xl:grid-cols-[minmax(0,1fr)_22rem]'}`}>
        <ExcelDigestTable
          rows={rows}
          selectedId={selectedRow?.id ?? null}
          onSelect={setSelectedId}
        />
        <ExcelDigestDetailPanel row={selectedRow} />
      </div>
    </Card>
  )
}

function ExcelDigestTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ExcelDigestRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="type-label-md text-[var(--md-sys-color-on-surface)]">셀 변경</p>
          <p className="mt-0.5 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            빈 값에서 채워진 셀은 추가, 값이 사라진 셀은 삭제로 표시합니다.
          </p>
        </div>
        <Chip label={`${rows.length}건`} tone={rows.length > 0 ? 'primary' : 'neutral'} as="span" />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 type-body-sm text-[var(--md-sys-color-on-surface-variant)] sm:px-5">
          변경된 셀이 없습니다.
        </p>
      ) : (
        <div className="max-h-[24rem] overflow-auto overscroll-contain border-t border-[var(--md-sys-color-outline-variant)]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--md-sys-color-surface-container-high)] shadow-[0_1px_0_var(--md-sys-color-outline-variant)]">
              <tr>
                {['위치', '이전 값', '최신 값', '상태'].map((header) => (
                  <th
                    key={header}
                    className="px-3 py-2 text-left type-label-sm text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(row.id)
                    }
                  }}
                  className={`cursor-pointer transition-colors hover:bg-[var(--md-sys-color-surface-container-low)] ${
                    selectedId === row.id
                      ? 'bg-[var(--md-sys-color-primary-container)]/28 ring-1 ring-inset ring-[var(--md-sys-color-primary)]/40'
                      : 'bg-[var(--md-sys-color-surface-container-lowest)]'
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-[var(--md-sys-color-on-surface)] whitespace-nowrap">
                    {row.location}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-red-950">
                    <div className="max-w-[16rem] truncate rounded-md bg-red-50 px-2 py-1" title={row.beforeText}>
                      {row.beforeText}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-emerald-950">
                    <div className="max-w-[16rem] truncate rounded-md bg-emerald-50 px-2 py-1" title={row.latestText}>
                      {row.latestText}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge tone={row.tone}>
                      <Icon name={row.icon} size={14} /> {row.label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ExcelDigestDetailPanel({ row }: { row: ExcelDigestRow | null }) {
  if (!row) {
    return (
      <aside className="border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4 xl:border-l xl:border-t-0">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">변경 상세</p>
        <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          변경 행을 선택하면 파일별 값과 위치를 확인할 수 있습니다.
        </p>
      </aside>
    )
  }

  return (
    <aside className="min-w-0 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4 xl:border-l xl:border-t-0">
      <div className="sticky top-0 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={row.tone}>
            <Icon name={row.icon} size={14} /> {row.label}
          </Badge>
          <span className="font-mono type-label-md text-[var(--md-sys-color-on-surface-variant)]">{row.location}</span>
        </div>
        <div>
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{excelIssueTitle(row.issue)}</p>
          <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{row.issue.message}</p>
        </div>

        <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 space-y-2">
          <p className="type-label-md text-[var(--md-sys-color-on-surface)]">파일별 값</p>
          {row.issue.conflicts.length === 0 ? (
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              파일별 상세 값이 없습니다.
            </p>
          ) : (
            <div className="max-h-56 space-y-2 overflow-auto overscroll-contain pr-1">
              {row.issue.conflicts.map((conflict) => (
                <div
                  key={`${row.id}-detail-${conflict.fileId}`}
                  className="rounded-md bg-[var(--md-sys-color-surface-container-low)] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate type-label-sm text-[var(--md-sys-color-on-surface)]" title={conflict.fileName}>
                      {conflict.fileName}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-[var(--md-sys-color-on-surface-variant)]">
                      {formatExcelLocation(conflict)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-[var(--md-sys-color-on-surface)]">
                    {excelConflictDisplayText(conflict)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function excelGridHighlightClass(highlight: ExcelDiffHighlight | null) {
  if (highlight === 'added') {
    return 'excel-diff-cell-added'
  }
  if (highlight === 'removed') {
    return 'excel-diff-cell-removed'
  }
  if (highlight === 'changed') {
    return 'excel-diff-cell-changed'
  }
  return 'excel-diff-cell-normal'
}

function excelGridHighlightLabel(highlight: ExcelDiffHighlight | null) {
  if (highlight === 'added') return '추가'
  if (highlight === 'removed') return '삭제'
  if (highlight === 'changed') return '변경'
  return '최신 변경 없음'
}

function excelGridCellTitle(cell: ExcelDiffGridCell) {
  const location = `${cell.row_number}행 ${cell.column_letter}열`
  if (cell.histories.length === 0) return `${location} · ${displayExcelGridValue(cell.value)}`
  const first = cell.histories[0]
  return `${location} · ${excelGridHighlightLabel(cell.highlight)} · ${displayExcelGridValue(first.before)} → ${displayExcelGridValue(first.after)}`
}

function ExcelDiffGridModal({
  modal,
  onClose,
  highlightReview = false,
  tutorialStep,
  onTutorialStep,
}: {
  modal: ExcelGridModalState
  onClose: () => void
  highlightReview?: boolean
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const [selectedCell, setSelectedCell] = useState<ExcelDiffGridCell | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden overscroll-contain bg-black/45 backdrop-blur-sm p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Excel 표로 보기"
      onClick={onClose}
      onWheel={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) event.preventDefault()
      }}
      onTouchMove={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      <div
        className="flex h-[96dvh] min-h-[620px] w-[96vw] max-w-[1500px] flex-col overflow-hidden overscroll-contain rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/96">
          <div className="flex min-h-16 items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
                <Icon name="table_chart" size={22} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="type-title-md text-[var(--md-sys-color-on-surface)]">Excel 표로 보기</p>
                  <Badge tone="neutral">최신↔이전 기준</Badge>
                </div>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate mt-1">
                  {modal.detail.base_name}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
              aria-label="닫기"
            >
              <Icon name="close" size={22} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-3">
          {modal.loading ? (
            <div className="flex items-center justify-center gap-2 py-16 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
              <Spinner size={20} /> Excel 표 범위를 계산하는 중…
            </div>
          ) : modal.error ? (
            <div className="rounded-lg border border-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)] p-4 text-[var(--md-sys-color-on-error-container)]">
              {modal.error}
            </div>
          ) : modal.data ? (
            <>
              <ExcelDiffGridSummary data={modal.data} />
              {modal.data.sections.map((section, index) => (
                <ExcelDiffGridSectionView
                  key={section.id}
                  section={section}
                  selectedCell={selectedCell}
                  onSelectCell={setSelectedCell}
                  highlightReview={highlightReview && index === 0}
                  tutorialStep={tutorialStep}
                  onTutorialStep={onTutorialStep}
                />
              ))}
              <ExcelDiffGridCellDetail cell={selectedCell} tutorialStep={tutorialStep} />
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ExcelDiffGridSummary({ data }: { data: ExcelDiffGridResponse }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Chip label={`최신 파일 값 기준 · ${data.latest_file.file_name}`} tone="primary" icon="description" as="span" />
        <Chip label={`${data.sheet_name} 시트`} tone="neutral" as="span" />
        <Chip label={`${data.row_count}행 × ${data.column_count}열`} tone="neutral" as="span" />
        {data.key_column && <Chip label={`행 기준 · ${data.key_column}`} tone="secondary" as="span" />}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge tone="success">초록 · 최신본에 추가</Badge>
        <Badge tone="danger">빨강 · 최신본에서 삭제</Badge>
        <Badge tone="warning">노랑 · 최신본에서 변경</Badge>
      </div>

      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        색상은 최신본과 바로 이전 버전의 차이만 표시합니다. 색이 없는 셀도 누르면 이전 버전들 사이의 변경 이력을 확인할 수 있습니다.
      </p>

      {data.partial && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 type-body-sm text-amber-950">
          표가 커서 전체를 한 번에 표시하지 않고 변경 셀 주변 구간만 보여줍니다.
          {data.omitted_focus_count > 0 && ` 전체 변경 범위에서 위치를 찾지 못한 변경 ${data.omitted_focus_count}건은 표에 표시하지 못했습니다.`}
        </p>
      )}
    </div>
  )
}

function ExcelDiffGridSectionView({
  section,
  selectedCell,
  onSelectCell,
  highlightReview = false,
  tutorialStep,
  onTutorialStep,
}: {
  section: ExcelDiffGridResponse['sections'][number]
  selectedCell: ExcelDiffGridCell | null
  onSelectCell: (cell: ExcelDiffGridCell) => void
  highlightReview?: boolean
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.shiftKey) return
      element.scrollLeft += event.deltaY
      event.preventDefault()
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <section
      className="border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{section.title}</p>
          {highlightReview && tutorialStep === 'excel-table-cell' && (
            <span className="tour-evidence-note">
              <Icon name="auto_awesome" size={14} />
              D7 셀을 눌러 변경 이력을 열어보세요
            </span>
          )}
        </div>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          {section.description} 표시 범위: {section.row_start}-{section.row_end}행, {section.col_start}-{section.col_end}열
        </p>
      </div>
      <div
        ref={scrollRef}
        className="max-h-[52vh] overflow-auto overscroll-contain"
      >
        <table className="min-w-max table-fixed border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="min-w-[4rem] border-b border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-2 py-2 text-left type-label-sm">
                행
              </th>
              {section.columns.map((column) => (
                <th
                  key={column.index}
                  className="w-[8rem] min-w-[8rem] max-w-[8rem] border-b border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-2 py-2 text-left type-label-sm"
                >
                  <span className="font-mono">{column.letter}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.row_index}>
                <th className="border-b border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-2 py-1 text-left font-mono">
                  {row.row_number}
                </th>
                {row.cells.map((cell) => {
                  const selected =
                    selectedCell?.row_index === cell.row_index &&
                    selectedCell?.column_index === cell.column_index
                  const isTutorialCell =
                    highlightReview &&
                    tutorialStep === 'excel-table-cell' &&
                    row.row_number === 7 &&
                    cell.column_letter === 'D'
                  return (
                    <td
                      key={`${cell.row_index}-${cell.column_index}`}
                      title={excelGridCellTitle(cell)}
                      className={`w-[8rem] min-w-[8rem] max-w-[8rem] border-b border-r border-[var(--md-sys-color-outline-variant)] px-2 py-1 align-top font-mono whitespace-nowrap cursor-pointer hover:ring-1 hover:ring-inset hover:ring-[var(--md-sys-color-primary)] ${excelGridHighlightClass(cell.highlight)} ${
                        selected ? 'outline outline-2 outline-[var(--md-sys-color-primary)] outline-offset-[-2px]' : ''
                      } ${isTutorialCell ? 'attention-pulse tour-target' : ''}`}
                      data-tour-target={isTutorialCell ? 'excel-table-cell' : undefined}
                      onClick={() => {
                        onSelectCell(cell)
                        if (isTutorialCell) onTutorialStep?.('excel-table-history')
                      }}
                    >
                      <div className="truncate">{displayExcelGridValue(cell.value)}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ExcelDiffGridCellDetail({
  cell,
  tutorialStep,
}: {
  cell: ExcelDiffGridCell | null
  tutorialStep?: TutorialStep | null
}) {
  if (!cell) {
    return (
      <aside className="border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">변경 셀 상세</p>
        <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          표의 셀을 누르면 최신본 값과 버전 사이 변경 이력을 여기서 확인할 수 있습니다.
        </p>
      </aside>
    )
  }

  const badgeTone =
    cell.highlight === 'removed'
      ? 'danger'
      : cell.highlight === 'added'
        ? 'success'
        : cell.highlight === 'changed'
          ? 'warning'
      : 'neutral'
  const isTutorialHistoryTarget = tutorialStep === 'excel-table-history'

  return (
    <aside
      className={`border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-3 ${
        isTutorialHistoryTarget ? 'tour-target tour-review-target rounded-xl' : ''
      }`}
      data-tour-target={isTutorialHistoryTarget ? 'excel-table-history' : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={badgeTone}>{excelGridHighlightLabel(cell.highlight)}</Badge>
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
          {cell.row_number}행 {cell.column_letter}열
        </p>
        {isTutorialHistoryTarget && (
          <span className="tour-evidence-note">
            <Icon name="auto_awesome" size={14} />
            셀 변경 이력이 아래에 정리됩니다
          </span>
        )}
      </div>
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        현재 최신본 값: <span className="font-mono text-[var(--md-sys-color-on-surface)]">{displayExcelGridValue(cell.value)}</span>
      </p>
      {cell.histories.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--md-sys-color-outline-variant)] px-3 py-2 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          이 셀의 변경 이력은 없습니다.
        </p>
      )}
      <div className="space-y-2">
        {cell.histories.map((history, index) => (
          <div
            key={`${history.label}-${index}`}
            className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3"
          >
            <p className="type-label-md text-[var(--md-sys-color-on-surface)]">
              {history.label || `${history.from_file_name ?? '이전 파일'} → ${history.to_file_name ?? '다음 파일'}`}
            </p>
            <div className="mt-2 space-y-1.5">
              <div className="grid grid-cols-[4.5rem,minmax(0,1fr)] items-start gap-2">
                <span className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">수정 전</span>
                <span className="min-w-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 font-mono type-body-sm text-red-950 whitespace-pre-wrap break-words">
                  {displayExcelGridValue(history.before)}
                </span>
              </div>
              <div className="grid grid-cols-[4.5rem,minmax(0,1fr)] items-start gap-2">
                <span className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">수정 후</span>
                <span className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono type-body-sm text-emerald-950 whitespace-pre-wrap break-words">
                  {displayExcelGridValue(history.after)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function WordCheckResult({
  diffs,
  compact = false,
}: {
  diffs: WordDiffCard[]
  compact?: boolean
}) {
  const insertCount = diffs.filter((diff) => diff.type === 'insert').length
  const deleteCount = diffs.filter((diff) => diff.type === 'delete').length
  const replaceCount = diffs.filter((diff) => diff.type === 'replace').length

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="전체 변경" value={diffs.length} icon="edit_note" />
          <StatCard label="추가" value={insertCount} icon="add_circle" tone="success" />
          <StatCard label="삭제" value={deleteCount} icon="do_not_disturb_on" tone="danger" />
          <StatCard label="수정" value={replaceCount} icon="change_circle" tone="warning" />
        </div>
      )}

      <Card variant="outlined" className="overflow-hidden">
        <header className="px-6 py-3 bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)]">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">Word 변경 내용</p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
            쪽 번호는 문서에 저장된 페이지 나눔 정보를 기준으로 표시합니다.
          </p>
        </header>
        {diffs.length === 0 ? (
          <p className="px-6 py-8 type-body-sm text-[var(--md-sys-color-on-surface-variant)] text-center">
            문서 변경점이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {diffs.map((diff) => (
              <li key={diff.id} className="px-6 py-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    tone={
                      diff.type === 'insert'
                        ? 'success'
                        : diff.type === 'delete'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {DIFF_TYPE_KO[diff.type]}
                  </Badge>
                  <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                    {diff.pageLabel}
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="기존 내용" content={diff.beforeText} tone="danger" />
                  <DiffPanel title="변경 후 내용" content={diff.afterText} tone="success" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

interface PptSlideGroup {
  id: string
  slideNumber: number
  matchedSlideNumber?: number
  title: string
  changes: PptSlideCard[]
}

function groupPptSlides(slides: PptSlideCard[]): PptSlideGroup[] {
  const groups = new Map<string, PptSlideGroup>()

  slides.forEach((slide) => {
    const key = `${slide.slideNumber}->${slide.matchedSlideNumber ?? slide.slideNumber}`
    const existing = groups.get(key)
    if (existing) {
      existing.changes.push(slide)
      return
    }

    groups.set(key, {
      id: key,
      slideNumber: slide.slideNumber,
      matchedSlideNumber: slide.matchedSlideNumber,
      title: slide.title,
      changes: [slide],
    })
  })

  return Array.from(groups.values())
}

function PptCheckResult({
  slides,
  compact = false,
  highlightReview = false,
  tutorialStep,
  onTutorialStep,
}: {
  slides: PptSlideCard[]
  compact?: boolean
  highlightReview?: boolean
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const inserted = slides.filter((slide) => slide.type === 'inserted_slide').length
  const removed = slides.filter((slide) => slide.type === 'removed_slide').length
  const changed = slides.filter((slide) => slide.type === 'matched_slide_change').length
  const slideGroups = useMemo(() => groupPptSlides(slides), [slides])
  const [expandedSlideIds, setExpandedSlideIds] = useState<Set<string>>(() =>
    compact ? new Set() : new Set(slideGroups.map((group) => group.id)),
  )

  useEffect(() => {
    setExpandedSlideIds(compact ? new Set() : new Set(slideGroups.map((group) => group.id)))
  }, [compact, slideGroups])

  const toggleSlideGroup = (groupId: string) => {
    setExpandedSlideIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="전체 변경" value={slides.length} icon="slideshow" />
          <StatCard label="슬라이드 추가" value={inserted} icon="add_to_photos" tone="success" />
          <StatCard label="슬라이드 제거" value={removed} icon="delete_sweep" tone="danger" />
          <StatCard
            label="내용 변경"
            value={changed}
            icon="compare_arrows"
            tone="warning"
          />
        </div>
      )}

      <Card variant="outlined" className="overflow-hidden">
        <header className="px-6 py-3 bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">PPT 변경 내용</p>
              <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                슬라이드별로 접어두었습니다. 필요한 슬라이드만 자세히 열어보세요.
              </p>
            </div>
            <Badge tone="neutral">{slideGroups.length}개 슬라이드</Badge>
          </div>
        </header>
        {slides.length === 0 ? (
          <p className="px-6 py-8 type-body-sm text-[var(--md-sys-color-on-surface-variant)] text-center">
            슬라이드 변경점이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {slideGroups.map((group, groupIndex) => {
              const expanded = expandedSlideIds.has(group.id)
              const representative = group.changes[0]
              const isTutorialReviewTarget =
                highlightReview && tutorialStep === 'version-ppt-review' && !expanded && groupIndex === 0
              const isTutorialDetailTarget =
                highlightReview && tutorialStep === 'version-ppt-detail' && expanded && groupIndex === 0
              const tone =
                representative.type === 'inserted_slide'
                  ? 'success'
                  : representative.type === 'removed_slide'
                    ? 'danger'
                    : 'warning'
              return (
                <li key={group.id} className="px-4 py-3 sm:px-6">
                  <button
                    type="button"
                    className={`flex w-full items-start justify-between gap-3 text-left ${
                      isTutorialReviewTarget ? 'attention-pulse tour-target rounded-lg ring-1 ring-[var(--md-sys-color-primary)]/40' : ''
                    }`}
                    data-tour-target={isTutorialReviewTarget ? 'version-ppt-review' : undefined}
                    onClick={() => {
                      toggleSlideGroup(group.id)
                      if (isTutorialReviewTarget) onTutorialStep?.('version-ppt-detail')
                    }}
                    aria-expanded={expanded}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={tone}>{PPT_TYPE_KO[representative.type]}</Badge>
                        <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                          슬라이드 {group.slideNumber}
                          {group.matchedSlideNumber && group.matchedSlideNumber !== group.slideNumber
                            ? ` → ${group.matchedSlideNumber}`
                            : ''}
                        </span>
                        <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate">
                          {group.title}
                        </span>
                      </div>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        {group.changes.length}개 항목 변경 · {expanded ? '자세히 보는 중' : '접힌 상태'}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 type-label-md text-[var(--md-sys-color-primary)]">
                      {expanded ? '접기' : '자세히 보기'}
                      <Icon name={expanded ? 'expand_less' : 'expand_more'} size={18} />
                    </span>
                  </button>

                  {expanded && (
                    <div
                      className={`mt-3 space-y-3 ${
                        isTutorialDetailTarget ? 'tour-target tour-review-target rounded-xl p-2' : ''
                      }`}
                      data-tour-target={isTutorialDetailTarget ? 'version-ppt-detail' : undefined}
                    >
                      {isTutorialDetailTarget && (
                        <span className="tour-evidence-note">
                          <Icon name="auto_awesome" size={14} />
                          슬라이드 안에서 바뀐 문구만 모아 보여줍니다
                        </span>
                      )}
                      {group.changes.map((slide, index) => (
                        <div
                          key={slide.id}
                          className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3 space-y-3"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            {group.changes.length > 1 && <Badge tone="neutral">항목 {index + 1}</Badge>}
                            <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)]">
                              {slide.description}
                            </p>
                            <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                              {blockTypeLabel(slide.itemType || 'slide')}
                            </p>
                          </div>
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            <DiffPanel
                              title="이전 내용"
                              content={slide.beforeText}
                              tone="danger"
                              previewMaxChars={compact ? 260 : 420}
                            />
                            <DiffPanel
                              title="변경 후 내용"
                              content={slide.afterText}
                              tone="success"
                              previewMaxChars={compact ? 260 : 420}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function DiffPanel({
  title,
  content,
  tone,
  previewMaxChars = 0,
}: {
  title: string
  content: string
  tone: 'danger' | 'success'
  previewMaxChars?: number
}) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [content])

  const normalizedContent = content || '(내용 없음)'
  const shouldPreview = previewMaxChars > 0 && normalizedContent.length > previewMaxChars
  const visibleContent = shouldPreview && !expanded
    ? `${normalizedContent.slice(0, previewMaxChars).trimEnd()}…`
    : normalizedContent

  return (
    <div className={`diff-panel diff-panel-${tone}`}>
      <p className="diff-panel-label type-label-md">
        {title}
      </p>
      <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-2 whitespace-pre-wrap break-words">
        {visibleContent}
      </p>
      {shouldPreview && (
        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
          {!expanded && (
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              내용이 길어 일부만 표시합니다. 파일에서 직접 확인해 주세요.
            </p>
          )}
          <Button variant="text" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '접기' : '전체 보기'}
          </Button>
        </div>
      )}
    </div>
  )
}
