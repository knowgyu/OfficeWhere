import { useEffect, useState, type WheelEvent } from 'react'

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
    if (next === 'search') setActiveTab('search')
    if (next === 'version-ppt' || next === 'version-excel' || next === 'excel-table') {
      setActiveTab('check')
    }
  }

  return (
    <div
      className={`app-text-${textSize} flex flex-1 min-h-screen bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-surface)]`}
      onWheel={handleGlobalWheel}
    >
      <NavigationRail activeTab={activeTab} onChange={setActiveTab} />

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
        <div className="fixed inset-0 z-[64] pointer-events-none bg-slate-950/10 backdrop-blur-[1px]" />
      )}
      <GuidedTourPanel step={tutorialStep} onFinish={() => handleTutorialStep(null)} />
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

function GuidedTourPanel({
  step,
  onFinish,
}: {
  step: TutorialStep | null
  onFinish: () => void
}) {
  if (!step) return null

  const content: Record<TutorialStep, { title: string; description: string; action?: string }> = {
    'example-folder': {
      title: '1. 예제 폴더를 대상에 추가하세요',
      description: 'A 프로젝트 예제 폴더가 입력되어 있습니다. 강조된 대상 추가 버튼을 눌러 라이브러리에 넣어주세요.',
    },
    'document-refresh': {
      title: '2. 문서 새로고침을 실행하세요',
      description: '대상 폴더의 새 문서와 변경된 문서를 확인합니다. 강조된 문서 새로고침 버튼을 눌러주세요.',
    },
    search: {
      title: '3. 예제 키워드를 검색하세요',
      description: '검색어가 미리 입력되어 있습니다. 검색 버튼을 눌러 문서 안의 A 프로젝트 결과를 확인하세요.',
    },
    'version-ppt': {
      title: '4. PPT 버전 진단을 열어보세요',
      description: '프로젝트상태 PowerPoint 묶음이 준비됩니다. 강조된 버전 진단 열기를 눌러 변경 내용을 확인하세요.',
    },
    'version-excel': {
      title: '5. Excel 버전 진단을 열어보세요',
      description: '사업예산 Excel 묶음으로 이동합니다. 다시 버전 진단 열기를 눌러 값 변경을 확인하세요.',
    },
    'excel-table': {
      title: '6. Excel 표로 보기를 확인하세요',
      description: '변경점이 표 위에 표시됩니다. 강조된 표로 보기 버튼을 눌러 셀 단위 변경을 확인하세요.',
    },
    done: {
      title: '예제로 둘러보기를 마쳤습니다',
      description: '이제 검색, 버전 관리, Excel 통합을 자유롭게 사용해도 됩니다.',
      action: '둘러보기 끝내기',
    },
  }

  const current = content[step]

  return (
    <div className="fixed inset-x-0 bottom-6 z-[66] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto max-w-2xl rounded-2xl border border-white/70 bg-[var(--md-sys-color-surface-container-lowest)]/92 p-4 shadow-elev-5 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)]">
            <Icon name={step === 'done' ? 'task_alt' : 'auto_awesome'} size={22} filled={step === 'done'} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{current.title}</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{current.description}</p>
          </div>
          {current.action && (
            <Button size="sm" variant="filled" onClick={onFinish}>
              {current.action}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function NavigationRail({
  activeTab,
  onChange,
}: {
  activeTab: Tab
  onChange: (tab: Tab) => void
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
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`state-host relative flex flex-col items-center gap-1.5 py-2.5 rounded-lg group transition-colors ${
                active ? 'text-[var(--md-sys-color-primary)]' : 'text-[var(--md-sys-color-on-surface-variant)]'
              }`}
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
