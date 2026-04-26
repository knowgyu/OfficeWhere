import { useEffect, useMemo, useRef, useState } from 'react'

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

const CHECK_FILE_PAGE_SIZE = 60
const GROUP_PAGE_SIZE = 50
const GROUP_DETAIL_FILE_LIMIT = 200
type GroupFilter = 'all' | LibraryGroupKind
type ContentStatus = LibraryGroupSummary['content_status']
type HistoryTransitionStatus = 'pending' | 'loading' | 'done' | 'error'
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
  excel: 'Excel은 여러 파일을 동시에 비교합니다. 기준 컬럼이 같은 행의 값 차이와 행/열 추가·삭제를 찾습니다.',
  word: 'Word는 2개 파일만 비교합니다. 추가·삭제·수정된 문단과 표 행을 카드 형태로 보여줍니다.',
  ppt: 'PPT는 2개 파일만 비교합니다. 슬라이드 추가/삭제와 슬라이드 내 항목 변경을 보여줍니다.',
  none: '자동 감지된 묶음에서 바로 비교하거나, 필요할 때만 수동 선택을 열어 직접 고를 수 있습니다.',
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

const CONTENT_STATUS_META: Record<
  ContentStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  pending: { label: '내용 확인 전', tone: 'neutral' },
  partial: { label: '일부만 확인', tone: 'warning' },
  not_enough_content: { label: '본문 부족', tone: 'neutral' },
  same_content: { label: '내용 같아 보임', tone: 'success' },
  content_differs: { label: '내용 다름 가능', tone: 'danger' },
}

const isCheckableFile = (file: FileInfo) =>
  ['Excel', 'Word', 'PowerPoint'].includes(normalizeFileType(file.file_type))

const blockTypeLabel = (type: string) => BLOCK_TYPE_KO[type] ?? type

const groupKindLabel = (kind: LibraryGroupKind) =>
  kind === 'exact_name_conflict' ? '같은 이름 문서' : '버전/날짜 문서'

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

const versionTokensFromName = (name: string) => {
  const tokens = new Set<string>()
  const withoutExtension = name.replace(/\.[^.]+$/, '')
  for (const match of withoutExtension.matchAll(/(?:^|[^A-Za-z0-9가-힣])(?:v|ver|version|rev)\s*\.?\s*(\d+(?:\.\d+)*)(?=$|[^A-Za-z0-9가-힣])/gi)) {
    tokens.add(`v${match[1]}`)
  }
  for (const match of withoutExtension.matchAll(/(?:^|[^0-9])(\d{6}|\d{8})(?=$|[^0-9])/g)) {
    tokens.add(match[1])
  }
  for (const match of withoutExtension.matchAll(/(?:^|[^A-Za-z0-9가-힣])(초안|draft|final|최종|수정본)(?=$|[^A-Za-z0-9가-힣])/gi)) {
    tokens.add(match[1])
  }
  return Array.from(tokens)
}

const fileVersionMarkers = (file: FileInfo) => {
  const tokens = versionTokensFromName(file.name)
  if (tokens.length > 0) return tokens
  const date = file.file_mtime ?? file.created_at
  return date ? [formatDate(date).slice(0, 12).trim()] : []
}

const versionGroupAnchorId = (groupId: string) =>
  `version-group-${groupId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

export default function ConsistencyCheck() {
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
  const [groupCounts, setGroupCounts] = useState<Partial<Record<LibraryGroupKind, number>>>({})
  const [groupOffset, setGroupOffset] = useState(0)
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupLoadingId, setGroupLoadingId] = useState<string | null>(null)
  const [activeGroupDetail, setActiveGroupDetail] = useState<LibraryGroupDetail | null>(null)
  const [groupDetailFiles, setGroupDetailFiles] = useState<FileInfo[]>([])
  const [historyState, setHistoryState] = useState<HistoryDiffState | null>(null)
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingScrollGroupId, setPendingScrollGroupId] = useState<string | null>(null)
  const [excelGridModal, setExcelGridModal] = useState<ExcelGridModalState | null>(null)

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

  const fetchGroups = async (nextOffset = groupOffset, nextFilter = groupFilter) => {
    setGroupsLoading(true)
    try {
      const response = await api.library.groups({
        limit: GROUP_PAGE_SIZE,
        offset: nextOffset,
        kind: nextFilter === 'all' ? undefined : nextFilter,
      })
      setGroups(response.data.groups)
      setGroupTotal(response.data.total)
      setGroupOffset(response.data.offset)
      setGroupFilter(nextFilter)
      setGroupCounts((current) =>
        nextFilter === 'all'
          ? response.data.counts_by_kind
          : { ...current, ...response.data.counts_by_kind },
      )
    } catch {
      /* silent */
    } finally {
      setGroupsLoading(false)
    }
  }

  useEffect(() => {
    void fetchFiles(0, '')
    void fetchGroups(0, 'all')
  }, [])

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

  const buildHistoryTransitions = (detail: LibraryGroupDetail): HistoryTransition[] =>
    detail.files.slice(0, GROUP_DETAIL_FILE_LIMIT).flatMap((toFile, index, filesForHistory) => {
      const fromFile = filesForHistory[index + 1]
      if (!fromFile) return []
      return [
        {
          id: `${fromFile.id}->${toFile.id}`,
          fromFile,
          toFile,
          status: 'pending' as const,
          result: null,
        },
      ]
    })

  const runHistoryDiffs = async (detail: LibraryGroupDetail) => {
    const transitions = buildHistoryTransitions(detail)
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

    for (let index = 0; index < transitions.length; index += 1) {
      const transition = transitions[index]
      setHistoryState((current) =>
        current?.groupId === detail.id
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
        const normalized = normalizeCheckResponse(response.data)
        setHistoryState((current) =>
          current?.groupId === detail.id
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
        const detailMessage =
          (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          '이 버전 사이의 변경점을 계산하지 못했습니다.'
        setHistoryState((current) =>
          current?.groupId === detail.id
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

    setHistoryState((current) =>
      current?.groupId === detail.id ? { ...current, loading: false } : current,
    )
  }

  const selectGroup = async (group: LibraryGroupSummary) => {
    if (activeGroupDetail?.id === group.id) {
      setActiveGroupDetail(null)
      setHistoryState(null)
      setGroupDetailFiles([])
      return
    }

    const detail = await loadGroupDetail(group)
    if (!detail) return
    setPendingScrollGroupId(detail.id)
    if (historyState?.groupId === detail.id && historyState.transitions.length > 0) return
    await runHistoryDiffs(detail)
  }

  const openExcelGrid = async (detail: LibraryGroupDetail, currentHistoryState: HistoryDiffState | null) => {
    if (normalizeFileType(detail.file_type) !== 'Excel') {
      snackbar.warn('표로 보기는 Excel 묶음에서만 사용할 수 있습니다.')
      return
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
    }
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
    void fetchGroups(0, nextFilter)
  }

  const goToGroupPage = (nextOffset: number) => {
    const boundedOffset = Math.max(0, nextOffset)
    setActiveGroupDetail(null)
    setHistoryState(null)
    void fetchGroups(boundedOffset, groupFilter)
  }

  const visibleFileStart = fileTotal === 0 ? 0 : fileOffset + 1
  const visibleFileEnd = Math.min(fileOffset + files.length, fileTotal)
  const hasPreviousFilePage = fileOffset > 0
  const hasNextFilePage = fileOffset + files.length < fileTotal
  const visibleGroupStart = groupTotal === 0 ? 0 : groupOffset + 1
  const visibleGroupEnd = Math.min(groupOffset + groups.length, groupTotal)
  const hasPreviousGroupPage = groupOffset > 0
  const hasNextGroupPage = groupOffset + groups.length < groupTotal
  const exactCount =
    groupCounts.exact_name_conflict ??
    groups.filter((group) => group.group_kind === 'exact_name_conflict').length
  const versionCount =
    groupCounts.version_family ??
    groups.filter((group) => group.group_kind === 'version_family').length
  const contentDiffCandidateCount = groups.filter(
    (group) => group.content_status === 'content_differs',
  ).length

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
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="버전 관리"
          value={groupTotal}
          icon="folder_copy"
          tone={groupTotal > 0 ? 'primary' : 'neutral'}
        />
        <StatCard
          label="같은 이름 문서"
          value={exactCount}
          icon="content_copy"
          tone={exactCount > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="버전/날짜 문서"
          value={versionCount}
          icon="history"
          tone={versionCount > 0 ? 'primary' : 'neutral'}
        />
        <StatCard
          label="표시 중 차이 후보"
          value={contentDiffCandidateCount}
          icon="fingerprint"
          tone={contentDiffCandidateCount > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card variant="elevated">
        <CardSection
          title="자동 감지된 버전 관리"
          trailing={
            <Chip
              label={
                groupTotal > groups.length
                  ? `표시 ${visibleGroupStart}-${visibleGroupEnd} / ${groupTotal}`
                  : `${groupTotal}개 묶음`
              }
              tone="primary"
              icon="auto_awesome"
              as="span"
            />
          }
        >
          <div className="flex gap-2 flex-wrap">
            <Chip
              label="전체"
              kind="filter"
              selected={groupFilter === 'all'}
              onClick={() => changeGroupFilter('all')}
            />
            <Chip
                label={`같은 이름 ${exactCount}`}
              kind="filter"
              selected={groupFilter === 'exact_name_conflict'}
              onClick={() => changeGroupFilter('exact_name_conflict')}
            />
            <Chip
                label={`버전/날짜 ${versionCount}`}
              kind="filter"
              selected={groupFilter === 'version_family'}
              onClick={() => changeGroupFilter('version_family')}
            />
          </div>

          {groupsLoading ? (
            <div className="px-6 py-10 flex items-center justify-center gap-2 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
              <Spinner size={18} /> 묶음 불러오는 중…
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon="task_alt"
              title="자동 감지된 버전 묶음이 없습니다"
              description="같은 이름이거나 버전/날짜가 붙은 Office 문서를 등록하면 이곳에 표시됩니다."
              compact
            />
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                    group={group}
                    activeDetail={activeGroupDetail?.id === group.id ? activeGroupDetail : null}
                    historyState={historyState?.groupId === group.id ? historyState : null}
                    loading={groupLoadingId === group.id}
                    onOpen={() => void selectGroup(group)}
                    onOpenFile={(file) => void openFile(file)}
                    onOpenExcelGrid={(detail, state) => void openExcelGrid(detail, state)}
                />
              ))}
            </div>
          )}

          {groupTotal > GROUP_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-3">
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                {visibleGroupStart}-{visibleGroupEnd} / {groupTotal}개 묶음
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

      <Card variant="outlined">
        <CardSection
          title="수동으로 직접 고르기"
          description="자동 묶음에 없는 특수 케이스만 열어서 사용하세요. 1만 개 문서에서도 현재 페이지와 검색 결과만 보여줍니다."
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
                                ? `기준 컬럼 ${file.key_column || '미지정'} · 여러 파일 비교`
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
        />
      )}
    </div>
  )
}

function GroupCard({
  group,
  activeDetail,
  historyState,
  loading,
  onOpen,
  onOpenFile,
  onOpenExcelGrid,
}: {
  group: LibraryGroupSummary
  activeDetail: LibraryGroupDetail | null
  historyState: HistoryDiffState | null
  loading: boolean
  onOpen: () => void
  onOpenFile: (file: FileInfo) => void
  onOpenExcelGrid: (detail: LibraryGroupDetail, historyState: HistoryDiffState | null) => void
}) {
  const contentMeta = CONTENT_STATUS_META[group.content_status] ?? CONTENT_STATUS_META.pending
  const historyLoading = loading || (!activeDetail && Boolean(historyState?.loading))
  const summaryTokens = group.tokens_summary.slice(0, 8)

  return (
    <div
      id={versionGroupAnchorId(group.id)}
      className="scroll-mt-24 rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <FileTypeBadge fileType={group.file_type} />
          <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
            {group.base_name}
          </span>
          <Badge tone={group.group_kind === 'exact_name_conflict' ? 'warning' : 'neutral'}>
            {groupKindLabel(group.group_kind)}
          </Badge>
          <Badge tone="neutral">{group.file_count}개 파일</Badge>
          <Badge tone={contentMeta.tone}>{contentMeta.label}</Badge>
        </div>

        {summaryTokens.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {summaryTokens.map((token) => (
              <Chip key={token} label={token} tone="secondary" as="span" />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={activeDetail ? 'tonal' : 'filled'}
          leadingIcon={activeDetail ? 'expand_less' : 'timeline'}
          onClick={onOpen}
          loading={historyLoading}
        >
          {activeDetail ? '버전 관리 접기' : '버전 관리 열기'}
        </Button>
      </div>

      {activeDetail && (
        <GroupTimeline
          detail={activeDetail}
          historyState={historyState}
          onOpenFile={onOpenFile}
          onOpenExcelGrid={() => onOpenExcelGrid(activeDetail, historyState)}
        />
      )}
    </div>
  )
}

function GroupTimeline({
  detail,
  historyState,
  onOpenFile,
  onOpenExcelGrid,
}: {
  detail: LibraryGroupDetail
  historyState: HistoryDiffState | null
  onOpenFile: (file: FileInfo) => void
  onOpenExcelGrid: () => void
}) {
  const progressLabel = historyState
    ? historyState.total === 0
      ? '비교할 이전 버전 없음'
      : historyState.loading
        ? `변경점 계산 중… ${historyState.completed}/${historyState.total}`
        : `변경점 계산 완료 ${historyState.completed}/${historyState.total}`
    : '변경점 계산 준비 중'

  return (
    <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">버전 목록</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Chip label={`${detail.files.length}/${detail.file_count}개 표시`} tone="neutral" as="span" />
          {normalizeFileType(detail.file_type) === 'Excel' && (
            <Button
              variant="filled"
              leadingIcon="table_chart"
              className="shadow-elev-1"
              onClick={onOpenExcelGrid}
            >
              표로 보기
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">버전별 변경점</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              이 묶음 안에서 바로 이전 버전과 다음 버전만 순서대로 비교합니다.
            </p>
          </div>
          <Badge tone={historyState?.loading ? 'warning' : 'neutral'}>
            {historyState?.loading && <Spinner size={14} />} {progressLabel}
          </Badge>
        </div>
        {historyState?.truncated && (
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            최신 {detail.files.length}개만 표시되어 이 범위 안의 변경점만 계산했습니다.
          </p>
        )}
        <HistoryTransitions transitions={historyState?.transitions ?? []} />
      </div>

      <ol className="space-y-2">
        {detail.files.map((file, index) => (
          <li
            key={file.id}
            className="flex items-start gap-3 rounded-md bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] p-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] type-label-md">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)] truncate">
                  {file.name}
                </p>
                <FileTypeBadge fileType={file.file_type} />
                {fileVersionMarkers(file).map((token) => (
                  <Chip key={`${file.id}-${token}`} label={token} tone="secondary" as="span" />
                ))}
              </div>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                수정/등록 · {formatDate(file.file_mtime ?? file.created_at)}
              </p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate" title={file.path}>
                위치 · {pathTail(file.path)}
              </p>
            </div>
            <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(file)}>
              열기
            </Button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function HistoryTransitions({ transitions }: { transitions: HistoryTransition[] }) {
  if (transitions.length === 0) {
    return (
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        비교할 이전 버전이 없습니다. 같은 문서의 다른 버전을 더 등록하면 변경점이 표시됩니다.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {transitions.map((transition) => (
        <HistoryTransitionCard key={transition.id} transition={transition} />
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

function HistoryTransitionCard({ transition }: { transition: HistoryTransition }) {
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
    <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)] break-words">
            {transition.fromFile.name} → {transition.toFile.name}
          </p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            이전 버전에서 다음 버전으로 바뀐 내용을 확인합니다.
          </p>
        </div>
        <Badge tone={statusTone}>
          {transition.status === 'loading' && <Spinner size={14} />} {statusLabel}
        </Badge>
      </div>

      {transition.status === 'error' && (
        <p className="type-body-sm text-[var(--md-sys-color-error)]">
          {transition.error ?? '이 버전 사이의 변경점을 계산하지 못했습니다.'}
        </p>
      )}
      {transition.status === 'done' && transition.result && (
        <HistoryTransitionResult result={transition.result} />
      )}
    </div>
  )
}

function HistoryTransitionResult({ result }: { result: CheckResponse }) {
  if (result.mode === 'excel') return <ExcelCheckResult result={result} compact />
  if (result.mode === 'word') return <WordCheckResult diffs={result.diffs} compact />
  return <PptCheckResult slides={result.slides} compact />
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

function excelIssueSubtext(issue: ExcelCheckIssue) {
  if (issue.type === 'missing_column') {
    return issue.columnGroup ? `항목 ${issue.columnGroup}` : ''
  }
  return issue.key ? `기준값 ${issue.key}` : ''
}

function conflictStatus(conflict: ExcelCheckIssue['conflicts'][number]) {
  return conflict.values.join(' | ') || (conflict.rowValues.length > 0 ? '내용 있음' : '-')
}

function isAbsentExcelConflict(conflict: ExcelCheckIssue['conflicts'][number]) {
  if (conflict.rowValues.length > 0) return false
  const status = conflict.values.join(' ')
  return /없음|누락/.test(status)
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

      {(!compact || valueConflicts.length > 0) && (
        <ExcelIssueSection
          title="값 변경"
          icon="report_problem"
          description="셀 값이 이전 버전과 달라진 항목입니다."
          issues={valueConflicts}
        />
      )}
      {(!compact || contentChanges.length > 0) && (
        <ExcelIssueSection
          title="추가/삭제된 내용"
          icon="difference"
          description="새로 생기거나 사라진 셀/행 내용을 필요할 때 펼쳐 확인합니다."
          issues={contentChanges}
        />
      )}
    </div>
  )
}

function ExcelIssueSection({
  title,
  description,
  icon,
  issues,
}: {
  title: string
  description: string
  icon: string
  issues: ExcelCheckIssue[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card variant="outlined" className="overflow-hidden">
      <button
        type="button"
        className="state-host relative flex w-full items-center gap-2 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-6 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="state-layer" />
        <Icon
          name={icon}
          size={20}
          className="relative text-[var(--md-sys-color-on-surface-variant)]"
        />
        <div className="relative min-w-0">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{title}</p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{description}</p>
        </div>
        <span className="relative ml-auto flex items-center gap-2">
          <Badge tone={issues.length > 0 ? 'warning' : 'neutral'}>
            {issues.length}건
          </Badge>
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            size={20}
            className="text-[var(--md-sys-color-on-surface-variant)]"
          />
        </span>
      </button>

      {open && (
        issues.length === 0 ? (
          <p className="px-6 py-6 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            해당 이슈가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {issues.map((issue) => (
              <li key={issue.id} className="px-6 py-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                        {excelIssueTitle(issue)}
                      </span>
                      <Badge tone={issue.severity === 'conflict' ? 'danger' : 'warning'}>
                        {issue.severity === 'conflict' ? '확인 필요' : '주의'}
                      </Badge>
                    </div>
                    {excelIssueSubtext(issue) && (
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
                        {excelIssueSubtext(issue)}
                      </p>
                    )}
                  </div>
                  <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)] max-w-md">
                    {issue.message}
                  </p>
                </div>

                <ExcelIssueTable issue={issue} />
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
  )
}

function ExcelIssueTable({ issue }: { issue: ExcelCheckIssue }) {
  if (issue.type === 'missing_key' || issue.type === 'missing_column') {
    return <ExcelContentPreviewTable issue={issue} />
  }
  return <ExcelValueIssueTable issue={issue} valueHeader={issue.type === 'value_conflict' ? '값' : '내용'} />
}

function ExcelValueIssueTable({
  issue,
  valueHeader = '값',
}: {
  issue: ExcelCheckIssue
  valueHeader?: string
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--md-sys-color-outline-variant)]">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--md-sys-color-surface-container-low)]">
          <tr>
            {['파일', '위치', valueHeader].map((header) => (
              <th
                key={header}
                className="px-3 py-2 text-left type-label-md text-[var(--md-sys-color-on-surface-variant)]"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
          {issue.conflicts.map((conflict) => (
            <tr key={`${issue.id}-${conflict.fileId}`} className="bg-[var(--md-sys-color-surface-container-lowest)]">
              <td className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap">
                {conflict.fileName}
              </td>
              <td className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap font-mono">
                {formatExcelLocation(conflict)}
              </td>
              <td className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap font-mono">
                {conflict.values.join(' | ') || '(빈 값)'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExcelContentPreviewTable({ issue }: { issue: ExcelCheckIssue }) {
  const presentConflicts = issue.conflicts.filter((conflict) => !isAbsentExcelConflict(conflict))
  const absentConflicts = issue.conflicts.filter(isAbsentExcelConflict)

  return (
    <div className="space-y-3">
      {presentConflicts.length === 0 ? (
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          표시할 추가/삭제 내용이 없습니다.
        </p>
      ) : (
        presentConflicts.map((conflict) => {
          const location = formatExcelLocation(conflict)
          const visibleCount = conflict.rowValues.length
          const countLabel =
            conflict.rowCount > visibleCount && visibleCount > 0
              ? `표시 ${visibleCount}/${conflict.rowCount}개`
              : conflict.rowCount > 0
                ? `${conflict.rowCount}개 값`
                : ''
          return (
            <div
              key={`${issue.id}-${conflict.fileId}`}
              className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 space-y-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={conflict.values.some((value) => value.includes('삭제')) ? 'danger' : 'success'}>
                      {conflictStatus(conflict)}
                    </Badge>
                    <p className="type-title-sm text-[var(--md-sys-color-on-surface)] break-all">
                      {conflict.fileName}
                    </p>
                  </div>
                  {location !== '-' && (
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1 font-mono">
                      {location}
                    </p>
                  )}
                </div>
                {countLabel && <Chip label={countLabel} tone="neutral" as="span" />}
              </div>
              {conflict.rowValues.length > 0 ? (
                <ExcelRowPreview conflict={conflict} />
              ) : (
                <p className="type-body-sm text-[var(--md-sys-color-on-surface)] font-mono">
                  {conflict.values.join(' | ')}
                </p>
              )}
            </div>
          )
        })
      )}

      {absentConflicts.length > 0 && (
        <div className="rounded-md border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3">
          <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">내용이 없는 파일</p>
          <div className="mt-2 flex gap-2 flex-wrap">
            {absentConflicts.map((conflict) => (
              <Chip
                key={`${issue.id}-absent-${conflict.fileId}`}
                label={`${conflict.fileName} · ${conflictStatus(conflict)}`}
                tone="neutral"
                as="span"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExcelRowPreview({ conflict }: { conflict: ExcelCheckIssue['conflicts'][number] }) {
  const columns = conflict.columns.length > 0
    ? conflict.columns
    : conflict.rowValues[0]?.map((_, index) => `열 ${index + 1}`) ?? []

  return (
    <div className="max-w-[720px] overflow-x-auto rounded border border-[var(--md-sys-color-outline-variant)]">
      <table className="text-xs min-w-max">
        <thead className="bg-[var(--md-sys-color-surface-container-low)]">
          <tr>
            {columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                className="px-2 py-1 text-left type-label-sm text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {conflict.rowValues.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-[var(--md-sys-color-outline-variant)]">
              {columns.map((column, columnIndex) => (
                <td key={`${column}-${columnIndex}`} className="px-2 py-1 whitespace-nowrap font-mono">
                  {row[columnIndex] || '(빈 값)'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function excelGridHighlightClass(highlight: ExcelDiffHighlight | null) {
  if (highlight === 'added') {
    return 'bg-emerald-100 text-emerald-950 ring-1 ring-inset ring-emerald-300'
  }
  if (highlight === 'removed') {
    return 'bg-red-100 text-red-950 ring-1 ring-inset ring-red-300'
  }
  if (highlight === 'changed') {
    return 'bg-amber-100 text-amber-950 ring-1 ring-inset ring-amber-300'
  }
  return 'bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-on-surface)]'
}

function excelGridHighlightLabel(highlight: ExcelDiffHighlight | null) {
  if (highlight === 'added') return '추가'
  if (highlight === 'removed') return '삭제'
  if (highlight === 'changed') return '변경'
  return '변경 없음'
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
}: {
  modal: ExcelGridModalState
  onClose: () => void
}) {
  const [selectedCell, setSelectedCell] = useState<ExcelDiffGridCell | null>(null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Excel 표로 보기"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] min-h-[560px] w-[94vw] max-w-[1400px] flex-col overflow-hidden rounded-xl bg-[var(--md-sys-color-surface)] shadow-2xl border border-[var(--md-sys-color-outline-variant)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--md-sys-color-outline-variant)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon name="table_chart" size={22} className="text-[var(--md-sys-color-primary)]" />
              <p className="type-title-md text-[var(--md-sys-color-on-surface)]">Excel 표로 보기</p>
              <Badge tone="neutral">전체 변경 범위 기준</Badge>
            </div>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate mt-1">
              {modal.detail.base_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
            aria-label="닫기"
          >
            <Icon name="close" size={22} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
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
              {modal.data.sections.map((section) => (
                <ExcelDiffGridSectionView
                  key={section.id}
                  section={section}
                  selectedCell={selectedCell}
                  onSelectCell={setSelectedCell}
                />
              ))}
              <ExcelDiffGridCellDetail cell={selectedCell} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ExcelDiffGridSummary({ data }: { data: ExcelDiffGridResponse }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Chip label={`최신 파일 값 기준 · ${data.latest_file.file_name}`} tone="primary" icon="description" as="span" />
        <Chip label={`${data.sheet_name} 시트`} tone="neutral" as="span" />
        <Chip label={`${data.row_count}행 × ${data.column_count}열`} tone="neutral" as="span" />
        {data.key_column && <Chip label={`기준 컬럼 · ${data.key_column}`} tone="secondary" as="span" />}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge tone="success">초록 · 추가</Badge>
        <Badge tone="danger">빨강 · 삭제</Badge>
        <Badge tone="warning">노랑 · 변경</Badge>
      </div>

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
}: {
  section: ExcelDiffGridResponse['sections'][number]
  selectedCell: ExcelDiffGridCell | null
  onSelectCell: (cell: ExcelDiffGridCell) => void
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
    <section className="border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{section.title}</p>
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
                  return (
                    <td
                      key={`${cell.row_index}-${cell.column_index}`}
                      title={excelGridCellTitle(cell)}
                      className={`w-[8rem] min-w-[8rem] max-w-[8rem] border-b border-r border-[var(--md-sys-color-outline-variant)] px-2 py-1 align-top font-mono whitespace-nowrap cursor-default ${excelGridHighlightClass(cell.highlight)} ${
                        selected ? 'outline outline-2 outline-[var(--md-sys-color-primary)] outline-offset-[-2px]' : ''
                      }`}
                      onClick={() => cell.histories.length > 0 && onSelectCell(cell)}
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

function ExcelDiffGridCellDetail({ cell }: { cell: ExcelDiffGridCell | null }) {
  if (!cell) {
    return (
      <aside className="border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">변경 셀 상세</p>
        <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          노란색/초록색/빨간색 셀을 누르면 원래 값과 변경 후 값을 여기서 확인할 수 있습니다.
        </p>
      </aside>
    )
  }

  return (
    <aside className="border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={cell.highlight === 'removed' ? 'danger' : cell.highlight === 'added' ? 'success' : 'warning'}>
          {excelGridHighlightLabel(cell.highlight)}
        </Badge>
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
          {cell.row_number}행 {cell.column_letter}열
        </p>
      </div>
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        현재 최신본 값: <span className="font-mono text-[var(--md-sys-color-on-surface)]">{displayExcelGridValue(cell.value)}</span>
      </p>
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

function PptCheckResult({
  slides,
  compact = false,
}: {
  slides: PptSlideCard[]
  compact?: boolean
}) {
  const inserted = slides.filter((slide) => slide.type === 'inserted_slide').length
  const removed = slides.filter((slide) => slide.type === 'removed_slide').length
  const changed = slides.filter((slide) => slide.type === 'matched_slide_change').length

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
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">PPT 변경 내용</p>
        </header>
        {slides.length === 0 ? (
          <p className="px-6 py-8 type-body-sm text-[var(--md-sys-color-on-surface-variant)] text-center">
            슬라이드 변경점이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {slides.map((slide) => (
              <li key={slide.id} className="px-6 py-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    tone={
                      slide.type === 'inserted_slide'
                        ? 'success'
                        : slide.type === 'removed_slide'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {PPT_TYPE_KO[slide.type]}
                  </Badge>
                    <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                      슬라이드 {slide.slideNumber}
                      {slide.matchedSlideNumber && slide.matchedSlideNumber !== slide.slideNumber
                        ? ` → ${slide.matchedSlideNumber}`
                        : ''}
                    </span>
                  <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {slide.title}
                  </span>
                </div>
                <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)]">
                  {slide.description}
                </p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="이전 내용" content={slide.beforeText} tone="danger" />
                  <DiffPanel title="변경 후 내용" content={slide.afterText} tone="success" />
                </div>
                <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                  항목 유형 · {blockTypeLabel(slide.itemType || 'slide')}
                </p>
              </li>
            ))}
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
}: {
  title: string
  content: string
  tone: 'danger' | 'success'
}) {
  const bg =
    tone === 'danger'
      ? 'bg-[var(--md-sys-color-error-container)]/50 border-[var(--md-sys-color-error)]/70'
      : 'bg-[var(--md-sys-color-success-container)]/50 border-[var(--md-sys-color-success)]/70'
  return (
    <div className={`rounded-md border-2 p-3 ${bg}`}>
      <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
        {title}
      </p>
      <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-2 whitespace-pre-wrap break-words">
        {content || '(내용 없음)'}
      </p>
    </div>
  )
}
