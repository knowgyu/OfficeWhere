import { useEffect, useMemo, useState } from 'react'

import {
  api,
  FileInfo,
  FileInspectResponse,
  NormalizedFileInspect,
  NormalizedPreview,
  SchemaResponse,
  formatParserConfigSummary,
  getCompareMode,
  getFileTypeLabel,
  isExcelFile,
  normalizeFileInspect,
  normalizeSchemaResponse,
} from '../api/client'
import FolderScanner from './FolderScanner'

export default function FileManager() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [filePath, setFilePath] = useState('')
  const [keyColumn, setKeyColumn] = useState('')
  const [inspectedFile, setInspectedFile] = useState<NormalizedFileInspect | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [registering, setRegistering] = useState(false)

  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [schema, setSchema] = useState<NormalizedPreview | null>(null)
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

  const resetInspection = () => {
    setInspectedFile(null)
    setSelectedCandidateId('')
    setKeyColumn('')
  }

  const applyInspection = (payload: FileInspectResponse) => {
    const normalized = normalizeFileInspect(payload)
    const firstCandidateId = normalized.parserCandidates[0]?.id ?? ''

    setInspectedFile(normalized)
    setFilePath(normalized.path)
    setSelectedCandidateId(firstCandidateId)
    setKeyColumn(normalized.keyRequired ? normalized.suggestedKey || normalized.keyOptions[0] || '' : '')
  }

  const selectedCandidate = useMemo(() => {
    if (!inspectedFile || inspectedFile.compareMode !== 'excel') return null
    return (
      inspectedFile.parserCandidates.find((candidate) => candidate.id === selectedCandidateId) ??
      inspectedFile.parserCandidates[0] ??
      null
    )
  }, [inspectedFile, selectedCandidateId])

  const effectivePreview = useMemo(() => {
    if (!inspectedFile) return null
    if (!selectedCandidate) return inspectedFile.preview

    return {
      ...inspectedFile.preview,
      table: selectedCandidate.table,
      summary:
        selectedCandidate.summary.length > 0 ? selectedCandidate.summary : inspectedFile.preview.summary,
    }
  }, [inspectedFile, selectedCandidate])

  const availableColumns = selectedCandidate?.table.columns ?? inspectedFile?.keyOptions ?? []
  const effectiveParserConfig = selectedCandidate?.parserConfig ?? inspectedFile?.parserConfig ?? {}
  const keyRequired = inspectedFile?.keyRequired ?? false

  const handleInspectPath = async () => {
    if (!filePath.trim()) {
      setError('파일 경로를 입력해 주세요.')
      return
    }

    setInspecting(true)
    setError('')
    try {
      const res = await api.files.inspect({ path: filePath.trim() })
      applyInspection(res.data)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '파일 검사에 실패했습니다.'
      setError(msg)
      resetInspection()
    } finally {
      setInspecting(false)
    }
  }

  const handlePickFile = async () => {
    setPicking(true)
    setError('')
    try {
      const res = await api.files.pick()
      if (!res.data.cancelled && res.data.file) {
        applyInspection(res.data.file)
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '파일 선택창을 열지 못했습니다.'
      setError(msg)
    } finally {
      setPicking(false)
    }
  }

  const handleCandidateChange = (candidateId: string) => {
    if (!inspectedFile || inspectedFile.compareMode !== 'excel') return
    const candidate =
      inspectedFile.parserCandidates.find((item) => item.id === candidateId) ??
      inspectedFile.parserCandidates[0]

    setSelectedCandidateId(candidateId)
    if (!candidate) return

    const nextColumns = candidate.table.columns
    if (nextColumns.length === 0) return

    if (!nextColumns.includes(keyColumn)) {
      const nextKey = inspectedFile.suggestedKey
      setKeyColumn(nextKey && nextColumns.includes(nextKey) ? nextKey : nextColumns[0] ?? '')
    }
  }

  const handleRegister = async () => {
    if (!filePath.trim()) {
      setError('파일 경로를 입력해 주세요.')
      return
    }
    if (!inspectedFile) {
      setError('먼저 파일 검사로 parser/preview 정보를 확인해 주세요.')
      return
    }
    if (keyRequired && !keyColumn.trim()) {
      setError('Excel 등록에는 key 컬럼이 필요합니다.')
      return
    }

    setRegistering(true)
    setError('')
    try {
      await api.files.register({
        path: filePath.trim(),
        key_column: keyRequired ? keyColumn.trim() : '',
        parser_config: effectiveParserConfig,
      })
      setFilePath('')
      resetInspection()
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
      setSchema(normalizeSchemaResponse(res.data as SchemaResponse, file.file_type))
    } catch {
      setSchema(null)
    } finally {
      setSchemaLoading(false)
    }
  }

  const registeredSummary = (file: FileInfo) => {
    const mode = getCompareMode(undefined, file.file_type)
    const parserSummary = formatParserConfigSummary(file.parser_config ?? undefined)

    if (mode === 'excel') {
      return [
        parserSummary.join(' · ') || `등록 컬럼 ${file.column_count}개`,
        file.key_column ? `key ${file.key_column}` : 'key 미지정',
        'JOIN + 멀티 파일 비교',
      ]
    }
    if (mode === 'word') {
      return ['문단/표 블록 diff', '비교 전용', 'key 입력 불필요']
    }
    return ['슬라이드 diff', '추가/삭제 및 변경 감지', 'key 입력 불필요']
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">파일 관리</h2>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-medium text-gray-700">파일 등록</h3>
            <p className="text-xs text-gray-500 mt-1">
              Excel은 표 후보 영역과 추천 key를 확인한 뒤 등록하고, Word/PPT는 key 없이 비교 전용으로 등록합니다.
            </p>
          </div>
          <div className="flex gap-2 text-xs text-gray-500">
            <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              Excel: JOIN + 비교
            </span>
            <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
              Word/PPT: diff 전용
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="파일 경로 입력 또는 파일 찾기 사용"
              value={filePath}
              onChange={(e) => {
                setFilePath(e.target.value)
                if (inspectedFile && e.target.value !== inspectedFile.path) {
                  resetInspection()
                }
              }}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleInspectPath}
              disabled={inspecting}
              className="px-3 py-2 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
            >
              {inspecting ? '검사 중...' : '경로 검사'}
            </button>
            <button
              onClick={handlePickFile}
              disabled={picking}
              className="px-3 py-2 bg-gray-100 border border-gray-300 rounded text-sm hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
            >
              {picking ? '여는 중...' : '파일 찾기'}
            </button>
          </div>

          {inspectedFile && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <p className="font-medium text-blue-950">{inspectedFile.name}</p>
                  <p className="text-xs text-blue-700 break-all">{inspectedFile.path}</p>
                  <div className="flex gap-2 flex-wrap text-xs">
                    <span className="px-2 py-1 rounded-full bg-white border border-blue-200 text-blue-700">
                      {getFileTypeLabel(inspectedFile.fileType)}
                    </span>
                    <span className="px-2 py-1 rounded-full bg-white border border-blue-200 text-blue-700">
                      {inspectedFile.compareMode === 'excel'
                        ? '표 기반 비교'
                        : inspectedFile.compareMode === 'word'
                          ? '문서 diff'
                          : '슬라이드 diff'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {inspectedFile.capabilitySummary.map((item) => (
                    <span
                      key={item}
                      className="px-2 py-1 rounded-full bg-white border border-blue-100 text-xs text-blue-700"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              {inspectedFile.compareMode === 'excel' && inspectedFile.parserCandidates.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm font-medium text-blue-950">표 후보 영역</p>
                    <span className="text-xs text-blue-700">
                      선택한 parser_config가 등록 시 함께 저장됩니다.
                    </span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {inspectedFile.parserCandidates.map((candidate) => {
                      const active = candidate.id === (selectedCandidate?.id ?? '')
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => handleCandidateChange(candidate.id)}
                          className={`text-left rounded-lg border p-3 transition-colors ${
                            active
                              ? 'bg-white border-blue-300 shadow-sm'
                              : 'bg-blue-50/50 border-blue-100 hover:bg-white'
                          }`}
                        >
                          <p className="text-sm font-medium text-gray-800">{candidate.label}</p>
                          <div className="mt-2 flex gap-2 flex-wrap">
                            {candidate.summary.map((item) => (
                              <span
                                key={item}
                                className="px-2 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs text-gray-600"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,240px)_1fr] gap-4">
                <div className="space-y-3">
                  <div className="rounded-lg border border-blue-100 bg-white p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      등록 옵션
                    </p>
                    {keyRequired ? (
                      <div className="mt-3 space-y-2">
                        <label className="text-sm font-medium text-gray-700">key 컬럼</label>
                        {availableColumns.length > 0 ? (
                          <select
                            value={keyColumn}
                            onChange={(e) => setKeyColumn(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">key 컬럼 선택</option>
                            {availableColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                                {column === inspectedFile.suggestedKey ? ' (추천)' : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="key 컬럼명"
                            value={keyColumn}
                            onChange={(e) => setKeyColumn(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        )}
                        <p className="text-xs text-gray-500">
                          추천 key: <strong>{inspectedFile.suggestedKey || '없음'}</strong>
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
                        <p className="text-sm text-gray-700">이 형식은 key 없이 등록됩니다.</p>
                        <p className="text-xs text-gray-500 mt-1">
                          비교 시 문서 diff 엔진이 parser_config와 내부 블록/슬라이드 구조를 사용합니다.
                        </p>
                      </div>
                    )}

                    {formatParserConfigSummary(effectiveParserConfig).length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          저장될 parser_config
                        </p>
                        {formatParserConfigSummary(effectiveParserConfig).map((item) => (
                          <p key={item} className="text-xs text-gray-600">
                            {item}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRegister}
                    disabled={registering}
                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {registering ? '등록 중...' : '현재 설정으로 등록'}
                  </button>
                </div>

                <div className="rounded-lg border border-blue-100 bg-white p-4">
                  <p className="text-sm font-medium text-gray-800 mb-3">미리보기</p>
                  {effectivePreview && <PreviewPanel preview={effectivePreview} />}
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">
          지원 형식: .xlsx, .xls, .docx, .pptx. Excel은 표 후보와 key를 확인한 뒤 등록하고, Word/PPT는 compare-only 문서로 관리합니다.
        </p>
      </div>

      <FolderScanner onRegistered={fetchFiles} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-700">등록된 파일 ({files.length})</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              파일 타입별 parser/config와 비교 capability를 기준으로 관리합니다.
            </p>
          </div>
          <button onClick={fetchFiles} className="text-xs text-gray-500 hover:text-gray-700">
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
          <div className="divide-y divide-gray-100">
            {files.map((file) => (
              <div key={file.id} className="px-5 py-4 flex items-start justify-between gap-4">
                <button
                  type="button"
                  onClick={() => handlePreview(file)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-blue-600 hover:underline">
                      {file.name}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                      {getFileTypeLabel(file.file_type)}
                    </span>
                    {isExcelFile(file.file_type) ? (
                      <span className="px-2 py-0.5 bg-blue-50 rounded text-xs text-blue-700">
                        JOIN 가능
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-50 rounded text-xs text-amber-700">
                        비교 전용
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1 break-all">{file.path}</p>
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {registeredSummary(file).map((item) => (
                      <span
                        key={item}
                        className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-600"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </button>

                <div className="shrink-0 text-right space-y-3">
                  <div className="text-xs text-gray-400">
                    {file.created_at ? file.created_at.replace('T', ' ').slice(0, 19) : '-'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {isExcelFile(file.file_type) && file.key_column ? `key ${file.key_column}` : 'key 없음'}
                  </div>
                  <button
                    onClick={() => handleDelete(file.id, file.name)}
                    className="text-red-500 hover:text-red-700 text-xs px-2 py-1 border border-red-200 rounded hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewFile && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <h3 className="font-medium text-gray-800">{previewFile.name}</h3>
                <p className="text-xs text-gray-500 break-all">{previewFile.path}</p>
                <div className="flex gap-2 flex-wrap">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                    {getFileTypeLabel(previewFile.file_type)}
                  </span>
                  {isExcelFile(previewFile.file_type) && previewFile.key_column && (
                    <span className="px-2 py-0.5 bg-blue-50 rounded text-xs text-blue-700">
                      key {previewFile.key_column}
                    </span>
                  )}
                </div>
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
                <div className="space-y-4">
                  {formatParserConfigSummary(previewFile.parser_config ?? undefined).length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {formatParserConfigSummary(previewFile.parser_config ?? undefined).map((item) => (
                        <span
                          key={item}
                          className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-600"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  <PreviewPanel preview={schema} />
                </div>
              ) : (
                <p className="text-red-500 text-sm">미리보기를 불러올 수 없습니다.</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
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

function PreviewPanel({ preview }: { preview: NormalizedPreview }) {
  return (
    <div className="space-y-4">
      {preview.summary.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {preview.summary.map((item) => (
            <span
              key={item}
              className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-600"
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {preview.mode === 'excel' || preview.table.columns.length > 0 ? (
        <div className="overflow-x-auto border border-gray-200 rounded bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {preview.table.columns.map((column) => (
                  <th key={column} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.table.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(preview.table.columns.length, 1)}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    표시할 샘플 행이 없습니다.
                  </td>
                </tr>
              ) : (
                preview.table.rows.map((row, rowIndex) => (
                  <tr key={`${row.join('|')}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${cell}-${cellIndex}`} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {preview.mode === 'word' && preview.blocks.length > 0 && (
        <div className="space-y-2">
          {preview.blocks.map((block) => (
            <div key={block.id} className="rounded-lg border border-gray-200 p-3 bg-white">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {block.blockType}
                </span>
                <span>{block.location}</span>
              </div>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap break-words">{block.text || '(빈 블록)'}</p>
            </div>
          ))}
        </div>
      )}

      {preview.mode === 'ppt' && preview.slides.length > 0 && (
        <div className="space-y-3">
          {preview.slides.map((slide) => (
            <div key={slide.id} className="rounded-lg border border-gray-200 p-3 bg-white">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700">
                  Slide {slide.slideNumber}
                </span>
                <span className="text-sm font-medium text-gray-800">{slide.title}</span>
              </div>
              {slide.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {slide.items.map((item) => (
                    <div key={item.id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                      <p className="text-xs text-gray-500">
                        {item.itemType} · {item.location}
                      </p>
                      <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">
                        {item.afterText || item.beforeText || '(텍스트 없음)'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 mt-2">표시할 슬라이드 항목이 없습니다.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
