import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      ...actual.api,
      files: {
        ...actual.api.files,
        duplicates: vi.fn(),
        open: vi.fn(),
        showInFolder: vi.fn(),
      },
    },
  }
})

import DuplicateFiles from './DuplicateFiles'
import { api } from '../api/client'
import type { DuplicateFilesResponse } from '../api/client'

const mockedDuplicates = vi.mocked(api.files.duplicates)

function emptyDup(): DuplicateFilesResponse {
  return { total: 0, groups: [], limit: 50, offset: 0 }
}

function dupFile(overrides: Partial<DuplicateFilesResponse['groups'][number]['files'][number]> = {}) {
  return {
    id: 1,
    name: '공통양식.xlsx',
    path: '/lib/03_부서A/공통양식.xlsx',
    file_type: 'Excel',
    column_count: 0,
    content_chars: 1000,
    chunk_count: 5,
    ...overrides,
  }
}

beforeEach(() => {
  mockedDuplicates.mockResolvedValue({
    data: emptyDup(),
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
})

describe('DuplicateFiles', () => {
  it('fetches duplicates on mount', async () => {
    renderWithProviders(<DuplicateFiles />, { withLibraryRescan: false })

    await waitFor(() => expect(mockedDuplicates).toHaveBeenCalled())
    const params = mockedDuplicates.mock.lastCall?.[0]
    expect(params?.offset).toBe(0)
  })

  it('renders an empty state when no duplicate groups exist', async () => {
    renderWithProviders(<DuplicateFiles />, { withLibraryRescan: false })

    await waitFor(() => expect(mockedDuplicates).toHaveBeenCalled())
    // Title text from the empty state
    await waitFor(() => {
      // Either an EmptyState description or the section heading is fine —
      // we just want the page to mount without throwing.
      expect(screen.getByText('같은 내용 문서')).toBeInTheDocument()
    })
  })

  it('renders the duplicate groups returned by the backend', async () => {
    mockedDuplicates.mockResolvedValue({
      data: {
        total: 1,
        groups: [
          {
            content_signature: 'hash-1',
            file_count: 2,
            distinct_name_count: 1,
            total_content_chars: 2000,
            latest_mtime: null,
            file_types: ['Excel'],
            files: [
              dupFile({ id: 1, path: '/lib/03_부서A/공통양식.xlsx' }),
              dupFile({ id: 2, path: '/lib/04_부서B/공통양식.xlsx' }),
            ],
          },
        ],
        limit: 50,
        offset: 0,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
    })

    renderWithProviders(<DuplicateFiles />, { withLibraryRescan: false })

    await waitFor(() => expect(mockedDuplicates).toHaveBeenCalled())
    // The card renders the parent directory of each file (parentPath), and
    // the file name itself appears at least once across the two members.
    await waitFor(() => {
      expect(screen.getAllByText('공통양식.xlsx').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('/lib/03_부서A')).toBeInTheDocument()
      expect(screen.getByText('/lib/04_부서B')).toBeInTheDocument()
    })
  })

  it('refresh button triggers a re-fetch with offset=0', async () => {
    renderWithProviders(<DuplicateFiles />, { withLibraryRescan: false })
    await waitFor(() => expect(mockedDuplicates).toHaveBeenCalled())
    mockedDuplicates.mockClear()

    await userEvent.click(screen.getByRole('button', { name: '새로고침' }))

    await waitFor(() => expect(mockedDuplicates).toHaveBeenCalled())
    expect(mockedDuplicates.mock.lastCall?.[0]?.offset).toBe(0)
  })

  it('shows an error snackbar when the duplicates API rejects', async () => {
    mockedDuplicates.mockRejectedValue(new Error('network'))

    renderWithProviders(<DuplicateFiles />, { withLibraryRescan: false })

    await waitFor(() => {
      expect(screen.getByText('같은 내용 문서 정보를 불러오지 못했습니다.')).toBeInTheDocument()
    })
  })
})
