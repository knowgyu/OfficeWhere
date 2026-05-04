import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'

import FileManager from './components/FileManager'
import ConsistencyCheck from './components/ConsistencyCheck'
import FileSearch from './components/FileSearch'
import DuplicateFiles from './components/DuplicateFiles'
import OnboardingCarousel from './components/OnboardingCarousel'
import { api, type UpdateCheckResult } from './api/client'
import { Button, Dialog, Icon, Spinner } from './ui'
import { useSnackbar } from './ui'
import { useLibraryRescan } from './contexts/LibraryRescanContext'
import { useDisplaySettings } from './contexts/DisplaySettingsContext'
import {
  TutorialStep,
  TUTORIAL_TOTAL_STEPS,
  TUTORIAL_SECTIONS,
  EXAMPLE_SEARCH_QUERY,
  getTutorialStepIndex,
  getTutorialSection,
} from './tutorial'

type Tab = 'search' | 'check' | 'duplicates' | 'files'

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
    label: '변경 이력',
    short: '이력',
    icon: 'history',
    iconFilled: 'history',
    hint: '비슷한 문서를 묶고 무엇이 달라졌는지 확인합니다',
  },
  {
    id: 'duplicates',
    label: '같은 내용 문서',
    short: '중복',
    icon: 'content_copy',
    iconFilled: 'content_copy',
    hint: '파일명은 달라도 내용이 같은 문서를 묶어서 확인합니다',
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
const LS_UPDATE_DISMISSED_VERSION = 'officewhere:update-dismissed-version'
const LOCAL_STATE_PREFIXES = ['officewhere:', 'odj:']

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
  keyword?: string
}

const TUTORIAL_TARGET_TAB: Record<TutorialStep, Tab | null> = {
  'example-folder': 'files',
  'document-refresh': 'files',
  search: 'search',
  'search-results': 'search',
  'search-review': 'search',
  'version-ppt': 'check',
  'version-ppt-review': 'check',
  'version-ppt-detail': 'check',
  'version-excel': 'check',
  'version-excel-review': 'check',
  'excel-table': 'check',
  'excel-table-cell': 'check',
  'excel-table-history': 'check',
  done: null,
}

const TUTORIAL_REVIEW_ADVANCE: Partial<Record<TutorialStep, TutorialStep>> = {
  'search-review': 'version-ppt',
  'version-ppt-detail': 'version-excel',
  'version-excel-review': 'excel-table',
  'excel-table-history': 'done',
}
const TUTORIAL_CONFIRMATION_ADVANCE_MS = 1400
const TUTORIAL_CONFIRMATION_ADVANCE_BY_STEP: Partial<Record<TutorialStep, number>> = {
  'search-review': 1800,
  'version-ppt-detail': 1500,
  'version-excel-review': 1600,
  'excel-table-history': 1800,
}

function getTutorialAutoAdvanceDelay(step: TutorialStep) {
  return TUTORIAL_CONFIRMATION_ADVANCE_BY_STEP[step] ?? TUTORIAL_CONFIRMATION_ADVANCE_MS
}

const TUTORIAL_COPY: Record<TutorialStep, TourCopy> = {
  'example-folder': {
    eyebrow: '예제 폴더',
    title: '예제 폴더를 추가해 볼게요',
    description: '방금 만든 임시 폴더입니다. 대상 추가를 누르면 예제 문서가 등록됩니다.',
    icon: 'drive_folder_upload',
  },
  'document-refresh': {
    eyebrow: '문서 준비',
    title: '문서를 한 번 새로고침하세요',
    description: '폴더 안의 문서를 읽어 검색과 변경 이력에 쓸 정보를 준비합니다.',
    icon: 'sync',
  },
  search: {
    eyebrow: '문서 검색',
    title: '검색창에 일정을 입력하세요',
    description: '입력이 끝나면 잠시 후 파일명과 본문에서 찾은 결과가 함께 나옵니다.',
    icon: 'search',
    keyword: EXAMPLE_SEARCH_QUERY,
  },
  'search-results': {
    eyebrow: '본문 매칭',
    title: '본문에서 찾은 위치를 확인하세요',
    description: '결과 아래에 검색어가 들어간 문장과 위치가 펼쳐져 있습니다.',
    icon: 'unfold_more',
  },
  'search-review': {
    eyebrow: '검색 결과',
    title: '이 문장에서 검색어를 찾았습니다',
    description: '강조된 줄을 확인하면 다음 안내로 넘어갑니다.',
    icon: 'visibility',
  },
  'version-ppt': {
    eyebrow: 'PPT 변경 이력',
    title: 'PPT 변경점을 열어보세요',
    description: '변경점 보기를 누르면 슬라이드별로 달라진 부분을 볼 수 있습니다.',
    icon: 'timeline',
  },
  'version-ppt-review': {
    eyebrow: 'PPT 변경',
    title: '접힌 내용을 펼쳐보세요',
    description: '자세히 보기를 누르면 어떤 문장이 바뀌었는지 바로 확인할 수 있습니다.',
    icon: 'unfold_more',
  },
  'version-ppt-detail': {
    eyebrow: 'PPT 변경 상세',
    title: 'PPT에서 달라진 부분입니다',
    description: '슬라이드 변경 내용을 확인하면 다음 안내로 이어집니다.',
    icon: 'visibility',
  },
  'version-excel': {
    eyebrow: 'Excel 변경 이력',
    title: 'Excel 변경점도 확인해 볼게요',
    description: '변경점 보기를 누르면 바뀐 셀과 값을 먼저 보여줍니다.',
    icon: 'difference',
  },
  'version-excel-review': {
    eyebrow: 'Excel 변경',
    title: '바뀐 셀이 표시됐습니다',
    description: '색으로 표시된 셀이 추가·삭제·수정된 위치입니다.',
    icon: 'fact_check',
  },
  'excel-table': {
    eyebrow: '셀 단위 보기',
    title: '표로 자세히 보세요',
    description: '표로 보기를 누르면 시트 위에서 바뀐 셀을 바로 볼 수 있습니다.',
    icon: 'table_chart',
  },
  'excel-table-cell': {
    eyebrow: '셀 변경',
    title: 'D7 셀을 선택하세요',
    description: '색이 있는 셀을 누르면 아래에 이전 값과 현재 값이 열립니다.',
    icon: 'table_view',
  },
  'excel-table-history': {
    eyebrow: '셀 변경 이력',
    title: '셀 값의 변화가 정리됐습니다',
    description: '이전 값과 현재 값을 확인하면 튜토리얼이 끝납니다.',
    icon: 'history',
  },
  done: {
    eyebrow: '둘러보기 완료',
    title: '기본 흐름을 모두 확인했습니다',
    description: '예제는 정리되고, 이제 설정에서 내 문서 폴더를 추가해 보세요.',
    icon: 'task_alt',
  },
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function getRectBoundaryPoint(rect: TourRect, from: Point): Point {
  const center = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
  const dx = from.x - center.x
  const dy = from.y - center.y
  if (dx === 0 && dy === 0) {
    return { x: center.x, y: rect.top }
  }

  const halfWidth = Math.max(rect.width / 2, 1)
  const halfHeight = Math.max(rect.height / 2, 1)
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
  )

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  }
}

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
      title: `${tab?.short ?? tab?.label ?? '다음'} 탭으로 이동`,
      description: `왼쪽의 강조된 ${tab?.short ?? '탭'}에서 이어집니다.`,
      icon: 'touch_app',
    }
  }

  return TUTORIAL_COPY[step]
}

function getTutorialTargetElement(step: TutorialStep) {
  const targeted = document.querySelector<HTMLElement>(`[data-tour-target="${step}"]`)
  return targeted ?? document.querySelector<HTMLElement>('.tour-target')
}

function clearOfficeWhereLocalState() {
  const keys = Array.from({ length: window.localStorage.length }, (_value, index) =>
    window.localStorage.key(index),
  ).filter((key): key is string => Boolean(key))

  keys.forEach((key) => {
    if (LOCAL_STATE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      window.localStorage.removeItem(key)
    }
  })
}

export default function App() {
  const snackbar = useSnackbar()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'search'
    const stored = window.localStorage.getItem(LS_TAB) ?? window.localStorage.getItem(LEGACY_LS_TAB)
    return stored && TABS.some((tab) => tab.id === stored) ? (stored as Tab) : 'search'
  })
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LS_ONBOARDING_DONE) !== 'true'
  })
  const [onboardingReplay, setOnboardingReplay] = useState(false)
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null)
  const [exampleLibraryPath, setExampleLibraryPath] = useState('')
  const [libraryDataRevision, setLibraryDataRevision] = useState(0)
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [updateDownloadedPath, setUpdateDownloadedPath] = useState('')
  const { textSize, increaseTextSize, decreaseTextSize, resetTextSize, resetThemeMode } = useDisplaySettings()
  const tutorialCleanupPathRef = useRef('')
  const tutorialCleanupInFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    window.localStorage.setItem(LS_TAB, activeTab)
  }, [activeTab])

  useEffect(() => {
    if (exampleLibraryPath) tutorialCleanupPathRef.current = exampleLibraryPath
  }, [exampleLibraryPath])

  useEffect(() => {
    let cancelled = false

    const consumeResetState = async () => {
      try {
        const response = await api.app.consumeResetState()
        if (cancelled || !response.data.resetPending) return

        clearOfficeWhereLocalState()
        resetTextSize()
        resetThemeMode()
        setExampleLibraryPath('')
        setTutorialStep(null)
        setOnboardingReplay(false)
        setActiveTab('search')
        setOnboardingOpen(true)
        snackbar.info('앱 데이터를 초기화했습니다. 처음 둘러보기를 다시 시작합니다.')
      } catch {
        // Browser/dev mode has no reset marker to consume.
      }
    }

    void consumeResetState()
    return () => {
      cancelled = true
    }
  }, [resetTextSize, resetThemeMode, snackbar])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await api.app.consumeSchemaResetState()
        if (cancelled || !response.data.resetPending) return
        setActiveTab('files')
        snackbar.warn(
          response.data.message ||
            '문서 목록을 다시 준비해야 합니다. 원본 문서는 그대로이며 대상 폴더를 다시 새로고침해 주세요.',
          8000,
        )
      } catch {
        // Browser/dev mode can ignore this backend-only maintenance notice.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [snackbar])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await api.app.checkForUpdates()
          if (cancelled || !response.data.updateAvailable) return
          if (
            response.data.latestVersion &&
            window.localStorage.getItem(LS_UPDATE_DISMISSED_VERSION) === response.data.latestVersion
          ) {
            return
          }
          setUpdateInfo(response.data)
          setUpdateStatus('')
          setUpdateError('')
          setUpdateDownloadedPath('')
          setUpdateDialogOpen(true)
        } catch {
          // Update checks must never block startup or local document work.
        }
      })()
    }, 2200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

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

  const cleanupTutorialLibrary = useCallback(
    (showMessage = false) => {
      if (tutorialCleanupInFlightRef.current) return tutorialCleanupInFlightRef.current
      const path = tutorialCleanupPathRef.current
      if (!path) return Promise.resolve()

      tutorialCleanupPathRef.current = ''
      setExampleLibraryPath('')

      const promise = api.app
        .cleanupTutorialLibrary(path)
        .then((response) => {
          setLibraryDataRevision((value) => value + 1)
          if (showMessage && response.data.success) {
            snackbar.info('튜토리얼 예제 파일과 임시 문서 데이터를 정리했습니다.')
          }
          if (showMessage && !response.data.success) {
            snackbar.warn('튜토리얼 예제 일부를 정리하지 못했습니다. 앱 데이터 정리에서 다시 지울 수 있습니다.')
          }
        })
        .catch(() => {
          if (showMessage) snackbar.warn('튜토리얼 예제 파일 정리에 실패했습니다.')
        })
        .finally(() => {
          tutorialCleanupInFlightRef.current = null
        })

      tutorialCleanupInFlightRef.current = promise
      return promise
    },
    [snackbar],
  )

  const handleStartOwnFolder = () => {
    void cleanupTutorialLibrary(false)
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
      const response = await api.app.createTutorialLibrary()
      if (response.data.available && response.data.path) {
        tutorialCleanupPathRef.current = response.data.path
        setExampleLibraryPath(response.data.path)
        completeOnboarding()
        setActiveTab('files')
        setTutorialStep('example-folder')
      } else {
        setExampleLibraryPath('')
        tutorialCleanupPathRef.current = ''
        snackbar.warn(response.data.reason || '튜토리얼 예제 파일을 만들지 못했습니다.')
      }
    } catch (error) {
      setExampleLibraryPath('')
      tutorialCleanupPathRef.current = ''
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '튜토리얼 예제 파일을 만들지 못했습니다.'
      snackbar.warn(detail)
    }
  }

  const handleTutorialStep = (next: TutorialStep | null) => {
    if (next === null && tutorialStep && tutorialStep !== 'done') void cleanupTutorialLibrary(true)
    setTutorialStep(next)
  }

  const dismissUpdateDialog = () => {
    if (updateInfo?.latestVersion) {
      window.localStorage.setItem(LS_UPDATE_DISMISSED_VERSION, updateInfo.latestVersion)
    }
    setUpdateStatus('')
    setUpdateError('')
    setUpdateDownloadedPath('')
    setUpdateDialogOpen(false)
  }

  const handleOpenReleasePage = async () => {
    try {
      await api.app.openReleasePage()
    } catch {
      snackbar.warn('릴리즈 페이지를 열지 못했습니다.')
    }
  }

  const handleInstallUpdate = async () => {
    setUpdateDownloading(true)
    setUpdateError('')
    setUpdateDownloadedPath('')
    setUpdateStatus('업데이트 zip을 다운로드하고 검증하는 중입니다...')
    try {
      const response = await api.app.installUpdate()
      const message = response.data.message || '업데이트 zip을 다운로드했습니다.'
      snackbar.success(message, 7000)
      setUpdateDownloadedPath(response.data.filePath)
      setUpdateStatus(
        response.data.alreadyDownloaded
          ? '이미 받은 파일을 확인했습니다. 압축을 풀고 새 OfficeWhere.exe를 실행해 주세요.'
          : '다운로드가 끝났습니다. 압축을 풀고 새 OfficeWhere.exe를 실행해 주세요.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '업데이트 zip 다운로드에 실패했습니다.'
      setUpdateError(message)
      snackbar.error('업데이트 zip을 다운로드하지 못했습니다.', 7000)
      setUpdateStatus('')
      return
    } finally {
      setUpdateDownloading(false)
    }
  }

  useEffect(() => {
    if (!tutorialStep) return undefined

    const handleTutorialKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void cleanupTutorialLibrary(true)
      setTutorialStep(null)
    }

    window.addEventListener('keydown', handleTutorialKeyDown)
    return () => window.removeEventListener('keydown', handleTutorialKeyDown)
  }, [cleanupTutorialLibrary, tutorialStep])

  useEffect(() => {
    if (tutorialStep !== 'done') return undefined
    void cleanupTutorialLibrary(true)
    return undefined
  }, [cleanupTutorialLibrary, tutorialStep])

  return (
    <div
      className={`app-text-${textSize} flex flex-1 min-h-screen bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-surface)]`}
      onWheel={handleGlobalWheel}
    >
      <NavigationRail
        activeTab={activeTab}
        onChange={setActiveTab}
        tutorialStep={tutorialStep}
        tutorialActive={Boolean(tutorialStep && tutorialStep !== 'done')}
        tutorialTargetTab={tutorialTargetTab}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopAppBar title={current.label} hint={current.hint} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1420px] px-5 md:px-7 pt-6 pb-16">
            <section className={activeTab === 'files' ? 'animate-fade-in' : 'hidden'} aria-hidden={activeTab !== 'files'}>
              <FileManager
                tutorialStep={tutorialStep}
                exampleLibraryPath={exampleLibraryPath}
                libraryDataRevision={libraryDataRevision}
                onTutorialStep={handleTutorialStep}
                onReplayOnboarding={handleReplayOnboarding}
              />
            </section>
            <section className={activeTab === 'search' ? 'animate-fade-in' : 'hidden'} aria-hidden={activeTab !== 'search'}>
              <FileSearch
                tutorialStep={tutorialStep}
                libraryDataRevision={libraryDataRevision}
                onTutorialStep={handleTutorialStep}
                onOpenDuplicates={() => setActiveTab('duplicates')}
              />
            </section>
            <section className={activeTab === 'check' ? 'animate-fade-in' : 'hidden'} aria-hidden={activeTab !== 'check'}>
              <ConsistencyCheck
                tutorialStep={tutorialStep}
                libraryDataRevision={libraryDataRevision}
                onTutorialStep={handleTutorialStep}
              />
            </section>
            <section className={activeTab === 'duplicates' ? 'animate-fade-in' : 'hidden'} aria-hidden={activeTab !== 'duplicates'}>
              <DuplicateFiles libraryDataRevision={libraryDataRevision} />
            </section>
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
        onAdvance={(next) => setTutorialStep(next)}
        onCloseDone={() => {
          setTutorialStep(null)
          setActiveTab('files')
        }}
        onReplayOnboarding={() => {
          setTutorialStep(null)
          setOnboardingReplay(true)
          setOnboardingOpen(true)
        }}
      />
      <OnboardingCarousel
        open={onboardingOpen}
        replay={onboardingReplay}
        onStartExample={handleStartExample}
        onStartOwnFolder={handleStartOwnFolder}
      />
      <Dialog
        open={updateDialogOpen && Boolean(updateInfo)}
        onClose={updateDownloading ? () => undefined : dismissUpdateDialog}
        icon="download"
        title="새 버전 zip을 다운로드할 수 있습니다"
        description={
          updateInfo
            ? `현재 ${updateInfo.currentVersion || '알 수 없음'} · 최신 ${updateInfo.latestVersion}`
            : undefined
        }
        actions={
          <>
            <Button variant="text" onClick={dismissUpdateDialog} disabled={updateDownloading}>
              나중에
            </Button>
            <Button
              variant="outlined"
              leadingIcon="open_in_new"
              onClick={handleOpenReleasePage}
              disabled={updateDownloading}
            >
              릴리즈 보기
            </Button>
            <Button
              variant="filled"
              leadingIcon="download"
              onClick={handleInstallUpdate}
              loading={updateDownloading}
              disabled={!updateInfo?.asset || updateDownloading}
            >
              {updateDownloading ? '다운로드 중...' : 'zip 다운로드'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="type-body-md text-[var(--md-sys-color-on-surface)]">
            포터블 배포판은 실행 중인 앱 폴더를 자동으로 교체하지 않습니다. 대신 업데이트 zip을 다운로드
            폴더에 받고 검증한 뒤, 압축을 풀어 새 OfficeWhere.exe를 실행하면 됩니다. 원본 문서와 앱 데이터는
            건드리지 않습니다.
          </p>
          {(updateDownloading || updateStatus) && (
            <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3">
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                {updateDownloading ? '다운로드 중...' : '다운로드 완료'}
              </p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                {updateStatus || '잠시만 기다려 주세요.'}
              </p>
              {updateDownloadedPath && (
                <p className="type-body-sm mt-2 break-all text-[var(--md-sys-color-on-surface)]">
                  {updateDownloadedPath}
                </p>
              )}
            </div>
          )}
          {updateError && (
            <div className="rounded-md border border-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)] p-3 text-[var(--md-sys-color-on-error-container)]">
              <p className="type-title-sm">업데이트 zip을 다운로드하지 못했습니다</p>
              <p className="type-body-sm mt-1 whitespace-pre-wrap">{updateError}</p>
              <p className="type-body-sm mt-2">
                원본 문서와 앱 데이터는 변경되지 않았습니다. 계속 실패하면 릴리즈 보기에서 직접 받아 주세요.
              </p>
            </div>
          )}
          {updateInfo?.asset ? (
            <div className="rounded-md bg-[var(--md-sys-color-surface-container-lowest)] p-3">
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{updateInfo.asset.name}</p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                다운로드가 끝나면 파일 위치를 열어 드립니다. 기존 앱은 그대로 두고 새 zip을 원하는 위치에 풀어
                실행하세요.
              </p>
            </div>
          ) : (
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              이 릴리즈에는 다운로드할 Windows zip 파일이 없어 릴리즈 페이지에서 직접 확인해 주세요.
            </p>
          )}
        </div>
      </Dialog>
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
  onAdvance,
  onCloseDone,
  onReplayOnboarding,
}: {
  step: TutorialStep | null
  activeTab: Tab
  targetTab: Tab | null
  onAdvance: (step: TutorialStep) => void
  onCloseDone: () => void
  onReplayOnboarding: () => void
}) {
  const [pointer, setPointer] = useState<Point>(getInitialPointer)
  const [viewport, setViewport] = useState(getViewport)
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const autoAdvancedStepRef = useRef<TutorialStep | null>(null)

  const content = useMemo(() => getTutorialCopy(step, activeTab), [activeTab, step])
  const nextCheckpoint = step ? TUTORIAL_REVIEW_ADVANCE[step] : undefined
  const autoAdvanceDelay = step ? getTutorialAutoAdvanceDelay(step) : TUTORIAL_CONFIRMATION_ADVANCE_MS

  useEffect(() => {
    if (!step) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      setPointer({ x: event.clientX, y: event.clientY })
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [step])

  useEffect(() => {
    if (step !== 'done') return undefined
    const raf = requestAnimationFrame(() => primaryButtonRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [step])

  useEffect(() => {
    if (step !== 'done') return undefined
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        onCloseDone()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [step, onCloseDone])

  useEffect(() => {
    if (!step) {
      setTargetRect(null)
      autoAdvancedStepRef.current = null
      return undefined
    }

    let frame = 0
    const readTarget = () => {
      if (step === 'done') {
        setTargetRect(null)
        return
      }

      const target = getTutorialTargetElement(step)
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
    }

    const scheduleRead = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(readTarget)
    }
    const handleResize = () => {
      setViewport(getViewport())
      scheduleRead()
    }

    const firstRead = window.setTimeout(readTarget, 80)
    const retryRead = window.setInterval(readTarget, 360)
    window.addEventListener('scroll', scheduleRead, true)
    window.addEventListener('resize', handleResize)

    return () => {
      window.clearTimeout(firstRead)
      window.clearInterval(retryRead)
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleRead, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [activeTab, step, targetTab])

  useEffect(() => {
    if (!step || !nextCheckpoint || targetTab !== activeTab) return undefined
    if (autoAdvancedStepRef.current === step) return undefined
    autoAdvancedStepRef.current = step
    const timer = window.setTimeout(() => onAdvance(nextCheckpoint), autoAdvanceDelay)
    return () => window.clearTimeout(timer)
  }, [activeTab, autoAdvanceDelay, nextCheckpoint, onAdvance, step, targetTab])

  if (!step || !content) return null

  const isDone = step === 'done'
  const bubbleWidth = Math.min(isDone ? 380 : 352, Math.max(280, viewport.width - 32))
  const bubbleHeight = isDone ? 300 : 214
  const target = targetRect
  const canPlaceBubbleRight = target ? target.left + target.width + bubbleWidth + 18 <= viewport.width - 16 : false
  const canPlaceBubbleLeft = target ? target.left - bubbleWidth - 18 >= 16 : false
  const placeBubbleBeside =
    target !== null && target.width < bubbleWidth * 0.82 && (canPlaceBubbleRight || canPlaceBubbleLeft)
  const placeBubbleBelow = target ? target.top + target.height + bubbleHeight + 18 <= viewport.height - 16 : false
  const targetBubbleLeft = target
    ? placeBubbleBeside
      ? canPlaceBubbleRight
        ? target.left + target.width + 18
        : target.left - bubbleWidth - 18
      : target.left + target.width / 2 - bubbleWidth / 2
    : pointer.x > viewport.width - bubbleWidth - 44
      ? pointer.x - bubbleWidth - 26
      : pointer.x + 26
  const targetBubbleTop = target
    ? placeBubbleBeside
      ? target.top + target.height / 2 - bubbleHeight / 2
      : placeBubbleBelow
        ? target.top + target.height + 18
        : target.top - bubbleHeight - 18
    : pointer.y > viewport.height - bubbleHeight - 44
      ? pointer.y - bubbleHeight - 24
      : pointer.y + 22
  const bubbleLeft = isDone
    ? Math.max(16, (viewport.width - bubbleWidth) / 2)
    : clamp(targetBubbleLeft, 16, Math.max(16, viewport.width - bubbleWidth - 16))
  const bubbleTop = isDone
    ? Math.max(16, (viewport.height - bubbleHeight) / 2)
    : clamp(targetBubbleTop, 16, Math.max(16, viewport.height - bubbleHeight - 16))
  const pointerAnchor = {
    x: clamp(pointer.x, 8, Math.max(8, viewport.width - 8)),
    y: clamp(pointer.y, 8, Math.max(8, viewport.height - 8)),
  }
  const pointerHintLeft = clamp(pointerAnchor.x + 14, 16, Math.max(16, viewport.width - 104))
  const pointerHintTop = clamp(pointerAnchor.y + 14, 16, Math.max(16, viewport.height - 40))
  const targetAnchor = target ? getRectBoundaryPoint(target, pointerAnchor) : null
  const curve = !isDone && targetAnchor
    ? {
        startX: pointerAnchor.x,
        startY: pointerAnchor.y,
        c1X: pointerAnchor.x + (targetAnchor.x - pointerAnchor.x) * 0.32,
        c1Y: pointerAnchor.y,
        c2X: pointerAnchor.x + (targetAnchor.x - pointerAnchor.x) * 0.74,
        c2Y: targetAnchor.y,
        endX: targetAnchor.x,
        endY: targetAnchor.y,
      }
    : null
  const stepIndex = getTutorialStepIndex(step)
  const section = getTutorialSection(step)

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none">
      {curve && (
        <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <path
            d={`M ${curve.startX} ${curve.startY} C ${curve.c1X} ${curve.c1Y}, ${curve.c2X} ${curve.c2Y}, ${curve.endX} ${curve.endY}`}
            className="tour-hud-line"
          />
          <circle cx={curve.startX} cy={curve.startY} r="5" className="tour-hud-pointer-core" />
          <circle cx={curve.startX} cy={curve.startY} r="13" className="tour-hud-pointer-halo" />
          <circle cx={curve.endX} cy={curve.endY} r="7" className="tour-hud-target-core" />
          <circle cx={curve.endX} cy={curve.endY} r="18" className="tour-hud-target-halo" />
        </svg>
      )}
      {curve && (
        <div className="tour-pointer-hint" style={{ left: pointerHintLeft, top: pointerHintTop }}>
          <Icon name="near_me" size={14} />
          <span>이쪽으로</span>
        </div>
      )}
      <div
        className={`tour-hud-bubble${isDone ? ' tour-hud-bubble-interactive' : ''}`}
        style={{ left: bubbleLeft, top: bubbleTop, width: bubbleWidth }}
      >
        {isDone ? (
          <div className="tour-hud-done">
            <div className="tour-hud-done-icon">
              <Icon name="task_alt" size={28} filled />
            </div>
            <p className="tour-hud-eyebrow">둘러보기 완료</p>
            <p className="type-title-md text-[var(--md-sys-color-on-surface)]">기본 흐름을 모두 확인했습니다</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              예제는 정리되고, 이제 설정에서 내 문서 폴더를 추가해 보세요.
            </p>
            <ul className="tour-hud-summary">
              <li><Icon name="search" size={16} /><span>파일명과 본문을 함께 검색</span></li>
              <li><Icon name="timeline" size={16} /><span>PPT·Excel 변경점 확인</span></li>
              <li><Icon name="grid_on" size={16} /><span>Excel 셀 값 변화 확인</span></li>
            </ul>
            <div className="tour-hud-done-actions">
              <button
                type="button"
                ref={primaryButtonRef}
                className="tour-hud-btn tour-hud-btn-primary"
                onClick={onCloseDone}
              >
                <Icon name="folder_open" size={16} />
                <span>설정에서 폴더 추가하기</span>
              </button>
              <button
                type="button"
                className="tour-hud-btn tour-hud-btn-ghost"
                onClick={onReplayOnboarding}
              >
                <Icon name="replay" size={16} />
                <span>온보딩 다시 보기</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="tour-hud-meta">
              <span className="tour-hud-section">{section?.label ?? ''}</span>
              <span
                className="tour-hud-count tabular-nums"
                aria-label={`진행 단계 ${stepIndex} / ${TUTORIAL_TOTAL_STEPS}`}
              >
                {stepIndex} / {TUTORIAL_TOTAL_STEPS}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <div className="tour-hud-icon">
                <Icon name={content.icon} size={22} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="tour-hud-eyebrow">{content.eyebrow}</p>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{content.title}</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{content.description}</p>
                {content.keyword && (
                  <div className="tour-hud-keyword">
                    <span>따라 입력</span>
                    <kbd>{content.keyword}</kbd>
                  </div>
                )}
                <div className="tour-hud-progress" aria-hidden="true">
                  {TUTORIAL_SECTIONS.map((seg) => {
                    const segSize = seg.range[1] - seg.range[0] + 1
                    const filled = Math.max(0, Math.min(segSize, stepIndex - seg.range[0] + 1))
                    const pct = (filled / segSize) * 100
                    const isActive = stepIndex >= seg.range[0] && stepIndex <= seg.range[1]
                    return (
                      <div
                        key={seg.id}
                        className={`tour-hud-progress-seg${isActive ? ' is-active' : ''}`}
                        style={{ flex: segSize }}
                      >
                        <span className="tour-hud-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-3 pt-2 flex-wrap">
                  <span className="tour-hud-kbd">
                    <kbd>Esc</kbd>
                    <span>그만보기</span>
                  </span>
                  {nextCheckpoint && (
                    <span
                      className="tour-auto-advance-pill inline-flex items-center gap-1.5 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 py-1 type-label-md text-[var(--md-sys-color-on-surface-variant)]"
                      style={{ '--tour-auto-advance-ms': `${autoAdvanceDelay}ms` } as CSSProperties}
                    >
                      <Icon name="progress_activity" size={16} />
                      <span>확인 완료 · 잠시 후 다음 안내로 넘어갑니다</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NavigationRail({
  activeTab,
  onChange,
  tutorialStep = null,
  tutorialActive = false,
  tutorialTargetTab = null,
}: {
  activeTab: Tab
  onChange: (tab: Tab) => void
  tutorialStep?: TutorialStep | null
  tutorialActive?: boolean
  tutorialTargetTab?: Tab | null
}) {
  return (
    <aside className="sticky top-0 self-start flex flex-col items-center gap-2 w-24 min-h-screen py-4 bg-[var(--md-sys-color-surface-container-lowest)]/88 backdrop-blur-xl border-r border-[var(--md-sys-color-outline-variant)] shadow-[1px_0_0_var(--ow-inset-highlight)_inset]">
      <div className="py-2" aria-hidden="true" />

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
              data-tour-target={highlight && tutorialStep ? tutorialStep : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <span className="state-layer" />
              <span
                className={`relative inline-flex items-center justify-center h-9 w-14 rounded-full transition-all ${
                  active
                    ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)] shadow-[0_1px_0_var(--ow-inset-highlight)_inset]'
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
