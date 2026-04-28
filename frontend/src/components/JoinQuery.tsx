import { useEffect, useMemo, useState } from 'react'

import {
  api,
  FileInfo,
  JoinResponse,
  getSchemaColumns,
  isExcelFile,
} from '../api/client'
import {
  Badge,
  Button,
  Card,
  CardSection,
  Checkbox,
  Chip,
  EmptyState,
  FileTypeBadge,
  Icon,
  Radio,
  SegmentedButton,
  Spinner,
  TextField,
  useSnackbar,
} from '../ui'
import ResultTable from './ResultTable'

type JoinType = 'left' | 'outer' | 'inner'
const JOIN_FILE_PAGE_SIZE = 50

const JOIN_TYPE_HELP: Record<JoinType, string> = {
  outer: '모든 파일의 기준 컬럼 값을 빠짐없이 모읍니다. 누락된 값은 빈칸으로 표시됩니다.',
  left: '기준 파일에 있는 행만 남기고, 다른 파일의 컬럼 값을 옆에 붙입니다.',
  inner: '선택한 모든 파일에 공통으로 있는 행만 남깁니다.',
}

interface FileSelection {
  fileId: number
  fileName: string
  selectedColumns: Set<string>
  allColumns: string[]
}

export default function JoinQuery() {
  const snackbar = useSnackbar()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTotal, setFileTotal] = useState(0)
  const [fileOffset, setFileOffset] = useState(0)
  const [fileQuery, setFileQuery] = useState('')
  const [fileQueryDraft, setFileQueryDraft] = useState('')
  const [filesLoading, setFilesLoading] = useState(false)
  const [selections, setSelections] = useState<Map<number, FileSelection>>(new Map())
  const [joinType, setJoinType] = useState<JoinType>('outer')
  const [baseFileId, setBaseFileId] = useState<number | null>(null)
  const [result, setResult] = useState<JoinResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [columnsLoading, setColumnsLoading] = useState<Set<number>>(new Set())

  const fetchFiles = async (nextOffset = fileOffset, nextQuery = fileQuery) => {
    setFilesLoading(true)
    try {
      const response = await api.files.page({
        limit: JOIN_FILE_PAGE_SIZE,
        offset: nextOffset,
        query: nextQuery,
        fileTypes: ['Excel'],
      })
      setFiles(response.data.items)
      setFileTotal(response.data.total)
      setFileOffset(response.data.offset)
      setFileQuery(nextQuery)
    } catch {
      /* silent */
    } finally {
      setFilesLoading(false)
    }
  }

  useEffect(() => {
    void fetchFiles(0, '')
  }, [])

  const excelFiles = useMemo(
    () => files.filter((file) => isExcelFile(file.file_type)),
    [files],
  )

  const toggleFile = async (file: FileInfo) => {
    if (!isExcelFile(file.file_type)) return
    const next = new Map(selections)
    if (next.has(file.id)) {
      next.delete(file.id)
      if (baseFileId === file.id) {
        const first = next.keys().next()
        setBaseFileId(first.done ? null : first.value)
      }
      setSelections(next)
      setResult(null)
      return
    }

    setColumnsLoading((prev) => new Set(prev).add(file.id))
    try {
      const response = await api.files.schema(file.id)
      const columns = getSchemaColumns(response.data, file.file_type)
      next.set(file.id, {
        fileId: file.id,
        fileName: file.name,
        selectedColumns: new Set(columns),
        allColumns: columns,
      })
      if (baseFileId === null) setBaseFileId(file.id)
      setSelections(next)
      setResult(null)
    } catch {
      snackbar.error(`"${file.name}" 스키마를 불러오지 못했습니다.`)
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
    const columns = new Set(selection.selectedColumns)
    if (columns.has(column)) columns.delete(column)
    else columns.add(column)
    next.set(fileId, { ...selection, selectedColumns: columns })
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
    const orderedEntries = Array.from(selections.entries()).sort(([a], [b]) => {
      if (baseFileId === null) return 0
      if (a === baseFileId) return -1
      if (b === baseFileId) return 1
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
      snackbar.warn('통합할 Excel 파일을 선택해 주세요.')
      return
    }
    if (joinType === 'left' && baseFileId === null) {
      snackbar.warn('LEFT 방식의 기준 파일을 선택해 주세요.')
      return
    }
    setLoading(true)
    try {
      const response = await api.query.join(buildRequest())
      setResult(response.data)
      snackbar.success(`Excel 통합 완료 · ${response.data.total_rows}행`)
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Excel 통합 처리에 실패했습니다.'
      snackbar.error(detail)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    if (selections.size === 0) return
    try {
      const response = await api.query.export(buildRequest())
      const url = URL.createObjectURL(new Blob([response.data]))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'join_result.xlsx'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      snackbar.error('Excel 내보내기에 실패했습니다.')
    }
  }

  const handleFileSearch = () => {
    const nextQuery = fileQueryDraft.trim()
    setFileOffset(0)
    void fetchFiles(0, nextQuery)
  }

  const clearFileSearch = () => {
    setFileQueryDraft('')
    setFileOffset(0)
    void fetchFiles(0, '')
  }

  const goToFilePage = (nextOffset: number) => {
    const boundedOffset = Math.max(0, nextOffset)
    setFileOffset(boundedOffset)
    void fetchFiles(boundedOffset, fileQuery)
  }

  const visibleFileStart = fileTotal === 0 ? 0 : fileOffset + 1
  const visibleFileEnd = Math.min(fileOffset + files.length, fileTotal)
  const hasPreviousFilePage = fileOffset > 0
  const hasNextFilePage = fileOffset + files.length < fileTotal

  if (fileTotal === 0 && !fileQuery && !filesLoading) {
    return (
      <Card variant="outlined">
        <EmptyState
          icon="table_view"
          title="먼저 대상 폴더를 설정해 주세요"
          description="설정에서 Excel 파일이 있는 폴더를 추가하고 문서 새로고침을 실행하면 이 화면에서 통합할 수 있습니다."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card variant="outlined" className="border-amber-300 bg-amber-50/70">
        <div className="flex items-start gap-3 p-4">
          <Icon name="warning" size={22} className="mt-0.5 text-amber-700" />
          <div className="space-y-1">
            <p className="type-title-sm text-amber-950">Excel 통합은 아직 개발 진행 중입니다.</p>
            <p className="type-body-sm text-amber-900">
              현재는 같은 기준 컬럼을 가진 단순한 양식 위주로 확인해 주세요. 중요한 업무 파일은 결과를 검토한 뒤 사용하시고,
              원본 Excel 파일은 앱에서 읽기만 하며 수정하지 않습니다.
            </p>
          </div>
        </div>
      </Card>

      <Card variant="elevated">
        <CardSection
          title="통합할 Excel 파일 선택"
          description="같은 기준 컬럼을 가진 Excel 파일을 하나의 표로 합칩니다. Word/PPT 파일은 통합 대상에서 제외됩니다."
          trailing={
            <div className="flex gap-2 flex-wrap">
              <Chip
                label={`표시 ${visibleFileStart}-${visibleFileEnd} / ${fileTotal}개`}
                tone="success"
                icon="table_chart"
                as="span"
              />
              {fileQuery && <Chip label={`검색어 · ${fileQuery}`} tone="secondary" icon="search" as="span" />}
            </div>
          }
        >
          <div className="flex gap-2 items-start flex-wrap md:flex-nowrap mb-3">
            <div className="flex-1 min-w-[240px]">
              <TextField
                leadingIcon="search"
                placeholder="통합할 Excel 파일명 또는 경로 검색"
                value={fileQueryDraft}
                onChange={(event) => setFileQueryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleFileSearch()
                }}
              />
            </div>
            <Button variant="filled" leadingIcon="search" onClick={handleFileSearch} disabled={filesLoading}>
              검색
            </Button>
            {fileQuery && (
              <Button variant="text" leadingIcon="close" onClick={clearFileSearch} disabled={filesLoading}>
                검색 해제
              </Button>
            )}
          </div>

          {filesLoading ? (
            <div className="px-6 py-10 flex items-center justify-center gap-2 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
              <Spinner size={18} /> 불러오는 중…
            </div>
          ) : excelFiles.length === 0 ? (
            <EmptyState
              icon="warning"
              title="표시할 Excel 파일이 없습니다"
              description="검색어를 바꾸거나 설정 탭에서 대상 폴더를 추가하고 문서 새로고침을 실행해 주세요."
              compact
            />
          ) : (
            <div className="space-y-3">
              {excelFiles.map((file) => {
                const selected = selections.has(file.id)
                const selection = selections.get(file.id)
                const loadingColumns = columnsLoading.has(file.id)
                return (
                  <div
                    key={file.id}
                    className={`rounded-md border transition-all ${
                      selected
                        ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/35'
                        : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void toggleFile(file)}
                      className="state-host relative w-full text-left flex items-start gap-3 px-4 py-3"
                    >
                      <span className="state-layer" />
                      <Checkbox
                        checked={selected}
                        onChange={() => {}}
                        aria-label={file.name}
                        className="pointer-events-none"
                      />
                      <div className="flex-1 min-w-0 relative">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                            {file.name}
                          </span>
                          <FileTypeBadge fileType={file.file_type} />
                          <Badge tone="primary">기준 컬럼 {file.key_column || '미지정'}</Badge>
                          <Badge tone="neutral">컬럼 {file.column_count}개</Badge>
                        </div>
                        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1 break-all">
                          {file.path}
                        </p>
                      </div>
                      {loadingColumns && (
                        <span className="relative inline-flex items-center gap-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                          <Spinner size={14} /> 컬럼 로딩…
                        </span>
                      )}
                    </button>

                    {selected && selection && (
                      <div className="border-t border-[var(--md-sys-color-outline-variant)] px-4 py-3 space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Icon
                            name="view_column"
                            size={16}
                            className="text-[var(--md-sys-color-on-surface-variant)]"
                          />
                          <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">
                            가져올 컬럼
                          </span>
                          <Button
                            variant="text"
                            size="sm"
                            onClick={() => selectAllColumns(file.id, true)}
                          >
                            전체 선택
                          </Button>
                          <Button
                            variant="text"
                            size="sm"
                            onClick={() => selectAllColumns(file.id, false)}
                          >
                            전체 해제
                          </Button>
                          <Badge tone="neutral">
                            {selection.selectedColumns.size} / {selection.allColumns.length}
                          </Badge>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {selection.allColumns.map((column) => {
                            const isKey = column === file.key_column
                            const checked = selection.selectedColumns.has(column)
                            return (
                              <Chip
                                key={column}
                                kind="filter"
                                selected={checked}
                                disabled={isKey}
                                tone={isKey ? 'primary' : 'neutral'}
                                label={
                                  <span className="inline-flex items-center gap-1">
                                    {column}
                                    {isKey && <Badge tone="primary">기준</Badge>}
                                  </span>
                                }
                                onClick={() => !isKey && toggleColumn(file.id, column)}
                              />
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

          {fileTotal > JOIN_FILE_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-3">
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                {visibleFileStart}-{visibleFileEnd} / {fileTotal}개
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outlined"
                  leadingIcon="chevron_left"
                  onClick={() => goToFilePage(fileOffset - JOIN_FILE_PAGE_SIZE)}
                  disabled={!hasPreviousFilePage || filesLoading}
                >
                  이전
                </Button>
                <Button
                  variant="outlined"
                  trailingIcon="chevron_right"
                  onClick={() => goToFilePage(fileOffset + JOIN_FILE_PAGE_SIZE)}
                  disabled={!hasNextFilePage || filesLoading}
                >
                  다음
                </Button>
              </div>
            </div>
          )}
        </CardSection>
      </Card>

      <Card variant="outlined" className="p-5 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">
              통합 방식
            </span>
            <SegmentedButton
              value={joinType}
              onChange={setJoinType}
              options={[
                { value: 'outer', label: '전체' },
                { value: 'left', label: '기준 파일' },
                { value: 'inner', label: '공통' },
              ]}
              aria-label="Excel 통합 방식"
            />
          </div>
          <Badge tone="primary">선택 {selections.size}개</Badge>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="filled"
              leadingIcon="play_circle"
              onClick={handleJoin}
              loading={loading}
              disabled={selections.size === 0}
            >
              통합 미리보기
            </Button>
            {result && (
              <Button variant="tonal" leadingIcon="download" onClick={handleExport}>
                Excel 다운로드
              </Button>
            )}
          </div>
        </div>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          {JOIN_TYPE_HELP[joinType]}
        </p>

        {joinType === 'left' && selections.size > 0 && (
          <div className="border-t border-[var(--md-sys-color-outline-variant)] pt-3">
            <p className="type-label-lg text-[var(--md-sys-color-on-surface-variant)] mb-2">
              기준 파일 선택
            </p>
            <div className="flex gap-2 flex-wrap">
              {Array.from(selections.values()).map((selection) => {
                return (
                  <Radio
                    key={selection.fileId}
                    name="baseFile"
                    checked={baseFileId === selection.fileId}
                    onChange={() => setBaseFileId(selection.fileId)}
                    label={selection.fileName}
                  />
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {result && (
        <Card variant="elevated" className="p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h3 className="type-title-md text-[var(--md-sys-color-on-surface)]">Excel 통합 결과</h3>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                등록할 때 확인한 표 영역만 대상으로 통합했습니다. 총 {result.total_rows}행
              </p>
            </div>
          </div>
          <ResultTable columns={result.columns} data={result.data} />
        </Card>
      )}
    </div>
  )
}
