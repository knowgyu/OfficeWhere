import { useEffect, useState } from 'react'

import { FileInfo, LibraryGroupDetail, normalizeFileType } from '../../api/client'
import { Badge, Button, Chip, FileTypeBadge, Icon, Spinner } from '../../ui'
import { TutorialStep } from '../../tutorial'
import { HistoryTransitions } from './historyTransitions'
import type { HistoryTransition } from './types'

const VERSION_LIST_PREVIEW_LIMIT = 5

export type CompareSlot = 'from' | 'to'

export interface CompareSelection {
  fromId: number | null
  toId: number | null
}

export interface HistoryDiffState {
  groupId: string
  transitions: HistoryTransition[]
  loading: boolean
  completed: number
  total: number
  truncated: boolean
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

export function GroupTimeline({
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
      ? '비교할 이전 파일 없음'
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
              leadingIcon="star"
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
                <Icon name="check_circle" size={14} />
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
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">파일 순서</p>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          별표로 대표 파일을 바꾸고, 1/2로 비교할 두 파일을 고릅니다.
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
                        ? '직접 지정한 대표 파일'
                        : '현재 대표 파일'
                      : '대표 파일로 지정'
                  }
                  title={
                    isLatest
                      ? isManualLatest
                        ? '직접 지정한 대표 파일'
                        : '현재 대표 파일'
                      : '대표 파일로 지정'
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
        <ComparedFilePill marker="1" label="비교 전" file={fromFile} tone="warning" onOpenFile={onOpenFile} />
        <Icon
          name="arrow_forward"
          size={18}
          className="hidden text-[var(--md-sys-color-on-surface-variant)] lg:block"
        />
        <ComparedFilePill marker="2" label="비교 후" file={toFile} tone="success" onOpenFile={onOpenFile} />
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
