import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  CheckResponse,
  ExcelCheckIssue,
  ExcelDiffGridCell,
  ExcelDiffGridFocus,
  ExcelDiffGridResponse,
  ExcelDiffHighlight,
} from '../../api/client'
import { Badge, Card, Chip, Icon, SelectField, Spinner, StatCard } from '../../ui'
import { TutorialStep } from '../../tutorial'
import { ExcelGridModalState, HistoryTransition } from './types'

const excelChangeTypeFromIssue = (
  issue: ExcelCheckIssue,
  beforeValue: string,
  afterValue: string,
): ExcelDiffHighlight => {
  if (issue.type === 'value_added') return 'added'
  if (issue.type === 'value_removed') return 'removed'
  if (issue.type === 'value_presence') {
    if (isEmptyExcelValue(beforeValue) && !isEmptyExcelValue(afterValue)) return 'added'
    if (!isEmptyExcelValue(beforeValue) && isEmptyExcelValue(afterValue)) return 'removed'
  }
  return 'changed'
}

const excelHighlightRank = (type: ExcelDiffHighlight) => {
  if (type === 'removed') return 3
  if (type === 'changed') return 2
  return 1
}

const isEmptyExcelValue = (value: string) => {
  const normalized = value.trim()
  return !normalized || normalized === '(빈 값)' || normalized === '-'
}

const excelConflictText = (conflict?: ExcelCheckIssue['conflicts'][number]) =>
  conflict?.values.join(' | ') || ''

const displayExcelGridValue = (value?: string | null) => {
  const text = value ?? ''
  return text === '(빈 값)' ? '' : text
}

export function buildExcelGridFocuses(transitions: HistoryTransition[]): ExcelDiffGridFocus[] {
  const focusMap = new Map<string, ExcelDiffGridFocus>()
  const addFocus = (
    sheetName: string,
    key: string,
    column: string,
    changeType: ExcelDiffHighlight,
    history: ExcelDiffGridFocus['histories'][number],
  ) => {
    if (!key || !column) return
    const focusKey = `${sheetName}::${key}::${column}`
    const existing = focusMap.get(focusKey)
    if (existing) {
      existing.histories.push(history)
      if (excelHighlightRank(changeType) > excelHighlightRank(existing.change_type)) {
        existing.change_type = changeType
      }
      return
    }

    focusMap.set(focusKey, {
      sheet_name: sheetName,
      key,
      column,
      change_type: changeType,
      histories: [history],
    })
  }

  transitions.forEach((transition) => {
    if (transition.status !== 'done' || transition.result?.mode !== 'excel') return

    transition.result.issues.forEach((issue) => {
      if (issue.type === 'missing_column' && issue.columnGroup) {
        issue.conflicts.forEach((conflict) => {
          const changeType = conflict.fileId === transition.toFile.id ? 'added' : 'removed'
          conflict.rowValues.forEach((row) => {
            const key = row[0] ?? ''
            const value = row[row.length - 1] ?? ''
            addFocus(conflict.sheetName || issue.sheetName, key, issue.columnGroup, changeType, {
              change_type: changeType,
              from_file_id: transition.fromFile.id,
              from_file_name: transition.fromFile.name,
              to_file_id: transition.toFile.id,
              to_file_name: transition.toFile.name,
              before: changeType === 'added' ? '' : value,
              after: changeType === 'added' ? value : '',
              label: `${transition.fromFile.name} → ${transition.toFile.name}`,
            })
          })
        })
        return
      }

      if (issue.type === 'missing_key') {
        issue.conflicts.forEach((conflict) => {
          const changeType = conflict.fileId === transition.toFile.id ? 'added' : 'removed'
          conflict.rowValues.forEach((row) => {
            const key = row[0] ?? issue.key
            conflict.columns.slice(1).forEach((column, columnIndex) => {
              const value = row[columnIndex + 1] ?? ''
              addFocus(conflict.sheetName || issue.sheetName, key, column, changeType, {
                change_type: changeType,
                from_file_id: transition.fromFile.id,
                from_file_name: transition.fromFile.name,
                to_file_id: transition.toFile.id,
                to_file_name: transition.toFile.name,
                before: changeType === 'added' ? '' : value,
                after: changeType === 'added' ? value : '',
                label: `${transition.fromFile.name} → ${transition.toFile.name}`,
              })
            })
          })
        })
        return
      }

      if (!issue.key || !issue.columnGroup) return

      const beforeConflict = issue.conflicts.find((conflict) => conflict.fileId === transition.fromFile.id)
      const afterConflict = issue.conflicts.find((conflict) => conflict.fileId === transition.toFile.id)
      const before = excelConflictText(beforeConflict)
      const after = excelConflictText(afterConflict)
      const changeType = excelChangeTypeFromIssue(issue, before, after)
      const history = {
        change_type: changeType,
        from_file_id: transition.fromFile.id,
        from_file_name: transition.fromFile.name,
        to_file_id: transition.toFile.id,
        to_file_name: transition.toFile.name,
        before,
        after,
        label: `${transition.fromFile.name} → ${transition.toFile.name}`,
      }
      addFocus(issue.sheetName || beforeConflict?.sheetName || afterConflict?.sheetName || '', issue.key, issue.columnGroup, changeType, history)
    })
  })

  return Array.from(focusMap.values())
}

function formatExcelLocation(conflict: ExcelCheckIssue['conflicts'][number]) {
  const rows = conflict.rowNumbers.length > 0 ? `${conflict.rowNumbers.join(', ')}행` : ''
  const columns = conflict.columnLetters.length > 0 ? `${conflict.columnLetters.join(', ')}열` : ''
  const rowColumnText = [rows, columns].filter(Boolean).join(' ')
  const sheetPrefix = conflict.sheetName ? `${conflict.sheetName} 시트 · ` : ''

  if (conflict.cellRefs.length > 0) {
    const cells = conflict.cellRefs.slice(0, 4).join(', ')
    const suffix = conflict.cellRefs.length > 4 ? ` 외 ${conflict.cellRefs.length - 4}개` : ''
    const location = rowColumnText ? `${rowColumnText} (${cells}${suffix})` : `${cells}${suffix}`
    return `${sheetPrefix}${location}`
  }
  return rowColumnText ? `${sheetPrefix}${rowColumnText}` : '-'
}

function firstExcelLocation(issue: ExcelCheckIssue) {
  const located = issue.conflicts.find(
    (conflict) => conflict.rowNumbers.length > 0 || conflict.columnLetters.length > 0 || conflict.cellRefs.length > 0,
  )
  return located ? formatExcelLocation(located) : ''
}

function isExcelContentChange(issue: ExcelCheckIssue) {
  return issue.type !== 'value_conflict'
}

function excelIssueTitle(issue: ExcelCheckIssue) {
  if (issue.type === 'value_conflict') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 값 변경` : '셀 값 변경'
  }
  if (issue.type === 'value_added') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 내용 추가` : '셀 내용 추가'
  }
  if (issue.type === 'value_removed') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 내용 삭제` : '셀 내용 삭제'
  }
  if (issue.type === 'value_presence') {
    const location = firstExcelLocation(issue)
    return location ? `${location} 내용 있음/없음` : '셀 내용 있음/없음'
  }
  return issue.message
}

function conflictStatus(conflict: ExcelCheckIssue['conflicts'][number]) {
  return conflict.values.join(' | ') || (conflict.rowValues.length > 0 ? '내용 있음' : '-')
}

type UiTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'tertiary'

type ExcelDigestRow = {
  id: string
  issue: ExcelCheckIssue
  label: string
  tone: UiTone
  icon: string
  location: string
  beforeText: string
  latestText: string
}

const EXCEL_ISSUE_META: Record<
  ExcelCheckIssue['type'],
  { label: string; tone: UiTone; icon: string }
> = {
  value_conflict: { label: '값 변경', tone: 'warning', icon: 'change_circle' },
  value_added: { label: '추가', tone: 'success', icon: 'add_circle' },
  value_removed: { label: '삭제', tone: 'danger', icon: 'do_not_disturb_on' },
  value_presence: { label: '있음/없음', tone: 'warning', icon: 'rule' },
  missing_key: { label: '행 추가/삭제', tone: 'warning', icon: 'difference' },
  missing_column: { label: '열 추가/삭제', tone: 'warning', icon: 'view_column' },
}

function emptyExcelValueLabel(value: string) {
  return isEmptyExcelValue(value) ? '(빈 값)' : value
}

function excelConflictDisplayText(conflict?: ExcelCheckIssue['conflicts'][number]) {
  if (!conflict) return '-'
  const text = conflictStatus(conflict)
  return emptyExcelValueLabel(text)
}

function buildExcelDigestRows(issues: ExcelCheckIssue[]): ExcelDigestRow[] {
  return issues.map((issue) => {
    const meta = EXCEL_ISSUE_META[issue.type]
    const firstConflict = issue.conflicts[0]
    const lastConflict = issue.conflicts[issue.conflicts.length - 1]
    const location = firstExcelLocation(issue) || '-'
    const beforeText = excelConflictDisplayText(firstConflict)
    const latestText =
      lastConflict && lastConflict !== firstConflict ? excelConflictDisplayText(lastConflict) : ''

    return {
      id: issue.id,
      issue,
      label: meta.label,
      tone: meta.tone,
      icon: meta.icon,
      location,
      beforeText,
      latestText: latestText || (issue.type === 'value_removed' ? '(빈 값)' : issue.message),
    }
  })
}

export function ExcelCheckResult({
  result,
  compact = false,
}: {
  result: Extract<CheckResponse, { mode: 'excel' }>
  compact?: boolean
}) {
  const valueConflicts = result.issues.filter((issue) => issue.type === 'value_conflict')
  const contentChanges = result.issues.filter(isExcelContentChange)

  if (compact && result.issues.length === 0) {
    return (
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        Excel에서 달라진 셀이 없습니다.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="전체 항목" value={result.totalKeys} icon="tag" />
          <StatCard
            label="값 변경"
            value={valueConflicts.length}
            icon="report_problem"
            tone={valueConflicts.length > 0 ? 'danger' : 'neutral'}
          />
          <StatCard
            label="추가/삭제"
            value={contentChanges.length}
            icon="difference"
            tone={contentChanges.length > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      {result.issues.length === 0 ? (
        <Card variant="outlined" className="px-6 py-8 text-center">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">Excel에서 달라진 셀이 없습니다.</p>
          <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            비교한 파일 사이에서 표시할 값 변경이나 추가/삭제를 찾지 못했습니다.
          </p>
        </Card>
      ) : (
        <ExcelChangeDigest result={result} compact={compact} />
      )}
    </div>
  )
}

function ExcelChangeDigest({
  result,
  compact,
}: {
  result: Extract<CheckResponse, { mode: 'excel' }>
  compact: boolean
}) {
  const rows = useMemo(() => buildExcelDigestRows(result.issues), [result.issues])
  const changedCount = rows.filter((row) => row.issue.type === 'value_conflict').length
  const addedCount = rows.filter((row) => row.issue.type === 'value_added').length
  const removedCount = rows.filter((row) => row.issue.type === 'value_removed').length
  const otherCount = rows.length - changedCount - addedCount - removedCount
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null

  return (
    <Card variant="outlined" className="overflow-hidden">
      <header className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon name="troubleshoot" size={20} className="text-[var(--md-sys-color-primary)]" />
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">바뀐 셀 빠르게 보기</p>
            </div>
            <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              변경·추가·삭제된 셀만 한 표에 모아 보여줍니다. 행을 누르면 아래에서 파일별 값을 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Badge tone={changedCount > 0 ? 'warning' : 'neutral'}>{changedCount}건 변경</Badge>
            <Badge tone={addedCount > 0 ? 'success' : 'neutral'}>{addedCount}건 추가</Badge>
            <Badge tone={removedCount > 0 ? 'danger' : 'neutral'}>{removedCount}건 삭제</Badge>
            {otherCount > 0 && <Badge tone="neutral">{otherCount}건 기타</Badge>}
          </div>
        </div>
      </header>

      <div className={`grid grid-cols-1 ${compact ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : 'xl:grid-cols-[minmax(0,1fr)_22rem]'}`}>
        <ExcelDigestTable
          rows={rows}
          selectedId={selectedRow?.id ?? null}
          onSelect={setSelectedId}
        />
        <ExcelDigestDetailPanel row={selectedRow} />
      </div>
    </Card>
  )
}

function ExcelDigestTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ExcelDigestRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="type-label-md text-[var(--md-sys-color-on-surface)]">셀 변경</p>
          <p className="mt-0.5 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            빈 값에서 채워진 셀은 추가, 값이 사라진 셀은 삭제로 표시합니다.
          </p>
        </div>
        <Chip label={`${rows.length}건`} tone={rows.length > 0 ? 'primary' : 'neutral'} as="span" />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 type-body-sm text-[var(--md-sys-color-on-surface-variant)] sm:px-5">
          변경된 셀이 없습니다.
        </p>
      ) : (
        <div className="max-h-[24rem] overflow-auto overscroll-contain border-t border-[var(--md-sys-color-outline-variant)]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--md-sys-color-surface-container-high)] shadow-[0_1px_0_var(--md-sys-color-outline-variant)]">
              <tr>
                {['위치', '이전 값', '최신 값', '상태'].map((header) => (
                  <th
                    key={header}
                    className="px-3 py-2 text-left type-label-sm text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(row.id)
                    }
                  }}
                  className={`cursor-pointer transition-colors hover:bg-[var(--md-sys-color-surface-container-low)] ${
                    selectedId === row.id
                      ? 'bg-[var(--md-sys-color-primary-container)]/28 ring-1 ring-inset ring-[var(--md-sys-color-primary)]/40'
                      : 'bg-[var(--md-sys-color-surface-container-lowest)]'
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-[var(--md-sys-color-on-surface)] whitespace-nowrap">
                    {row.location}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-red-950">
                    <div className="max-w-[16rem] truncate rounded-md bg-red-50 px-2 py-1" title={row.beforeText}>
                      {row.beforeText}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-emerald-950">
                    <div className="max-w-[16rem] truncate rounded-md bg-emerald-50 px-2 py-1" title={row.latestText}>
                      {row.latestText}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge tone={row.tone}>
                      <Icon name={row.icon} size={14} /> {row.label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ExcelDigestDetailPanel({ row }: { row: ExcelDigestRow | null }) {
  if (!row) {
    return (
      <aside className="border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4 xl:border-l xl:border-t-0">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">셀 상세</p>
        <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          바뀐 셀을 선택하면 파일별 값과 위치를 확인할 수 있습니다.
        </p>
      </aside>
    )
  }

  return (
    <aside className="min-w-0 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4 xl:border-l xl:border-t-0">
      <div className="sticky top-0 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={row.tone}>
            <Icon name={row.icon} size={14} /> {row.label}
          </Badge>
          <span className="font-mono type-label-md text-[var(--md-sys-color-on-surface-variant)]">{row.location}</span>
        </div>
        <div>
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{excelIssueTitle(row.issue)}</p>
          <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{row.issue.message}</p>
        </div>

        <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 space-y-2">
          <p className="type-label-md text-[var(--md-sys-color-on-surface)]">파일별 값</p>
          {row.issue.conflicts.length === 0 ? (
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              파일별 상세 값이 없습니다.
            </p>
          ) : (
            <div className="max-h-56 space-y-2 overflow-auto overscroll-contain pr-1">
              {row.issue.conflicts.map((conflict) => (
                <div
                  key={`${row.id}-detail-${conflict.fileId}`}
                  className="rounded-md bg-[var(--md-sys-color-surface-container-low)] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate type-label-sm text-[var(--md-sys-color-on-surface)]" title={conflict.fileName}>
                      {conflict.fileName}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-[var(--md-sys-color-on-surface-variant)]">
                      {formatExcelLocation(conflict)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-[var(--md-sys-color-on-surface)]">
                    {excelConflictDisplayText(conflict)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function excelGridHighlightClass(highlight: ExcelDiffHighlight | null) {
  if (highlight === 'added') {
    return 'excel-diff-cell-added'
  }
  if (highlight === 'removed') {
    return 'excel-diff-cell-removed'
  }
  if (highlight === 'changed') {
    return 'excel-diff-cell-changed'
  }
  return 'excel-diff-cell-normal'
}

function excelGridHighlightLabel(highlight: ExcelDiffHighlight | null) {
  if (highlight === 'added') return '추가'
  if (highlight === 'removed') return '삭제'
  if (highlight === 'changed') return '변경'
  return '최신 변경 없음'
}

function excelGridCellTitle(cell: ExcelDiffGridCell) {
  const location = `${cell.sheet_name ? `${cell.sheet_name} 시트 · ` : ''}${cell.row_number}행 ${cell.column_letter}열`
  if (cell.histories.length === 0) return `${location} · ${displayExcelGridValue(cell.value)}`
  const first = cell.histories[0]
  return `${location} · ${excelGridHighlightLabel(cell.highlight)} · ${displayExcelGridValue(first.before)} → ${displayExcelGridValue(first.after)}`
}

function excelDiffGridSheetNames(data: ExcelDiffGridResponse | null): string[] {
  if (!data) return []
  const names = data.sections
    .map((section) => section.sheet_name || data.sheet_name || '')
    .filter((name) => name && name !== '여러 시트')
  return Array.from(new Set(names))
}

export function ExcelDiffGridModal({
  modal,
  onClose,
  highlightReview = false,
  tutorialStep,
  onTutorialStep,
}: {
  modal: ExcelGridModalState
  onClose: () => void
  highlightReview?: boolean
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const [selectedCell, setSelectedCell] = useState<ExcelDiffGridCell | null>(null)
  const sheetNames = useMemo(() => excelDiffGridSheetNames(modal.data), [modal.data])
  const [selectedSheetName, setSelectedSheetName] = useState(() => excelDiffGridSheetNames(modal.data)[0] ?? '')
  const activeSheetName = selectedSheetName || sheetNames[0] || ''
  const visibleSections = useMemo(() => {
    if (!modal.data || !activeSheetName) return modal.data?.sections ?? []
    return modal.data.sections.filter((section) => (section.sheet_name || modal.data?.sheet_name) === activeSheetName)
  }, [modal.data, activeSheetName])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    if (!modal.data || sheetNames.length === 0) {
      setSelectedSheetName('')
      setSelectedCell(null)
      return
    }
    if (!selectedSheetName || !sheetNames.includes(selectedSheetName)) {
      setSelectedSheetName(sheetNames[0])
      setSelectedCell(null)
    }
  }, [modal.data, selectedSheetName, sheetNames])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center overflow-hidden overscroll-contain bg-[var(--ow-dialog-backdrop)] backdrop-blur-md p-4 sm:p-5 lg:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Excel 시트 보기"
      onClick={onClose}
      onWheel={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) event.preventDefault()
      }}
      onTouchMove={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      <div
        className="flex h-[92dvh] min-h-[560px] w-[calc(100vw-2rem)] max-w-[1400px] flex-col overflow-hidden overscroll-contain rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--ow-dialog-surface)] shadow-elev-5 sm:w-[calc(100vw-3rem)] lg:w-[92vw]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/96">
          <div className="flex min-h-16 items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
                <Icon name="table_chart" size={22} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="type-title-md text-[var(--md-sys-color-on-surface)]">Excel 시트 보기</p>
                  <Badge tone="neutral">선택 파일 비교</Badge>
                </div>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] truncate mt-1">
                  {modal.detail.base_name}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
              aria-label="닫기"
            >
              <Icon name="close" size={22} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-3">
          {modal.loading ? (
            <div className="flex items-center justify-center gap-2 py-16 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
              <Spinner size={20} /> Excel 시트 범위를 계산하는 중…
            </div>
          ) : modal.error ? (
            <div className="rounded-lg border border-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)] p-4 text-[var(--md-sys-color-on-error-container)]">
              {modal.error}
            </div>
          ) : modal.data ? (
            <>
              <ExcelDiffGridSummary
                data={modal.data}
                sheetNames={sheetNames}
                selectedSheetName={activeSheetName}
                onSelectSheet={(sheetName) => {
                  setSelectedSheetName(sheetName)
                  setSelectedCell(null)
                }}
              />
              {visibleSections.map((section, index) => (
                <ExcelDiffGridSectionView
                  key={section.id}
                  section={section}
                  selectedCell={selectedCell}
                  onSelectCell={setSelectedCell}
                  highlightReview={highlightReview && index === 0}
                  tutorialStep={tutorialStep}
                  onTutorialStep={onTutorialStep}
                />
              ))}
              <ExcelDiffGridCellDetail cell={selectedCell} tutorialStep={tutorialStep} />
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ExcelDiffGridSummary({
  data,
  sheetNames,
  selectedSheetName,
  onSelectSheet,
}: {
  data: ExcelDiffGridResponse
  sheetNames: string[]
  selectedSheetName: string
  onSelectSheet: (sheetName: string) => void
}) {
  const sectionCountsBySheet = useMemo(() => {
    const counts = new Map<string, number>()
    data.sections.forEach((section) => {
      const sheetName = section.sheet_name || data.sheet_name
      if (!sheetName || sheetName === '여러 시트') return
      counts.set(sheetName, (counts.get(sheetName) ?? 0) + 1)
    })
    return counts
  }, [data])

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Chip label={`최신 파일 값 · ${data.latest_file.file_name}`} tone="primary" icon="description" as="span" />
        <Chip label={`${selectedSheetName || data.sheet_name} 시트`} tone="neutral" as="span" />
        <Chip label={`${data.row_count}행 × ${data.column_count}열`} tone="neutral" as="span" />
      </div>

      {sheetNames.length > 1 && (
        <div className="grid gap-3 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 sm:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)] sm:items-end">
          <SelectField
            label="시트 선택"
            value={selectedSheetName}
            onChange={(event) => onSelectSheet(event.target.value)}
            leadingIcon="view_column"
            helper="여러 시트가 있을 때 선택한 시트만 표에 표시합니다."
            fullWidth
          >
            {sheetNames.map((sheetName) => {
              const count = sectionCountsBySheet.get(sheetName) ?? 0
              return (
                <option key={sheetName} value={sheetName}>
                  {sheetName}
                  {count > 1 ? ` · 구간 ${count}개` : ''}
                </option>
              )
            })}
          </SelectField>
          <div className="min-w-0 rounded-md bg-[var(--md-sys-color-surface-container-low)] px-3 py-2">
            <p className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">표시 중</p>
            <p className="mt-0.5 truncate type-title-sm text-[var(--md-sys-color-on-surface)]">
              {selectedSheetName} 시트
            </p>
            <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              첫 화면은 첫 번째 시트로 열리고, 다른 시트는 여기서 전환합니다.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Badge tone="success">초록 · 최신본에 추가</Badge>
        <Badge tone="danger">빨강 · 최신본에서 삭제</Badge>
        <Badge tone="warning">노랑 · 최신본에서 변경</Badge>
      </div>

      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        색상은 최신본과 바로 이전 파일의 차이만 표시합니다. 색이 없는 셀도 누르면 이전 파일들 사이의 변경 이력을 확인할 수 있습니다.
      </p>

      {data.partial && (
        <p className="rounded-lg border border-[var(--md-sys-color-warning)]/45 bg-[var(--md-sys-color-warning-container)] px-3 py-2 type-body-sm text-[var(--md-sys-color-on-warning-container)]">
          표가 커서 전체를 한 번에 표시하지 않고 변경 셀 주변 구간만 보여줍니다.
          {data.omitted_focus_count > 0 && ` 전체 변경 범위에서 위치를 찾지 못한 변경 ${data.omitted_focus_count}건은 표에 표시하지 못했습니다.`}
        </p>
      )}
    </div>
  )
}

function ExcelDiffGridSectionView({
  section,
  selectedCell,
  onSelectCell,
  highlightReview = false,
  tutorialStep,
  onTutorialStep,
}: {
  section: ExcelDiffGridResponse['sections'][number]
  selectedCell: ExcelDiffGridCell | null
  onSelectCell: (cell: ExcelDiffGridCell) => void
  highlightReview?: boolean
  tutorialStep?: TutorialStep | null
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.shiftKey) return
      element.scrollLeft += event.deltaY
      event.preventDefault()
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <section
      className="border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{section.title}</p>
          {highlightReview && tutorialStep === 'excel-table-cell' && (
            <span className="tour-evidence-note">
              <Icon name="check_circle" size={14} />
              D7 셀을 눌러 변경 이력을 열어보세요
            </span>
          )}
        </div>
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          {section.description} 표시 범위: {section.row_start}-{section.row_end}행, {section.col_start}-{section.col_end}열
        </p>
      </div>
      <div
        ref={scrollRef}
        className="max-h-[50vh] overflow-auto overscroll-contain"
      >
        <table className="min-w-max table-fixed border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="min-w-[3.25rem] border-b border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-2 py-2 text-left type-label-sm sm:min-w-[4rem]">
                행
              </th>
              {section.columns.map((column) => (
                <th
                  key={column.index}
                  className="w-[6.5rem] min-w-[6.5rem] max-w-[6.5rem] border-b border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-2 py-2 text-left type-label-sm sm:w-[7.5rem] sm:min-w-[7.5rem] sm:max-w-[7.5rem] xl:w-[8rem] xl:min-w-[8rem] xl:max-w-[8rem]"
                >
                  <span className="font-mono">{column.letter}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.row_index}>
                <th className="min-w-[3.25rem] border-b border-r border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-2 py-1 text-left font-mono sm:min-w-[4rem]">
                  {row.row_number}
                </th>
                {row.cells.map((cell) => {
                  const selected =
                    selectedCell?.sheet_name === cell.sheet_name &&
                    selectedCell?.row_index === cell.row_index &&
                    selectedCell?.column_index === cell.column_index
                  const isTutorialCell =
                    highlightReview &&
                    tutorialStep === 'excel-table-cell' &&
                    row.row_number === 7 &&
                    cell.column_letter === 'D'
                  return (
                    <td
                      key={`${cell.sheet_name ?? ''}-${cell.row_index}-${cell.column_index}`}
                      title={excelGridCellTitle(cell)}
                      className={`w-[6.5rem] min-w-[6.5rem] max-w-[6.5rem] border-b border-r border-[var(--md-sys-color-outline-variant)] px-2 py-1 align-top font-mono whitespace-nowrap cursor-pointer hover:ring-1 hover:ring-inset hover:ring-[var(--md-sys-color-primary)] sm:w-[7.5rem] sm:min-w-[7.5rem] sm:max-w-[7.5rem] xl:w-[8rem] xl:min-w-[8rem] xl:max-w-[8rem] ${excelGridHighlightClass(cell.highlight)} ${
                        selected ? 'outline outline-2 outline-[var(--md-sys-color-primary)] outline-offset-[-2px]' : ''
                      } ${isTutorialCell ? 'attention-pulse tour-target' : ''}`}
                      data-tour-target={isTutorialCell ? 'excel-table-cell' : undefined}
                      onClick={() => {
                        onSelectCell(cell)
                        if (isTutorialCell) onTutorialStep?.('excel-table-history')
                      }}
                    >
                      <div className="truncate">{displayExcelGridValue(cell.value)}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ExcelDiffGridCellDetail({
  cell,
  tutorialStep,
}: {
  cell: ExcelDiffGridCell | null
  tutorialStep?: TutorialStep | null
}) {
  if (!cell) {
    return (
      <aside className="border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4">
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">변경 셀 상세</p>
        <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          표의 셀을 누르면 최신본 값과 파일 사이 변경 이력을 여기서 확인할 수 있습니다.
        </p>
      </aside>
    )
  }

  const badgeTone =
    cell.highlight === 'removed'
      ? 'danger'
      : cell.highlight === 'added'
        ? 'success'
        : cell.highlight === 'changed'
          ? 'warning'
      : 'neutral'
  const isTutorialHistoryTarget = tutorialStep === 'excel-table-history'

  return (
    <aside
      className={`border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-3 ${
        isTutorialHistoryTarget ? 'tour-target tour-review-target rounded-xl' : ''
      }`}
      data-tour-target={isTutorialHistoryTarget ? 'excel-table-history' : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={badgeTone}>{excelGridHighlightLabel(cell.highlight)}</Badge>
        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
          {cell.sheet_name ? `${cell.sheet_name} 시트 · ` : ''}{cell.row_number}행 {cell.column_letter}열
        </p>
        {isTutorialHistoryTarget && (
          <span className="tour-evidence-note">
            <Icon name="check_circle" size={14} />
            셀 변경 이력이 아래에 정리됩니다
          </span>
        )}
      </div>
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
        현재 최신본 값: <span className="font-mono text-[var(--md-sys-color-on-surface)]">{displayExcelGridValue(cell.value)}</span>
      </p>
      {cell.histories.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--md-sys-color-outline-variant)] px-3 py-2 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          이 셀의 변경 이력은 없습니다.
        </p>
      )}
      <div className="space-y-2">
        {cell.histories.map((history, index) => (
          <div
            key={`${history.label}-${index}`}
            className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3"
          >
            <p className="type-label-md text-[var(--md-sys-color-on-surface)]">
              {history.label || `${history.from_file_name ?? '이전 파일'} → ${history.to_file_name ?? '다음 파일'}`}
            </p>
            <div className="mt-2 space-y-1.5">
              <div className="grid grid-cols-[4.5rem,minmax(0,1fr)] items-start gap-2">
                <span className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">수정 전</span>
                <span className="min-w-0 rounded-md border px-2 py-1 font-mono type-body-sm whitespace-pre-wrap break-words excel-diff-cell-removed">
                  {displayExcelGridValue(history.before)}
                </span>
              </div>
              <div className="grid grid-cols-[4.5rem,minmax(0,1fr)] items-start gap-2">
                <span className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">수정 후</span>
                <span className="min-w-0 rounded-md border px-2 py-1 font-mono type-body-sm whitespace-pre-wrap break-words excel-diff-cell-added">
                  {displayExcelGridValue(history.after)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
