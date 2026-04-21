import { useEffect, useState } from 'react'

import { api, FileInfo, JoinResponse } from '../api/client'
import ResultTable from './ResultTable'

type JoinType = 'left' | 'outer' | 'inner'

interface FileSelection {
  fileId: number
  selectedColumns: Set<string>
  allColumns: string[]
}

export default function JoinQuery() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selections, setSelections] = useState<Map<number, FileSelection>>(new Map())
  const [joinType, setJoinType] = useState<JoinType>('outer')
  const [baseFileId, setBaseFileId] = useState<number | null>(null)
  const [result, setResult] = useState<JoinResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [columnsLoading, setColumnsLoading] = useState<Set<number>>(new Set())

  useEffect(() => {
    api.files.list().then((res) => setFiles(res.data)).catch(() => {})
  }, [])

  const toggleFile = async (file: FileInfo) => {
    const next = new Map(selections)
    if (next.has(file.id)) {
      next.delete(file.id)
      if (baseFileId === file.id) {
        const firstRemaining = next.keys().next()
        setBaseFileId(firstRemaining.done ? null : firstRemaining.value)
      }
    } else {
      setColumnsLoading((prev) => new Set(prev).add(file.id))
      try {
        const res = await api.files.schema(file.id)
        const cols = res.data.columns
        next.set(file.id, {
          fileId: file.id,
          selectedColumns: new Set(cols),
          allColumns: cols,
        })
      } catch {
        next.set(file.id, {
          fileId: file.id,
          selectedColumns: new Set(),
          allColumns: [],
        })
      } finally {
        setColumnsLoading((prev) => {
          const nextLoading = new Set(prev)
          nextLoading.delete(file.id)
          return nextLoading
        })
      }

      if (baseFileId === null) {
        setBaseFileId(file.id)
      }
    }

    setSelections(next)
    setResult(null)
  }

  const toggleColumn = (fileId: number, col: string) => {
    const next = new Map(selections)
    const selection = next.get(fileId)
    if (!selection) return

    const cols = new Set(selection.selectedColumns)
    if (cols.has(col)) {
      cols.delete(col)
    } else {
      cols.add(col)
    }

    next.set(fileId, { ...selection, selectedColumns: cols })
    setSelections(next)
    setResult(null)
  }

  const selectAllColumns = (fileId: number, all: boolean) => {
    const next = new Map(selections)
    const selection = next.get(fileId)
    if (!selection) return

    next.set(fileId, {
      ...selection,
      selectedColumns: all ? new Set(selection.allColumns) : new Set(),
    })
    setSelections(next)
    setResult(null)
  }

  const buildRequest = () => {
    const orderedEntries = Array.from(selections.entries()).sort(([fileIdA], [fileIdB]) => {
      if (baseFileId === null) return 0
      if (fileIdA === baseFileId) return -1
      if (fileIdB === baseFileId) return 1
      return 0
    })

    return {
      files: orderedEntries.map(([fileId, selection]) => ({
        file_id: fileId,
        columns: Array.from(selection.selectedColumns),
      })),
      join_type: joinType,
      base_file_id: joinType === 'left' ? baseFileId ?? undefined : undefined,
    }
  }

  const handleJoin = async () => {
    if (selections.size === 0) {
      setError('JOIN할 파일을 선택해 주세요.')
      return
    }
    if (joinType === 'left' && baseFileId === null) {
      setError('LEFT JOIN 기준 파일을 선택해 주세요.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await api.query.join(buildRequest())
      setResult(res.data)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'JOIN 처리에 실패했습니다.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    if (selections.size === 0) return
    try {
      const res = await api.query.export(buildRequest())
      const url = URL.createObjectURL(new Blob([res.data]))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'join_result.xlsx'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Excel 내보내기에 실패했습니다.')
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">JOIN 쿼리</h2>

      {files.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
          먼저 "파일 관리" 탭에서 파일을 등록해 주세요.
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">파일 선택 및 컬럼 지정</h3>
            <div className="space-y-4">
              {files.map((file) => {
                const isSelected = selections.has(file.id)
                const selection = selections.get(file.id)
                const isLoadingCols = columnsLoading.has(file.id)
                return (
                  <div key={file.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                        isSelected ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                      onClick={() => toggleFile(file)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm text-gray-800">{file.name}</span>
                        <span className="ml-2 text-xs text-gray-400">key: {file.key_column}</span>
                      </div>
                      {isLoadingCols && <span className="text-xs text-gray-400">컬럼 로딩 중...</span>}
                    </div>
                    {isSelected && selection && selection.allColumns.length > 0 && (
                      <div className="px-4 py-3 border-t border-gray-100">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xs text-gray-500">가져올 컬럼:</span>
                          <button
                            onClick={() => selectAllColumns(file.id, true)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            전체 선택
                          </button>
                          <button
                            onClick={() => selectAllColumns(file.id, false)}
                            className="text-xs text-gray-500 hover:underline"
                          >
                            전체 해제
                          </button>
                          <span className="text-xs text-gray-400">
                            ({selection.selectedColumns.size}/{selection.allColumns.length})
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selection.allColumns.map((col) => {
                            const isKey = col === file.key_column
                            const checked = selection.selectedColumns.has(col)
                            return (
                              <label
                                key={col}
                                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer ${
                                  isKey
                                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                                    : checked
                                      ? 'bg-white border-gray-300 text-gray-700'
                                      : 'bg-gray-50 border-gray-200 text-gray-400'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => !isKey && toggleColumn(file.id, col)}
                                  disabled={isKey}
                                  className="w-3 h-3"
                                />
                                {col}
                                {isKey && <span className="text-blue-400">(key)</span>}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">JOIN 방식:</label>
                {(['outer', 'left', 'inner'] as JoinType[]).map((type) => (
                  <label key={type} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="joinType"
                      value={type}
                      checked={joinType === type}
                      onChange={() => setJoinType(type)}
                      className="accent-blue-600"
                    />
                    {type === 'outer' ? 'OUTER (전체)' : type === 'left' ? 'LEFT (기준 파일)' : 'INNER (교집합)'}
                  </label>
                ))}
              </div>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={handleJoin}
                  disabled={loading || selections.size === 0}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? '처리 중...' : '미리보기'}
                </button>
                {result && (
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                  >
                    Excel 다운로드
                  </button>
                )}
              </div>
            </div>

            {joinType === 'left' && selections.size > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">기준 파일 선택</p>
                <div className="flex flex-wrap gap-2">
                  {Array.from(selections.keys()).map((fileId) => {
                    const file = files.find((item) => item.id === fileId)
                    if (!file) return null
                    return (
                      <label
                        key={file.id}
                        className={`flex items-center gap-2 px-3 py-2 border rounded text-sm cursor-pointer ${
                          baseFileId === file.id
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="baseFile"
                          checked={baseFileId === file.id}
                          onChange={() => setBaseFileId(file.id)}
                          className="accent-blue-600"
                        />
                        {file.name}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded">
              {error}
              <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">
                ✕
              </button>
            </div>
          )}

          {result && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-700">JOIN 결과 ({result.total_rows}행)</h3>
              </div>
              <ResultTable columns={result.columns} data={result.data} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
