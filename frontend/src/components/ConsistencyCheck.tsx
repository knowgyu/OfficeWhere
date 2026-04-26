import { useEffect, useMemo, useState } from 'react'

import {
  CheckResponse,
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

const MODE_GUIDE: Record<string, string> = {
  excel: 'Excel은 여러 파일을 동시에 비교합니다. 기준 컬럼이 같은 행에서 값이 다르거나 일부 파일에 항목이 없는 경우를 찾습니다.',
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

const sanitizeGroupReason = (reason: string) =>
  reason
    .replace(/fingerprint/gi, '추출 내용')
    .replace(/후보입니다\./g, '문서로 보입니다.')

const contentStatusHint = (group: LibraryGroupSummary) => {
  if (group.content_status === 'same_content') {
    return `${group.fingerprint_coverage}개 문서에서 추출한 내용이 같아 보입니다.`
  }
  if (group.content_status === 'content_differs') {
    return `${group.fingerprint_unique_count}가지 내용이 있어 변경 가능성이 있습니다.`
  }
  if (group.content_status === 'partial') {
    return `${group.file_count}개 중 ${group.fingerprint_coverage}개 문서만 내용 확인이 끝났습니다.`
  }
  if (group.content_status === 'not_enough_content') {
    return '추출할 본문이 부족해 내용 차이를 단정하지 않습니다.'
  }
  return '재스캔 후 내용 확인 정확도가 올라갑니다.'
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
    const detail = await loadGroupDetail(group)
    if (!detail) return
    if (historyState?.groupId === detail.id && historyState.transitions.length > 0) return
    await runHistoryDiffs(detail)
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
          description="문서 히스토리는 등록된 Office 파일 사이의 버전과 변경점을 확인합니다."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="문서 히스토리"
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
          title="자동 감지된 문서 히스토리"
          description="같은 이름이거나 v1.0, v1.1, 260426처럼 버전/날짜가 붙은 Office 문서를 묶어 보여줍니다. 히스토리를 열면 그 묶음의 변경점만 계산합니다."
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
              title="자동 감지된 히스토리가 없습니다"
              description="같은 이름이거나 버전/날짜가 붙은 Office 문서를 등록하면 이곳에 표시됩니다."
              compact
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                    group={group}
                    activeDetail={activeGroupDetail?.id === group.id ? activeGroupDetail : null}
                    historyState={historyState?.groupId === group.id ? historyState : null}
                    loading={groupLoadingId === group.id}
                    onOpen={() => void selectGroup(group)}
                    onOpenFile={(file) => void openFile(file)}
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
}: {
  group: LibraryGroupSummary
  activeDetail: LibraryGroupDetail | null
  historyState: HistoryDiffState | null
  loading: boolean
  onOpen: () => void
  onOpenFile: (file: FileInfo) => void
}) {
  const contentMeta = CONTENT_STATUS_META[group.content_status] ?? CONTENT_STATUS_META.pending
  const historyLoading = loading || Boolean(historyState?.loading)

  return (
    <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-4">
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

        <div className="space-y-1">
          {[group.latest_file, group.previous_file].filter(Boolean).map((file, index) => (
            <p
              key={(file as FileInfo).id}
              className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate"
              title={(file as FileInfo).path}
            >
              {index === 0 ? '최신 후보 · ' : '이전 후보 · '}
              {(file as FileInfo).name}
            </p>
          ))}
        </div>

        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          {sanitizeGroupReason(group.reason)}
        </p>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          내용 확인 · {contentStatusHint(group)}
        </p>
        {group.tokens_summary.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {group.tokens_summary.slice(0, 6).map((token) => (
              <Chip key={token} label={token} tone="secondary" as="span" />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button variant="filled" leadingIcon="timeline" onClick={onOpen} loading={historyLoading}>
          {activeDetail ? '히스토리 보기' : '히스토리 열기'}
        </Button>
      </div>

      {activeDetail && (
        <GroupTimeline detail={activeDetail} historyState={historyState} onOpenFile={onOpenFile} />
      )}
    </div>
  )
}

function GroupTimeline({
  detail,
  historyState,
  onOpenFile,
}: {
  detail: LibraryGroupDetail
  historyState: HistoryDiffState | null
  onOpenFile: (file: FileInfo) => void
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
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">버전 히스토리</p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            파일명 토큰, 등록/수정 시간 기준으로 최신 후보부터 정렬했습니다.
          </p>
        </div>
        <Chip label={`${detail.files.length}/${detail.file_count}개 표시`} tone="neutral" as="span" />
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
                {index === 0 && <Badge tone="success">최신 후보</Badge>}
                <FileTypeBadge fileType={file.file_type} />
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

function ExcelCheckResult({
  result,
  compact = false,
}: {
  result: Extract<CheckResponse, { mode: 'excel' }>
  compact?: boolean
}) {
  const valueConflicts = result.issues.filter((issue) => issue.type === 'value_conflict')
  const missingKeys = result.issues.filter((issue) => issue.type === 'missing_key')

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="전체 항목" value={result.totalKeys} icon="tag" />
          <StatCard label="공통 항목" value={result.matchedKeys} icon="check_circle" tone="success" />
          <StatCard
            label="값 불일치"
            value={valueConflicts.length}
            icon="report_problem"
            tone={valueConflicts.length > 0 ? 'danger' : 'neutral'}
          />
          <StatCard
            label="항목 누락"
            value={missingKeys.length}
            icon="pending"
            tone={missingKeys.length > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      <ExcelIssueSection
        title="값 불일치"
        icon="report_problem"
        description="기준 컬럼 값이 같은 행에서 파일마다 셀 값이 다릅니다."
        issues={valueConflicts}
      />
      <ExcelIssueSection
        title="항목 누락"
        icon="pending"
        description="일부 파일에 같은 기준 컬럼 값을 가진 행이 없습니다."
        issues={missingKeys}
      />
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
  return (
    <Card variant="outlined" className="overflow-hidden">
      <header className="px-6 py-3 bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)] flex items-center gap-2">
        <Icon
          name={icon}
          size={20}
          className="text-[var(--md-sys-color-on-surface-variant)]"
        />
        <div className="min-w-0">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{title}</p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{description}</p>
        </div>
        <Badge tone={issues.length > 0 ? 'warning' : 'neutral'} className="ml-auto">
          {issues.length}건
        </Badge>
      </header>

      {issues.length === 0 ? (
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
                      {issue.key || '(빈 기준 값)'}
                    </span>
                    <Badge tone={issue.severity === 'conflict' ? 'danger' : 'warning'}>
                      {issue.severity === 'conflict' ? '확인 필요' : '주의'}
                    </Badge>
                  </div>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
                    컬럼 그룹 · <strong>{issue.columnGroup || '-'}</strong>
                  </p>
                  {issue.keyVariants.length > 0 && (
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
                      기준 값 표기 차이 · {issue.keyVariants.join(', ')}
                    </p>
                  )}
                </div>
                <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)] max-w-md">
                  {issue.message}
                </p>
              </div>

              <div className="overflow-x-auto rounded-md border border-[var(--md-sys-color-outline-variant)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--md-sys-color-surface-container-low)]">
                    <tr>
                      {['파일', '위치', '컬럼', '행 수', '값'].map((header) => (
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
                      <tr
                        key={`${issue.id}-${conflict.fileId}`}
                        className="bg-[var(--md-sys-color-surface-container-lowest)]"
                      >
                          <td className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap">
                            {conflict.fileName}
                          </td>
                          <td className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap font-mono">
                            {formatExcelLocation(conflict)}
                          </td>
                          <td className="px-3 py-2 text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap">
                            {conflict.columns.join(', ') || '-'}
                        </td>
                        <td className="px-3 py-2 text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap">
                          {conflict.rowCount}
                        </td>
                        <td className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap font-mono">
                          {conflict.values.join(' | ') || '(빈 값)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
                    {diff.location}
                  </span>
                  <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {blockTypeLabel(diff.blockType)}
                  </span>
                </div>
                <GitDiffPanel diff={diff} />
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

function GitDiffPanel({ diff }: { diff: WordDiffCard }) {
  const rows: Array<{ prefix: '+' | '-'; text: string; tone: 'success' | 'danger' }> = []
  if (diff.type !== 'insert' && diff.beforeText) {
    rows.push({ prefix: '-', text: diff.beforeText, tone: 'danger' })
  }
  if (diff.type !== 'delete' && diff.afterText) {
    rows.push({ prefix: '+', text: diff.afterText, tone: 'success' })
  }

  if (rows.length === 0) {
    rows.push({ prefix: '+', text: '(내용 없음)', tone: 'success' })
  }

  return (
    <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] overflow-hidden bg-[var(--md-sys-color-surface-container-lowest)] font-mono text-sm">
      {rows.map((row, index) => {
        const bg =
          row.tone === 'danger'
            ? 'bg-[var(--md-sys-color-error-container)]/45 text-[var(--md-sys-color-on-error-container)]'
            : 'bg-[var(--md-sys-color-success-container)]/45 text-[var(--md-sys-color-on-success-container)]'
        return (
          <div key={`${row.prefix}-${index}`} className={`px-3 py-2 whitespace-pre-wrap break-words ${bg}`}>
            <span className="font-bold mr-2">{row.prefix}</span>
            {row.text}
          </div>
        )
      })}
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
      ? 'bg-[var(--md-sys-color-error-container)]/50 border-[var(--md-sys-color-error-container)]'
      : 'bg-[var(--md-sys-color-success-container)]/50 border-[var(--md-sys-color-success-container)]'
  return (
    <div className={`rounded-md border p-3 ${bg}`}>
      <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
        {title}
      </p>
      <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-2 whitespace-pre-wrap break-words">
        {content || '(내용 없음)'}
      </p>
    </div>
  )
}
