import { useState, useEffect, useRef } from 'react'
import { api, FileInfo, SchemaResponse } from '../api/client'

export default function FileManager() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 파일 등록 폼
  const [filePath, setFilePath] = useState('')
  const [keyColumn, setKeyColumn] = useState('')
  const [availableColumns, setAvailableColumns] = useState<string[]>([])
  const [suggestedKey, setSuggestedKey] = useState('')
  const [registering, setRegistering] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 미리보기 모달
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [schema, setSchema] = useState<SchemaResponse | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)

  const fetchFiles = async () => {
    setLoading(true)
    try {
      const res = await api.files.list()
      setFiles(res.data)
    } catch {
      setError('파일 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // 브라우저 환경에서는 전체 경로 접근 불가 - 파일명만 표시하고 경로는 수동 입력 유도
      setFilePath(file.name)
      setAvailableColumns([])
      setKeyColumn('')
      setSuggestedKey('')
    }
  }

  const handlePathBlur = async () => {
    if (!filePath.trim()) return
    // 경로로 컬럼 미리 조회 시도 (임시 등록 없이)
    // 실제로는 백엔드에 schema 조회 API가 파일 ID 기반이라
    // 여기서는 등록 후 schema를 가져오는 방식으로 처리
  }

  const handleRegister = async () => {
    if (!filePath.trim()) {
      setError('파일 경로를 입력해 주세요.')
      return
    }
    if (!keyColumn.trim()) {
      setError('key 컬럼을 입력해 주세요.')
      return
    }
    setRegistering(true)
    setError('')
    try {
      await api.files.register({ path: filePath.trim(), key_column: keyColumn.trim() })
      setFilePath('')
      setKeyColumn('')
      setAvailableColumns([])
      setSuggestedKey('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await fetchFiles()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '파일 등록에 실패했습니다.'
      setError(msg)
    } finally {
      setRegistering(false)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`"${name}" 파일 등록을 해제하시겠습니까?`)) return
    try {
      await api.files.delete(id)
      await fetchFiles()
    } catch {
      setError('파일 삭제에 실패했습니다.')
    }
  }

  const handlePreview = async (file: FileInfo) => {
    setPreviewFile(file)
    setSchema(null)
    setSchemaLoading(true)
    try {
      const res = await api.files.schema(file.id)
      setSchema(res.data)
    } catch {
      setSchema(null)
    } finally {
      setSchemaLoading(false)
    }
  }

  const handleSuggestKey = async (fileId: number) => {
    try {
      const res = await api.files.suggestKey(fileId)
      setAvailableColumns(res.data.columns)
      setSuggestedKey(res.data.suggested_key_column)
      setKeyColumn(res.data.suggested_key_column)
    } catch {
      // 무시
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">파일 관리</h2>

      {/* 파일 등록 폼 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-4">파일 등록</h3>
        <div className="space-y-3">
          {/* 파일 경로 입력 */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="파일 경로 입력 (예: C:\Users\...\data.xlsx)"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              onBlur={handlePathBlur}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <label className="px-3 py-2 bg-gray-100 border border-gray-300 rounded text-sm cursor-pointer hover:bg-gray-200 whitespace-nowrap">
              파일 선택
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.docx,.pptx"
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>
          </div>

          {/* key 컬럼 입력 */}
          <div className="flex gap-2">
            {availableColumns.length > 0 ? (
              <select
                value={keyColumn}
                onChange={(e) => setKeyColumn(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">key 컬럼 선택</option>
                {availableColumns.map((col) => (
                  <option key={col} value={col}>
                    {col} {col === suggestedKey ? '(추천)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="key 컬럼명 (예: 과제명)"
                value={keyColumn}
                onChange={(e) => setKeyColumn(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
            <button
              onClick={handleRegister}
              disabled={registering}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {registering ? '등록 중...' : '등록'}
            </button>
          </div>

          <p className="text-xs text-gray-400">
            지원 형식: .xlsx, .xls, .docx, .pptx
          </p>
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      )}

      {/* 파일 목록 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">등록된 파일 ({files.length})</h3>
          <button
            onClick={fetchFiles}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            새로고침
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : files.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">
            등록된 파일이 없습니다. 위에서 파일을 등록해 주세요.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">파일명</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">형식</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">key 컬럼</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">컬럼 수</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">등록일시</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {files.map((f) => (
                <tr
                  key={f.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handlePreview(f)}
                >
                  <td className="px-4 py-2.5 text-blue-600 hover:underline font-medium">
                    {f.name}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{f.file_type}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{f.key_column}</td>
                  <td className="px-4 py-2.5 text-gray-500">{f.column_count}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {f.created_at ? f.created_at.replace('T', ' ').slice(0, 19) : '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(f.id, f.name)
                      }}
                      className="text-red-500 hover:text-red-700 text-xs px-2 py-1 border border-red-200 rounded hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 미리보기 모달 */}
      {previewFile && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-800">{previewFile.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{previewFile.path}</p>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto p-5 flex-1">
              {schemaLoading ? (
                <p className="text-gray-400 text-sm">불러오는 중...</p>
              ) : schema ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    컬럼 수: <strong>{schema.columns.length}</strong> | key 컬럼:{' '}
                    <strong>{previewFile.key_column}</strong>
                  </p>
                  <div className="overflow-x-auto border border-gray-200 rounded">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {schema.columns.map((col, i) => (
                            <th
                              key={i}
                              className={`px-3 py-2 text-left font-medium whitespace-nowrap ${
                                col === previewFile.key_column
                                  ? 'text-blue-600 bg-blue-50'
                                  : 'text-gray-600'
                              }`}
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {schema.sample.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400">샘플 데이터 (최대 5행)</p>
                </div>
              ) : (
                <p className="text-red-500 text-sm">스키마를 불러올 수 없습니다.</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => handleSuggestKey(previewFile.id)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                key 컬럼 추천 받기
              </button>
              <button
                onClick={() => setPreviewFile(null)}
                className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
