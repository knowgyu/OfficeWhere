export {}

declare global {
  interface OfficeWhereE2eAppDataCandidate {
    id: string
    label: string
    path: string
    exists: boolean
    sizeBytes?: number
    description: string
    dangerous?: boolean
  }

  type OfficeWhereE2eCloseBehavior = 'ask' | 'hide' | 'quit'

  interface OfficeWhereE2eQuickSearchSettings {
    supported: boolean
    enabled: boolean
    showRecent: boolean
    accelerator: string
    displayShortcut: string
    registered: boolean
    reason?: string
  }

  interface OfficeWhereE2eUpdateAssetInfo {
    name: string
    url: string
    sizeBytes?: number
    sha256Url?: string
  }

  interface OfficeWhereE2eUpdateCheckResult {
    currentVersion: string
    latestVersion: string
    updateAvailable: boolean
    releaseUrl: string
    asset?: OfficeWhereE2eUpdateAssetInfo
  }

  interface OfficeWhereE2eUpdateInstallResult {
    success: boolean
    latestVersion: string
    assetName: string
    filePath: string
    folderPath: string
    alreadyDownloaded: boolean
    restartScheduled: boolean
    message: string
  }

  interface OfficeWhereBridge {
    getBackendBaseUrl?: () => Promise<string>
    getAppDataPaths?: () => Promise<OfficeWhereE2eAppDataCandidate[]>
    getCloseBehavior?: () => Promise<OfficeWhereE2eCloseBehavior>
    setCloseBehavior?: (behavior: OfficeWhereE2eCloseBehavior) => Promise<OfficeWhereE2eCloseBehavior>
    getQuickSearchSettings?: () => Promise<OfficeWhereE2eQuickSearchSettings>
    setQuickSearchSettings?: (
      settings: Partial<Pick<OfficeWhereE2eQuickSearchSettings, 'enabled' | 'showRecent' | 'accelerator'>>,
    ) => Promise<OfficeWhereE2eQuickSearchSettings>
    showQuickSearch?: () => Promise<void>
    hideQuickSearch?: () => Promise<void>
    openMainSearch?: (query: string) => Promise<void>
    checkForUpdates?: () => Promise<OfficeWhereE2eUpdateCheckResult>
    installUpdate?: () => Promise<OfficeWhereE2eUpdateInstallResult>
  }

  interface Window {
    officeWhere?: OfficeWhereBridge
  }
}
