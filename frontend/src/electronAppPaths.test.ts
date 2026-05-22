import {
  hasExplicitUserDataDirArg,
  resolveWindowsLocalAppDataPaths,
} from '../electron/appPaths'

describe('Windows LocalAppData Electron paths', () => {
  it('detects explicit user-data-dir command line overrides', () => {
    expect(hasExplicitUserDataDirArg(['OfficeWhere.exe', '--user-data-dir=C:\\tmp\\ow'])).toBe(true)
    expect(hasExplicitUserDataDirArg(['OfficeWhere.exe', '--user-data-dir', 'C:\\tmp\\ow'])).toBe(true)
    expect(hasExplicitUserDataDirArg(['OfficeWhere.exe', '--no-sandbox'])).toBe(false)
  })

  it('anchors normal Windows launches under LOCALAPPDATA', () => {
    expect(
      resolveWindowsLocalAppDataPaths({
        platform: 'win32',
        argv: ['OfficeWhere.exe'],
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        currentAppDataPath: 'C:\\Users\\me\\AppData\\Roaming',
      }),
    ).toEqual({
      appData: 'C:\\Users\\me\\AppData\\Local',
      userData: 'C:\\Users\\me\\AppData\\Local\\OfficeWhere',
    })
  })

  it('preserves explicit custom user-data-dir launches', () => {
    expect(
      resolveWindowsLocalAppDataPaths({
        platform: 'win32',
        argv: ['OfficeWhere.exe', '--user-data-dir=C:\\tmp\\ow-e2e'],
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
    ).toBeNull()
  })

  it('honors Electron commandLine user-data-dir detection', () => {
    expect(
      resolveWindowsLocalAppDataPaths({
        platform: 'win32',
        argv: ['OfficeWhere.exe'],
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        explicitUserDataDir: true,
      }),
    ).toBeNull()
  })

  it('leaves non-Windows launches unchanged', () => {
    expect(
      resolveWindowsLocalAppDataPaths({
        platform: 'darwin',
        argv: ['OfficeWhere'],
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
    ).toBeNull()
  })

  it('falls back from Roaming appData when LOCALAPPDATA is unavailable', () => {
    expect(
      resolveWindowsLocalAppDataPaths({
        platform: 'win32',
        argv: ['OfficeWhere.exe'],
        env: {},
        currentAppDataPath: 'C:\\Users\\me\\AppData\\Roaming',
      }),
    ).toEqual({
      appData: 'C:\\Users\\me\\AppData\\Local',
      userData: 'C:\\Users\\me\\AppData\\Local\\OfficeWhere',
    })
  })
})
