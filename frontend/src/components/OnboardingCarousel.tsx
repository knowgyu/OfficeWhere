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
    eyebrow: 'Find',
    title: '흩어진 문서를 빠르게 찾습니다',
    description: '파일명과 본문을 함께 읽어 필요한 문서를 바로 찾습니다.',
    proof: '초성만 입력해도 본문 속 프로젝트 문서까지 이어집니다.',
    accent: '#4257b2',
    previewTitle: 'ㅍㄹㅈㅌ 초성 검색',
    previewSubtitle: 'A 프로젝트 본문 결과 8개',
    metric: '초성 + 본문',
    chips: ['초성 검색', '본문 미리보기', '로컬 색인'],
    rows: [
      { icon: 'description', title: '주간보고_v4.0_260517.docx', meta: '회의 액션아이템 · 본문 일치', state: 'Word' },
      { icon: 'slideshow', title: '프로젝트상태_v4.0_260517.pptx', meta: '릴리즈 후보 준비 · 슬라이드 2', state: 'PPT' },
      { icon: 'table_chart', title: '사업예산_v4.0_260517.xlsx', meta: 'Excel 표 안의 값까지 검색', state: 'Excel' },
    ],
  },
  {
    eyebrow: 'Compare',
    title: '버전 차이를 바로 봅니다',
    description: '비슷한 파일을 묶고 바뀐 부분만 먼저 보여줍니다.',
    proof: 'PPT 슬라이드와 Excel 값 변경을 증거 중심으로 확인합니다.',
    accent: '#6d5a86',
    previewTitle: '프로젝트상태 버전 묶음',
    previewSubtitle: '5개 파일 · 최신 v4.0',
    metric: '변경점 중심',
    chips: ['버전 진단', 'PPT 변경', '최신 지정'],
    rows: [
      { icon: 'task_alt', title: 'v4.0 → v3.0', meta: '주요 변경점 슬라이드 추가', state: '+3' },
      { icon: 'sync_alt', title: 'v3.0 → v2.0', meta: '위험 요소 문구 수정', state: '수정' },
      { icon: 'history', title: 'v2.0 → v1.1', meta: '일정 항목 2개 변경', state: '추적' },
    ],
  },
  {
    eyebrow: 'Try',
    title: '예제로 핵심만 둘러보세요',
    description: '강조된 곳을 따라가며 검색, 버전 차이, 셀 변경을 확인합니다.',
    proof: '원본 문서는 건드리지 않고 준비된 예제로 확인합니다.',
    accent: '#146c2e',
    previewTitle: '예제 둘러보기 경로',
    previewSubtitle: '6단계 안내 · 직접 클릭',
    metric: '3분 체험',
    chips: ['ㅍㄹㅈㅌ → 프로젝트', '문서 새로고침', '표로 보기'],
    rows: [
      { icon: 'folder_open', title: '예제 폴더 지정', meta: 'officewhere_test_library', state: '1' },
      { icon: 'search', title: 'ㅍㄹㅈㅌ 초성 검색', meta: '검색 결과를 확인하고 버전으로 이동', state: '2' },
      { icon: 'grid_on', title: 'Excel 표로 보기', meta: '셀 단위 변경점을 표에서 확인', state: '3' },
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

  if (!open) return null

  const slide = slides[index]
  const isLast = index === slides.length - 1
  const accentStyle = { '--ow-onboarding-accent': slide.accent } as CSSProperties

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[#050711] p-4 text-slate-950"
      role="dialog"
      aria-modal="true"
      aria-labelledby="officewhere-onboarding-title"
      onMouseDown={(event) => event.stopPropagation()}
      style={accentStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(83,58,253,0.24),transparent_24rem),radial-gradient(circle_at_86%_16%,rgba(20,108,46,0.18),transparent_24rem),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_35%)]" />
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
                <span className="rounded-md border border-[#e5edf5] bg-white/70 px-2.5 py-1 text-[0.72rem] font-medium text-[#64748d]">
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
                    <Icon name="auto_awesome" size={19} />
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
                  <Button size="lg" trailingIcon="arrow_forward" onClick={() => setIndex((value) => value + 1)}>
                    다음
                  </Button>
                ) : (
                  <>
                    <Button size="lg" leadingIcon="play_circle" className="attention-pulse" onClick={onStartExample}>
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

          <section className="relative overflow-hidden bg-[#0b1020] p-5 md:p-8 lg:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,color-mix(in_srgb,var(--ow-onboarding-accent)_36%,transparent),transparent_18rem),linear-gradient(160deg,rgba(255,255,255,0.08),transparent_42%)]" />
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
      <div className="onboarding-preview-lift w-full max-w-[34rem] rounded-[1.35rem] border border-white/10 bg-[#0f1424]/95 p-4 shadow-[0_28px_70px_rgba(0,0,0,0.36)]">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.72rem] font-medium text-slate-300">
            Local · Read-only
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/40">
                  Workspace Preview
                </p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-white">{slide.previewTitle}</h2>
                <p className="mt-1 text-sm text-slate-400">{slide.previewSubtitle}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[color-mix(in_srgb,var(--ow-onboarding-accent)_20%,transparent)] px-3 py-2 text-right">
                <p className="text-[0.68rem] uppercase tracking-[0.12em] text-white/50">Mode</p>
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
            <div className="onboarding-scan-line" />
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
          Guided step
        </div>
        <p className="mt-2 text-sm leading-5 text-white/[0.85]">빛나는 곳에서 결과를 확인하세요.</p>
      </div>
    </div>
  )
}
