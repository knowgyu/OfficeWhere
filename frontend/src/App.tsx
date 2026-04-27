import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'

import FileManager from './components/FileManager'
import JoinQuery from './components/JoinQuery'
import ConsistencyCheck from './components/ConsistencyCheck'
import FileSearch from './components/FileSearch'
import OnboardingCarousel from './components/OnboardingCarousel'
import { api } from './api/client'
import { Button, Icon, Spinner } from './ui'
import { useSnackbar } from './ui'
import { useLibraryRescan } from './contexts/LibraryRescanContext'
import { useDisplaySettings } from './contexts/DisplaySettingsContext'
import { TutorialStep } from './tutorial'

type Tab = 'search' | 'check' | 'join' | 'files'

interface TabDef {
  id: Tab
  label: string
  short: string
  icon: string
  iconFilled: string
  hint: string
}

const TABS: TabDef[] = [
  {
    id: 'search',
    label: '문서 검색',
    short: '검색',
    icon: 'search',
    iconFilled: 'search',
    hint: '등록한 폴더와 파일에서 파일명과 문서 내용을 함께 찾습니다',
  },
  {
    id: 'check',
    label: '버전 관리',
    short: '버전',
    icon: 'history',
    iconFilled: 'history',
    hint: '같은 문서의 여러 버전에서 무엇이 바뀌었는지 확인합니다',
  },
  {
    id: 'join',
    label: 'Excel 통합',
    short: '통합',
    icon: 'table_chart',
    iconFilled: 'table_chart',
    hint: '여러 Excel 표를 한 화면에서 비교·정리합니다',
  },
  {
    id: 'files',
    label: '설정 / 라이브러리',
    short: '설정',
    icon: 'settings',
    iconFilled: 'settings',
    hint: '문서 폴더, 화면 표시, 종료 방식을 설정합니다',
  },
]

const LS_TAB = 'officewhere:last-tab'
const LEGACY_LS_TAB = 'odj:last-tab'
const LS_ONBOARDING_DONE = 'officewhere:onboarding-complete:v1'
const LOGO_SRC = './officewhere-logo.png'

interface Point {
  x: number
  y: number
}

interface TourRect {
  left: number
  top: number
  width: number
  height: number
}

interface TourCopy {
  eyebrow: string
  title: string
  description: string
  icon: string
}

const TUTORIAL_TARGET_TAB: Record<TutorialStep, Tab | null> = {
  'example-folder': 'files',
  'document-refresh': 'files',
  search: 'search',
  'version-ppt': 'check',
  'version-excel': 'check',
  'excel-table': 'check',
  done: null,
}

const TUTORIAL_COPY: Record<TutorialStep, TourCopy> = {
  'example-folder': {
    eyebrow: 'Step 1 · 예제 시작',
    title: '예제 폴더를 대상에 추가하세요',
    description: '경로를 미리 입력해 두었습니다. 폴더 찾기는 그대로 두고, 강조된 대상 추가를 눌러주세요.',
    icon: 'drive_folder_upload',
  },
  'document-refresh': {
    eyebrow: 'Step 2 · 라이브러리 준비',
    title: '문서 새로고침을 실행하세요',
    description: '예제 문서를 색인합니다. 강조된 문서 새로고침 버튼을 눌러 새 문서와 변경점을 확인해 주세요.',
    icon: 'sync',
  },
  search: {
    eyebrow: 'Step 3 · 검색 체험',
    title: '예제 키워드를 검색하세요',
    description: '검색어가 미리 입력되어 있습니다. 검색을 눌러 A 프로젝트 문서가 어떻게 찾아지는지 확인해 보세요.',
    icon: 'search',
  },
  'version-ppt': {
    eyebrow: 'Step 4 · 발표자료 비교',
    title: 'PPT 변경점을 열어보세요',
    description: '프로젝트상태 PowerPoint 비교 대상이 준비됩니다. 강조된 버전 진단 열기를 눌러보세요.',
    icon: 'timeline',
  },
  'version-excel': {
    eyebrow: 'Step 5 · 스프레드시트 비교',
    title: 'Excel 변경점을 열어보세요',
    description: '사업예산 Excel 비교 대상으로 이동합니다. 강조된 버전 진단 열기를 눌러 값 변경을 확인해 주세요.',
    icon: 'difference',
  },
  'excel-table': {
    eyebrow: 'Step 6 · 셀 단위 확인',
    title: '표로 보기를 확인하세요',
    description: '강조된 표로 보기를 눌러 추가·삭제·수정된 셀을 한 번에 살펴보세요.',
    icon: 'table_chart',
  },
  done: {
    eyebrow: '완료',
    title: '예제로 둘러보기를 마쳤습니다',
    description: '이제 검색, 버전 관리, Excel 통합을 자유롭게 사용해도 됩니다.',
    icon: 'task_alt',
  },
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const getViewport = () => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
})

const getInitialPointer = (): Point => {
  const viewport = getViewport()
  return {
    x: Math.max(96, viewport.width - 360),
    y: Math.max(96, viewport.height - 180),
  }
}

function getTutorialTargetTab(step: TutorialStep | null): Tab | null {
  return step ? TUTORIAL_TARGET_TAB[step] : null
}

function getTutorialCopy(step: TutorialStep | null, activeTab: Tab): TourCopy | null {
  if (!step) return null

  const targetTab = getTutorialTargetTab(step)
  if (targetTab && targetTab !== activeTab) {
    const tab = TABS.find((item) => item.id === targetTab)
    return {
      eyebrow: '다음 위치',
      title: `${tab?.short ?? tab?.label ?? '다음'} 탭으로 이동하세요`,
      description: `자동으로 이동하지 않습니다. 왼쪽의 ${tab?.label ?? '다음 탭'}을 직접 눌러 이어가세요.`,
      icon: 'touch_app',
    }
  }

  return TUTORIAL_COPY[step]
}

export default function App() {
  const snackbar = useSnackbar()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'search'
    const stored = (
      window.localStorage.getItem(LS_TAB) ?? window.localStorage.getItem(LEGACY_LS_TAB)
    ) as Tab | null
    return stored && TABS.some((tab) => tab.id === stored) ? stored : 'search'
  })
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LS_ONBOARDING_DONE) !== 'true'
  })
  const [onboardingReplay, setOnboardingReplay] = useState(false)
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null)
  const [exampleLibraryPath, setExampleLibraryPath] = useState('')
  const { textSize, increaseTextSize, decreaseTextSize, resetTextSize } = useDisplaySettings()

  useEffect(() => {
    window.localStorage.setItem(LS_TAB, activeTab)
  }, [activeTab])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key
      if (!['+', '=', '-', '_', '0'].includes(key)) return
      event.preventDefault()
      if (key === '0') {
        resetTextSize()
      } else if (key === '-' || key === '_') {
        decreaseTextSize()
      } else {
        increaseTextSize()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [decreaseTextSize, increaseTextSize, resetTextSize])

  const handleGlobalWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    if (event.deltaY < 0) increaseTextSize()
    else decreaseTextSize()
  }

  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const tutorialTargetTab = getTutorialTargetTab(tutorialStep)

  const completeOnboarding = () => {
    window.localStorage.setItem(LS_ONBOARDING_DONE, 'true')
    setOnboardingOpen(false)
    setOnboardingReplay(false)
  }

  const handleStartOwnFolder = () => {
    completeOnboarding()
    setTutorialStep(null)
    setActiveTab('files')
  }

  const handleReplayOnboarding = () => {
    setOnboardingReplay(true)
    setOnboardingOpen(true)
  }

  const handleStartExample = async () => {
    try {
      const response = await api.app.getExampleLibraryPath()
      if (response.data.available && response.data.path) {
        setExampleLibraryPath(response.data.path)
        completeOnboarding()
        setActiveTab('files')
        setTutorialStep('example-folder')
      } else {
        setExampleLibraryPath('')
        snackbar.warn(response.data.reason || '예제 라이브러리 경로를 찾지 못했습니다.')
      }
    } catch (error) {
      setExampleLibraryPath('')
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '예제 라이브러리 경로를 확인하지 못했습니다.'
      snackbar.warn(detail)
    }
  }

  const handleTutorialStep = (next: TutorialStep | null) => {
    setTutorialStep(next)
  }

  useEffect(() => {
    if (!tutorialStep) return undefined

    const handleTutorialKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setTutorialStep(null)
    }

    window.addEventListener('keydown', handleTutorialKeyDown)
    return () => window.removeEventListener('keydown', handleTutorialKeyDown)
  }, [tutorialStep])

  return (
    <div
      className={`app-text-${textSize} flex flex-1 min-h-screen bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-surface)]`}
      onWheel={handleGlobalWheel}
    >
      <NavigationRail
        activeTab={activeTab}
        onChange={setActiveTab}
        tutorialActive={Boolean(tutorialStep && tutorialStep !== 'done')}
        tutorialTargetTab={tutorialTargetTab}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopAppBar title={current.label} hint={current.hint} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1420px] px-5 md:px-7 pt-6 pb-16 animate-fade-in" key={activeTab}>
            {activeTab === 'files' && (
              <FileManager
                tutorialStep={tutorialStep}
                exampleLibraryPath={exampleLibraryPath}
                onTutorialStep={handleTutorialStep}
                onReplayOnboarding={handleReplayOnboarding}
              />
            )}
            {activeTab === 'search' && (
              <FileSearch
                tutorialActive={tutorialStep === 'search'}
                onTutorialSearchComplete={() => handleTutorialStep('version-ppt')}
              />
            )}
            {activeTab === 'join' && <JoinQuery />}
            {activeTab === 'check' && (
              <ConsistencyCheck
                tutorialStep={tutorialStep}
                onTutorialStep={handleTutorialStep}
              />
            )}
          </div>
        </main>
      </div>
      <GlobalRescanProgress />
      {tutorialStep && tutorialStep !== 'done' && (
        <div className="tour-soft-scrim fixed inset-0 z-[64] pointer-events-none" />
      )}
      <GuidedTourHud
        step={tutorialStep}
        activeTab={activeTab}
        targetTab={tutorialTargetTab}
        onFinish={() => handleTutorialStep(null)}
      />
      <OnboardingCarousel
        open={onboardingOpen}
        replay={onboardingReplay}
        onStartExample={handleStartExample}
        onStartOwnFolder={handleStartOwnFolder}
      />
    </div>
  )
}

function GlobalRescanProgress() {
  const { status, running, cancelling, cancelRescan } = useLibraryRescan()
  if (!status || (!running && status.stage !== 'cancelling')) return null

  const percent = Math.min(Math.max(status.percent || 0, status.total > 0 ? 4 : 0), 100)
  const progressText =
    status.total > 0
      ? `처리 ${status.processed}/${status.total} · ${Math.round(status.percent)}%`
      : status.folders_total > 0
        ? `폴더 ${status.folders_processed}/${status.folders_total} · 발견 ${status.found}개`
        : '진행률 계산 중'

  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center pointer-events-none px-4">
      <div className="pointer-events-auto w-full max-w-xl rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] shadow-elev-3 p-4 animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-[var(--md-sys-color-primary)]">
            <Spinner size={22} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
              {cancelling ? '문서 새로고침 정지 중' : '문서 새로고침 중'}
            </p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {status.message || '대상 폴더 상태를 확인하는 중입니다.'}
            </p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {progressText}
              {status.current_file ? ` · 현재 ${status.current_file}` : ''}
            </p>
          </div>
          <Button
            variant="outlined"
            size="sm"
            leadingIcon="stop_circle"
            onClick={() => void cancelRescan()}
            disabled={cancelling}
          >
            정지
          </Button>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--md-sys-color-surface-container-high)]">
          <div
            className="h-full rounded-full bg-[var(--md-sys-color-primary)] transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function GuidedTourHud({
  step,
  activeTab,
  targetTab,
  onFinish,
}: {
  step: TutorialStep | null
  activeTab: Tab
  targetTab: Tab | null
  onFinish: () => void
}) {
  const [pointer, setPointer] = useState<Point>(getInitialPointer)
  const [viewport, setViewport] = useState(getViewport)
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const scrolledKeyRef = useRef('')

  const content = useMemo(() => getTutorialCopy(step, activeTab), [activeTab, step])

  useEffect(() => {
    if (!step) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      setPointer({ x: event.clientX, y: event.clientY })
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [step])

  useEffect(() => {
    if (!step) {
      setTargetRect(null)
      scrolledKeyRef.current = ''
      return undefined
    }

    let frame = 0
    let settleRead = 0
    const readTarget = (shouldScroll: boolean) => {
      if (step === 'done') {
        setTargetRect(null)
        return
      }

      const target = document.querySelector<HTMLElement>('.tour-target')
      if (!target) {
        setTargetRect(null)
        return
      }

      const rect = target.getBoundingClientRect()
      setTargetRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })

      const key = `${step}:${activeTab}:${target.textContent?.trim() ?? target.tagName}`
      if (shouldScroll && activeTab === targetTab && scrolledKeyRef.current !== key) {
        scrolledKeyRef.current = key
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
        window.clearTimeout(settleRead)
        settleRead = window.setTimeout(() => {
          const nextRect = target.getBoundingClientRect()
          setTargetRect({
            left: nextRect.left,
            top: nextRect.top,
            width: nextRect.width,
            height: nextRect.height,
          })
        }, 420)
      }
    }

    const scheduleRead = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => readTarget(false))
    }
    const handleResize = () => {
      setViewport(getViewport())
      scheduleRead()
    }

    const firstRead = window.setTimeout(() => readTarget(activeTab === targetTab), 80)
    const retryRead = window.setInterval(() => readTarget(activeTab === targetTab), 360)
    window.addEventListener('scroll', scheduleRead, true)
    window.addEventListener('resize', handleResize)

    return () => {
      window.clearTimeout(firstRead)
      window.clearTimeout(settleRead)
      window.clearInterval(retryRead)
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleRead, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [activeTab, step, targetTab])

  if (!step || !content) return null

  const bubbleWidth = Math.min(352, Math.max(280, viewport.width - 32))
  const bubbleHeight = step === 'done' ? 132 : 178
  const targetCenter = targetRect
    ? {
        x: targetRect.left + targetRect.width / 2,
        y: targetRect.top + targetRect.height / 2,
      }
    : null
  const bubbleLeft = clamp(
    targetCenter && pointer.x < targetCenter.x ? pointer.x - bubbleWidth - 26 : pointer.x + 26,
    16,
    Math.max(16, viewport.width - bubbleWidth - 16),
  )
  const bubbleTop = clamp(
    pointer.y > viewport.height - bubbleHeight - 44 ? pointer.y - bubbleHeight - 24 : pointer.y + 22,
    16,
    Math.max(16, viewport.height - bubbleHeight - 16),
  )
  const curve = targetCenter
    ? {
        startX: pointer.x,
        startY: pointer.y,
        c1X: pointer.x + (targetCenter.x - pointer.x) * 0.36,
        c1Y: pointer.y,
        c2X: pointer.x + (targetCenter.x - pointer.x) * 0.74,
        c2Y: targetCenter.y,
        endX: targetCenter.x,
        endY: targetCenter.y,
      }
    : null

  return (
    <div className="fixed inset-0 z-[66] pointer-events-none">
      {curve && (
        <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <marker
              id="tour-arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="8.5"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="tour-hud-arrowhead" />
            </marker>
          </defs>
          <path
            d={`M ${curve.startX} ${curve.startY} C ${curve.c1X} ${curve.c1Y}, ${curve.c2X} ${curve.c2Y}, ${curve.endX} ${curve.endY}`}
            className="tour-hud-line"
            markerEnd="url(#tour-arrowhead)"
          />
          <circle cx={curve.endX} cy={curve.endY} r="7" className="tour-hud-target-core" />
          <circle cx={curve.endX} cy={curve.endY} r="18" className="tour-hud-target-halo" />
        </svg>
      )}
      <div
        className="tour-hud-bubble pointer-events-auto"
        style={{ left: bubbleLeft, top: bubbleTop, width: bubbleWidth }}
      >
        <div className="flex items-start gap-3">
          <div className="tour-hud-icon">
            <Icon name={content.icon} size={22} filled={step === 'done'} />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="tour-hud-eyebrow">{content.eyebrow}</p>
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{content.title}</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{content.description}</p>
            <div className="flex items-center justify-between gap-3 pt-2">
              <span className="tour-hud-kbd">
                <kbd>Esc</kbd>
                <span>그만보기</span>
              </span>
              <Button size="sm" variant="text" leadingIcon="close" onClick={onFinish}>
                그만보기
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NavigationRail({
  activeTab,
  onChange,
  tutorialActive = false,
  tutorialTargetTab = null,
}: {
  activeTab: Tab
  onChange: (tab: Tab) => void
  tutorialActive?: boolean
  tutorialTargetTab?: Tab | null
}) {
  return (
    <aside className="sticky top-0 self-start flex flex-col items-center gap-2 w-24 min-h-screen py-4 bg-[var(--md-sys-color-surface-container-lowest)]/82 backdrop-blur-xl border-r border-[var(--md-sys-color-outline-variant)] shadow-[1px_0_0_rgba(255,255,255,0.7)_inset]">
      <div className="flex items-center justify-center py-3">
        <img
          src={LOGO_SRC}
          alt="OfficeWhere"
          className="h-10 w-10 rounded-lg object-cover shadow-elev-2 ring-1 ring-[var(--md-sys-color-outline-variant)]"
        />
      </div>

      <nav className="flex flex-col gap-1.5 mt-2 w-full px-2" aria-label="메인 내비게이션">
        {TABS.map((tab) => {
          const active = tab.id === activeTab
          const highlight = tutorialActive && tutorialTargetTab === tab.id && !active
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`state-host relative flex flex-col items-center gap-1.5 py-2.5 rounded-lg group transition-colors ${
                active ? 'text-[var(--md-sys-color-primary)]' : 'text-[var(--md-sys-color-on-surface-variant)]'
              } ${highlight ? 'attention-pulse tour-target' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="state-layer" />
              <span
                className={`relative inline-flex items-center justify-center h-9 w-14 rounded-full transition-all ${
                  active
                    ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)] shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]'
                    : 'text-[var(--md-sys-color-on-surface-variant)]'
                }`}
              >
                <Icon name={active ? tab.iconFilled : tab.icon} size={22} filled={active} />
              </span>
              <span
                className={`type-label-md text-center leading-tight ${
                  active
                    ? 'text-[var(--md-sys-color-on-surface)]'
                    : 'text-[var(--md-sys-color-on-surface-variant)]'
                }`}
              >
                {tab.short}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

function TopAppBar({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="sticky top-0 z-20 bg-[var(--md-sys-color-background)]/78 backdrop-blur-xl supports-[backdrop-filter]:bg-[var(--md-sys-color-background)]/68 border-b border-[var(--md-sys-color-outline-variant)]">
      <div className="mx-auto w-full max-w-[1420px] px-5 md:px-7 h-[4.25rem] flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="type-label-md text-[var(--md-sys-color-primary)] uppercase tracking-[0.14em]">
            OfficeWhere
          </p>
          <h1 className="type-title-lg text-[var(--md-sys-color-on-surface)] truncate -tracking-[0.01em]">
            {title}
          </h1>
        </div>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] hidden md:block max-w-2xl text-right">
          {hint}
        </p>
      </div>
    </header>
  )
}
