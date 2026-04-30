export interface AppDataCandidate {
  id: string
  label: string
  path: string
  exists: boolean
  sizeBytes?: number
  description: string
  dangerous?: boolean
}

export interface ClearAppDataResult {
  success: boolean
  deleted: string[]
  failed: { id: string; path: string; error: string }[]
  backendStopped: boolean
  exitScheduled?: boolean
  restartScheduled?: boolean
}

export type CloseBehavior = 'ask' | 'hide' | 'quit'
export type AppResetReason = 'safe' | 'full' | 'custom'

export interface AppResetState {
  resetPending: boolean
  reason?: AppResetReason
  resetAt?: string
}

export interface ExampleLibraryPathResponse {
  available: boolean
  path: string
  reason?: string
}

export interface SchemaResetState {
  resetPending: boolean
  detail?: string
  message?: string
}

export interface UpdateAssetInfo {
  name: string
  url: string
  sizeBytes?: number
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  asset?: UpdateAssetInfo
}

export interface UpdateDownloadResult {
  success: boolean
  path: string
  fileName: string
  sizeBytes: number
}

export interface FolderPickResponse {
  cancelled: boolean
  folder_path: string
}

declare global {
  interface OfficeWhereBridge {
    getBackendBaseUrl?: () => Promise<string>
    pickFolder?: () => Promise<FolderPickResponse & { error?: string }>
    pickFile?: () => Promise<{ cancelled: boolean; path: string; error?: string }>
    getAppVersion?: () => Promise<string>
    getLogPath?: () => Promise<string>
    getAppDataPaths?: () => Promise<AppDataCandidate[]>
    clearAppData?: (candidateIds: string[], exitAfterClear?: boolean) => Promise<ClearAppDataResult>
    consumeResetState?: () => Promise<AppResetState>
    getCloseBehavior?: () => Promise<CloseBehavior>
    setCloseBehavior?: (behavior: CloseBehavior) => Promise<CloseBehavior>
    getExampleLibraryPath?: () => Promise<ExampleLibraryPathResponse>
    checkForUpdates?: () => Promise<UpdateCheckResult>
    downloadUpdate?: () => Promise<UpdateDownloadResult>
    openReleasePage?: () => Promise<void>
    showItemInFolder?: (filePath: string) => Promise<void>
  }

  interface Window {
    officeWhere?: OfficeWhereBridge
  }
}

let backendBaseUrlPromise: Promise<string> | null = null
const configuredDevBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/$/, '')

export function getOfficeWhereBridge(): OfficeWhereBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.officeWhere
}

export async function getBackendBaseUrl(): Promise<string> {
  if (!backendBaseUrlPromise) {
    const bridge = getOfficeWhereBridge()
    backendBaseUrlPromise = bridge?.getBackendBaseUrl
      ? bridge.getBackendBaseUrl()
      : Promise.resolve(import.meta.env.DEV ? configuredDevBackendUrl || '' : '')
  }

  return backendBaseUrlPromise
}

export async function apiPath(path: string): Promise<string> {
  const baseUrl = await getBackendBaseUrl()
  return `${baseUrl}${path}`
}
