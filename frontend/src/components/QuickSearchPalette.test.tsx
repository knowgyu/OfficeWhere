import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders, screen, waitFor } from '../test/utils'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      ...actual.api,
      search: {
        ...actual.api.search,
        query: vi.fn(),
      },
      files: {
        ...actual.api.files,
        open: vi.fn(),
        showInFolder: vi.fn(),
      },
      app: {
        ...actual.api.app,
        getQuickSearchSettings: vi.fn(),
        hideQuickSearch: vi.fn(),
        openMainSearch: vi.fn(),
      },
    },
  }
})

import { api, type SearchResponse } from '../api/client'
import QuickSearchPalette from './QuickSearchPalette'

const mockedSearchQuery = vi.mocked(api.search.query)
const mockedOpenFile = vi.mocked(api.files.open)
const mockedShowInFolder = vi.mocked(api.files.showInFolder)
const mockedGetQuickSearchSettings = vi.mocked(api.app.getQuickSearchSettings)
const mockedHideQuickSearch = vi.mocked(api.app.hideQuickSearch)

function searchResponse(results: SearchResponse['results']): SearchResponse {
  return {
    query: '예산',
    total: results.length,
    results,
    file_count: new Set(results.map((item) => item.file_id)).size,
    file_limit: 10,
    has_more: false,
  }
}

beforeEach(() => {
  mockedSearchQuery.mockReset()
  mockedOpenFile.mockReset()
  mockedShowInFolder.mockReset()
  mockedHideQuickSearch.mockReset()
  mockedGetQuickSearchSettings.mockReset()
  mockedGetQuickSearchSettings.mockResolvedValue({
    data: {
      supported: true,
      enabled: true,
      showRecent: false,
      accelerator: 'CommandOrControl+Alt+F',
      displayShortcut: 'Ctrl + Alt + F',
      registered: true,
    },
  })
  mockedSearchQuery.mockResolvedValue({ data: searchResponse([]) })
})

describe('QuickSearchPalette', () => {
  it('keeps the idle palette as a plain search box even when old recent-search data exists', async () => {
    mockedGetQuickSearchSettings.mockResolvedValueOnce({
      data: {
        supported: true,
        enabled: true,
        showRecent: true,
        accelerator: 'CommandOrControl+Alt+F',
        displayShortcut: 'Ctrl + Alt + F',
        registered: true,
      },
    })
    window.localStorage.setItem('officewhere:quick-search-recent:v1', JSON.stringify(['예산안']))

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })

    expect(await screen.findByRole('searchbox', { name: '빠른 문서 검색' })).toBeInTheDocument()
    expect(screen.queryByText('OfficeWhere 빠른 검색')).not.toBeInTheDocument()
    expect(screen.queryByText('최근 검색')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /예산안/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument()
  })

  it('searches, groups duplicate chunks by document, and shows snippets', async () => {
    mockedSearchQuery.mockResolvedValue({
      data: searchResponse([
        {
          file_id: 7,
          name: '2026_예산안.xlsx',
          path: '/work/budget/2026_예산안.xlsx',
          file_type: 'Excel',
          location: 'Summary',
          snippet: '**예산** 총액이 조정되었습니다.',
        },
        {
          file_id: 7,
          name: '2026_예산안.xlsx',
          path: '/work/budget/2026_예산안.xlsx',
          file_type: 'Excel',
          location: 'Sheet1!B3',
          snippet: '부서별 **예산** 세부 내역입니다.',
        },
      ]),
    })

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })

    fireEvent.change(screen.getByLabelText('빠른 문서 검색'), { target: { value: '예산' } })

    await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ query: '예산', search_scope: 'filename_content' }),
    ))
    expect(await screen.findByText('2026_예산안.xlsx')).toBeInTheDocument()
    expect(screen.getByText('2개 일치')).toBeInTheDocument()
  })

  it('uses explicit keyboard actions for revealing and opening files', async () => {
    mockedSearchQuery.mockResolvedValue({
      data: searchResponse([
        {
          file_id: 9,
          name: '회의록.docx',
          path: '/work/meetings/회의록.docx',
          file_type: 'Word',
          location: '쪽 1',
          snippet: '**회의록** 본문입니다.',
        },
      ]),
    })

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })
    const input = screen.getByLabelText('빠른 문서 검색')
    fireEvent.change(input, { target: { value: '회의록' } })
    await screen.findByText('회의록.docx')

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(mockedShowInFolder).toHaveBeenCalledWith(9, '/work/meetings/회의록.docx'))
    expect(mockedHideQuickSearch).toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(mockedOpenFile).toHaveBeenCalledWith(9))
  })
})
