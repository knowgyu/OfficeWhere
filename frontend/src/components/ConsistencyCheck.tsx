import { useEffect, useMemo, useState } from 'react'

import {
  CheckResponse,
  ExcelCheckIssue,
  FileInfo,
  LibraryFileGroup,
  PptSlideCard,
  WordDiffCard,
  api,
  getCompareMode,
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
  StatCard,
  useSnackbar,
} from '../ui'

const MODE_GUIDE: Record<string, string> = {
  excel: 'Excel은 다중 선택 가능. value conflict · missing key · missing column을 탐지합니다.',
  word: 'Word는 2개 파일만 비교. insert / delete / replace diff 카드가 표시됩니다.',
  ppt: 'PPT는 2개 파일만 비교. 슬라이드 추가/삭제 및 항목 변경을 카드로 표시합니다.',
  none: 'Excel은 다중 파일 비교, Word/PPT는 2개 파일 비교가 가능합니다.',
}

export default function ConsistencyCheck() {
  const snackbar = useSnackbar()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [groups, setGroups] = useState<LibraryFileGroup[]>([])
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.files
      .list()
      .then((response) => setFiles(response.data))
      .catch(() => {
        /* silent */
      })
    api.library
      .groups()
      .then((response) => setGroups(response.data.groups))
      .catch(() => {
        /* silent */
      })
  }, [])

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedIds.has(file.id)),
    [files, selectedIds],
  )
  const selectedMode = selectedFiles[0]
    ? getCompareMode(undefined, selectedFiles[0].file_type)
    : null

  const toggleFile = (file: FileInfo) => {
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

  const selectGroup = (group: LibraryFileGroup) => {
    const ids =
      group.file_type === 'Excel'
        ? group.files.map((file) => file.id)
        : group.files.slice(0, 2).map((file) => file.id)
    setSelectedIds(new Set(ids))
    setResult(null)
  }

  if (files.length === 0) {
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
            description="파일명에서 날짜/버전/최종 같은 토큰을 제거해 같은 문서의 버전 후보를 먼저 보여줍니다."
            trailing={<Chip label={`${groups.length}개 묶음`} tone="primary" icon="auto_awesome" as="span" />}
          >
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => selectGroup(group)}
                  className="state-host relative text-left rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 hover:border-[var(--md-sys-color-primary)] transition-colors"
                >
                  <span className="state-layer" />
                  <div className="relative space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileTypeBadge fileType={group.file_type} />
                      <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                        {group.canonical_name}
                      </span>
                      <Badge tone="neutral">{group.files.length}개 파일</Badge>
                    </div>
                    <div className="space-y-1">
                      {group.files.slice(0, 3).map((file) => (
                        <p
                          key={file.id}
                          className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate"
                          title={file.path}
                        >
                          {file.name}
                        </p>
                      ))}
                    </div>
                    <p className="type-label-md text-[var(--md-sys-color-primary)]">
                      {group.file_type === 'Excel'
                        ? '이 묶음 전체를 Excel 정합성 검사 대상으로 선택'
                        : '최신 2개 파일을 비교 대상으로 선택'}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {files.map((file) => {
              const checked = selectedIds.has(file.id)
              const fileMode = getCompareMode(undefined, file.file_type)
              const disabled =
                !checked &&
                Boolean(
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
                      {fileMode === 'excel'
                        ? `key ${file.key_column || '미지정'} · 다중 비교`
                        : `${fileMode === 'word' ? '문서 diff' : '슬라이드 diff'} · 2개 비교`}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>

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
        <StatCard label="전체 key" value={result.totalKeys} icon="tag" />
        <StatCard label="공통 key" value={result.matchedKeys} icon="check_circle" tone="success" />
        <StatCard
          label="value conflict"
          value={valueConflicts.length}
          icon="report_problem"
          tone={valueConflicts.length > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="missing key"
          value={missingKeys.length}
          icon="pending"
          tone={missingKeys.length > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="missing column"
          value={missingColumns.length}
          icon="view_column_off"
          tone={missingColumns.length > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <ExcelIssueSection
        title="Value Conflict"
        icon="report_problem"
        description="같은 key에서 같은 컬럼 그룹의 값이 다릅니다."
        issues={valueConflicts}
      />
      <ExcelIssueSection
        title="Missing Key"
        icon="pending"
        description="일부 파일에 key가 없어 데이터가 누락됩니다."
        issues={missingKeys}
      />
      <ExcelIssueSection
        title="Missing Column"
        icon="view_column_off"
        description="일부 파일에 컬럼 그룹이 존재하지 않습니다."
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
                      {issue.key || '(빈 key)'}
                    </span>
                    <Badge tone={issue.severity === 'conflict' ? 'danger' : 'warning'}>
                      {issue.severity}
                    </Badge>
                  </div>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
                    컬럼 그룹 · <strong>{issue.columnGroup || '-'}</strong>
                  </p>
                  {issue.keyVariants.length > 0 && (
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
                      key 변형 · {issue.keyVariants.join(', ')}
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
        <StatCard label="insert" value={insertCount} icon="add_circle" tone="success" />
        <StatCard label="delete" value={deleteCount} icon="do_not_disturb_on" tone="danger" />
        <StatCard label="replace" value={replaceCount} icon="change_circle" tone="warning" />
      </div>

      <Card variant="outlined" className="overflow-hidden">
        <header className="px-6 py-3 bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)]">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">Word 변경 카드</p>
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
                    {diff.type}
                  </Badge>
                  <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                    {diff.location}
                  </span>
                  <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {diff.blockType}
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="Before" content={diff.beforeText} tone="danger" />
                  <DiffPanel title="After" content={diff.afterText} tone="success" />
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
        <StatCard label="inserted slide" value={inserted} icon="add_to_photos" tone="success" />
        <StatCard label="removed slide" value={removed} icon="delete_sweep" tone="danger" />
        <StatCard
          label="matched change"
          value={changed}
          icon="compare_arrows"
          tone="warning"
        />
      </div>

      <Card variant="outlined" className="overflow-hidden">
        <header className="px-6 py-3 bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)]">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">PPT 변경 카드</p>
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
                    {slide.type.replace('_', ' ')}
                  </Badge>
                  <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                    Slide {slide.slideNumber}
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
                  <DiffPanel title="Before" content={slide.beforeText} tone="danger" />
                  <DiffPanel title="After" content={slide.afterText} tone="success" />
                </div>
                <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                  항목 유형 · {slide.itemType || 'slide'}
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
      <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)] uppercase">
        {title}
      </p>
      <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-2 whitespace-pre-wrap break-words">
        {content || '(내용 없음)'}
      </p>
    </div>
  )
}
