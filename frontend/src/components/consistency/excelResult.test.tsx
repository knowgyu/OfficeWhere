import { describe, expect, it, vi } from 'vitest'

import { act, fireEvent, render, screen, waitFor, within } from '../../test/utils'
import type { ExcelDiffGridResponse } from '../../api/client'
import type { LibraryGroupDetail } from '../../api/library'
import { ExcelDiffGridModal } from './excelResult'

function cell(sheetName: string, rowNumber: number, columnLetter: string, value: string) {
  const columnIndex = columnLetter.charCodeAt(0) - 65
  return {
    sheet_name: sheetName,
    row_index: rowNumber - 1,
    row_number: rowNumber,
    column_index: columnIndex,
    column_letter: columnLetter,
    column_name: columnLetter,
    value,
    highlight: null,
    histories: [],
  }
}

function section(sheetName: string, title: string, value: string): ExcelDiffGridResponse['sections'][number] {
  return {
    id: `${sheetName}-${title}`,
    sheet_name: sheetName,
    title,
    description: `${sheetName} 설명`,
    partial: false,
    row_start: 1,
    row_end: 1,
    col_start: 1,
    col_end: 1,
    columns: [{ index: 0, letter: 'A', name: 'A' }],
    rows: [
      {
        sheet_name: sheetName,
        row_index: 0,
        row_number: 1,
        cells: [cell(sheetName, 1, 'A', value)],
      },
    ],
  }
}

function modalData(): ExcelDiffGridResponse {
  return {
    latest_file: { file_id: 2, file_name: '사업예산-v2.xlsx' },
    row_count: 3,
    column_count: 3,
    sheet_name: '여러 시트',
    partial: false,
    omitted_focus_count: 0,
    sections: [
      section('요약', '요약 시트 표', '요약값'),
      section('세부', '세부 시트 표', '세부값'),
    ],
  }
}

function groupDetail(): LibraryGroupDetail {
  return {
    id: 'grp-budget',
    group_kind: 'version_family',
    file_type: 'Excel',
    base_name: '사업예산',
    canonical_name: '사업예산',
    title: '사업예산',
    file_count: 2,
    confidence: 'high',
    reason: '',
    tokens_summary: [],
    content_status: 'content_differs',
    fingerprint_coverage: 1,
    fingerprint_unique_count: 2,
    content_evidence: '',
    files: [],
  }
}

describe('ExcelDiffGridModal', () => {
  it('opens multi-sheet grids on the first sheet and switches visible sheet by selector', async () => {
    render(
      <ExcelDiffGridModal
        modal={{ detail: groupDetail(), loading: false, data: modalData(), error: '' }}
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Excel 시트 보기' })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '시트 선택' })).toHaveValue('요약'))
    expect(within(dialog).getByText('요약 시트 표')).toBeInTheDocument()
    expect(within(dialog).queryByText('세부 시트 표')).not.toBeInTheDocument()

    act(() => {
      fireEvent.change(within(dialog).getByRole('combobox', { name: '시트 선택' }), {
        target: { value: '세부' },
      })
    })

    expect(within(dialog).getByRole('combobox', { name: '시트 선택' })).toHaveValue('세부')
    expect(within(dialog).getByText('세부 시트 표')).toBeInTheDocument()
    expect(within(dialog).queryByText('요약 시트 표')).not.toBeInTheDocument()
  })
})
