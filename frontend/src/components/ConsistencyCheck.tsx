import { useEffect, useMemo, useState } from 'react'

import {
  CheckResponse,
  ExcelCheckIssue,
  FileInfo,
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
const GROUP_PREVIEW_LIMIT = 20

const MODE_GUIDE: Record<string, string> = {
  excel: 'Excel은 여러 파일을 동시에 비교합니다. 기준 컬럼이 같은 행에서 값이 다르거나 컬럼·항목이 누락된 경우를 찾습니다.',
  word: 'Word는 2개 파일만 비교합니다. 추가·삭제·수정된 문단과 표 행을 카드 형태로 보여줍니다.',
  ppt: 'PPT는 2개 파일만 비교합니다. 슬라이드 추가/삭제와 슬라이드 내 항목 변경을 보여줍니다.',
  none: 'Excel은 여러 파일 동시 비교, Word/PPT는 2개 파일 비교가 가능합니다. 텍스트 파일은 검색 등록용입니다.',
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

export default function ConsistencyCheck() {
  const snackbar = useSnackbar()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTotal, setFileTotal] = useState(0)
  const [fileOffset, setFileOffset] = useState(0)
  const [fileQuery, setFileQuery] = useState('')
  const [fileQueryDraft, setFileQueryDraft] = useState('')
  const [filesLoading, setFilesLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [groups, setGroups] = useState<LibraryGroupSummary[]>([])
  const [groupTotal, setGroupTotal] = useState(0)
  const [groupLoadingId, setGroupLoadingId] = useState<string | null>(null)
  const [groupDetailFiles, setGroupDetailFiles] = useState<FileInfo[]>([])
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

  useEffect(() => {
    void fetchFiles(0, '')
    api.library
      .groups({ limit: GROUP_PREVIEW_LIMIT })
      .then((response) => {
        setGroups(response.data.groups)
        setGroupTotal(response.data.total)
      })
      .catch(() => {
        /* silent */
      })
  }, [])

  const knownFilesById = useMemo(() => {
    const byId = new Map<number, FileInfo>()
    files.forEach((file) => byId.set(file.id, file))
    groupDetailFiles.forEach((file) => byId.set(file.id, file))
    groups.forEach((group) => {
      if (group.latest_file) byId.set(group.latest_file.id, group.latest_file)
      if (group.previous_file) byId.set(group.previous_file.id, group.previous_file)
    })
    return byId
  }, [files, groupDetailFiles, groups])

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

  const toggleFile = (file: FileInfo) => {
    if (!isCheckableFile(file)) {
      snackbar.warn('이 파일 형식은 검색 등록은 가능하지만 정합성 검사는 지원하지 않습니다.')
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
      snackbar.warn('정합성 검사는 같은 파일 타입만 함께 선택할 수 있습니다.')
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

  const validateSelection = (): string | null => {
    if (selectedFiles.length < 2) return '최소 2개 파일을 선택해 주세요.'
    const modes = new Set(selectedFiles.map((file) => getCompareMode(undefined, file.file_type)))
    if (modes.size > 1) return '파일 타입이 섞이면 검사할 수 없습니다.'
    const mode = selectedMode
    if (!mode) return '검사할 파일을 선택해 주세요.'
    if ((mode === 'word' || mode === 'ppt') && selectedFiles.length !== 2) {
      return `${mode === 'word' ? 'Word' : 'PPT'} 비교는 정확히 2개 파일이 필요합니다.`
    }
    return null
  }

  const handleCheck = async () => {
    const validationError = validateSelection()
    if (validationError) {
      snackbar.warn(validationError)
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const response = await api.check.run({ file_ids: Array.from(selectedIds) })
      const normalized = normalizeCheckResponse(response.data)
      setResult(normalized)
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '정합성 검사에 실패했습니다.'
      snackbar.error(detail)
    } finally {
      setLoading(false)
    }
  }

  const selectGroup = async (group: LibraryGroupSummary) => {
    if (!['Excel', 'Word', 'PowerPoint'].includes(normalizeFileType(group.file_type))) {
      snackbar.warn('이 묶음은 검색 등록용 파일이라 정합성 검사 대상으로 선택할 수 없습니다.')
      return
    }
    setGroupLoadingId(group.id)
    try {
      const response = await api.library.groupDetail(group.id)
      const detailFiles = response.data.files
      const ids =
        normalizeFileType(group.file_type) === 'Excel'
          ? detailFiles.map((file) => file.id)
          : detailFiles.slice(0, 2).map((file) => file.id)
      setGroupDetailFiles(detailFiles)
      setSelectedIds(new Set(ids))
      setResult(null)
    } catch {
      snackbar.error('문서 묶음 상세 정보를 불러오지 못했습니다.')
    } finally {
      setGroupLoadingId(null)
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

  const visibleFileStart = fileTotal === 0 ? 0 : fileOffset + 1
  const visibleFileEnd = Math.min(fileOffset + files.length, fileTotal)
  const hasPreviousFilePage = fileOffset > 0
  const hasNextFilePage = fileOffset + files.length < fileTotal

  if (fileTotal === 0 && groupTotal === 0 && !filesLoading) {
    return (
      <Card variant="outlined">
        <EmptyState
          icon="fact_check"
          title="먼저 파일을 등록해 주세요"
          description="정합성 검사는 등록된 파일 사이의 차이를 탐지합니다."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {groups.length > 0 && (
        <Card variant="elevated">
          <CardSection
            title="자동 감지된 유사 파일 묶음"
            description="같은 파일명 또는 버전/날짜 표시가 있는 Office 문서 후보를 요약만 먼저 보여줍니다. 내용 차이는 실제 비교 후에만 확인합니다."
            trailing={
              <Chip
                label={groupTotal > groups.length ? `표시 ${groups.length}/${groupTotal}개` : `${groups.length}개 묶음`}
                tone="primary"
                icon="auto_awesome"
                as="span"
              />
            }
          >
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => void selectGroup(group)}
                  disabled={groupLoadingId === group.id}
                  className="state-host relative text-left rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 hover:border-[var(--md-sys-color-primary)] transition-colors"
                >
                  <span className="state-layer" />
                  <div className="relative space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileTypeBadge fileType={group.file_type} />
                      <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                        {group.base_name}
                      </span>
                      <Badge tone={group.group_kind === 'exact_name_conflict' ? 'warning' : 'neutral'}>
                        {group.group_kind === 'exact_name_conflict' ? '같은 파일명' : '버전 후보'}
                      </Badge>
                      <Badge tone="neutral">{group.file_count}개 파일</Badge>
                    </div>
                    <div className="space-y-1">
                      {[group.latest_file, group.previous_file].filter(Boolean).map((file) => (
                        <p
                          key={(file as FileInfo).id}
                          className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate"
                          title={(file as FileInfo).path}
                        >
                          {(file as FileInfo).name}
                        </p>
                      ))}
                    </div>
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                      {group.reason}
                    </p>
                    {group.tokens_summary.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {group.tokens_summary.slice(0, 5).map((token) => (
                          <Chip key={token} label={token} tone="secondary" as="span" />
                        ))}
                      </div>
                    )}
                    <p className="type-label-md text-[var(--md-sys-color-primary)]">
                      {groupLoadingId === group.id
                        ? '묶음 상세 불러오는 중…'
                        : normalizeFileType(group.file_type) === 'Excel'
                        ? '이 묶음 전체를 비교 대상으로 선택'
                        : '이 묶음에서 최신 2개 파일을 비교 대상으로 선택'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </CardSection>
        </Card>
      )}

      <Card variant="elevated">
        <CardSection
          title="검사할 파일 선택"
          description={MODE_GUIDE[selectedMode ?? 'none']}
          trailing={
            <div className="flex gap-2 flex-wrap">
              <Chip
                label={`선택 ${selectedFiles.length}개`}
                tone="primary"
                icon="task_alt"
                as="span"
              />
              <Chip
                label={
                  fileTotal === 0
                    ? '표시 0개'
                    : `표시 ${visibleFileStart}-${visibleFileEnd} / ${fileTotal}`
                }
                tone="neutral"
                icon="view_list"
                as="span"
              />
              {selectedMode && (
                <Chip
                  label={`모드 · ${selectedMode.toUpperCase()}`}
                  tone="secondary"
                  as="span"
                />
              )}
            </div>
          }
        >
          <div className="flex gap-2 items-start flex-wrap md:flex-nowrap mb-3">
            <div className="flex-1 min-w-[240px]">
              <TextField
                leadingIcon="search"
                placeholder="검사할 Office 파일명 또는 경로 검색"
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
                        ? '검색 등록 가능 · 정합성 검사 제외'
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

          <div className="flex items-center gap-3 flex-wrap pt-2">
            <Button
              variant="filled"
              leadingIcon="play_arrow"
              onClick={handleCheck}
              loading={loading}
              disabled={selectedFiles.length < 2}
            >
              검사 실행
            </Button>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {MODE_GUIDE[selectedMode ?? 'none']}
            </p>
          </div>
        </CardSection>
      </Card>

      {result?.mode === 'excel' && <ExcelCheckResult result={result} />}
      {result?.mode === 'word' && <WordCheckResult diffs={result.diffs} />}
      {result?.mode === 'ppt' && <PptCheckResult slides={result.slides} />}
    </div>
  )
}

function ExcelCheckResult({ result }: { result: Extract<CheckResponse, { mode: 'excel' }> }) {
  const valueConflicts = result.issues.filter((issue) => issue.type === 'value_conflict')
  const missingKeys = result.issues.filter((issue) => issue.type === 'missing_key')
  const missingColumns = result.issues.filter((issue) => issue.type === 'missing_column')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
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
        <StatCard
          label="컬럼 누락"
          value={missingColumns.length}
          icon="view_column_off"
          tone={missingColumns.length > 0 ? 'warning' : 'neutral'}
        />
      </div>

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
      <ExcelIssueSection
        title="컬럼 누락"
        icon="view_column_off"
        description="일부 파일에 해당 컬럼이 아예 없습니다."
        issues={missingColumns}
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
                      {['파일', '컬럼', '행 수', '값'].map((header) => (
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

function WordCheckResult({ diffs }: { diffs: WordDiffCard[] }) {
  const insertCount = diffs.filter((diff) => diff.type === 'insert').length
  const deleteCount = diffs.filter((diff) => diff.type === 'delete').length
  const replaceCount = diffs.filter((diff) => diff.type === 'replace').length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="전체 변경" value={diffs.length} icon="edit_note" />
        <StatCard label="추가" value={insertCount} icon="add_circle" tone="success" />
        <StatCard label="삭제" value={deleteCount} icon="do_not_disturb_on" tone="danger" />
        <StatCard label="수정" value={replaceCount} icon="change_circle" tone="warning" />
      </div>

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
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="이전 내용" content={diff.beforeText} tone="danger" />
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

function PptCheckResult({ slides }: { slides: PptSlideCard[] }) {
  const inserted = slides.filter((slide) => slide.type === 'inserted_slide').length
  const removed = slides.filter((slide) => slide.type === 'removed_slide').length
  const changed = slides.filter((slide) => slide.type === 'matched_slide_change').length

  return (
    <div className="space-y-5">
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
                    {slide.matchedSlideNumber ? ` ↔ ${slide.matchedSlideNumber}` : ''}
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
