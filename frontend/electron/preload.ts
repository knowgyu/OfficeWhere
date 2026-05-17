import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

type QuickSearchStatusPayload = {
  supported?: boolean
  enabled?: boolean
  showRecent?: boolean
  accelerator?: string
  displayShortcut?: string
  registered?: boolean
  reason?: string
}

const officeWhereBridge = {
  getBackendBaseUrl: () => ipcRenderer.invoke('app:get-backend-base-url'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getLogPath: () => ipcRenderer.invoke('app:get-log-path'),
  getAppDataPaths: () => ipcRenderer.invoke('app:get-data-paths'),
  clearAppData: (candidateIds: string[], exitAfterClear = true) =>
    ipcRenderer.invoke('app:clear-app-data', { candidateIds, exitAfterClear }),
  consumeResetState: () => ipcRenderer.invoke('app:consume-reset-state'),
  getCloseBehavior: () => ipcRenderer.invoke('app:get-close-behavior'),
  setCloseBehavior: (behavior: string) => ipcRenderer.invoke('app:set-close-behavior', { behavior }),
  getQuickSearchSettings: () => ipcRenderer.invoke('app:get-quick-search-settings'),
  setQuickSearchSettings: (settings: { enabled?: boolean; showRecent?: boolean; accelerator?: string }) =>
    ipcRenderer.invoke('app:set-quick-search-settings', settings),
  showQuickSearch: () => ipcRenderer.invoke('app:show-quick-search'),
  hideQuickSearch: () => ipcRenderer.invoke('app:hide-quick-search'),
  openMainSearch: (query: string) => ipcRenderer.invoke('app:open-main-search', { query }),
  onQuickSearchOpened: (callback: (payload?: QuickSearchStatusPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload?: QuickSearchStatusPayload) => callback(payload)
    ipcRenderer.on('quick-search:opened', listener)
    return () => ipcRenderer.removeListener('quick-search:opened', listener)
  },
  onQuickSearchPrepare: (callback: (payload?: QuickSearchStatusPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload?: QuickSearchStatusPayload) => callback(payload)
    ipcRenderer.on('quick-search:prepare', listener)
    return () => ipcRenderer.removeListener('quick-search:prepare', listener)
  },
  onQuickSearchSettingsChanged: (callback: (payload: QuickSearchStatusPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: QuickSearchStatusPayload) => callback(payload)
    ipcRenderer.on('quick-search:settings-changed', listener)
    return () => ipcRenderer.removeListener('quick-search:settings-changed', listener)
  },
  onOpenSearch: (callback: (payload: { query?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { query?: string }) => callback(payload)
    ipcRenderer.on('app:open-search', listener)
    return () => ipcRenderer.removeListener('app:open-search', listener)
  },
  getStartupSettings: () => ipcRenderer.invoke('app:get-startup-settings'),
  setStartupSettings: (enabled: boolean) => ipcRenderer.invoke('app:set-startup-settings', { enabled }),
  getExampleLibraryPath: () => ipcRenderer.invoke('app:get-example-library-path'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  openReleasePage: () => ipcRenderer.invoke('app:open-release-page'),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('app:show-item-in-folder', { path: filePath }),
}

contextBridge.exposeInMainWorld('officeWhere', officeWhereBridge)
