import { useState } from 'react'
import { api, ScannedFileInfo, BulkRegisterResult } from '../api/client'

interface FolderScannerProps {
  onRegistered: () => void
}

interface FileRow {
  info: ScannedFileInfo
  keyColumn: string
  checked: boolean
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
      const newRows: FileRow[] = res.data.files.map((f) => ({
        info: f,
        keyColumn: f.suggested_key_column ?? f.columns[0] ?? '',
        checked: !f.error,
      }))
      setRows(newRows)
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
    setRows((prev) => prev.map((r) => (r.info.error ? r : { ...r, checked })))
  }

  const toggleRow = (idx: number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx && !r.info.error ? { ...r, checked: !r.checked } : r))
    )
  }

  const setKey = (idx: number, key: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, keyColumn: key } : r)))
  }

  const handleBulkRegister = async () => {
    const selected = rows.filter((r) => r.checked && !r.info.error && r.keyColumn)
    if (selected.length === 0) {
      setError('등록할 파일을 선택해 주세요.')
      return
    }
    setRegistering(true)
    setError('')
    setBulkResult(null)
    try {
      const res = await api.files.bulkRegister({
        files: selected.map((r) => ({ path: r.info.path, key_column: r.keyColumn })),
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

  const checkedCount = rows.filter((r) => r.checked).length
  const validCount = rows.filter((r) => !r.info.error).length

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-medium text-gray-700">폴더 스캔으로 일괄 등록</h3>

      {/* 폴더 경로 입력 */}
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
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600"
            />
            하위 폴더 포함 (재귀 스캔)
          </label>
          <button
            onClick={handleScan}
            disabled={scanning || !folderPath.trim()}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {scanning ? '스캔 중...' : '스캔'}
          </button>
        </div>
        <p className="text-xs text-gray-400">지원 형식: .xlsx, .xls, .docx, .pptx</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      {/* 스캔 결과 */}
      {scanDone && rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <strong>{rows.length}</strong>개 파일 발견
              {rows.some((r) => !!r.info.error) && (
                <span className="ml-2 text-red-500 text-xs">
                  ({rows.filter((r) => !!r.info.error).length}개 파싱 실패)
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

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">파일명</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">형식</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-48">key 컬럼</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">경로</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`${row.info.error ? 'bg-red-50 opacity-60' : row.checked ? 'bg-blue-50' : 'bg-white'}`}
                  >
                    <td className="px-3 py-2 text-center">
                      {row.info.error ? (
                        <span title={row.info.error} className="text-red-400 cursor-help">✕</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onChange={() => toggleRow(idx)}
                          className="w-3.5 h-3.5 accent-blue-600"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                      {row.info.name}
                      {row.info.error && (
                        <span className="ml-1 text-red-500 text-xs">({row.info.error})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded">{row.info.file_type}</span>
                    </td>
                    <td className="px-3 py-2">
                      {row.info.columns.length > 0 ? (
                        <select
                          value={row.keyColumn}
                          onChange={(e) => setKey(idx, e.target.value)}
                          disabled={!row.checked}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        >
                          {row.info.columns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                              {col === row.info.suggested_key_column ? ' (추천)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400 max-w-xs truncate" title={row.info.path}>
                      {row.info.path}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
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

      {/* 일괄 등록 결과 */}
      {bulkResult && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">
            등록 완료: <span className="text-blue-600">{bulkResult.filter((r) => r.success).length}개 성공</span>
            {bulkResult.some((r) => !r.success) && (
              <span className="ml-2 text-red-500">
                {bulkResult.filter((r) => !r.success).length}개 실패
              </span>
            )}
          </p>
          {bulkResult.filter((r) => !r.success).map((r, i) => (
            <p key={i} className="text-xs text-red-600">
              ✕ {r.name}: {r.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
