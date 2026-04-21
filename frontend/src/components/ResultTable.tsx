import { useState, useMemo } from 'react'

interface ResultTableProps {
  columns: string[]
  data: string[][]
  pageSize?: number
}

export default function ResultTable({ columns, data, pageSize = 50 }: ResultTableProps) {
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

  const totalPages = Math.ceil(sorted.length / pageSize)
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const handleSort = (idx: number) => {
    if (sortCol === idx) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(idx)
      setSortAsc(true)
    }
    setPage(0)
  }

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(0)
  }

  if (columns.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Search & Stats */}
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder="검색..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-500">
          {search ? `${sorted.length} / ${data.length}행` : `전체 ${data.length}행`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  onClick={() => handleSort(idx)}
                  className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:bg-gray-100 border-b border-gray-200 select-none"
                >
                  {col}
                  {sortCol === idx && (
                    <span className="ml-1 text-blue-500">{sortAsc ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-gray-400 text-sm"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              pageData.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-gray-50">
                  {row.map((cell, colIdx) => (
                    <td key={colIdx} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(0)}
            disabled={page === 0}
            className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-100"
          >
            «
          </button>
          <button
            onClick={() => setPage(page - 1)}
            disabled={page === 0}
            className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-100"
          >
            ‹
          </button>
          <span className="text-sm text-gray-600">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-100"
          >
            ›
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-100"
          >
            »
          </button>
        </div>
      )}
    </div>
  )
}
