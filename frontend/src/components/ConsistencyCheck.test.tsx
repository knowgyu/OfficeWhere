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
        page: vi.fn(),
        open: vi.fn(),
        showInFolder: vi.fn(),
      },
      check: {
        run: vi.fn(),
        excelGrid: vi.fn(),
      },
      library: {
        ...actual.api.library,
        groups: vi.fn(),
        groupDetail: vi.fn(),
        setGroupLatestFile: vi.fn(),
        clearGroupLatestFile: vi.fn(),
        rescanStatus: vi.fn(),
      },
    },
  }
})

import ConsistencyCheck from './ConsistencyCheck'
import { api } from '../api/client'
import type { LibraryGroupDetail, LibraryGroupSummary, LibraryRescanStatus } from '../api/library'

const mocked = {
  filesPage: vi.mocked(api.files.page),
  groups: vi.mocked(api.library.groups),
  groupDetail: vi.mocked(api.library.groupDetail),
  rescanStatus: vi.mocked(api.library.rescanStatus),
  checkRun: vi.mocked(api.check.run),
}

const idleStatus: LibraryRescanStatus = {
  running: false,
  stage: 'idle',
  message: '',
  mode: 'normal',
  worker_count: 1,
  folders_total: 0,
  folders_processed: 0,
  found: 0,
  total: 0,
  processed: 0,
  percent: 0,
  registered: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  cancelled: 0,
  pruned_unsupported: 0,
  cancel_requested: false,
}

function summary(overrides: Partial<LibraryGroupSummary> = {}): LibraryGroupSummary {
  // The card renders group.latest_file?.name ?? group.base_name, so most
  // tests should set base_name (not title) to drive the visible text.
  const base = '기본묶음'
  return {
    id: 'grp-1',
    group_kind: 'version_family',
    file_type: 'Word',
    base_name: overrides.base_name ?? overrides.title ?? base,
    canonical_name: overrides.canonical_name ?? overrides.title ?? base,
    title: base,
    file_count: 4,
    confidence: 'high',
    reason: '',
    tokens_summary: [],
    content_status: 'content_differs',
    fingerprint_coverage: 1,
    fingerprint_unique_count: 4,
    content_evidence: '',
    ...overrides,
  }
}

function groupsResponse(items: LibraryGroupSummary[]) {
  return {
    data: {
      total: items.length,
      groups: items,
      limit: 50,
      offset: 0,
      counts_by_kind: {},
      derived_index_state: 'ready' as const,
      derived_index_stale: false,
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  }
}

function filesResponse() {
  return {
    data: { total: 0, items: [], counts_by_type: {}, limit: 60, offset: 0 },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  }
}

beforeEach(() => {
  // Default to a non-empty library so the component renders the main UI
  // rather than the "먼저 파일을 등록해 주세요" empty state, which has no
  // filter controls.
  mocked.filesPage.mockResolvedValue({
    data: { total: 1, items: [], counts_by_type: { Excel: 1 }, limit: 60, offset: 0 },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
  mocked.groups.mockResolvedValue(groupsResponse([summary({ id: 'default-grp', title: '기본묶음' })]))
  mocked.rescanStatus.mockResolvedValue({
    data: idleStatus,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
})

describe('ConsistencyCheck', () => {
  describe('initial load', () => {
    it('fetches groups and files on mount', async () => {
      renderWithProviders(<ConsistencyCheck />)

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      await waitFor(() => expect(mocked.filesPage).toHaveBeenCalled())

      expect(mocked.filesPage.mock.calls[0]?.[0]?.fileTypes).toEqual([
        'Excel',
        'Word',
        'PowerPoint',
      ])
    })

    it('renders the group titles returned by the backend', async () => {
      mocked.groups.mockResolvedValue(
        groupsResponse([
          summary({ id: 'a', base_name: '주간보고' }),
          summary({ id: 'b', base_name: '사업예산' }),
        ]),
      )

      renderWithProviders(<ConsistencyCheck />)

      await waitFor(() => {
        expect(screen.getAllByText('주간보고').length).toBeGreaterThan(0)
        expect(screen.getAllByText('사업예산').length).toBeGreaterThan(0)
      })
    })
  })

  describe('group filter (kind)', () => {
    it('clicking 수정본 묶음 re-queries with kind=version_family', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      // Filter panel is collapsed by default — open it first.
      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      mocked.groups.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '수정본 묶음' }))

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      expect(mocked.groups.mock.lastCall?.[0]?.kind).toBe('version_family')
    })

    it('clicking 같은 제목 후보 re-queries with kind=exact_name_conflict', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      mocked.groups.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '같은 제목 후보' }))

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      expect(mocked.groups.mock.lastCall?.[0]?.kind).toBe('exact_name_conflict')
    })

    it('clicking 전체 보기 sends kind=undefined', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      // First narrow, then widen back
      await userEvent.click(screen.getByRole('button', { name: '수정본 묶음' }))
      mocked.groups.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '전체 보기' }))

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      expect(mocked.groups.mock.lastCall?.[0]?.kind).toBeUndefined()
    })
  })

  describe('group file-type filter', () => {
    it('clicking .xlsx narrows fileType=Excel', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      mocked.groups.mockClear()

      // Two ".xlsx" buttons may exist (one in the file-type panel, one elsewhere
      // if duplicate label). The file-type filter is the first .xlsx button.
      const xlsxButtons = screen.getAllByRole('button', { name: '.xlsx' })
      await userEvent.click(xlsxButtons[0])

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      expect(mocked.groups.mock.lastCall?.[0]?.fileType).toBe('Excel')
    })
  })

  describe('group sort', () => {
    it('clicking 파일 많은 순 sets sort=count', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      mocked.groups.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '파일 많은 순' }))

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      expect(mocked.groups.mock.lastCall?.[0]?.sort).toBe('count')
    })
  })

  describe('show duplicate groups', () => {
    it('clicking 같은 내용 문서도 표시 sets includeDuplicates=true', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      mocked.groups.mockClear()

      await userEvent.click(screen.getByRole('button', { name: /같은 내용 문서도 표시/ }))

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      expect(mocked.groups.mock.lastCall?.[0]?.includeDuplicates).toBe(true)
    })
  })

  describe('group search', () => {
    it('Enter in the search box triggers a query with the entered text', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      const input = screen.getByPlaceholderText('문서명, 파일명, 폴더명으로 찾기')
      mocked.groups.mockClear()

      await userEvent.type(input, '주간보고')
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      // Component debounces search-on-type; the query reaches the API
      // eventually with our typed text.
      const calls = mocked.groups.mock.calls
      const lastQuery = calls[calls.length - 1]?.[0]?.query
      expect(lastQuery).toBe('주간보고')
    })
  })

  describe('group click', () => {
    it('clicking 변경 내용 보기 fetches the group detail', async () => {
      mocked.groups.mockResolvedValue(
        groupsResponse([summary({ id: 'grp-week', base_name: '주간보고' })]),
      )
      const detail: LibraryGroupDetail = {
        ...summary({ id: 'grp-week', base_name: '주간보고' }),
        files: [],
      }
      mocked.groupDetail.mockResolvedValue({
        data: detail,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(screen.getAllByText('주간보고').length).toBeGreaterThan(0))

      await userEvent.click(screen.getByRole('button', { name: '변경 내용 보기' }))

      await waitFor(() => expect(mocked.groupDetail).toHaveBeenCalledWith('grp-week'))
    })
  })

  describe('reset filters', () => {
    it('필터 초기화 returns query/kind/fileType/sort/duplicates to defaults', async () => {
      renderWithProviders(<ConsistencyCheck />)
      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '필터' }))
      // Apply a non-default filter so the reset button becomes enabled.
      await userEvent.click(screen.getByRole('button', { name: '수정본 묶음' }))
      mocked.groups.mockClear()

      await userEvent.click(screen.getByRole('button', { name: '필터 초기화' }))

      await waitFor(() => expect(mocked.groups).toHaveBeenCalled())
      const lastCallParams = mocked.groups.mock.lastCall?.[0]
      expect(lastCallParams?.kind).toBeUndefined()
      expect(lastCallParams?.fileType).toBeUndefined()
      expect(lastCallParams?.sort).toBe('recent')
      expect(lastCallParams?.includeDuplicates).toBeFalsy()
    })
  })
})
