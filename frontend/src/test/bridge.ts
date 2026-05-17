import { vi } from 'vitest'

/**
 * Install a mocked Electron preload bridge on `window.officeWhere` for the
 * current test. Returns the mock object so individual handlers can be asserted
 * or overridden mid-test.
 *
 * The bridge is removed automatically in setup.ts's afterEach. Tests that need
 * different defaults pass `overrides`.
 *
 * Why opt-in: components are written so all bridge methods are optional
 * (transport.ts:91-114). Auto-injecting the bridge in setup.ts would mask
 * regressions where components stop guarding for the absent bridge.
 */
export function installBridge(overrides: Partial<OfficeWhereBridge> = {}): OfficeWhereBridge {
  const bridge: OfficeWhereBridge = {
    getBackendBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:18765'),
    pickFolder: vi.fn().mockResolvedValue({ cancelled: true, folder_path: '' }),
    pickFile: vi.fn().mockResolvedValue({ cancelled: true, path: '' }),
    getAppVersion: vi.fn().mockResolvedValue('0.0.0-test'),
    getLogPath: vi.fn().mockResolvedValue('/tmp/officewhere-test.log'),
    getAppDataPaths: vi.fn().mockResolvedValue([]),
    clearAppData: vi.fn().mockResolvedValue({
      success: true,
      deleted: [],
      failed: [],
      backendStopped: false,
    }),
    consumeResetState: vi.fn().mockResolvedValue({ resetPending: false }),
    getCloseBehavior: vi.fn().mockResolvedValue('ask'),
    setCloseBehavior: vi.fn().mockImplementation((behavior) => Promise.resolve(behavior)),
    getQuickSearchSettings: vi.fn().mockResolvedValue({
      supported: true,
      enabled: true,
      showRecent: true,
      accelerator: 'CommandOrControl+Alt+F',
      displayShortcut: 'Ctrl + Alt + F',
      registered: true,
    }),
    setQuickSearchSettings: vi.fn().mockImplementation((settings) =>
      Promise.resolve({
        supported: true,
        enabled: settings.enabled ?? true,
        showRecent: settings.showRecent ?? true,
        accelerator: settings.accelerator ?? 'CommandOrControl+Alt+F',
        displayShortcut:
          settings.accelerator === 'CommandOrControl+Alt+Space'
            ? 'Ctrl + Alt + Space'
            : settings.accelerator === 'CommandOrControl+Shift+F'
              ? 'Ctrl + Shift + F'
              : 'Ctrl + Alt + F',
        registered: settings.enabled !== false,
      }),
    ),
    showQuickSearch: vi.fn().mockResolvedValue(undefined),
    hideQuickSearch: vi.fn().mockResolvedValue(undefined),
    openMainSearch: vi.fn().mockResolvedValue(undefined),
    onQuickSearchOpened: vi.fn().mockReturnValue(() => undefined),
    onOpenSearch: vi.fn().mockReturnValue(() => undefined),
    getStartupSettings: vi.fn().mockResolvedValue({
      supported: false,
      enabled: false,
      executablePath: '',
    }),
    setStartupSettings: vi.fn().mockResolvedValue({
      supported: false,
      enabled: false,
      executablePath: '',
    }),
    getExampleLibraryPath: vi.fn().mockResolvedValue({ available: false, path: '' }),
    checkForUpdates: vi.fn().mockResolvedValue({
      currentVersion: '0.0.0-test',
      latestVersion: '0.0.0-test',
      updateAvailable: false,
      releaseUrl: '',
    }),
    installUpdate: vi.fn().mockResolvedValue({
      success: false,
      latestVersion: '',
      assetName: '',
      filePath: '',
      folderPath: '',
      alreadyDownloaded: false,
      restartScheduled: false,
      message: '',
    }),
    openReleasePage: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  Object.defineProperty(window, 'officeWhere', {
    value: bridge,
    configurable: true,
    writable: true,
  })
  return bridge
}
