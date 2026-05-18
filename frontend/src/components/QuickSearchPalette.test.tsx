import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderWithProviders, screen, waitFor, within } from '../test/utils'
import { installBridge } from '../test/bridge'

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

import { api, type QuickSearchSettings, type SearchResponse } from '../api/client'
import QuickSearchPalette from './QuickSearchPalette'

const mockedSearchQuery = vi.mocked(api.search.query)
const mockedOpenFile = vi.mocked(api.files.open)
const mockedShowInFolder = vi.mocked(api.files.showInFolder)
const mockedGetQuickSearchSettings = vi.mocked(api.app.getQuickSearchSettings)
const mockedHideQuickSearch = vi.mocked(api.app.hideQuickSearch)
const mockedOpenMainSearch = vi.mocked(api.app.openMainSearch)

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
  mockedOpenMainSearch.mockReset()
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
  it('keeps the floating shell free of the old oversized drop shadow', async () => {
    const { container } = renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })
    await act(async () => undefined)

    const shell = container.querySelector('.quick-search-shell')
    expect(shell).toBeInTheDocument()
    expect(shell?.className).toContain('shadow-[0_1px_0_var(--ow-inset-highlight)_inset]')
    expect(shell?.className).not.toContain('0_30px_80px')
  })

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

  it('searches, groups duplicate chunks by document, and keeps rows file-only until detail is opened', async () => {
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
    expect(screen.getByText(/budget/)).toBeInTheDocument()
    expect(screen.queryByText('2개 일치')).not.toBeInTheDocument()
    expect(screen.queryByText('Summary')).not.toBeInTheDocument()
    expect(screen.queryByText(/총액이 조정/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2026_예산안.xlsx 선택' }))
    expect(screen.queryByText('2개 일치')).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('빠른 문서 검색'), { key: 'Enter' })
    expect(screen.getByText(/2개 일치/)).toBeInTheDocument()
    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByText(/총액이 조정/)).toBeInTheDocument()
  })

  it('applies scope and file type prefixes before querying', async () => {
    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })

    fireEvent.change(screen.getByLabelText('빠른 문서 검색'), { target: { value: 'pdf c 예산' } })

    await waitFor(() => expect(mockedSearchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '예산',
        file_types: ['PDF'],
        search_scope: 'content',
      }),
    ))
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('본문')).toBeInTheDocument()
  })

  it('opens result details from the dedicated detail button for pointer users', async () => {
    mockedSearchQuery.mockResolvedValue({
      data: searchResponse([
        {
          file_id: 11,
          name: '요약.pdf',
          path: '/work/docs/요약.pdf',
          file_type: 'PDF',
          location: '쪽 3',
          snippet: '**요약** 문장입니다.',
        },
      ]),
    })

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })

    fireEvent.change(screen.getByLabelText('빠른 문서 검색'), { target: { value: '요약' } })
    await screen.findByText('요약.pdf')

    fireEvent.click(screen.getByRole('button', { name: '요약.pdf 상세 보기' }))
    expect(screen.getByText('1개 일치 · 쪽 3')).toBeInTheDocument()
    expect(screen.getByText(/문장입니다/)).toBeInTheDocument()
  })

  it('scrolls the keyboard-selected result into view while moving through results', async () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    mockedSearchQuery.mockResolvedValue({
      data: searchResponse(
        Array.from({ length: 12 }, (_, index) => ({
          file_id: index + 1,
          name: `문서_${index + 1}.pdf`,
          path: `/work/docs/문서_${index + 1}.pdf`,
          file_type: 'PDF',
          location: `쪽 ${index + 1}`,
          snippet: `**문서** ${index + 1} 내용입니다.`,
        })),
      ),
    })

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })
    const input = screen.getByLabelText('빠른 문서 검색')
    fireEvent.change(input, { target: { value: '문서' } })
    await screen.findByText('문서_1.pdf')
    scrollIntoView.mockClear()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }))
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('문서_3.pdf')
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

  it('opens a Ctrl+K action panel for the selected document', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    mockedSearchQuery.mockResolvedValue({
      data: searchResponse([
        {
          file_id: 13,
          name: '계약서.pdf',
          path: '/work/contracts/계약서.pdf',
          file_type: 'PDF',
          location: '쪽 4',
          snippet: '**계약서** 본문입니다.',
        },
      ]),
    })

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })
    const input = screen.getByLabelText('빠른 문서 검색')
    fireEvent.change(input, { target: { value: '계약서' } })
    await screen.findByText('계약서.pdf')

    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    const panel = screen.getByRole('dialog', { name: '문서 작업' })
    expect(within(panel).getByRole('button', { name: /파일 열기/ })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /위치 열기/ })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: /경로 복사/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/work/contracts/계약서.pdf'))
    expect(screen.queryByRole('dialog', { name: '문서 작업' })).not.toBeInTheDocument()
  })

  it('keeps open fast by focusing only, then prepares clean state while hidden', async () => {
    let openedHandler: ((payload?: Partial<QuickSearchSettings>) => void) | undefined
    let prepareHandler: ((payload?: Partial<QuickSearchSettings>) => void) | undefined
    installBridge({
      onQuickSearchOpened: vi.fn((callback) => {
        openedHandler = callback
        return () => undefined
      }),
      onQuickSearchPrepare: vi.fn((callback) => {
        prepareHandler = callback
        return () => undefined
      }),
    })
    mockedSearchQuery.mockResolvedValue({
      data: searchResponse([
        {
          file_id: 21,
          name: '빠른검색_계약서.pdf',
          path: '/work/contracts/빠른검색_계약서.pdf',
          file_type: 'PDF',
          location: '쪽 1',
          snippet: '**계약서** 본문입니다.',
        },
      ]),
    })

    renderWithProviders(<QuickSearchPalette />, { withLibraryRescan: false })
    const input = screen.getByLabelText('빠른 문서 검색')
    fireEvent.change(input, { target: { value: '계약서' } })
    await screen.findByText('빠른검색_계약서.pdf')

    act(() => openedHandler?.())

    expect(input).toHaveValue('계약서')
    expect(screen.getByText('빠른검색_계약서.pdf')).toBeInTheDocument()

    act(() =>
      prepareHandler?.({
        supported: true,
        enabled: true,
        showRecent: false,
        accelerator: 'CommandOrControl+Alt+G',
        displayShortcut: 'Ctrl + Alt + G',
        registered: true,
      }),
    )

    expect(input).toHaveValue('')
    expect(screen.queryByText('빠른검색_계약서.pdf')).not.toBeInTheDocument()
  })
})
