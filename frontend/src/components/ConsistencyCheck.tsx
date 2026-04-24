import { useEffect, useMemo, useState } from 'react'

import {
  api,
  CheckResponse,
  ExcelCheckIssue,
  FileInfo,
  PptSlideCard,
  WordDiffCard,
  getCompareMode,
  getFileTypeLabel,
  normalizeCheckResponse,
} from '../api/client'

export default function ConsistencyCheck() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.files.list().then((res) => setFiles(res.data)).catch(() => {})
  }, [])

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedIds.has(file.id)),
    [files, selectedIds]
  )
  const selectedMode = selectedFiles[0] ? getCompareMode(undefined, selectedFiles[0].file_type) : null

  const toggleFile = (file: FileInfo) => {
    const next = new Set(selectedIds)
    const isSelected = next.has(file.id)
    const fileMode = getCompareMode(undefined, file.file_type)

    if (isSelected) {
      next.delete(file.id)
      setSelectedIds(next)
      setResult(null)
      setError('')
      return
    }

    if (selectedMode && fileMode !== selectedMode) {
      setError('정합성 검사는 같은 파일 타입만 함께 선택할 수 있습니다.')
      return
    }

    if ((fileMode === 'word' || fileMode === 'ppt') && next.size >= 2) {
      setError(`${fileMode === 'word' ? 'Word' : 'PPT'} 비교는 2개 파일만 선택할 수 있습니다.`)
      return
    }

    next.add(file.id)
    setSelectedIds(next)
    setResult(null)
    setError('')
  }

  const validateSelection = (): string | null => {
    if (selectedFiles.length < 2) {
      return '정합성 검사는 최소 2개 파일을 선택해야 합니다.'
    }

    const modes = new Set(selectedFiles.map((file) => getCompareMode(undefined, file.file_type)))
    if (modes.size > 1) {
      return '파일 타입이 섞이면 검사할 수 없습니다. 같은 타입만 선택해 주세요.'
    }

    const mode = selectedMode
    if (!mode) {
      return '검사할 파일을 선택해 주세요.'
    }
    if ((mode === 'word' || mode === 'ppt') && selectedFiles.length !== 2) {
      return `${mode === 'word' ? 'Word' : 'PPT'} 비교는 정확히 2개 파일만 허용됩니다.`
    }

    return null
  }

  const handleCheck = async () => {
    const validationError = validateSelection()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await api.check.run({ file_ids: Array.from(selectedIds) })
      setResult(normalizeCheckResponse(res.data))
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '정합성 검사에 실패했습니다.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const modeGuide =
    selectedMode === 'excel'
      ? 'Excel은 다중 선택이 가능하며 value conflict, missing key, missing column을 확인합니다.'
      : selectedMode === 'word'
        ? 'Word는 2개 파일만 비교하며 insert/delete/replace diff를 보여줍니다.'
        : selectedMode === 'ppt'
          ? 'PPT는 2개 파일만 비교하며 슬라이드 추가/삭제와 항목 변경을 보여줍니다.'
          : 'Excel은 다중 선택 가능, Word/PPT는 2개 파일만 비교 가능합니다.'

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">정합성 검사</h2>

      {files.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
          먼저 "파일 관리" 탭에서 파일을 등록해 주세요.
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-medium text-gray-700">검사할 파일 선택</h3>
                <p className="text-xs text-gray-500 mt-1">{modeGuide}</p>
              </div>
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  선택 {selectedFiles.length}개
                </span>
                {selectedMode && (
                  <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                    현재 모드 {selectedMode.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {files.map((file) => {
                const checked = selectedIds.has(file.id)
                const fileMode = getCompareMode(undefined, file.file_type)
                const disabled =
                  !checked &&
                  Boolean(
                    (selectedMode && fileMode !== selectedMode) ||
                      ((selectedMode === 'word' || selectedMode === 'ppt') && selectedIds.size >= 2)
                  )

                return (
                  <label
                    key={file.id}
                    className={`flex items-center gap-3 px-3 py-2.5 border rounded-lg transition-colors ${
                      disabled
                        ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                        : checked
                          ? 'border-blue-300 bg-blue-50 cursor-pointer'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleFile(file)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                        <span className="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-xs text-gray-600">
                          {getFileTypeLabel(file.file_type)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {fileMode === 'excel'
                          ? `key ${file.key_column || '미지정'} · 다중 비교`
                          : `${fileMode === 'word' ? '문서 diff' : '슬라이드 diff'} · 2개 비교`}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleCheck}
                disabled={loading || selectedFiles.length < 2}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '검사 중...' : '검사 실행'}
              </button>
              <span className="text-xs text-gray-500">{modeGuide}</span>
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

          {result && result.mode === 'excel' && <ExcelCheckResult result={result} />}
          {result && result.mode === 'word' && <WordCheckResult diffs={result.diffs} />}
          {result && result.mode === 'ppt' && <PptCheckResult slides={result.slides} />}
        </>
      )}
    </div>
  )
}

function ExcelCheckResult({
  result,
}: {
  result: Extract<CheckResponse, { mode: 'excel' }>
}) {
  const valueConflicts = result.issues.filter((issue) => issue.type === 'value_conflict')
  const missingKeys = result.issues.filter((issue) => issue.type === 'missing_key')
  const missingColumns = result.issues.filter((issue) => issue.type === 'missing_column')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <SummaryCard label="전체 key" value={String(result.totalKeys)} accent="gray" />
        <SummaryCard label="공통 key" value={String(result.matchedKeys)} accent="green" />
        <SummaryCard label="value conflict" value={String(valueConflicts.length)} accent="red" />
        <SummaryCard label="missing key" value={String(missingKeys.length)} accent="amber" />
        <SummaryCard label="missing column" value={String(missingColumns.length)} accent="amber" />
      </div>

      <ExcelIssueSection
        title="Value Conflict"
        description="같은 key에서 같은 컬럼 그룹의 값이 서로 다릅니다."
        issues={valueConflicts}
      />
      <ExcelIssueSection
        title="Missing Key"
        description="일부 파일에 key가 없어서 데이터가 누락됩니다."
        issues={missingKeys}
      />
      <ExcelIssueSection
        title="Missing Column"
        description="일부 파일에 컬럼 그룹이 존재하지 않습니다."
        issues={missingColumns}
      />
    </div>
  )
}

function ExcelIssueSection({
  title,
  description,
  issues,
}: {
  title: string
  description: string
  issues: ExcelCheckIssue[]
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      </div>

      {issues.length === 0 ? (
        <div className="px-5 py-6 text-sm text-gray-400">해당 이슈가 없습니다.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {issues.map((issue) => (
            <div key={issue.id} className="px-5 py-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">{issue.key || '(빈 key)'}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        issue.severity === 'conflict'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {issue.severity}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    컬럼 그룹: <strong>{issue.columnGroup || '-'}</strong>
                  </p>
                  {issue.keyVariants.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      key 변형: {issue.keyVariants.join(', ')}
                    </p>
                  )}
                </div>
                <p className="text-sm text-gray-600">{issue.message}</p>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">파일</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">컬럼</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">행 수</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">값</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {issue.conflicts.map((conflict) => (
                      <tr key={`${issue.id}-${conflict.fileId}`}>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{conflict.fileName}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {conflict.columns.join(', ') || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{conflict.rowCount}</td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                          {conflict.values.join(' | ') || '(빈 값)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WordCheckResult({ diffs }: { diffs: WordDiffCard[] }) {
  const insertCount = diffs.filter((diff) => diff.type === 'insert').length
  const deleteCount = diffs.filter((diff) => diff.type === 'delete').length
  const replaceCount = diffs.filter((diff) => diff.type === 'replace').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <SummaryCard label="전체 변경" value={String(diffs.length)} accent="gray" />
        <SummaryCard label="insert" value={String(insertCount)} accent="green" />
        <SummaryCard label="delete" value={String(deleteCount)} accent="red" />
        <SummaryCard label="replace" value={String(replaceCount)} accent="amber" />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-medium text-gray-700">Word Diff 카드</h3>
        </div>

        {diffs.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-400">문서 변경점이 없습니다.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {diffs.map((diff) => (
              <div key={diff.id} className="px-5 py-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      diff.type === 'insert'
                        ? 'bg-green-100 text-green-700'
                        : diff.type === 'delete'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {diff.type}
                  </span>
                  <span className="text-sm font-medium text-gray-800">{diff.location}</span>
                  <span className="text-xs text-gray-500">{diff.blockType}</span>
                </div>

                <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="Before" content={diff.beforeText} tone="red" />
                  <DiffPanel title="After" content={diff.afterText} tone="green" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PptCheckResult({ slides }: { slides: PptSlideCard[] }) {
  const inserted = slides.filter((slide) => slide.type === 'inserted_slide').length
  const removed = slides.filter((slide) => slide.type === 'removed_slide').length
  const changed = slides.filter((slide) => slide.type === 'matched_slide_change').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <SummaryCard label="전체 변경" value={String(slides.length)} accent="gray" />
        <SummaryCard label="inserted slide" value={String(inserted)} accent="green" />
        <SummaryCard label="removed slide" value={String(removed)} accent="red" />
        <SummaryCard label="matched change" value={String(changed)} accent="amber" />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-medium text-gray-700">PPT 변경 카드</h3>
        </div>

        {slides.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-400">슬라이드 변경점이 없습니다.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {slides.map((slide) => (
              <div key={slide.id} className="px-5 py-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      slide.type === 'inserted_slide'
                        ? 'bg-green-100 text-green-700'
                        : slide.type === 'removed_slide'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {slide.type}
                  </span>
                  <span className="text-sm font-medium text-gray-800">
                    Slide {slide.slideNumber}
                    {slide.matchedSlideNumber ? ` ↔ ${slide.matchedSlideNumber}` : ''}
                  </span>
                  <span className="text-xs text-gray-500">{slide.title}</span>
                </div>

                <p className="text-sm text-gray-600">{slide.description}</p>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="Before" content={slide.beforeText} tone="red" />
                  <DiffPanel title="After" content={slide.afterText} tone="green" />
                </div>

                <p className="text-xs text-gray-400">항목 유형: {slide.itemType || 'slide'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'gray' | 'green' | 'red' | 'amber'
}) {
  const accentClass =
    accent === 'green'
      ? 'border-green-200 text-green-600'
      : accent === 'red'
        ? 'border-red-200 text-red-600'
        : accent === 'amber'
          ? 'border-amber-200 text-amber-600'
          : 'border-gray-200 text-gray-800'

  return (
    <div className={`bg-white border rounded-lg px-4 py-3 text-center ${accentClass}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function DiffPanel({
  title,
  content,
  tone,
}: {
  title: string
  content: string
  tone: 'red' | 'green'
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === 'red' ? 'border-red-100 bg-red-50/60' : 'border-green-100 bg-green-50/60'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap break-words">
        {content || '(내용 없음)'}
      </p>
    </div>
  )
}
