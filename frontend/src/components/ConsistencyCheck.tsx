import { useState, useEffect } from 'react'
import { api, FileInfo, CheckResponse, CheckIssue } from '../api/client'

export default function ConsistencyCheck() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.files.list().then((res) => setFiles(res.data)).catch(() => {})
  }, [])

  const toggleFile = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
    setResult(null)
  }

  const handleCheck = async () => {
    if (selectedIds.size < 2) {
      setError('정합성 검사는 최소 2개 파일을 선택해야 합니다.')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await api.check.run({ file_ids: Array.from(selectedIds) })
      setResult(res.data)
      setExpandedKeys(new Set())
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '정합성 검사에 실패했습니다.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = (key: string) => {
    const next = new Set(expandedKeys)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setExpandedKeys(next)
  }

  const conflictCount = result?.issues.filter((i) => i.severity === 'conflict').length ?? 0
  const warningCount = result?.issues.filter((i) => i.severity === 'warning').length ?? 0

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">정합성 검사</h2>

      {files.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
          먼저 "파일 관리" 탭에서 파일을 등록해 주세요.
        </div>
      ) : (
        <>
          {/* 파일 선택 */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              검사할 파일 선택 (최소 2개)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {files.map((f) => {
                const checked = selectedIds.has(f.id)
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-3 px-3 py-2.5 border rounded-lg cursor-pointer transition-colors ${
                      checked
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFile(f.id)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                      <p className="text-xs text-gray-400">key: {f.key_column}</p>
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleCheck}
                disabled={loading || selectedIds.size < 2}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '검사 중...' : '검사 실행'}
              </button>
              <span className="text-xs text-gray-400">
                {selectedIds.size}개 파일 선택됨
              </span>
            </div>
          </div>

          {/* 에러 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded">
              {error}
              <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">
                ✕
              </button>
            </div>
          )}

          {/* 결과 요약 */}
          {result && (
            <div className="space-y-4">
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-gray-800">{result.total_keys}</p>
                  <p className="text-xs text-gray-500 mt-0.5">전체 key</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.matched_keys}</p>
                  <p className="text-xs text-gray-500 mt-0.5">공통 key</p>
                </div>
                <div className="bg-white border border-red-200 rounded-lg px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{conflictCount}</p>
                  <p className="text-xs text-gray-500 mt-0.5">충돌 (conflict)</p>
                </div>
                <div className="bg-white border border-yellow-200 rounded-lg px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-yellow-600">{warningCount}</p>
                  <p className="text-xs text-gray-500 mt-0.5">경고 (warning)</p>
                </div>
              </div>

              {/* 이슈 목록 */}
              {result.issues.length === 0 ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                  <p className="text-green-700 font-medium">정합성 이슈가 없습니다.</p>
                  <p className="text-green-600 text-sm mt-1">
                    선택한 파일들의 데이터가 일치합니다.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-sm font-medium text-gray-700">
                      이슈 목록 ({result.issues.length}건)
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {result.issues.map((issue, idx) => (
                      <IssueRow
                        key={idx}
                        issue={issue}
                        expanded={expandedKeys.has(`${idx}`)}
                        onToggle={() => toggleExpand(`${idx}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function IssueRow({
  issue,
  expanded,
  onToggle,
}: {
  issue: CheckIssue
  expanded: boolean
  onToggle: () => void
}) {
  const isConflict = issue.severity === 'conflict'

  return (
    <div className={`${isConflict ? 'border-l-4 border-red-400' : 'border-l-4 border-yellow-400'}`}>
      {/* 이슈 헤더 */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span
          className={`mt-0.5 px-2 py-0.5 text-xs font-medium rounded shrink-0 ${
            isConflict
              ? 'bg-red-100 text-red-700'
              : 'bg-yellow-100 text-yellow-700'
          }`}
        >
          {isConflict ? 'conflict' : 'warning'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-800">
              {issue.key_normalized}
            </span>
            {issue.key_variants.length > 1 && (
              <span className="text-xs text-gray-400">
                (변형: {issue.key_variants.join(', ')})
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            컬럼 그룹: <strong>{issue.column_group}</strong> · 관련 파일 {issue.conflicts.length}개
          </p>
        </div>
        <span className="text-gray-400 text-sm shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* 상세 내용 */}
      {expanded && (
        <div className="px-4 pb-4">
          <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">파일</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">컬럼명</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">값</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {issue.conflicts.map((c, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{c.file_name}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{c.column}</td>
                    <td
                      className={`px-3 py-2 font-medium whitespace-nowrap ${
                        isConflict ? 'text-red-700' : 'text-yellow-700'
                      }`}
                    >
                      {c.value || <span className="text-gray-300 font-normal">(빈 값)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issue.key_variants.length > 1 && (
            <p className="text-xs text-gray-400 mt-2">
              원본 key 변형: {issue.key_variants.map((v) => `"${v}"`).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
