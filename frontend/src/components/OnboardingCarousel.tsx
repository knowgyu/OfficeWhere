import { useEffect, useState } from 'react'

import { Button, Icon } from '../ui'

interface OnboardingCarouselProps {
  open: boolean
  replay?: boolean
  onStartExample: () => void
  onStartOwnFolder: () => void
}

const slides = [
  {
    eyebrow: 'Find',
    title: '흩어진 문서가 한곳으로 모입니다',
    description:
      'Word, PowerPoint, Excel, 텍스트 문서가 어디에 있든 파일명과 본문을 함께 찾아 업무 흐름을 끊지 않습니다.',
    accent: 'from-[#4257b2] to-[#8f7df0]',
    illustration: 'search',
  },
  {
    eyebrow: 'Compare',
    title: '버전 차이를 부드럽게 따라갑니다',
    description:
      'v1, v2, 날짜가 붙은 문서를 묶고 무엇이 바뀌었는지 Word·PPT·Excel에 맞게 보여줍니다.',
    accent: 'from-[#6d5a86] to-[#4257b2]',
    illustration: 'version',
  },
  {
    eyebrow: 'Try',
    title: 'A 프로젝트 예제로 먼저 감을 잡아보세요',
    description:
      '문서 새로고침, 검색, 버전 진단, Excel 표로 보기까지 준비된 예제로 짧게 둘러볼 수 있습니다.',
    accent: 'from-[#146c2e] to-[#4257b2]',
    illustration: 'example',
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

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(66,87,178,0.24),transparent_28rem),linear-gradient(135deg,rgba(246,247,251,0.92),rgba(227,232,255,0.9))] p-4 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="officewhere-onboarding-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="relative w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/82 shadow-[0_40px_120px_rgba(15,23,42,0.2)] backdrop-blur-xl">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_85%_10%,rgba(255,255,255,0.9),transparent_18rem),radial-gradient(circle_at_5%_80%,rgba(238,231,255,0.9),transparent_22rem)]" />
        <div className="relative grid min-h-[680px] grid-cols-1 lg:grid-cols-[1fr_0.95fr]">
          <section className="flex flex-col justify-between gap-8 p-8 md:p-12">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-white/70 px-3 py-1.5 type-label-md text-[var(--md-sys-color-on-surface-variant)] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset]">
                <Icon name="auto_awesome" size={16} className="text-[var(--md-sys-color-primary)]" />
                {replay ? '처음 둘러보기 다시 보기' : 'OfficeWhere 시작하기'}
              </div>

              <div className="space-y-5">
                <p className="type-label-md uppercase tracking-[0.18em] text-[var(--md-sys-color-primary)]">
                  {slide.eyebrow}
                </p>
                <h1
                  id="officewhere-onboarding-title"
                  className="max-w-2xl text-[2.7rem] font-semibold leading-[1.05] tracking-[-0.045em] text-[var(--md-sys-color-on-surface)] md:text-[4.25rem]"
                >
                  {slide.title}
                </h1>
                <p className="max-w-xl type-body-lg text-[var(--md-sys-color-on-surface-variant)] md:text-[1.1rem] md:leading-7">
                  {slide.description}
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-2">
                {slides.map((item, slideIndex) => (
                  <span
                    key={item.title}
                    className={`h-2.5 rounded-full transition-all ${
                      slideIndex === index
                        ? 'w-10 bg-[var(--md-sys-color-primary)]'
                        : 'w-2.5 bg-[var(--md-sys-color-outline-variant)]'
                    }`}
                    aria-hidden="true"
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
                {index > 0 && (
                  <Button size="lg" variant="text" leadingIcon="arrow_back" onClick={() => setIndex((value) => value - 1)}>
                    이전
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className={`relative min-h-[26rem] overflow-hidden bg-gradient-to-br ${slide.accent}`}>
            <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.45),transparent_10rem),radial-gradient(circle_at_75%_70%,rgba(255,255,255,0.24),transparent_14rem)]" />
            <div className="absolute inset-x-10 top-10 flex items-center justify-between text-white/75">
              <span className="type-label-md tracking-[0.16em]">OFFICEWHERE</span>
              <span className="rounded-full border border-white/30 px-3 py-1 type-label-sm">
                {index + 1} / {slides.length}
              </span>
            </div>
            <OnboardingIllustration kind={slide.illustration} />
          </section>
        </div>
      </div>
    </div>
  )
}

function OnboardingIllustration({ kind }: { kind: string }) {
  const isSearch = kind === 'search'
  const isVersion = kind === 'version'
  return (
    <svg
      className="absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 520 680"
      role="img"
      aria-label="OfficeWhere 안내 일러스트"
    >
      <defs>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#0f172a" floodOpacity="0.2" />
        </filter>
      </defs>
      <g className="onboarding-float" filter="url(#softShadow)">
        <rect x="84" y="158" width="352" height="360" rx="34" fill="rgba(255,255,255,0.9)" />
        <rect x="116" y="205" width="176" height="18" rx="9" fill="#4257b2" opacity="0.28" />
        <rect x="116" y="246" width="278" height="14" rx="7" fill="#111827" opacity="0.12" />
        <rect x="116" y="276" width="228" height="14" rx="7" fill="#111827" opacity="0.1" />
        <rect x="116" y="338" width="288" height="86" rx="18" fill="#e3e8ff" />
        <rect x="142" y="365" width="92" height="12" rx="6" fill="#4257b2" opacity="0.48" />
        <rect x="142" y="392" width="196" height="12" rx="6" fill="#4257b2" opacity="0.2" />
      </g>

      {isSearch && (
        <g className="onboarding-drift" filter="url(#softShadow)">
          <rect x="48" y="390" width="126" height="156" rx="20" fill="white" opacity="0.94" />
          <rect x="70" y="426" width="62" height="12" rx="6" fill="#146c2e" opacity="0.32" />
          <rect x="70" y="455" width="82" height="10" rx="5" fill="#0f172a" opacity="0.12" />
          <circle cx="362" cy="238" r="58" fill="none" stroke="white" strokeWidth="18" opacity="0.9" />
          <path d="M402 278 L456 332" stroke="white" strokeWidth="18" strokeLinecap="round" opacity="0.9" />
        </g>
      )}

      {isVersion && (
        <g className="onboarding-drift" filter="url(#softShadow)">
          <rect x="54" y="426" width="190" height="112" rx="22" fill="white" opacity="0.94" />
          <rect x="82" y="458" width="46" height="46" rx="12" fill="#c2f0c5" />
          <rect x="144" y="462" width="72" height="10" rx="5" fill="#146c2e" opacity="0.32" />
          <rect x="144" y="488" width="56" height="10" rx="5" fill="#ba1a1a" opacity="0.28" />
          <path d="M330 514 C374 476 400 430 406 376" fill="none" stroke="white" strokeWidth="8" strokeLinecap="round" strokeDasharray="10 14" />
        </g>
      )}

      {!isSearch && !isVersion && (
        <g className="onboarding-drift" filter="url(#softShadow)">
          <rect x="68" y="430" width="386" height="92" rx="28" fill="white" opacity="0.94" />
          <circle cx="118" cy="476" r="24" fill="#e3e8ff" />
          <path d="M108 476 h20 M118 466 v20" stroke="#4257b2" strokeWidth="6" strokeLinecap="round" />
          <rect x="162" y="455" width="138" height="14" rx="7" fill="#4257b2" opacity="0.32" />
          <rect x="162" y="484" width="222" height="12" rx="6" fill="#0f172a" opacity="0.11" />
        </g>
      )}
    </svg>
  )
}
