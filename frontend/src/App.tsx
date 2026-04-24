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
    hint: '등록한 폴더와 파일에서 파일명과 문서 내용을 함께 찾습니다',
  },
  {
    id: 'check',
    label: '버전 묶음 / 정합성',
    short: '검사',
    icon: 'difference',
    iconFilled: 'difference',
    hint: '같은 문서의 여러 버전에서 빠진 항목과 변경 내용을 확인합니다',
  },
  {
    id: 'join',
    label: 'Excel 통합',
    short: '통합',
    icon: 'table_chart',
    iconFilled: 'table_chart',
    hint: '같은 기준 컬럼을 가진 여러 Excel 표를 하나로 합칩니다',
  },
  {
    id: 'files',
    label: '설정 / 라이브러리',
    short: '설정',
    icon: 'settings',
    iconFilled: 'settings',
    hint: '검색과 비교에 사용할 폴더와 파일을 등록합니다',
  },
]

const LS_TAB = 'odj:last-tab'
const LOGO_SRC = './officewhere-logo.png'

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
      <div className="flex items-center justify-center py-3">
        <img
          src={LOGO_SRC}
          alt="OfficeWhere"
          className="h-10 w-10 rounded-md object-cover shadow-elev-1"
        />
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
            OfficeWhere
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
