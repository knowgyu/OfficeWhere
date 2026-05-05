import { CSSProperties, useEffect, useState } from 'react'

import { Button, Icon } from '../ui'

interface OnboardingCarouselProps {
  open: boolean
  replay?: boolean
  onStartExample: () => void
  onStartOwnFolder: () => void
}

type PreviewRow = {
  icon: string
  title: string
  meta: string
  state: string
}

type Slide = {
  eyebrow: string
  title: string
  description: string
  proof: string
  accent: string
  previewTitle: string
  previewSubtitle: string
  rows: PreviewRow[]
  chips: string[]
  metric: string
  activeSection: 'search' | 'history' | 'setup'
}

const slides: Slide[] = [
  {
    eyebrow: '검색',
    title: '흩어진 문서를 한곳에서 찾습니다',
    description: '폴더를 등록해두면 파일명과 문서 본문을 함께 검색할 수 있습니다.',
    proof: '예: “일정”을 입력하면 제목에 없어도 본문에 나온 일정까지 함께 보여줍니다.',
    accent: '#365f7d',
    previewTitle: '일정 검색',
    previewSubtitle: '본문에서 찾은 결과 6개',
    metric: '파일명 + 본문',
    activeSection: 'search',
    chips: ['일정', '본문 위치', '내 PC 문서'],
    rows: [
      { icon: 'slideshow', title: '프로젝트상태_v4.0_260517.pptx', meta: '본문 · 다음 일정', state: 'PPT' },
      { icon: 'description', title: '주간보고_v4.0_260517.docx', meta: '본문 · 교육 일정', state: 'Word' },
      { icon: 'table_chart', title: '사업예산_v4.0_260517.xlsx', meta: '본문 · 일정 확인', state: 'Excel' },
    ],
  },
  {
    eyebrow: '변경 이력',
    title: '무엇이 바뀌었는지 빠르게 확인합니다',
    description: '비슷한 문서를 묶고 최신 파일과 이전 파일의 달라진 부분만 보여줍니다.',
    proof: 'PPT는 슬라이드, Excel은 셀 값을 중심으로 필요한 차이만 확인할 수 있습니다.',
    accent: '#5e6372',
    previewTitle: '프로젝트상태 수정본',
    previewSubtitle: '5개 파일 · 최신 v4.0',
    metric: '바뀐 내용',
    activeSection: 'history',
    chips: ['변경 내용 보기', 'PPT', 'Excel'],
    rows: [
      { icon: 'add_circle', title: 'v4.0 ← v3.0', meta: '슬라이드 1장 추가', state: '+1' },
      { icon: 'edit_note', title: 'v3.0 ← v2.0', meta: '리스크 문구 3곳 수정', state: '수정' },
      { icon: 'compare_arrows', title: 'v2.0 ← v1.1', meta: '셀 D7, E9 값 변경', state: '값' },
    ],
  },
  {
    eyebrow: '처음 사용',
    title: '예제로 먼저 둘러보세요',
    description: '임시 예제 문서로 검색과 변경 이력 흐름을 짧게 확인합니다.',
    proof: '예제는 튜토리얼이 끝나면 정리됩니다. 원본 문서는 읽기 전용으로만 확인합니다.',
    accent: '#32704b',
    previewTitle: '예제 둘러보기',
    previewSubtitle: '검색부터 셀 변경까지',
    metric: '짧은 연습',
    activeSection: 'setup',
    chips: ['예제 폴더', '일정 검색', '셀 변경'],
    rows: [
      { icon: 'folder_open', title: '1. 예제 폴더 추가', meta: '튜토리얼용 임시 폴더', state: '준비' },
      { icon: 'search', title: '2. “일정” 검색', meta: '입력 후 자동 검색', state: '검색' },
      { icon: 'grid_on', title: '3. Excel 셀 확인', meta: 'D7 셀에서 변경 이력 보기', state: '확인' },
    ],
  },
]

export default function OnboardingCarousel({
  open,
  replay = false,
  onStartExample,
  onStartOwnFolder,
}: OnboardingCarouselProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (open) setIndex(0)
  }, [open, replay])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]')) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        setIndex((i) => Math.min(i + 1, slides.length - 1))
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        setIndex((i) => Math.max(i - 1, 0))
      } else if (event.key === 'Home') {
        setIndex(0)
      } else if (event.key === 'End') {
        setIndex(slides.length - 1)
      } else if (event.key === 'Escape') {
        onStartOwnFolder()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onStartOwnFolder])

  if (!open) return null

  const slide = slides[index]
  const isLast = index === slides.length - 1
  const accentStyle = { '--ow-onboarding-accent': slide.accent } as CSSProperties

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[color-mix(in_srgb,var(--md-sys-color-background)_88%,#111827_12%)] p-4 text-[var(--md-sys-color-on-surface)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="officewhere-onboarding-title"
      onMouseDown={(event) => event.stopPropagation()}
      style={accentStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,color-mix(in_srgb,var(--ow-onboarding-accent)_8%,transparent),transparent_28rem)]" />
      <button
        type="button"
        aria-label="둘러보기 닫기"
        onClick={onStartOwnFolder}
        className="onboarding-close-btn absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-on-surface-variant)] shadow-elev-1 hover:bg-[var(--md-sys-color-surface-container-low)] hover:text-[var(--md-sys-color-on-surface)]"
      >
        <Icon name="close" size={18} />
      </button>
      <div className="console-panel relative w-full max-w-6xl overflow-hidden rounded-[1.25rem] bg-[var(--md-sys-color-surface-container-lowest)]">
        <div className="grid min-h-[660px] grid-cols-1 lg:grid-cols-[0.94fr_1.06fr]">
          <section className="relative flex flex-col justify-between gap-8 p-7 md:p-10 lg:p-12 lg:pr-10">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--ow-onboarding-accent),rgba(83,58,253,0.24),transparent)]" />

            <div className="space-y-8">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-1.5 text-[0.78rem] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--ow-onboarding-accent)]" />
                  {replay ? '둘러보기 다시 보기' : '처음 설정'}
                </div>
                <span className="tabular-nums rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                  {index + 1} / {slides.length}
                </span>
              </div>

              <div className="space-y-4">
                <p className="text-[0.74rem] font-semibold uppercase tracking-[0.18em] text-[var(--ow-onboarding-accent)]">
                  {slide.eyebrow}
                </p>
                <h1
                  id="officewhere-onboarding-title"
                  className="max-w-[31rem] text-[2.15rem] font-[540] leading-[1.08] tracking-[-0.04em] text-[var(--md-sys-color-on-surface)] [text-wrap:balance] [word-break:keep-all] md:text-[3.1rem]"
                >
                  {slide.title}
                </h1>
                <p className="max-w-[30rem] text-[0.98rem] leading-7 text-[var(--md-sys-color-on-surface-variant)] [word-break:keep-all] md:text-[1.03rem]">
                  {slide.description}
                </p>
              </div>

              <div className="surface-summary rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--ow-onboarding-accent)_12%,var(--md-sys-color-surface-container-lowest))] text-[var(--ow-onboarding-accent)]">
                    <Icon name="tips_and_updates" size={19} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">이렇게 쓸 수 있어요</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--md-sys-color-on-surface-variant)]">{slide.proof}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-center gap-2" aria-hidden="true">
                {slides.map((item, slideIndex) => (
                  <span
                    key={item.title}
                    className={`h-1.5 rounded-full transition-all ${
                      slideIndex === index
                        ? 'w-11 bg-[var(--ow-onboarding-accent)]'
                        : 'w-5 bg-[var(--md-sys-color-outline-variant)]'
                    }`}
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {!isLast ? (
                  <>
                    <Button size="lg" trailingIcon="arrow_forward" onClick={() => setIndex((value) => value + 1)}>
                      다음
                    </Button>
                    <Button size="lg" variant="outlined" leadingIcon="folder_open" onClick={onStartOwnFolder}>
                      내 폴더 추가하러 가기
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="lg" leadingIcon="play_circle" onClick={onStartExample}>
                      예제로 먼저 보기
                    </Button>
                    <Button size="lg" variant="outlined" leadingIcon="folder_open" onClick={onStartOwnFolder}>
                      내 폴더 추가하기
                    </Button>
                  </>
                )}
                {index > 0 && !isLast && (
                  <Button size="lg" variant="text" leadingIcon="arrow_back" onClick={() => setIndex((value) => value - 1)}>
                    이전
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-5 md:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,color-mix(in_srgb,var(--ow-onboarding-accent)_5%,transparent),transparent_42%)]" />
            <ProductPreview slide={slide} />
          </section>
        </div>
      </div>
    </div>
  )
}

function ProductPreview({ slide }: { slide: Slide }) {
  const navItems = [
    { id: 'search', label: '검색', icon: 'search' },
    { id: 'history', label: '변경 이력', icon: 'history' },
    { id: 'setup', label: '설정', icon: 'settings' },
  ] as const
  const activeIcon = slide.activeSection === 'history' ? 'timeline' : slide.activeSection === 'setup' ? 'folder_open' : 'search'

  return (
    <div className="relative flex h-full min-h-[32rem] items-center justify-center">
      <div className="console-panel w-full max-w-[35rem] rounded-[1.15rem] bg-[var(--md-sys-color-surface-container-lowest)] p-3">
        <div className="grid min-h-[29rem] grid-cols-[7.7rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]">
          <aside className="border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3">
            <div className="mb-4 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3">
              <p className="text-[0.7rem] font-semibold text-[var(--md-sys-color-on-surface-variant)]">작업 공간</p>
              <p className="mt-1 text-sm font-medium text-[var(--md-sys-color-on-surface)]">내 문서</p>
            </div>
            <div className="space-y-1.5">
              {navItems.map((item) => {
                const active = item.id === slide.activeSection
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[0.78rem] font-medium ${
                      active
                        ? 'bg-[color-mix(in_srgb,var(--ow-onboarding-accent)_14%,var(--md-sys-color-surface-container-lowest))] text-[var(--md-sys-color-on-surface)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--ow-onboarding-accent)_22%,transparent)_inset]'
                        : 'text-[var(--md-sys-color-on-surface-variant)]'
                    }`}
                  >
                    <Icon name={item.icon} size={15} />
                    <span>{item.label}</span>
                  </div>
                )
              })}
            </div>
          </aside>

          <div className="min-w-0 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--md-sys-color-on-surface-variant)]">미리 보기</p>
                <h2 className="mt-2 truncate text-2xl font-medium tracking-[-0.04em] text-[var(--md-sys-color-on-surface)]">{slide.previewTitle}</h2>
                <p className="mt-1 text-sm text-[var(--md-sys-color-on-surface-variant)]">{slide.previewSubtitle}</p>
              </div>
              <div className="shrink-0 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[color-mix(in_srgb,var(--ow-onboarding-accent)_10%,var(--md-sys-color-surface-container-lowest))] px-3 py-2 text-right">
                <p className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--md-sys-color-on-surface-variant)]">보기</p>
                <p className="mt-1 text-sm font-semibold text-[var(--md-sys-color-on-surface)]">{slide.metric}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2 text-[var(--md-sys-color-on-surface-variant)]">
                <Icon name={activeIcon} size={17} />
                <span className="truncate text-sm">{slide.previewTitle}</span>
              </div>

              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--md-sys-color-outline-variant)]">
                {slide.rows.map((row, rowIndex) => (
                  <div
                    key={`${row.title}-${rowIndex}`}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3.5 py-3 last:border-b-0"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--ow-onboarding-accent)_10%,var(--md-sys-color-surface-container-low))] text-[var(--ow-onboarding-accent)]">
                      <Icon name={row.icon} size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--md-sys-color-on-surface)]">{row.title}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--md-sys-color-on-surface-variant)]">{row.meta}</p>
                    </div>
                    <span className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-2 py-1 text-[0.72rem] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                      {row.state}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {slide.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-2.5 py-1 text-[0.76rem] font-medium text-[var(--md-sys-color-on-surface-variant)]"
                >
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 text-xs leading-5 text-[var(--md-sys-color-on-surface-variant)]">
              원본 문서는 그대로 두고, OfficeWhere 안에서 검색 정보와 변경 이력만 관리합니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
