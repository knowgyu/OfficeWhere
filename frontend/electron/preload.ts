import { contextBridge, ipcRenderer } from 'electron'

const officeWhereBridge = {
  getBackendBaseUrl: () => ipcRenderer.invoke('app:get-backend-base-url'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getLogPath: () => ipcRenderer.invoke('app:get-log-path'),
  getAppDataPaths: () => ipcRenderer.invoke('app:get-data-paths'),
  clearAppData: (candidateIds: string[], exitAfterClear = true) =>
    ipcRenderer.invoke('app:clear-app-data', { candidateIds, exitAfterClear }),
  getCloseBehavior: () => ipcRenderer.invoke('app:get-close-behavior'),
  setCloseBehavior: (behavior: string) => ipcRenderer.invoke('app:set-close-behavior', { behavior }),
}

contextBridge.exposeInMainWorld('officeWhere', officeWhereBridge)
