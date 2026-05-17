import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'

// Mock the api module so we can drive return values per scenario.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      ...actual.api,
      files: {
        ...actual.api.files,
        page: vi.fn(),
        pickFolder: vi.fn(),
        delete: vi.fn(),
        deleteAll: vi.fn(),
        schema: vi.fn(),
      },
      library: {
        ...actual.api.library,
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
        startRescan: vi.fn(),
        rescanStatus: vi.fn(),
        cancelRescan: vi.fn(),
      },
      app: {
        ...actual.api.app,
        getDataPaths: vi.fn(),
        getCloseBehavior: vi.fn(),
        getStartupSettings: vi.fn(),
        clearData: vi.fn(),
        setCloseBehavior: vi.fn(),
        setStartupSettings: vi.fn(),
      },
    },
  }
})

import FileManager from './FileManager'
import { api } from '../api/client'
import { installBridge } from '../test/bridge'
import type { LibrarySettings, LibraryRescanStatus } from '../api/library'
import type { FileInfo } from '../api/shared'

const mocked = {
  filesPage: vi.mocked(api.files.page),
  pickFolder: vi.mocked(api.files.pickFolder),
  fileDelete: vi.mocked(api.files.delete),
  deleteAll: vi.mocked(api.files.deleteAll),
  fileSchema: vi.mocked(api.files.schema),
  getSettings: vi.mocked(api.library.getSettings),
  updateSettings: vi.mocked(api.library.updateSettings),
  startRescan: vi.mocked(api.library.startRescan),
  rescanStatus: vi.mocked(api.library.rescanStatus),
  getDataPaths: vi.mocked(api.app.getDataPaths),
  getCloseBehavior: vi.mocked(api.app.getCloseBehavior),
  getStartupSettings: vi.mocked(api.app.getStartupSettings),
  setStartupSettings: vi.mocked(api.app.setStartupSettings),
}

const baseSettings: LibrarySettings = {
  watched_folders: [],
  excluded_folder_names: [],
  auto_rescan_mode: 'manual',
  auto_rescan_interval_hours: 24,
  auto_rescan_daily_time: '03:00',
  fast_worker_count: 24,
  last_rescan_at: null,
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
  missing: 0,
  recovered: 0,
  purged_missing: 0,
  cancel_requested: false,
}

function fileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    id: 1,
    name: 'a.xlsx',
    path: '/lib/a.xlsx',
    file_type: 'Excel',
    column_count: 0,
    ...overrides,
  }
}

async function openSettingsTab(label: string) {
  await userEvent.click(await screen.findByRole('tab', { name: new RegExp(label) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: empty library, no files, no bridge-backed app data.
  mocked.filesPage.mockResolvedValue({
    data: { total: 0, items: [], counts_by_type: {}, limit: 50, offset: 0 },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
  mocked.getSettings.mockResolvedValue({
    data: baseSettings,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
  mocked.rescanStatus.mockResolvedValue({
    data: idleStatus,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
  // App data fetches are bridge-only and reject without a bridge — the
  // component handles this with a Snackbar. Make them reject quietly.
  mocked.getDataPaths.mockRejectedValue({ response: { data: { detail: 'no bridge' } } })
  mocked.getCloseBehavior.mockRejectedValue({ response: { data: { detail: 'no bridge' } } })
  mocked.getStartupSettings.mockRejectedValue({ response: { data: { detail: 'no bridge' } } })
  mocked.setStartupSettings.mockResolvedValue({
    data: { supported: false, enabled: false, executablePath: '' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  })
})

describe('FileManager', () => {
  describe('initial load', () => {
    it('renders empty-state for watched folders when none are configured', async () => {
      renderWithProviders(<FileManager />)
      await waitFor(() => {
        expect(screen.getByText('지정된 대상 폴더가 없습니다')).toBeInTheDocument()
      })
    })

    it('separates settings into horizontal category tabs', async () => {
      renderWithProviders(<FileManager />)
      await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled())

      expect(screen.getByRole('tab', { name: /문서 소스/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: /등록 문서/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /앱 동작/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /데이터\/문제 해결/ })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '문서 소스' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '스캔/제외 설정' })).toBeInTheDocument()

      await openSettingsTab('앱 동작')
      expect(screen.getByRole('heading', { name: '표시와 앱 동작' })).toBeInTheDocument()
    })

    it('renders the configured watched folders', async () => {
      mocked.getSettings.mockResolvedValueOnce({
        data: {
          ...baseSettings,
          watched_folders: [{ path: '/Users/me/work', recursive: true }],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await waitFor(() => {
        expect(screen.getByText('/Users/me/work')).toBeInTheDocument()
      })
      // "하위 폴더 포함" appears twice — once in the Switch, once in the folder
      // card description. Both being present is the contract we want to verify.
      expect(screen.getAllByText('하위 폴더 포함').length).toBeGreaterThanOrEqual(2)
    })

    it('shows registered files in the page list', async () => {
      mocked.filesPage.mockResolvedValueOnce({
        data: {
          total: 2,
          items: [
            fileInfo({ id: 1, name: '주간보고_v1.0.docx', path: '/lib/주간보고_v1.0.docx', file_type: 'Word' }),
            fileInfo({ id: 2, name: '사업예산_v1.0.xlsx', path: '/lib/사업예산_v1.0.xlsx', file_type: 'Excel' }),
          ],
          counts_by_type: { Word: 1, Excel: 1 },
          limit: 50,
          offset: 0,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await openSettingsTab('등록 문서')
      await waitFor(() => {
        expect(screen.getByText('주간보고_v1.0.docx')).toBeInTheDocument()
        expect(screen.getByText('사업예산_v1.0.xlsx')).toBeInTheDocument()
      })
    })
  })

  describe('add watched folder', () => {
    it('warns when 대상 추가 is clicked with empty path', async () => {
      renderWithProviders(<FileManager />)
      await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '대상 추가' }))

      await waitFor(() =>
        expect(screen.getByText('대상 폴더 경로를 입력해 주세요.')).toBeInTheDocument(),
      )
      expect(mocked.updateSettings).not.toHaveBeenCalled()
    })

    it('saves a new watched folder, clears the draft, and triggers rescan', async () => {
      mocked.updateSettings.mockResolvedValueOnce({
        data: {
          ...baseSettings,
          watched_folders: [{ path: '/Users/me/lib', recursive: true }],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      mocked.startRescan.mockResolvedValueOnce({
        data: { ...idleStatus, running: true, stage: 'queued', mode: 'fast' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled())

      const input = screen.getByPlaceholderText('검색/검사 대상 폴더 경로')
      await userEvent.type(input, '/Users/me/lib')
      await userEvent.click(screen.getByRole('button', { name: '대상 추가' }))

      await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
      const [savedPayload] = mocked.updateSettings.mock.lastCall ?? []
      expect(savedPayload?.watched_folders).toEqual([{ path: '/Users/me/lib', recursive: true }])

      await waitFor(() => expect(mocked.startRescan).toHaveBeenCalledWith('fast'))
      expect((input as HTMLInputElement).value).toBe('')
    })

    it('updates recursive flag of an existing folder rather than duplicating it', async () => {
      mocked.getSettings.mockResolvedValueOnce({
        data: {
          ...baseSettings,
          watched_folders: [{ path: '/Users/me/lib', recursive: true }],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      mocked.updateSettings.mockResolvedValueOnce({
        data: {
          ...baseSettings,
          watched_folders: [{ path: '/Users/me/lib', recursive: false }],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await waitFor(() => expect(screen.getByText('/Users/me/lib')).toBeInTheDocument())

      const input = screen.getByPlaceholderText('검색/검사 대상 폴더 경로')
      await userEvent.type(input, '/Users/me/lib')
      // The recursive Switch is the only checkbox rendered on this view.
      const recursiveSwitch = screen.getAllByRole('checkbox')[0]
      await userEvent.click(recursiveSwitch)
      await userEvent.click(screen.getByRole('button', { name: '대상 추가' }))

      await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
      const [savedPayload] = mocked.updateSettings.mock.lastCall ?? []
      expect(savedPayload?.watched_folders).toEqual([{ path: '/Users/me/lib', recursive: false }])
    })
  })

  describe('pick folder', () => {
    it('fills the folder draft when api.files.pickFolder returns a path', async () => {
      mocked.pickFolder.mockResolvedValueOnce({
        data: { cancelled: false, folder_path: '/Users/me/picked' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '폴더 찾기' }))

      await waitFor(() => {
        const input = screen.getByPlaceholderText('검색/검사 대상 폴더 경로') as HTMLInputElement
        expect(input.value).toBe('/Users/me/picked')
      })
    })

    it('leaves the draft empty when the user cancels', async () => {
      mocked.pickFolder.mockResolvedValueOnce({
        data: { cancelled: true, folder_path: '' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: '폴더 찾기' }))

      const input = screen.getByPlaceholderText('검색/검사 대상 폴더 경로') as HTMLInputElement
      expect(input.value).toBe('')
    })
  })

  describe('rescan button', () => {
    it('disables rescan when no watched folders exist', async () => {
      renderWithProviders(<FileManager />)
      await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled())

      expect(screen.getByRole('button', { name: '문서 새로고침' })).toBeDisabled()
    })

    it('enables and triggers rescan when watched folders exist', async () => {
      mocked.getSettings.mockResolvedValueOnce({
        data: {
          ...baseSettings,
          watched_folders: [{ path: '/lib', recursive: true }],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      mocked.startRescan.mockResolvedValueOnce({
        data: { ...idleStatus, running: true, stage: 'queued', mode: 'fast' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)
      await waitFor(() => expect(screen.getByText('/lib')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: '문서 새로고침' }))

      await waitFor(() => expect(mocked.startRescan).toHaveBeenCalledWith('fast'))
    })
  })

  describe('startup settings', () => {
    function enableDesktopStartupMocks() {
      installBridge()
      mocked.getDataPaths.mockResolvedValue({
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      mocked.getCloseBehavior.mockResolvedValue({
        data: 'ask',
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
    }

    async function openAppBehaviorSettings() {
      await openSettingsTab('앱 동작')
    }

    it('shows approval guidance when startup settings require system approval', async () => {
      enableDesktopStartupMocks()
      mocked.getStartupSettings.mockResolvedValue({
        data: {
          supported: true,
          enabled: true,
          executablePath: '/Applications/OfficeWhere.app/Contents/MacOS/OfficeWhere',
          requiresApproval: true,
          reason: '시스템 설정에서 허용하면 시작프로그램으로 실행됩니다.',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)

      await openAppBehaviorSettings()
      expect(await screen.findByText('시작프로그램')).toBeInTheDocument()
      expect(screen.getByLabelText(/로그인할 때 OfficeWhere 실행/)).toBeChecked()
      expect(screen.getByText('macOS 시스템 설정에서 OfficeWhere 로그인을 허용해야 적용됩니다.')).toBeInTheDocument()
      expect(screen.getByText('/Applications/OfficeWhere.app/Contents/MacOS/OfficeWhere')).toBeInTheDocument()
    })

    it('does not show startup success when the returned state differs from the requested state', async () => {
      enableDesktopStartupMocks()
      mocked.getStartupSettings.mockResolvedValue({
        data: {
          supported: true,
          enabled: false,
          executablePath: '/apps/OfficeWhere/OfficeWhere.exe',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      mocked.setStartupSettings.mockResolvedValueOnce({
        data: {
          supported: true,
          enabled: false,
          executablePath: '/apps/OfficeWhere/OfficeWhere.exe',
          reason: '시스템 시작 항목에서 OfficeWhere를 확인해 주세요.',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })

      renderWithProviders(<FileManager />)

      await openAppBehaviorSettings()
      const startupSwitch = await screen.findByLabelText(/로그인할 때 OfficeWhere 실행/)
      await userEvent.click(startupSwitch)

      await waitFor(() => expect(mocked.setStartupSettings).toHaveBeenCalledWith(true))
      expect(screen.getAllByText('시스템 시작 항목에서 OfficeWhere를 확인해 주세요.').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('시작프로그램에 등록했습니다. 앱 위치를 옮기면 다시 켜 주세요.')).not.toBeInTheDocument()
    })
  })
})
