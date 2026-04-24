import { useEffect, useMemo, useState } from 'react'

import {
  api,
  FileInfo,
  JoinResponse,
  getFileTypeLabel,
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
  useSnackbar,
} from '../ui'
import ResultTable from './ResultTable'

type JoinType = 'left' | 'outer' | 'inner'

interface FileSelection {
  fileId: number
  selectedColumns: Set<string>
  allColumns: string[]
}

export default function JoinQuery() {
  const snackbar = useSnackbar()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selections, setSelections] = useState<Map<number, FileSelection>>(new Map())
  const [joinType, setJoinType] = useState<JoinType>('outer')
  const [baseFileId, setBaseFileId] = useState<number | null>(null)
  const [result, setResult] = useState<JoinResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [columnsLoading, setColumnsLoading] = useState<Set<number>>(new Set())

  useEffect(() => {
    api.files
      .list()
      .then((response) => setFiles(response.data))
      .catch(() => {
        /* silent */
      })
  }, [])

  const excelFiles = useMemo(
    () => files.filter((file) => isExcelFile(file.file_type)),
    [files],
  )
  const compareOnlyFiles = useMemo(
    () => files.filter((file) => !isExcelFile(file.file_type)),
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

  if (files.length === 0) {
    return (
      <Card variant="outlined">
        <EmptyState
          icon="table_view"
          title="먼저 대상 폴더를 설정해 주세요"
          description="Excel 통합은 설정에서 자동 등록된 Excel 파일을 대상으로 합니다."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card variant="elevated">
        <CardSection
          title="통합할 Excel 파일 선택"
          description="같은 key를 가진 Excel 파일을 하나의 표로 합칩니다. Word/PPT는 비교 전용 문서이므로 제외됩니다."
          trailing={
            <div className="flex gap-2 flex-wrap">
              <Chip
                label={`선택 가능 ${excelFiles.length}개`}
                tone="success"
                icon="table_chart"
                as="span"
              />
              <Chip
                label={`compare-only ${compareOnlyFiles.length}개`}
                tone="neutral"
                icon="do_not_disturb_on"
                as="span"
              />
            </div>
          }
        >
          {excelFiles.length === 0 ? (
            <EmptyState
              icon="warning"
              title="등록된 Excel 파일이 없습니다"
              description="설정 탭에서 대상 폴더를 추가하고 자동 등록을 실행해 주세요."
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
                          <Badge tone="primary">key {file.key_column || '미지정'}</Badge>
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
                                    {isKey && <Badge tone="primary">key</Badge>}
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

          {compareOnlyFiles.length > 0 && (
            <div className="rounded-md bg-[var(--md-sys-color-surface-container-high)] p-4">
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)] mb-2">
                통합 제외 파일
              </p>
              <div className="flex gap-2 flex-wrap">
                {compareOnlyFiles.map((file) => (
                  <Chip
                    key={file.id}
                    label={`${file.name} · ${getFileTypeLabel(file.file_type)}`}
                    tone="neutral"
                    as="span"
                    icon="block"
                  />
                ))}
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
                { value: 'outer', label: 'OUTER' },
                { value: 'left', label: 'LEFT' },
                { value: 'inner', label: 'INNER' },
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

        {joinType === 'left' && selections.size > 0 && (
          <div className="border-t border-[var(--md-sys-color-outline-variant)] pt-3">
            <p className="type-label-lg text-[var(--md-sys-color-on-surface-variant)] mb-2">
              기준 파일 선택
            </p>
            <div className="flex gap-2 flex-wrap">
              {Array.from(selections.keys()).map((fileId) => {
                const file = excelFiles.find((item) => item.id === fileId)
                if (!file) return null
                return (
                  <Radio
                    key={file.id}
                    name="baseFile"
                    checked={baseFileId === file.id}
                    onChange={() => setBaseFileId(file.id)}
                    label={file.name}
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
                parser_config로 재파싱한 표만 대상으로 통합했습니다. 총 {result.total_rows}행
              </p>
            </div>
          </div>
          <ResultTable columns={result.columns} data={result.data} />
        </Card>
      )}
    </div>
  )
}
