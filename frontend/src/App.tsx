import { useState } from 'react'
import FileManager from './components/FileManager'
import JoinQuery from './components/JoinQuery'
import ConsistencyCheck from './components/ConsistencyCheck'

type Tab = 'files' | 'join' | 'check'

const TABS: { id: Tab; label: string }[] = [
  { id: 'files', label: '파일 관리' },
  { id: 'join', label: 'JOIN 쿼리' },
  { id: 'check', label: '정합성 검사' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('files')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-800">excel-db</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Excel / Word / PPT 파일을 DB처럼 관리하는 도구
        </p>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Tab Content */}
      <main className="px-6 py-6 max-w-7xl mx-auto">
        {activeTab === 'files' && <FileManager />}
        {activeTab === 'join' && <JoinQuery />}
        {activeTab === 'check' && <ConsistencyCheck />}
      </main>
    </div>
  )
}
