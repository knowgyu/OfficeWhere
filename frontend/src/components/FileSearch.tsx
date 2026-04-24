import { useState, useEffect, useRef, useCallback } from 'react'
import { api, SearchResult, SchedulerSettings } from '../api/client'

function SnippetText({ snippet }: { snippet: string }) {
  const parts = snippet.split('**')
  return (
    <span className="text-sm text-gray-700">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

type GroupedResults = Record<string, SearchResult[]>

export default function FileSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const [settings, setSettings] = useState<SchedulerSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SchedulerSettings | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [reindexMsg, setReindexMsg] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.search.getSettings().then((r) => {
      setSettings(r.data)
      setSettingsDraft(r.data)
    })
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    try {
      const r = await api.search.query({ query: q, limit: 200 })
      setResults(r.data.results)
      setSearched(true)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  const handleReindex = async () => {
    setReindexing(true)
    setReindexMsg('')
    try {
      const r = await api.search.reindex()
      const { success, failed } = r.data
      setReindexMsg(`완료: ${success}개 성공, ${failed}개 실패`)
      const s = await api.search.getSettings()
      setSettings(s.data)
      setSettingsDraft(s.data)
    } catch {
      setReindexMsg('재인덱싱 실패')
    } finally {
      setReindexing(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!settingsDraft) return
    try {
      const r = await api.search.updateSettings(settingsDraft)
      setSettings(r.data)
      setSettingsOpen(false)
    } catch {
      alert('설정 저장 실패')
    }
  }

  const grouped: GroupedResults = {}
  for (const result of results) {
    const key = result.name
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(result)
  }

  return (
    <div className="space-y-4">
      {/* Search bar + controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="검색어를 입력하세요 (예: DFBA 챗봇, 예산, 홍길동)"
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={() => doSearch(query)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            검색
          </button>
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {reindexing ? '인덱싱 중...' : '재인덱싱'}
          </button>
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
            title="인덱싱 스케줄 설정"
          >
            ⚙
          </button>
        </div>

        {reindexMsg && (
          <p className="mt-2 text-xs text-gray-500">{reindexMsg}</p>
        )}

        {settings?.last_reindex_at && (
          <p className="mt-1 text-xs text-gray-400">
            마지막 인덱싱: {new Date(settings.last_reindex_at).toLocaleString('ko-KR')}
          </p>
        )}
      </div>

      {/* Scheduler settings panel */}
      {settingsOpen && settingsDraft && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">인덱싱 스케줄 설정</h3>
          <div className="flex gap-4 text-sm">
            {(['manual', 'interval', 'daily'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={settingsDraft.mode === m}
                  onChange={() => setSettingsDraft({ ...settingsDraft, mode: m })}
                />
                {m === 'manual' ? '수동' : m === 'interval' ? '주기 반복' : '매일 정시'}
              </label>
            ))}
          </div>

          {settingsDraft.mode === 'interval' && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">매</span>
              <input
                type="number"
                min={1}
                value={settingsDraft.interval_hours}
                onChange={(e) =>
                  setSettingsDraft({ ...settingsDraft, interval_hours: Number(e.target.value) })
                }
                className="w-20 border border-gray-300 rounded px-2 py-1"
              />
              <span className="text-gray-600">시간마다</span>
            </div>
          )}

          {settingsDraft.mode === 'daily' && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">매일</span>
              <input
                type="time"
                value={settingsDraft.daily_time}
                onChange={(e) =>
                  setSettingsDraft({ ...settingsDraft, daily_time: e.target.value })
                }
                className="border border-gray-300 rounded px-2 py-1"
              />
              <span className="text-gray-600">에 실행</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSaveSettings}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              저장
            </button>
            <button
              onClick={() => setSettingsOpen(false)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {loading && (
        <div className="text-center py-10 text-gray-400 text-sm">검색 중...</div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-10 text-gray-400 text-sm">
          '{query}'에 대한 검색 결과가 없습니다.
        </div>
      )}

      {!loading && !searched && !query && (
        <div className="text-center py-10 text-gray-300 text-sm">
          검색어를 입력하면 등록된 파일에서 내용을 찾습니다.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">{results.length}개 결과</p>
          {Object.entries(grouped).map(([fileName, items]) => (
            <div key={fileName} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {items[0].file_type}
                </span>
                <span className="text-sm font-medium text-gray-800">{fileName}</span>
                <span className="ml-auto text-xs text-gray-400">{items.length}건</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {items.map((item, i) => (
                  <li key={i} className="px-4 py-3 hover:bg-gray-50">
                    <div className="text-xs text-blue-600 mb-1">{item.location}</div>
                    <SnippetText snippet={item.snippet} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
