import { useMemo, useState } from 'react'

import { Icon, IconButton, TextField } from '../ui'

interface ResultTableProps {
  columns: string[]
  data: string[][]
  pageSize?: number
  stickyHeader?: boolean
}

export default function ResultTable({
  columns,
  data,
  pageSize = 50,
  stickyHeader = true,
}: ResultTableProps) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.toLowerCase()
    return data.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)))
  }, [data, search])

  const sorted = useMemo(() => {
    if (sortCol === null) return filtered
    return [...filtered].sort((a, b) => {
      const av = a[sortCol] ?? ''
      const bv = b[sortCol] ?? ''
      return sortAsc ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko')
    })
  }, [filtered, sortCol, sortAsc])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const pageData = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  const handleSort = (idx: number) => {
    if (sortCol === idx) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(idx)
      setSortAsc(true)
    }
    setPage(0)
  }

  if (columns.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <TextField
          leadingIcon="search"
          placeholder="표 안에서 검색"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(0)
          }}
          fullWidth={false}
          className="md:w-72"
        />
        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          {search ? `${sorted.length} / ${data.length}행` : `전체 ${data.length}행`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]">
        <table className="min-w-full text-sm">
          <thead
            className={`${
              stickyHeader ? 'sticky top-0' : ''
            } bg-[var(--md-sys-color-surface-container-low)] backdrop-blur`}
          >
            <tr>
              {columns.map((col, idx) => {
                const isSorted = sortCol === idx
                return (
                  <th
                    key={idx}
                    scope="col"
                    onClick={() => handleSort(idx)}
                    className="px-3 py-3 text-left type-label-md text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap cursor-pointer hover:text-[var(--md-sys-color-on-surface)] border-b border-[var(--md-sys-color-outline-variant)] select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col}
                      {isSorted && (
                        <Icon
                          name={sortAsc ? 'arrow_upward' : 'arrow_downward'}
                          size={16}
                          className="text-[var(--md-sys-color-primary)]"
                        />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center type-body-sm text-[var(--md-sys-color-on-surface-variant)]"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              pageData.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors"
                >
                  {row.map((cell, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-3 py-2.5 type-body-md text-[var(--md-sys-color-on-surface)] whitespace-nowrap max-w-xs truncate"
                      title={cell}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <IconButton
            icon="first_page"
            label="첫 페이지"
            onClick={() => setPage(0)}
            disabled={currentPage === 0}
            size="sm"
          />
          <IconButton
            icon="chevron_left"
            label="이전"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 0}
            size="sm"
          />
          <span className="type-label-lg px-3 text-[var(--md-sys-color-on-surface-variant)]">
            {currentPage + 1} / {totalPages}
          </span>
          <IconButton
            icon="chevron_right"
            label="다음"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            size="sm"
          />
          <IconButton
            icon="last_page"
            label="마지막 페이지"
            onClick={() => setPage(totalPages - 1)}
            disabled={currentPage >= totalPages - 1}
            size="sm"
          />
        </div>
      )}
    </div>
  )
}
