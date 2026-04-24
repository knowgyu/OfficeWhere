import { useMemo, useState } from 'react'

import {
  api,
  BulkRegisterResult,
  NormalizedFileInspect,
  ScannedFileInfo,
  normalizeFileInspect,
} from '../api/client'
import {
  Badge,
  Button,
  Card,
  CardSection,
  Checkbox,
  Chip,
  FileTypeBadge,
  Icon,
  SelectField,
  Switch,
  TextField,
  useSnackbar,
} from '../ui'

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
  const snackbar = useSnackbar()
  const [folderPath, setFolderPath] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [picking, setPicking] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [rows, setRows] = useState<FileRow[]>([])
  const [scanDone, setScanDone] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkRegisterResult[] | null>(null)

  const handlePickFolder = async () => {
    setPicking(true)
    try {
      const response = await api.files.pickFolder()
      if (!response.data.cancelled && response.data.folder_path) {
        setFolderPath(response.data.folder_path)
      }
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '폴더 선택창을 열지 못했습니다.'
      snackbar.error(detail)
    } finally {
      setPicking(false)
    }
  }

  const handleScan = async () => {
    if (!folderPath.trim()) {
      snackbar.warn('폴더 경로를 입력해 주세요.')
      return
    }
    setScanning(true)
    setRows([])
    setScanDone(false)
    setBulkResult(null)
    try {
      const response = await api.files.scanFolder({
        folder_path: folderPath.trim(),
        recursive,
      })
      const nextRows = response.data.files.map((file) => buildRow(file))
      setRows(nextRows)
      setScanDone(true)
      if (response.data.total_found === 0) {
        snackbar.warn('지원 파일(.xlsx · .xls · .docx · .pptx · .txt · .md)을 찾지 못했습니다.')
      } else {
        snackbar.info(`${response.data.total_found}개 파일을 찾았습니다.`)
      }
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '폴더 스캔에 실패했습니다.'
      snackbar.error(detail)
    } finally {
      setScanning(false)
    }
  }

  const toggleAll = (checked: boolean) => {
    setRows((prev) => prev.map((row) => (row.error ? row : { ...row, checked })))
  }

  const toggleRow = (index: number) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index && !row.error ? { ...row, checked: !row.checked } : row)),
    )
  }

  const setKeyColumn = (index: number, value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, keyColumn: value } : row)))
  }

  const setCandidate = (index: number, candidateId: string) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row
        const candidate =
          row.info.parserCandidates.find((item) => item.id === candidateId) ??
          row.info.parserCandidates[0]
        if (!candidate) return { ...row, selectedCandidateId: candidateId }

        const nextColumns = candidate.table.columns
        const nextKey =
          !row.info.keyRequired || nextColumns.includes(row.keyColumn)
            ? row.keyColumn
            : row.info.suggestedKey && nextColumns.includes(row.info.suggestedKey)
              ? row.info.suggestedKey
              : nextColumns[0] ?? ''

        return { ...row, selectedCandidateId: candidateId, keyColumn: nextKey }
      }),
    )
  }

  const handleBulkRegister = async () => {
    const selected = rows.filter(
      (row) => row.checked && !row.error && (!row.info.keyRequired || Boolean(row.keyColumn)),
    )
    if (selected.length === 0) {
      snackbar.warn('등록할 파일을 선택해 주세요.')
      return
    }

    setRegistering(true)
    setBulkResult(null)
    try {
      const response = await api.files.bulkRegister({
        files: selected.map((row) => ({
          path: row.raw.path,
          key_column: row.info.keyRequired ? row.keyColumn : '',
          parser_config: getSelectedParserConfig(row),
        })),
      })
      setBulkResult(response.data.results)
      const ok = response.data.results.filter((item) => item.success).length
      const failed = response.data.results.length - ok
      if (failed > 0) {
        snackbar.warn(`${ok}개 등록 · ${failed}개 실패`)
      } else {
        snackbar.success(`${ok}개 파일을 일괄 등록했습니다.`)
      }
      onRegistered()
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '일괄 등록에 실패했습니다.'
      snackbar.error(detail)
    } finally {
      setRegistering(false)
    }
  }

  const selectedRows = useMemo(() => rows.filter((row) => row.checked && !row.error), [rows])
  const checkedCount = selectedRows.length
  const validCount = rows.filter((row) => !row.error).length
  const failedCount = rows.filter((row) => !!row.error).length

  return (
    <Card variant="outlined">
      <CardSection
        title="폴더 스캔으로 일괄 등록"
        description="폴더 안의 지원 파일을 한 번에 찾습니다. Excel은 기준 컬럼을 확인하고, Word/PPT/텍스트는 기준 컬럼 없이 등록합니다."
        trailing={
          <Chip
            label="표 읽기 설정 자동 저장"
            tone="tertiary"
            icon="auto_fix_high"
            as="span"
          />
        }
      >
        <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
          <div className="flex-1 min-w-0">
            <TextField
              leadingIcon="folder"
              placeholder="폴더 경로 입력 또는 폴더 찾기 사용"
              value={folderPath}
              onChange={(event) => {
                setFolderPath(event.target.value)
                setScanDone(false)
                setRows([])
                setBulkResult(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleScan()
              }}
            />
          </div>
          <Button
            variant="tonal"
            leadingIcon="drive_folder_upload"
            onClick={handlePickFolder}
            loading={picking}
          >
            폴더 찾기
          </Button>
          <Button
            variant="filled"
            leadingIcon="search"
            onClick={handleScan}
            loading={scanning}
            disabled={!folderPath.trim()}
          >
            스캔
          </Button>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Switch
            checked={recursive}
            onChange={(event) => setRecursive(event.target.checked)}
            label="하위 폴더 포함"
            description="재귀적으로 하위 디렉토리까지 탐색합니다."
          />
        </div>

        {scanDone && rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Chip
                  label={`발견 ${rows.length}개`}
                  tone="primary"
                  icon="inventory_2"
                  as="span"
                />
                {failedCount > 0 && (
                  <Chip
                    label={`파싱 실패 ${failedCount}개`}
                    tone="danger"
                    icon="error"
                    as="span"
                  />
                )}
                <Chip
                  label={`선택 ${checkedCount} / ${validCount}`}
                  tone="neutral"
                  as="span"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="text" leadingIcon="done_all" onClick={() => toggleAll(true)}>
                  전체 선택
                </Button>
                <Button variant="text" leadingIcon="remove_done" onClick={() => toggleAll(false)}>
                  전체 해제
                </Button>
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
                    className={`rounded-md border p-4 transition-colors ${
                      row.error
                        ? 'border-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)]/40'
                        : row.checked
                          ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/30'
                          : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {row.error ? (
                          <Icon
                            name="error"
                            size={20}
                            filled
                            className="text-[var(--md-sys-color-error)] mt-0.5"
                          />
                        ) : (
                          <Checkbox
                            checked={row.checked}
                            onChange={() => toggleRow(index)}
                            aria-label={`${row.raw.name} 선택`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                              {row.raw.name}
                            </p>
                            <FileTypeBadge fileType={row.raw.file_type} />
                            {row.info.keyRequired ? (
                              <Badge tone="primary">기준 컬럼 필요</Badge>
                            ) : (
                              <Badge tone="neutral">기준 컬럼 불필요</Badge>
                            )}
                          </div>
                          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1 break-all">
                            {row.raw.path}
                          </p>
                          {row.error && (
                            <p className="type-body-sm text-[var(--md-sys-color-error)] mt-2">
                              {row.error}
                            </p>
                          )}
                          <div className="mt-3 flex gap-1.5 flex-wrap">
                            {row.info.capabilitySummary.map((item) => (
                              <Chip key={item} label={item} tone="neutral" as="span" />
                            ))}
                          </div>
                        </div>
                      </div>

                      {!row.error && row.checked && (
                        <div className="w-full max-w-sm space-y-3">
                          {row.info.keyRequired && row.info.parserCandidates.length > 0 && (
                            <>
                              <SelectField
                                label="표 후보 영역"
                                value={row.selectedCandidateId}
                                onChange={(event) => setCandidate(index, event.target.value)}
                              >
                                {row.info.parserCandidates.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.label}
                                  </option>
                                ))}
                              </SelectField>
                              {selectedCandidate?.summary.length ? (
                                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                                  {selectedCandidate.summary.join(' · ')}
                                </p>
                              ) : null}
                            </>
                          )}
                          {row.info.keyRequired ? (
                            <SelectField
                              label="기준 컬럼"
                              value={row.keyColumn}
                              onChange={(event) => setKeyColumn(index, event.target.value)}
                            >
                              <option value="">기준 컬럼 선택</option>
                              {(selectedCandidate?.table.columns ?? row.info.keyOptions).map(
                                (column) => (
                                  <option key={column} value={column}>
                                    {column}
                                    {column === row.info.suggestedKey ? ' (추천)' : ''}
                                  </option>
                                ),
                              )}
                            </SelectField>
                          ) : (
                            <div className="rounded-md bg-[var(--md-sys-color-surface-container-high)] px-3 py-2 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                              {row.info.fileType === 'Text' || row.info.fileType === 'Markdown'
                                ? '기준 컬럼 없이 검색용으로 등록됩니다.'
                                : '기준 컬럼 없이 검색과 변경 비교용으로 등록됩니다.'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {!row.error && row.checked && previewTable.columns.length > 0 && (
                      <div className="mt-4 overflow-x-auto rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]">
                        <table className="min-w-full text-xs">
                          <thead className="bg-[var(--md-sys-color-surface-container-low)]">
                            <tr>
                              {previewTable.columns.map((column) => (
                                <th
                                  key={column}
                                  className="px-3 py-2 text-left type-label-md text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap"
                                >
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
                            {previewTable.rows.slice(0, 3).map((previewRow, previewIndex) => (
                              <tr key={`${previewRow.join('|')}-${previewIndex}`}>
                                {previewRow.map((cell, cellIndex) => (
                                  <td
                                    key={`${cell}-${cellIndex}`}
                                    className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap"
                                    title={cell}
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

            <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                선택된 파일 {checkedCount}개가 현재 설정으로 등록됩니다.
              </p>
              <Button
                variant="filled"
                leadingIcon="playlist_add_check"
                onClick={handleBulkRegister}
                loading={registering}
                disabled={checkedCount === 0}
              >
                {`선택 ${checkedCount}개 일괄 등록`}
              </Button>
            </div>
          </div>
        )}

        {bulkResult && (
          <div className="space-y-1">
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
              등록 결과 · 성공 {bulkResult.filter((item) => item.success).length}개
              {bulkResult.some((item) => !item.success) && (
                <span className="ml-2 text-[var(--md-sys-color-error)]">
                  실패 {bulkResult.filter((item) => !item.success).length}개
                </span>
              )}
            </p>
            {bulkResult
              .filter((item) => !item.success)
              .map((item, index) => (
                <p
                  key={`${item.path}-${index}`}
                  className="type-body-sm text-[var(--md-sys-color-error)]"
                >
                  ✕ {item.name} — {item.error}
                </p>
              ))}
          </div>
        )}
      </CardSection>
    </Card>
  )
}

function buildRow(file: ScannedFileInfo): FileRow {
  const normalized = normalizeFileInspect(file)
  return {
    raw: file,
    info: normalized,
    keyColumn: normalized.keyRequired
      ? normalized.suggestedKey || normalized.keyOptions[0] || ''
      : '',
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
