import path from 'node:path'

export type WindowsLocalAppDataPaths = {
  appData: string
  userData: string
}

type WindowsLocalAppDataOptions = {
  platform?: NodeJS.Platform | string
  argv?: readonly string[]
  env?: Partial<Pick<NodeJS.ProcessEnv, 'LOCALAPPDATA' | 'USERPROFILE'>>
  appName?: string
  currentAppDataPath?: string
  explicitUserDataDir?: boolean
}

export function hasExplicitUserDataDirArg(argv: readonly string[] = []): boolean {
  return argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))
}

function configuredLocalAppDataRoot(
  env: Partial<Pick<NodeJS.ProcessEnv, 'LOCALAPPDATA' | 'USERPROFILE'>>,
  currentAppDataPath?: string,
): string | null {
  const localAppData = env.LOCALAPPDATA?.trim()
  if (localAppData) return path.win32.normalize(localAppData)

  const userProfile = env.USERPROFILE?.trim()
  if (userProfile) return path.win32.join(userProfile, 'AppData', 'Local')

  if (currentAppDataPath) {
    const normalized = path.win32.normalize(currentAppDataPath)
    const parent = path.win32.dirname(normalized)
    if (
      path.win32.basename(normalized).toLowerCase() === 'roaming' &&
      path.win32.basename(parent).toLowerCase() === 'appdata'
    ) {
      return path.win32.join(parent, 'Local')
    }
  }

  return null
}

export function resolveWindowsLocalAppDataPaths({
  platform = process.platform,
  argv = process.argv,
  env = process.env,
  appName = 'OfficeWhere',
  currentAppDataPath,
  explicitUserDataDir,
}: WindowsLocalAppDataOptions = {}): WindowsLocalAppDataPaths | null {
  if (platform !== 'win32') return null
  if ((explicitUserDataDir ?? false) || hasExplicitUserDataDirArg(argv)) return null

  const appData = configuredLocalAppDataRoot(env, currentAppDataPath)
  if (!appData) return null

  return {
    appData,
    userData: path.win32.join(appData, appName),
  }
}
