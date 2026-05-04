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
}

const slides: Slide[] = [
  {
    eyebrow: '문서 찾기',
    title: '흩어진 문서를 빠르게 찾습니다',
    description: '파일명과 문서 내용을 함께 살펴 필요한 문서를 바로 찾습니다.',
    proof: '일정처럼 익숙한 단어를 입력하면 파일명과 문서 내용 속 결과까지 이어집니다.',
    accent: '#4257b2',
    previewTitle: '일정 검색',
    previewSubtitle: '본문 결과 6개',
    metric: '파일명 + 내용',
    chips: ['일정 검색', '본문 위치', '내 PC에서 확인'],
    rows: [
      { icon: 'slideshow', title: '프로젝트상태_v4.0_260517.pptx', meta: '본문 일치 · 다음 일정', state: 'PPT' },
      { icon: 'description', title: '주간보고_v4.0_260517.docx', meta: '본문 일치 · 교육 일정', state: 'Word' },
      { icon: 'table_chart', title: '사업예산_v4.0_260517.xlsx', meta: '본문 일치 · 일정 확인', state: 'Excel' },
    ],
  },
  {
    eyebrow: '변경 확인',
    title: '변경 이력을 바로 봅니다',
    description: '비슷한 파일을 묶고 바뀐 부분만 먼저 보여줍니다.',
    proof: 'PPT 슬라이드와 Excel 값 변경을 증거 중심으로 확인합니다.',
    accent: '#6d5a86',
    previewTitle: '프로젝트상태 수정본 묶음',
    previewSubtitle: '5개 파일 · 최신 v4.0',
    metric: '변경점 중심',
    chips: ['변경점 보기', 'PPT 변경', '최신 지정'],
    rows: [
      { icon: 'add_circle', title: 'v4.0 ← v3.0', meta: '슬라이드 1장 추가', state: '+1' },
      { icon: 'edit_note', title: 'v3.0 ← v2.0', meta: '"리스크" 문구 3곳 수정', state: '수정' },
      { icon: 'compare_arrows', title: 'v2.0 ← v1.1', meta: '셀 D7, E9 값 변경', state: '값' },
    ],
  },
  {
    eyebrow: '첫 실행',
    title: '예제로 핵심만 둘러보세요',
    description: '강조된 곳을 따라가며 검색, 변경 이력, 셀 변경을 확인합니다.',
    proof: '튜토리얼 동안만 임시 예제를 만들고, 끝나면 정리합니다.',
    accent: '#146c2e',
    previewTitle: '예제 둘러보기 경로',
    previewSubtitle: '핵심 흐름 안내 · 직접 클릭',
    metric: '짧은 체험',
    chips: ['일정 검색', '문서 새로고침', '표로 보기'],
    rows: [
      { icon: 'folder_open', title: '1. 임시 예제 폴더 추가', meta: '튜토리얼 완료 후 자동 정리', state: '준비' },
      { icon: 'search', title: '2. "일정"으로 검색', meta: '입력 후 자동 검색', state: '검색' },
      { icon: 'grid_on', title: '3. Excel 표에서 셀 차이 확인', meta: 'D7 셀 클릭 시 이력 펼침', state: '비교' },
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
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[#111827] p-4 text-slate-950"
      role="dialog"
      aria-modal="true"
      aria-labelledby="officewhere-onboarding-title"
      onMouseDown={(event) => event.stopPropagation()}
      style={accentStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_42%),linear-gradient(120deg,rgba(66,87,178,0.14),transparent_34rem)]" />
      <button
        type="button"
        aria-label="둘러보기 닫기"
        onClick={onStartOwnFolder}
        className="onboarding-close-btn absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.06] text-white/80 backdrop-blur-md hover:bg-white/[0.12] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
      >
        <Icon name="close" size={18} />
      </button>
      <div className="relative w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/[0.12] bg-[#f7f8ff] shadow-[0_34px_90px_rgba(0,0,0,0.42)]">
        <div className="grid min-h-[660px] grid-cols-1 lg:grid-cols-[0.92fr_1.08fr]">
          <section className="relative flex flex-col justify-between gap-8 p-7 md:p-10 lg:p-12 lg:pr-10">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--ow-onboarding-accent),rgba(83,58,253,0.28),transparent)]" />

            <div className="space-y-8">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-md border border-[#dfe5f1] bg-white px-3 py-1.5 text-[0.78rem] font-medium text-[#42526b] shadow-[0_8px_22px_rgba(50,50,93,0.08)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--ow-onboarding-accent)]" />
                  {replay ? '처음 둘러보기 다시 보기' : 'OfficeWhere 시작하기'}
                </div>
                <span
                  className="tabular-nums rounded-md border border-[#e5edf5] bg-white/70 px-2.5 py-1 text-[0.72rem] font-medium text-[#64748d]"
                >
                  {index + 1} / {slides.length}
                </span>
              </div>

              <div className="space-y-4">
                <p className="text-[0.74rem] font-semibold uppercase tracking-[0.18em] text-[var(--ow-onboarding-accent)]">
                  {slide.eyebrow}
                </p>
                <h1
                  id="officewhere-onboarding-title"
                  className="max-w-[31rem] text-[2.2rem] font-[520] leading-[1.06] tracking-[-0.045em] text-[#061b31] [text-wrap:balance] [word-break:keep-all] md:text-[3.35rem]"
                >
                  {slide.title}
                </h1>
                <p className="max-w-[30rem] text-[0.98rem] leading-7 text-[#64748d] [word-break:keep-all] md:text-[1.03rem]">
                  {slide.description}
                </p>
              </div>

              <div className="rounded-xl border border-[#e5edf5] bg-white p-4 shadow-[rgba(50,50,93,0.12)_0px_18px_42px_-24px,rgba(0,0,0,0.08)_0px_10px_24px_-18px]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f3f6ff] text-[var(--ow-onboarding-accent)]">
                    <Icon name="help" size={19} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#273951]">왜 필요한가요?</p>
                    <p className="mt-1 text-sm leading-6 text-[#64748d]">{slide.proof}</p>
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
                      slideIndex === index ? 'w-11 bg-[var(--ow-onboarding-accent)]' : 'w-5 bg-[#d7deea]'
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
                      내 폴더로 바로 시작
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="lg" leadingIcon="play_circle" onClick={onStartExample}>
                      예제로 둘러보기
                    </Button>
                    <Button size="lg" variant="outlined" leadingIcon="folder_open" onClick={onStartOwnFolder}>
                      내 폴더로 시작하기
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

          <section className="relative overflow-hidden bg-[#0f172a] p-5 md:p-8 lg:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.08),transparent_42%)]" />
            <ProductPreview slide={slide} />
          </section>
        </div>
      </div>
    </div>
  )
}

function ProductPreview({ slide }: { slide: Slide }) {
  return (
    <div className="relative flex h-full min-h-[32rem] items-center justify-center">
      <div className="w-full max-w-[34rem] rounded-[1.35rem] border border-white/10 bg-[#0f1424]/95 p-4 shadow-[0_28px_70px_rgba(0,0,0,0.36)]">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2 text-[0.76rem] font-semibold text-white/75">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.06]">
              <Icon name="folder_open" size={16} />
            </span>
            <span>OfficeWhere 문서 콘솔</span>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.72rem] font-medium text-slate-300">
            내 PC · 원본 보존
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/40">
                  문서 미리보기
                </p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-white">{slide.previewTitle}</h2>
                <p className="mt-1 text-sm text-slate-400">{slide.previewSubtitle}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[color-mix(in_srgb,var(--ow-onboarding-accent)_20%,transparent)] px-3 py-2 text-right">
                <p className="text-[0.68rem] uppercase tracking-[0.12em] text-white/50">보기</p>
                <p className="mt-1 text-sm font-semibold text-white">{slide.metric}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {slide.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-white/10 bg-white/[0.045] px-2.5 py-1 text-[0.76rem] font-medium text-slate-300"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#090d18]">
            {slide.rows.map((row, rowIndex) => (
              <div
                key={`${row.title}-${rowIndex}`}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.08] px-4 py-3.5 last:border-b-0"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.055] text-[var(--ow-onboarding-accent)]">
                  <Icon name={row.icon} size={19} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{row.title}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{row.meta}</p>
                </div>
                <span className="rounded-md border border-white/10 bg-white/[0.045] px-2 py-1 text-[0.72rem] font-medium text-slate-300">
                  {row.state}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute -right-3 bottom-8 hidden w-44 rounded-2xl border border-white/10 bg-white/[0.08] p-3 text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] backdrop-blur-xl md:block">
        <div className="flex items-center gap-2 text-[0.72rem] font-medium text-white/60">
          <span className="h-2 w-2 rounded-full bg-[var(--ow-onboarding-accent)]" />
          안내
        </div>
        <p className="mt-2 text-sm leading-5 text-white/[0.85]">강조된 곳에서 결과를 확인하세요.</p>
      </div>
    </div>
  )
}
