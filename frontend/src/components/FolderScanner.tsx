import { useMemo, useState } from 'react'

import {
  api,
  BulkRegisterResult,
  NormalizedFileInspect,
  ScannedFileInfo,
  getFileTypeLabel,
  normalizeFileInspect,
} from '../api/client'

interface FolderScannerProps {
  onRegistered: () => void
}

interface FileRow {
  raw: ScannedFileInfo
  info: NormalizedFileInspect
  keyColumn: string
  selectedCandidateId: string
  checked: boolean
  error?: string
}

export default function FolderScanner({ onRegistered }: FolderScannerProps) {
  const [folderPath, setFolderPath] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [picking, setPicking] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [rows, setRows] = useState<FileRow[]>([])
  const [scanDone, setScanDone] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkRegisterResult[] | null>(null)
  const [error, setError] = useState('')

  const handlePickFolder = async () => {
    setPicking(true)
    setError('')
    try {
      const res = await api.files.pickFolder()
      if (!res.data.cancelled && res.data.folder_path) {
        setFolderPath(res.data.folder_path)
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '폴더 선택창을 열지 못했습니다.'
      setError(msg)
    } finally {
      setPicking(false)
    }
  }

  const handleScan = async () => {
    if (!folderPath.trim()) {
      setError('폴더 경로를 입력해 주세요.')
      return
    }

    setScanning(true)
    setError('')
    setRows([])
    setScanDone(false)
    setBulkResult(null)
    try {
      const res = await api.files.scanFolder({ folder_path: folderPath.trim(), recursive })
      const nextRows = res.data.files.map((file) => buildRow(file))
      setRows(nextRows)
      setScanDone(true)
      if (res.data.total_found === 0) {
        setError('지원 파일(.xlsx, .xls, .docx, .pptx)을 찾을 수 없습니다.')
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '폴더 스캔에 실패했습니다.'
      setError(msg)
    } finally {
      setScanning(false)
    }
  }

  const toggleAll = (checked: boolean) => {
    setRows((prev) => prev.map((row) => (row.error ? row : { ...row, checked })))
  }

  const toggleRow = (index: number) => {
    setRows((prev) =>
      prev.map((row, currentIndex) =>
        currentIndex === index && !row.error ? { ...row, checked: !row.checked } : row
      )
    )
  }

  const setKeyColumn = (index: number, keyColumn: string) => {
    setRows((prev) =>
      prev.map((row, currentIndex) =>
        currentIndex === index ? { ...row, keyColumn } : row
      )
    )
  }

  const setCandidate = (index: number, candidateId: string) => {
    setRows((prev) =>
      prev.map((row, currentIndex) => {
        if (currentIndex !== index) return row
        const candidate =
          row.info.parserCandidates.find((item) => item.id === candidateId) ??
          row.info.parserCandidates[0]

        if (!candidate) {
          return { ...row, selectedCandidateId: candidateId }
        }

        const nextColumns = candidate.table.columns
        const nextKey =
          !row.info.keyRequired || nextColumns.includes(row.keyColumn)
            ? row.keyColumn
            : row.info.suggestedKey && nextColumns.includes(row.info.suggestedKey)
              ? row.info.suggestedKey
              : nextColumns[0] ?? ''

        return {
          ...row,
          selectedCandidateId: candidateId,
          keyColumn: nextKey,
        }
      })
    )
  }

  const handleBulkRegister = async () => {
    const selected = rows.filter(
      (row) => row.checked && !row.error && (!row.info.keyRequired || Boolean(row.keyColumn))
    )
    if (selected.length === 0) {
      setError('등록할 파일을 선택해 주세요.')
      return
    }

    setRegistering(true)
    setError('')
    setBulkResult(null)
    try {
      const res = await api.files.bulkRegister({
        files: selected.map((row) => ({
          path: row.raw.path,
          key_column: row.info.keyRequired ? row.keyColumn : '',
          parser_config: getSelectedParserConfig(row),
        })),
      })
      setBulkResult(res.data.results)
      onRegistered()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '일괄 등록에 실패했습니다.'
      setError(msg)
    } finally {
      setRegistering(false)
    }
  }

  const checkedCount = rows.filter((row) => row.checked).length
  const validCount = rows.filter((row) => !row.error).length
  const selectedRows = useMemo(() => rows.filter((row) => row.checked && !row.error), [rows])

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-medium text-gray-700">폴더 스캔으로 일괄 등록</h3>
          <p className="text-xs text-gray-500 mt-1">
            Excel은 파일별 parser 후보와 key를 선택하고, Word/PPT는 key 없이 compare-only로 등록합니다.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap text-xs text-gray-500">
          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
            후보 영역 선택 가능
          </span>
          <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
            bulk register에 parser_config 포함
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="폴더 경로 입력 또는 폴더 찾기 사용"
            value={folderPath}
            onChange={(e) => {
              setFolderPath(e.target.value)
              setScanDone(false)
              setRows([])
              setBulkResult(null)
            }}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handlePickFolder}
            disabled={picking}
            className="px-3 py-2 bg-gray-100 border border-gray-300 rounded text-sm hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
          >
            {picking ? '여는 중...' : '폴더 찾기'}
          </button>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600"
            />
            하위 폴더 포함
          </label>
          <button
            onClick={handleScan}
            disabled={scanning || !folderPath.trim()}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {scanning ? '스캔 중...' : '스캔'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      )}

      {scanDone && rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-600">
              <strong>{rows.length}</strong>개 파일 발견
              {rows.some((row) => !!row.error) && (
                <span className="ml-2 text-red-500 text-xs">
                  파싱 실패 {rows.filter((row) => !!row.error).length}개
                </span>
              )}
            </p>
            <div className="flex items-center gap-3 text-xs">
              <button onClick={() => toggleAll(true)} className="text-blue-600 hover:underline">
                전체 선택
              </button>
              <button onClick={() => toggleAll(false)} className="text-gray-500 hover:underline">
                전체 해제
              </button>
              <span className="text-gray-400">{checkedCount}/{validCount} 선택</span>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row, index) => {
              const selectedCandidate =
                row.info.parserCandidates.find((item) => item.id === row.selectedCandidateId) ??
                row.info.parserCandidates[0]
              const previewTable = selectedCandidate?.table ?? row.info.preview.table

              return (
                <div
                  key={`${row.raw.path}-${index}`}
                  className={`border rounded-lg p-4 ${
                    row.error
                      ? 'border-red-200 bg-red-50/60'
                      : row.checked
                        ? 'border-blue-200 bg-blue-50/40'
                        : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {row.error ? (
                        <span className="text-red-500 text-sm pt-0.5">✕</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onChange={() => toggleRow(index)}
                          className="w-4 h-4 mt-1 accent-blue-600"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">{row.raw.name}</p>
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600">
                            {getFileTypeLabel(row.raw.file_type)}
                          </span>
                          {row.info.keyRequired ? (
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-xs text-blue-700">
                              key 필요
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-gray-50 text-xs text-gray-700">
                              key 불필요
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1 break-all">{row.raw.path}</p>
                        {row.error && <p className="text-xs text-red-600 mt-2">{row.error}</p>}
                        <div className="mt-3 flex gap-2 flex-wrap">
                          {row.info.capabilitySummary.map((item) => (
                            <span
                              key={item}
                              className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-600"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {!row.error && row.checked && (
                      <div className="w-full max-w-sm space-y-3">
                        {row.info.keyRequired && row.info.parserCandidates.length > 0 && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                              표 후보 영역
                            </label>
                            <select
                              value={row.selectedCandidateId}
                              onChange={(e) => setCandidate(index, e.target.value)}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              {row.info.parserCandidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.label}
                                </option>
                              ))}
                            </select>
                            {selectedCandidate?.summary.length ? (
                              <p className="text-xs text-gray-500 mt-2">
                                {selectedCandidate.summary.join(' · ')}
                              </p>
                            ) : null}
                          </div>
                        )}

                        {row.info.keyRequired ? (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                              key 컬럼
                            </label>
                            <select
                              value={row.keyColumn}
                              onChange={(e) => setKeyColumn(index, e.target.value)}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">key 컬럼 선택</option>
                              {(selectedCandidate?.table.columns ?? row.info.keyOptions).map((column) => (
                                <option key={column} value={column}>
                                  {column}
                                  {column === row.info.suggestedKey ? ' (추천)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                            비교 전용 등록. key 없이 parser_config만 저장합니다.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {!row.error && row.checked && previewTable.columns.length > 0 && (
                    <div className="mt-4 overflow-x-auto border border-gray-200 rounded">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            {previewTable.columns.map((column) => (
                              <th
                                key={column}
                                className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap"
                              >
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {previewTable.rows.slice(0, 3).map((previewRow, previewIndex) => (
                            <tr key={`${previewRow.join('|')}-${previewIndex}`}>
                              {previewRow.map((cell, cellIndex) => (
                                <td
                                  key={`${cell}-${cellIndex}`}
                                  className="px-3 py-2 text-gray-700 whitespace-nowrap"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-gray-500">
              선택된 파일 {selectedRows.length}개가 현재 설정으로 등록됩니다.
            </div>
            <button
              onClick={handleBulkRegister}
              disabled={registering || checkedCount === 0}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {registering ? '등록 중...' : `선택 파일 ${checkedCount}개 일괄 등록`}
            </button>
          </div>
        </div>
      )}

      {bulkResult && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">
            등록 완료: <span className="text-blue-600">{bulkResult.filter((item) => item.success).length}개 성공</span>
            {bulkResult.some((item) => !item.success) && (
              <span className="ml-2 text-red-500">
                {bulkResult.filter((item) => !item.success).length}개 실패
              </span>
            )}
          </p>
          {bulkResult.filter((item) => !item.success).map((item, index) => (
            <p key={`${item.path}-${index}`} className="text-xs text-red-600">
              ✕ {item.name}: {item.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function buildRow(file: ScannedFileInfo): FileRow {
  const normalized = normalizeFileInspect(file)
  return {
    raw: file,
    info: normalized,
    keyColumn: normalized.keyRequired ? normalized.suggestedKey || normalized.keyOptions[0] || '' : '',
    selectedCandidateId: normalized.parserCandidates[0]?.id ?? '',
    checked: !file.error,
    error: file.error,
  }
}

function getSelectedParserConfig(row: FileRow) {
  return (
    row.info.parserCandidates.find((item) => item.id === row.selectedCandidateId)?.parserConfig ??
    row.info.parserConfig
  )
}
