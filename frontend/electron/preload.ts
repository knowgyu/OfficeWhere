import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('officeDataJoiner', {
  getBackendBaseUrl: () => ipcRenderer.invoke('app:get-backend-base-url'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getLogPath: () => ipcRenderer.invoke('app:get-log-path'),
  getAppDataPaths: () => ipcRenderer.invoke('app:get-data-paths'),
  clearAppData: (candidateIds: string[], relaunch = true) =>
    ipcRenderer.invoke('app:clear-app-data', { candidateIds, relaunch }),
})
