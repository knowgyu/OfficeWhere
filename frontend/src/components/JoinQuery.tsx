import { useEffect, useMemo, useState } from 'react'

import { api, FileInfo, JoinResponse, getSchemaColumns, getFileTypeLabel, isExcelFile } from '../api/client'
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

  const excelFiles = useMemo(() => files.filter((file) => isExcelFile(file.file_type)), [files])
  const compareOnlyFiles = useMemo(() => files.filter((file) => !isExcelFile(file.file_type)), [files])

  const toggleFile = async (file: FileInfo) => {
    if (!isExcelFile(file.file_type)) return

    const next = new Map(selections)
    if (next.has(file.id)) {
      next.delete(file.id)
      if (baseFileId === file.id) {
        const firstRemaining = next.keys().next()
        setBaseFileId(firstRemaining.done ? null : firstRemaining.value)
      }
      setSelections(next)
      setResult(null)
      return
    }

    setColumnsLoading((prev) => new Set(prev).add(file.id))
    try {
      const res = await api.files.schema(file.id)
      const columns = getSchemaColumns(res.data, file.file_type)
      next.set(file.id, {
        fileId: file.id,
        selectedColumns: new Set(columns),
        allColumns: columns,
      })
      if (baseFileId === null) {
        setBaseFileId(file.id)
      }
      setSelections(next)
      setResult(null)
    } catch {
      setError(`"${file.name}" 스키마를 불러오지 못했습니다.`)
    } finally {
      setColumnsLoading((prev) => {
        const nextLoading = new Set(prev)
        nextLoading.delete(file.id)
        return nextLoading
      })
    }
  }

  const toggleColumn = (fileId: number, column: string) => {
    const next = new Map(selections)
    const selection = next.get(fileId)
    if (!selection) return

    const selectedColumns = new Set(selection.selectedColumns)
    if (selectedColumns.has(column)) {
      selectedColumns.delete(column)
    } else {
      selectedColumns.add(column)
    }

    next.set(fileId, { ...selection, selectedColumns })
    setSelections(next)
    setResult(null)
  }

  const selectAllColumns = (fileId: number, selectAll: boolean) => {
    const next = new Map(selections)
    const selection = next.get(fileId)
    if (!selection) return

    next.set(fileId, {
      ...selection,
      selectedColumns: selectAll ? new Set(selection.allColumns) : new Set(),
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
      setError('JOIN할 Excel 파일을 선택해 주세요.')
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
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-medium text-gray-700">JOIN 대상 파일 선택</h3>
                <p className="text-xs text-gray-500 mt-1">
                  JOIN은 Excel 파이프라인 전용입니다. Word/PPT는 비교 전용 문서라 이 화면에서 선택할 수 없습니다.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  선택 가능 {excelFiles.length}개
                </span>
                <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                  compare-only {compareOnlyFiles.length}개
                </span>
              </div>
            </div>

            {excelFiles.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                등록된 Excel 파일이 없습니다. JOIN을 사용하려면 Excel 파일을 먼저 등록해 주세요.
              </div>
            ) : (
              <div className="space-y-4">
                {excelFiles.map((file) => {
                  const isSelected = selections.has(file.id)
                  const selection = selections.get(file.id)
                  const isLoadingColumns = columnsLoading.has(file.id)

                  return (
                    <div key={file.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div
                        className={`flex items-start gap-3 px-4 py-3 cursor-pointer ${
                          isSelected ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                        onClick={() => void toggleFile(file)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 mt-0.5 accent-blue-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-800">{file.name}</span>
                            <span className="px-2 py-0.5 bg-white border border-blue-100 rounded text-xs text-blue-700">
                              key {file.key_column || '미지정'}
                            </span>
                            <span className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-600">
                              컬럼 {file.column_count}개
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1 break-all">{file.path}</p>
                        </div>
                        {isLoadingColumns && <span className="text-xs text-gray-400">컬럼 로딩 중...</span>}
                      </div>

                      {isSelected && selection && (
                        <div className="px-4 py-3 border-t border-gray-100 bg-white">
                          <div className="flex items-center gap-3 mb-3 flex-wrap">
                            <span className="text-xs text-gray-500">가져올 컬럼</span>
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
                              {selection.selectedColumns.size}/{selection.allColumns.length}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selection.allColumns.map((column) => {
                              const isKey = column === file.key_column
                              const checked = selection.selectedColumns.has(column)
                              return (
                                <label
                                  key={column}
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
                                    onChange={() => !isKey && toggleColumn(file.id, column)}
                                    disabled={isKey}
                                    className="w-3 h-3"
                                  />
                                  {column}
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
            )}

            {compareOnlyFiles.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-medium text-gray-700">JOIN 제외 파일</p>
                <div className="mt-3 flex gap-2 flex-wrap">
                  {compareOnlyFiles.map((file) => (
                    <span
                      key={file.id}
                      className="px-2 py-1 rounded-full border border-gray-200 bg-white text-xs text-gray-600"
                    >
                      {file.name} · {getFileTypeLabel(file.file_type)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-sm font-medium text-gray-700">JOIN 방식</label>
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
                    {type === 'outer' ? 'OUTER' : type === 'left' ? 'LEFT' : 'INNER'}
                  </label>
                ))}
              </div>
              <div className="text-xs text-gray-500">
                선택된 Excel 파일 {selections.size}개
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
                    const file = excelFiles.find((item) => item.id === fileId)
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
                <div>
                  <h3 className="text-sm font-medium text-gray-700">JOIN 결과</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Excel parser_config로 읽은 표만 대상으로 JOIN했습니다. 총 {result.total_rows}행
                  </p>
                </div>
              </div>
              <ResultTable columns={result.columns} data={result.data} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
