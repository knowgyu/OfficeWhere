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
        page: vi.fn(),
        open: vi.fn(),
        showInFolder: vi.fn(),
      },
      library: {
        ...actual.api.library,
        getSettings: vi.fn(),
      },
    },
  }
})

import FileSearch from './FileSearch'
import { api } from '../api/client'
import type { FileListResponse, LibrarySettings, SearchResponse } from '../api/client'

const mockedSearchQuery = vi.mocked(api.search.query)
const mockedFilesPage = vi.mocked(api.files.page)
const mockedLibraryGetSettings = vi.mocked(api.library.getSettings)

const defaultLibrarySettings: LibrarySettings = {
  watched_folders: [],
  excluded_folder_names: [],
  auto_rescan_mode: 'interval',
  auto_rescan_interval_hours: 24,
  auto_rescan_daily_time: '03:00',
  fast_worker_count: 24,
}

function emptyResponse(query = ''): SearchResponse {
  return { query, total: 0, results: [], file_count: 0, file_limit: 20, has_more: false }
}

function fileListResponse(overrides: Partial<FileListResponse> = {}): FileListResponse {
  return {
    total: 0,
    items: [],
    counts_by_type: {},
    limit: 20,
    offset: 0,
    ...overrides,
  }
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

function renderInactiveFileSearch(props: Partial<Parameters<typeof FileSearch>[0]> = {}) {
  return renderWithProviders(<FileSearch active={false} {...props} />, { withLibraryRescan: false })
}

beforeEach(() => {
  mockedSearchQuery.mockReset()
  mockedFilesPage.mockReset()
  mockedLibraryGetSettings.mockReset()
  mockedFilesPage.mockResolvedValue({ data: fileListResponse() })
  mockedLibraryGetSettings.mockResolvedValue({ data: defaultLibrarySettings })
})

describe('FileSearch', () => {
  describe('debounce', () => {
    it('does not query the backend until 600ms after the last keystroke', async () => {
      vi.useFakeTimers()
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
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

      renderInactiveFileSearch()
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

      renderInactiveFileSearch()
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)

      fireEvent.change(input, { target: { value: '   ' } })
      vi.advanceTimersByTime(700)

      expect(mockedSearchQuery).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('offers a direct route to library settings from the ready empty state', async () => {
      const onOpenLibrarySettings = vi.fn()

      renderWithProviders(
        <FileSearch onOpenLibrarySettings={onOpenLibrarySettings} />,
        { withLibraryRescan: false },
      )

      await userEvent.click(await screen.findByRole('button', { name: '대상 폴더 추가' }))

      expect(onOpenLibrarySettings).toHaveBeenCalledTimes(1)
    })

    it('shows all documents by recent modified order when one target folder is registered', async () => {
      mockedLibraryGetSettings.mockResolvedValue({
        data: {
          ...defaultLibrarySettings,
          watched_folders: [{ path: '/work/docs', recursive: true }],
        },
      })
      mockedFilesPage.mockResolvedValue({
        data: fileListResponse({
          total: 1,
          items: [
            {
              id: 7,
              name: '분기보고.xlsx',
              path: '/work/docs/분기보고.xlsx',
              file_type: 'Excel',
              column_count: 3,
              file_mtime: 1_700_000_000,
            },
          ],
        }),
      })

      renderWithProviders(<FileSearch onOpenLibrarySettings={vi.fn()} />, { withLibraryRescan: false })

      expect(await screen.findByText('전체 문서')).toBeInTheDocument()
      expect(screen.getByText('분기보고.xlsx')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '대상 폴더 추가' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '검색 대상 확인' })).toBeInTheDocument()
      expect(mockedSearchQuery).not.toHaveBeenCalled()
      expect(mockedFilesPage).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        sort: 'file_mtime_desc',
        includeMissing: false,
      })
    })

    it('guides users to refresh documents when folders exist but no indexed files are ready', async () => {
      mockedLibraryGetSettings.mockResolvedValue({
        data: {
          ...defaultLibrarySettings,
          watched_folders: [{ path: '/work/docs', recursive: true }],
        },
      })

      renderWithProviders(<FileSearch onOpenLibrarySettings={vi.fn()} />, { withLibraryRescan: false })

      expect(await screen.findByText('대상 폴더가 등록되어 있습니다')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '대상 폴더 추가' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '검색 대상 확인' })).toBeInTheDocument()
    })

    it('loads more recent documents when the landing sentinel scrolls into view', async () => {
      let latestObserver: {
        trigger: () => void
        observe: ReturnType<typeof vi.fn>
        disconnect: ReturnType<typeof vi.fn>
      } | null = null
      class MockIntersectionObserver {
        observe = vi.fn()
        disconnect = vi.fn()
        private callback: IntersectionObserverCallback

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
          latestObserver = this
        }

        trigger() {
          this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
        }
      }
      vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
      mockedLibraryGetSettings.mockResolvedValue({
        data: {
          ...defaultLibrarySettings,
          watched_folders: [{ path: '/work/docs', recursive: true }],
        },
      })
      mockedFilesPage
        .mockResolvedValueOnce({
          data: fileListResponse({
            total: 21,
            items: Array.from({ length: 20 }, (_, index) => ({
              id: index + 1,
              name: `최근문서-${index + 1}.docx`,
              path: `/work/docs/최근문서-${index + 1}.docx`,
              file_type: 'Word',
              column_count: 0,
              file_mtime: 1_700_000_000 - index,
            })),
            limit: 20,
            offset: 0,
          }),
        })
        .mockResolvedValueOnce({
          data: fileListResponse({
            total: 21,
            items: [
              {
                id: 21,
                name: '다음문서.docx',
                path: '/work/docs/다음문서.docx',
                file_type: 'Word',
                column_count: 0,
                file_mtime: 1_699_999_000,
              },
            ],
            limit: 20,
            offset: 20,
          }),
        })

      renderWithProviders(<FileSearch onOpenLibrarySettings={vi.fn()} />, { withLibraryRescan: false })

      expect(await screen.findByText('최근문서-1.docx')).toBeInTheDocument()
      await waitFor(() => expect(latestObserver?.observe).toHaveBeenCalled())
      latestObserver?.trigger()

      await waitFor(() => expect(screen.getByText('다음문서.docx')).toBeInTheDocument())
      expect(mockedFilesPage.mock.calls[1]?.[0]).toEqual({
        limit: 20,
        offset: 20,
        sort: 'file_mtime_desc',
        includeMissing: false,
      })
      expect(mockedSearchQuery).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })

  describe('search button (immediate, bypass debounce)', () => {
    it('clicking 검색 triggers a query without waiting for debounce', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)
      await userEvent.type(input, '회의')

      mockedSearchQuery.mockClear()
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.calls[0]?.[0]).toMatchObject({
        query: '회의',
        limit: 100,
        file_limit: 20,
        per_file_limit: 5,
      })
    })

    it('clicking 검색 cancels the pending debounced duplicate query', async () => {
      vi.useFakeTimers()
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
      const input = screen.getByPlaceholderText(/파일 안의 단어를 검색/)
      fireEvent.change(input, { target: { value: '회의' } })
      fireEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      expect(mockedSearchQuery).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(700)
      expect(mockedSearchQuery).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('the 검색 button is disabled when the query is empty', () => {
      renderInactiveFileSearch()
      expect(screen.getByRole('button', { name: /^검색$/ })).toBeDisabled()
    })
  })

  describe('file type filter', () => {
    it('toggling .xlsx chip re-runs the search with file_types=["xlsx"]', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      mockedSearchQuery.mockClear()
      await userEvent.click(screen.getByRole('button', { name: '.xlsx' }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.lastCall?.[0]?.file_types).toEqual(['xlsx'])
    })

    it('초기화 clears file-type filters and re-queries with file_types undefined', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await userEvent.click(screen.getByRole('button', { name: '.xlsx' }))
      mockedSearchQuery.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '초기화' }))
      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.lastCall?.[0]?.file_types).toBeUndefined()
    })

    it('toggling .pdf chip re-runs the search with file_types=["pdf"]', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      mockedSearchQuery.mockClear()
      await userEvent.click(screen.getByRole('button', { name: '.pdf' }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      expect(mockedSearchQuery.mock.lastCall?.[0]?.file_types).toEqual(['pdf'])
    })
  })

  describe('search scope', () => {
    it('changing scope to 파일명만 re-runs the search with search_scope=filename', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('회의') })

      renderInactiveFileSearch()
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

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => {
        expect(screen.getByText('주간보고_v1.0.docx')).toBeInTheDocument()
      })
    })

    it('shows current watched folders directly on the search page', async () => {
      mockedLibraryGetSettings.mockResolvedValue({
        data: {
          ...defaultLibrarySettings,
          watched_folders: [{ path: '/work/finance', recursive: true }],
        },
      })

      renderWithProviders(<FileSearch onOpenLibrarySettings={vi.fn()} />, { withLibraryRescan: false })

      expect(await screen.findByText('검색 대상 1개 폴더')).toBeInTheDocument()
      expect(screen.getByText('/work/finance')).toBeInTheDocument()
    })

    it('can temporarily hide the clicked result folder for the current search', async () => {
      mockedSearchQuery
        .mockResolvedValueOnce({
          data: {
            query: '회의',
            total: 2,
            results: [
              searchHit({
                file_id: 1,
                name: '숨길문서.docx',
                path: '/lib/archive/숨길문서.docx',
              }),
              searchHit({
                file_id: 2,
                name: '남길문서.docx',
                path: '/lib/current/남길문서.docx',
              }),
            ],
            file_count: 2,
            file_limit: 20,
            has_more: false,
          },
        })
        .mockResolvedValueOnce({
          data: {
            query: '회의',
            total: 1,
            results: [
              searchHit({
                file_id: 2,
                name: '남길문서.docx',
                path: '/lib/current/남길문서.docx',
              }),
            ],
            file_count: 1,
            file_limit: 20,
            has_more: false,
          },
        })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(screen.getByText('숨길문서.docx')).toBeInTheDocument())
      await userEvent.click(screen.getAllByRole('button', { name: '이번 검색 제외' })[0])

      await waitFor(() => {
        expect(mockedSearchQuery.mock.lastCall?.[0]?.excluded_folder_paths).toEqual(['/lib/archive'])
      })
      await waitFor(() => expect(screen.queryByText('숨길문서.docx')).not.toBeInTheDocument())
      expect(screen.getByText('남길문서.docx')).toBeInTheDocument()
      expect(screen.getByText('숨김: archive')).toBeInTheDocument()
    })

    it('automatically loads the next result page when the sentinel scrolls into view', async () => {
      let latestObserver: {
        trigger: () => void
        observe: ReturnType<typeof vi.fn>
        disconnect: ReturnType<typeof vi.fn>
      } | null = null
      class MockIntersectionObserver {
        observe = vi.fn()
        disconnect = vi.fn()
        private callback: IntersectionObserverCallback

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
          latestObserver = this
        }

        trigger() {
          this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
        }
      }
      vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

      mockedSearchQuery
        .mockResolvedValueOnce({
          data: {
            query: '회의',
            total: 1,
            results: [searchHit({ file_id: 1, name: '첫문서.docx', path: '/lib/첫문서.docx' })],
            file_count: 1,
            file_limit: 20,
            has_more: true,
          },
        })
        .mockResolvedValueOnce({
          data: {
            query: '회의',
            total: 2,
            results: [
              searchHit({ file_id: 1, name: '첫문서.docx', path: '/lib/첫문서.docx' }),
              searchHit({ file_id: 2, name: '다음문서.docx', path: '/lib/다음문서.docx' }),
            ],
            file_count: 2,
            file_limit: 40,
            has_more: false,
          },
        })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(screen.getByText('첫문서.docx')).toBeInTheDocument())
      expect(mockedSearchQuery).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(latestObserver?.observe).toHaveBeenCalled())
      latestObserver?.trigger()

      await waitFor(() => expect(screen.getByText('다음문서.docx')).toBeInTheDocument())
      expect(mockedSearchQuery.mock.calls[1]?.[0]?.file_limit).toBe(40)
      expect(mockedSearchQuery.mock.calls[1]?.[0]?.per_file_limit).toBe(5)

      vi.unstubAllGlobals()
    })

    it('keeps later infinite-scroll results collapsed after the user collapses body matches', async () => {
      let latestObserver: {
        trigger: () => void
        observe: ReturnType<typeof vi.fn>
        disconnect: ReturnType<typeof vi.fn>
      } | null = null
      class MockIntersectionObserver {
        observe = vi.fn()
        disconnect = vi.fn()
        private callback: IntersectionObserverCallback

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
          latestObserver = this
        }

        trigger() {
          this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
        }
      }
      vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

      mockedSearchQuery
        .mockResolvedValueOnce({
          data: {
            query: '회의',
            total: 1,
            results: [searchHit({ file_id: 1, name: '첫문서.docx', path: '/lib/첫문서.docx' })],
            file_count: 1,
            file_limit: 20,
            has_more: true,
          },
        })
        .mockResolvedValueOnce({
          data: {
            query: '회의',
            total: 2,
            results: [
              searchHit({ file_id: 1, name: '첫문서.docx', path: '/lib/첫문서.docx' }),
              searchHit({ file_id: 2, name: '다음문서.docx', path: '/lib/다음문서.docx' }),
            ],
            file_count: 2,
            file_limit: 40,
            has_more: false,
          },
        })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(screen.getByText('첫문서.docx')).toBeInTheDocument())
      expect(mockedSearchQuery).toHaveBeenCalledTimes(1)
      await userEvent.click(screen.getAllByRole('button', { name: '본문 위치 접기' })[0])
      expect(screen.getAllByRole('button', { name: '본문 위치 1건' })).toHaveLength(1)

      latestObserver?.trigger()

      await waitFor(() => expect(screen.getByText('다음문서.docx')).toBeInTheDocument())
      expect(mockedSearchQuery).toHaveBeenCalledTimes(2)
      expect(screen.getAllByRole('button', { name: '본문 위치 1건' })).toHaveLength(2)

      vi.unstubAllGlobals()
    })

    it('does not add a duplicate-page CTA inside search results', async () => {
      mockedSearchQuery.mockResolvedValue({
        data: {
          query: '회의',
          total: 2,
          results: [
            searchHit({
              file_id: 1,
              name: '회의록_최종.docx',
              path: '/lib/회의록_최종.docx',
              normalized_hash: 'same-body',
              content_chars: 120,
              chunk_count: 2,
            }),
            searchHit({
              file_id: 2,
              name: '회의록_복사본.docx',
              path: '/lib/회의록_복사본.docx',
              normalized_hash: 'same-body',
              content_chars: 120,
              chunk_count: 2,
            }),
          ],
          file_count: 2,
          file_limit: 20,
          has_more: false,
        },
      })

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(screen.getByText('회의록_최종.docx')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: '같은 내용 문서 보기' })).not.toBeInTheDocument()
    })

    it('shows an empty state title when results are empty after search', async () => {
      mockedSearchQuery.mockResolvedValue({ data: emptyResponse('없는단어') })
      const onOpenLibrarySettings = vi.fn()

      renderInactiveFileSearch({ onOpenLibrarySettings })
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '없는단어')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalled())
      await waitFor(() => {
        expect(screen.getByText(/"없는단어"에 대한 결과가 없습니다/)).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: '검색 대상 확인' }))
      expect(onOpenLibrarySettings).toHaveBeenCalledTimes(1)
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

      renderInactiveFileSearch()
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

      renderInactiveFileSearch()
      await userEvent.type(screen.getByPlaceholderText(/파일 안의 단어를 검색/), '회의')
      await userEvent.click(screen.getByRole('button', { name: /^검색$/ }))

      await waitFor(() => {
        expect(screen.getByText('검색에 실패했습니다.')).toBeInTheDocument()
      })
    })
  })
})
