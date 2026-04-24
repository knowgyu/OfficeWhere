import { useEffect, useState } from 'react'

import FileManager from './components/FileManager'
import JoinQuery from './components/JoinQuery'
import ConsistencyCheck from './components/ConsistencyCheck'
import FileSearch from './components/FileSearch'
import { Icon } from './ui'

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
    hint: 'Finder처럼 파일명과 문서 내용을 함께 검색',
  },
  {
    id: 'check',
    label: '버전 묶음 / 정합성',
    short: '검사',
    icon: 'difference',
    iconFilled: 'difference',
    hint: '유사 파일 묶음을 기준으로 변경과 불일치 탐지',
  },
  {
    id: 'join',
    label: 'Excel 통합',
    short: '통합',
    icon: 'join_inner',
    iconFilled: 'join_inner',
    hint: '같은 key를 기준으로 여러 Excel 컬럼 통합',
  },
  {
    id: 'files',
    label: '설정 / 라이브러리',
    short: '설정',
    icon: 'settings',
    iconFilled: 'settings',
    hint: '대상 폴더, 자동 등록, 파일 라이브러리 관리',
  },
]

const LS_TAB = 'odj:last-tab'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'search'
    const stored = window.localStorage.getItem(LS_TAB) as Tab | null
    return stored && TABS.some((tab) => tab.id === stored) ? stored : 'search'
  })

  useEffect(() => {
    window.localStorage.setItem(LS_TAB, activeTab)
  }, [activeTab])

  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]

  return (
    <div className="flex flex-1 min-h-screen bg-[var(--md-sys-color-background)]">
      <NavigationRail activeTab={activeTab} onChange={setActiveTab} />

      <div className="flex-1 flex flex-col min-w-0">
        <TopAppBar title={current.label} hint={current.hint} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-6 pt-6 pb-16 animate-fade-in" key={activeTab}>
            {activeTab === 'files' && <FileManager />}
            {activeTab === 'search' && <FileSearch />}
            {activeTab === 'join' && <JoinQuery />}
            {activeTab === 'check' && <ConsistencyCheck />}
          </div>
        </main>
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
    <aside className="sticky top-0 self-start flex flex-col items-center gap-2 w-24 min-h-screen py-4 bg-[var(--md-sys-color-surface-container-low)] border-r border-[var(--md-sys-color-outline-variant)]">
      <div className="flex flex-col items-center gap-1.5 py-3">
        <div className="h-10 w-10 rounded-md bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] flex items-center justify-center shadow-elev-1">
          <Icon name="table_view" size={22} filled />
        </div>
        <p className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">ODJ</p>
      </div>

      <nav className="flex flex-col gap-1 mt-2 w-full px-2" aria-label="메인 내비게이션">
        {TABS.map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className="state-host relative flex flex-col items-center gap-1 py-2 rounded-sm group"
              aria-current={active ? 'page' : undefined}
            >
              <span className="state-layer" />
              <span
                className={`relative inline-flex items-center justify-center h-8 w-14 rounded-full transition-colors ${
                  active
                    ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
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
    <header className="sticky top-0 z-20 bg-[var(--md-sys-color-background)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--md-sys-color-background)]/75 border-b border-[var(--md-sys-color-outline-variant)]">
      <div className="mx-auto w-full max-w-[1400px] px-6 h-16 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="type-label-md text-[var(--md-sys-color-primary)] uppercase">
            Office Data Joiner
          </p>
          <h1 className="type-title-lg text-[var(--md-sys-color-on-surface)] truncate">
            {title}
          </h1>
        </div>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] hidden md:block">
          {hint}
        </p>
      </div>
    </header>
  )
}
