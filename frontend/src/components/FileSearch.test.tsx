import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, fireEvent } from '../test/utils'
import userEvent from '@testing-library/user-event'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      ...actual.api,
      search: {
        query: vi.fn(),
        reindex: vi.fn(),
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
      },
      files: {
        ...actual.api.files,
        open: vi.fn(),
        showInFolder: vi.fn(),
      },
    },
  }
})

import FileSearch from './FileSearch'
import { api } from '../api/client'
import type { SearchResponse } from '../api/client'

const mockedSearchQuery = vi.mocked(api.search.query)

function emptyResponse(query = ''): SearchResponse {
  return { query, total: 0, results: [], file_count: 0, file_limit: 20, has_more: false }
}

function searchHit(overrides: Partial<SearchResponse['results'][number]> = {}) {
  return {
    file_id: 1,
    name: '주간보고_v1.0.docx',
    path: '/lib/주간보고_v1.0.docx',
    file_type: 'Word',
    location: '쪽 1',
    snippet: '회의 ...',
    ...overrides,
  }
}

beforeEach(() => {
  mockedSearchQuery.mockReset()
})

describe('FileSearch', () => {
  describe('debounce', () => {
    it('does not query the backend until 600ms after the last keystroke', async () => {
      vi.useFakeTimers()
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)

      fireEvent.change(input, { target: { value: '회의' } })
      expect(mockedSearchQuery).not.toHaveBeenCalled()

      vi.advanceTimersByTime(599)
      expect(mockedSearchQuery).not.toHaveBeenCalled()

      vi.advanceTimersByTime(2)
      expect(mockedSearchQuery).toHaveBeenCalledTimes(1)
      expect(mockedSearchQuery.mock.calls[0]?.[0]?.query).toBe('회의')

      vi.useRealTimers()
    })

    it('coalesces rapid keystrokes into a single query (last value wins)', async () => {
      vi.useFakeTimers()
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse() })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)

      fireEvent.change(input, { target: { value: '회' } })
      vi.advanceTimersByTime(200)
      fireEvent.change(input, { target: { value: '회의' } })
      vi.advanceTimersByTime(200)
      fireEvent.change(input, { target: { value: '회의록' } })
      vi.advanceTimersByTime(700)

      expect(mockedSearchQuery).toHaveBeenCalledTimes(1)
      expect(mockedSearchQuery.mock.calls[0]?.[0]?.query).toBe('회의록')

      vi.useRealTimers()
    })
  })

  describe('empty query', () => {
    it('does not query the backend when input is whitespace', () => {
      vi.useFakeTimers()

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)

      fireEvent.change(input, { target: { value: '   ' } })
      vi.advanceTimersByTime(700)

      expect(mockedSearchQuery).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('search button (immediate, bypass debounce)', () => {
    it('clicking 검색 triggers a query without waiting for debounce', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)
      await userEvent.type(input, '회의')

      mockedSearchQuery.mockClear()
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.calls[0]?.[0]?.query).toBe('회의')
    })

    it('the 검색 button is disabled when the query is empty', () => {
      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      expect(screen.getByRole('button', { name: /^검색$/ })).toBeDisabled()
    })
  })

  describe('file type filter', () => {
    it('toggling .xlsx chip re-runs the search with file_types=["xlsx"]', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      mockedSearchQuery.mockClear()
      await userEvent.click(screen.getByRole('button', { name: '.xlsx' }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.lastCall?.[0]?.file_types).toEqual(['xlsx'])
    })

    it('초기화 clears file-type filters and re-queries with file_types undefined', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await userEvent.click(screen.getByRole('button', { name: '.xlsx' }))
      mockedSearchQuery.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '초기화' }))
      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.lastCall?.[0]?.file_types).toBeUndefined()
    })
  })

  describe('search scope', () => {
    it('changing scope to 파일명만 re-runs the search with search_scope=filename', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      mockedSearchQuery.mockClear()
      await userEvent.click(screen.getByRole('radio', { name: '파일명만' }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.lastCall?.[0]?.search_scope).toBe('filename')
    })
  })

  describe('results rendering', () => {
    it('renders a result row when the backend returns a hit', async () => {
      mockedSearchQuery.mockResolvedValue({
        data: {
          query: '회의',
          total: 1,
          results: [searchHit({ name: '주간보고_v1.0.docx' })],
          file_count: 1,
          file_limit: 20,
          has_more: false,
        },
      })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => {
        expect(screen.getByText('주간보고_v1.0.docx')).toBeInTheDocument()
      })
    })

    it('shows an empty state title when results are empty after search', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('없는단어') })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '없는단어')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      await waitFor(() => {
        expect(screen.getByText(/"없는단어"에 대한 결과가 없습니다/)).toBeInTheDocument()
      })
    })
  })

  describe('clear button', () => {
    it('the close icon next to the input clears query and results', async () => {
      mockedSearchQuery.mockResolvedValue({
        data: {
          query: '회의',
          total: 1,
          results: [searchHit()],
          file_count: 1,
          file_limit: 20,
          has_more: false,
        },
      })

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)
      await userEvent.type(input, '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))
      await waitFor(() => expect(screen.getByText('주간보고_v1.0.docx')).toBeInTheDocument())

      const clearBtn = screen.getByRole('button', { name: '검색어 지우기' })
      await userEvent.click(clearBtn)

      expect((input as HTMLInputElement).value).toBe('')
      expect(screen.queryByText('주간보고_v1.0.docx')).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('shows an error snackbar when api.search.query rejects', async () => {
      mockedSearchQuery.mockRejectedValue(new Error('network'))

      renderWithProviders(<FileSearch />, { withLibraryRescan: false })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => {
        expect(screen.getByText('검색에 실패했습니다.')).toBeInTheDocument()
      })
    })
  })
})
