import { useEffect, useMemo, useState } from 'react'

import { PptSlideCard } from '../../api/client'
import { Badge, Card, Icon, StatCard } from '../../ui'
import { TutorialStep } from '../../tutorial'
import { DiffPanel } from './diffPanel'

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

const blockTypeLabel = (type: string) => BLOCK_TYPE_KO[type] ?? type

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

export function PptCheckResult({
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
            슬라이드에서 달라진 내용이 없습니다.
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
                          <Icon name="check_circle" size={14} />
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
