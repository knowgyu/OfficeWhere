import { CheckResponse, FileInfo } from '../../api/client'
import { Badge, Button, Icon, Spinner } from '../../ui'
import { TutorialStep } from '../../tutorial'
import { ExcelCheckResult } from './excelResult'
import { PptCheckResult } from './pptResult'
import { WordCheckResult } from './wordResult'
import { HistoryTransition } from './types'

export function HistoryTransitions({
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
