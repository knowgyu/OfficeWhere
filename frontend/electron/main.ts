import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

const HOST = '127.0.0.1'
const STARTUP_TIMEOUT_MS = 30_000
const STARTUP_ATTEMPTS = 2

const DATA_CLEANUP_RETRIES = 3

type AppDataCandidate = {
  id: string
  label: string
  path: string
  exists: boolean
  sizeBytes?: number
  description: string
  dangerous?: boolean
  allowedRoot: string
}

type PublicAppDataCandidate = Omit<AppDataCandidate, 'allowedRoot'>

type ClearAppDataResult = {
  success: boolean
  deleted: string[]
  failed: { id: string; path: string; error: string }[]
  backendStopped: boolean
  restartScheduled: boolean
}

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
const expectedBackendExits = new WeakSet<ChildProcess>()
let backendBaseUrl = ''
let backendLogPath = ''
let isQuitting = false
let appDataCleanupInProgress = false

app.setName('OfficeWhere')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopBackend()
  })

  app.on('window-all-closed', () => {
    if (!appDataCleanupInProgress) app.quit()
  })

  app.whenReady()
    .then(startApp)
    .catch((error: unknown) => {
      showFatalError('앱 시작 실패', error)
      app.quit()
    })
}

async function startApp() {
  app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'))
  registerIpcHandlers()
  await startBackendWithRetry()
  await createMainWindow()
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-backend-base-url', () => backendBaseUrl)
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-log-path', () => backendLogPath)
  ipcMain.handle('app:get-data-paths', async () => getPublicAppDataCandidates())
  ipcMain.handle('app:clear-app-data', async (_event, payload: unknown) => clearAppData(payload))
  ipcMain.handle('dialog:pick-file', async () => pickFile())
  ipcMain.handle('dialog:pick-folder', async () => pickFolder())
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.removeMenu()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl)
    return
  }

  const rendererIndex = getRendererIndexPath()
  if (fs.existsSync(rendererIndex)) {
    await mainWindow.loadFile(rendererIndex)
    return
  }

  await mainWindow.loadURL('http://localhost:5173')
}

function getRendererIndexPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer', 'index.html')
  }
  return path.join(app.getAppPath(), 'dist', 'index.html')
}

function getAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer', 'officewhere-logo.png')
  }
  return path.join(app.getAppPath(), 'dist', 'officewhere-logo.png')
}

async function startBackendWithRetry() {
  let lastError: unknown

  for (let attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt += 1) {
    const port = await pickAvailablePort()
    backendBaseUrl = `http://${HOST}:${port}`
    try {
      await startBackend(port)
      return
    } catch (error) {
      lastError = error
      stopBackend()
      if (attempt < STARTUP_ATTEMPTS) {
        await delay(500)
      }
    }
  }

  const detail = errorToMessage(lastError)
  dialog.showErrorBox(
      'OfficeWhere backend 시작 실패',
    `Python backend를 시작하지 못했습니다.\n\n${detail}\n\n로그: ${backendLogPath || '생성되지 않음'}`
  )
  throw lastError
}

async function startBackend(port: number) {
  const dataDir = path.join(app.getPath('userData'), 'backend-data')
  fs.mkdirSync(dataDir, { recursive: true })

  const logDir = app.getPath('logs')
  fs.mkdirSync(logDir, { recursive: true })
  backendLogPath = path.join(logDir, `backend-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)

  const command = getBackendCommand(port, dataDir)
  const logStream = fs.createWriteStream(backendLogPath, { flags: 'a' })
  logStream.write(`[officewhere] command: ${command.file} ${command.args.join(' ')}\n`)

  let spawnError: Error | null = null
  let exited = false

  const child = spawn(command.file, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      ODJ_DATA_DIR: dataDir,
      ODJ_HOST: HOST,
      ODJ_PORT: String(port),
      PYTHONUTF8: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  backendProcess = child

  child.stdout?.pipe(logStream, { end: false })
  child.stderr?.pipe(logStream, { end: false })

  child.once('error', (error) => {
    spawnError = error
    logStream.write(`[officewhere] spawn error: ${error.message}\n`)
  })

  child.once('exit', (code, signal) => {
    exited = true
    logStream.write(`[officewhere] backend exited code=${code ?? ''} signal=${signal ?? ''}\n`)
    logStream.end()

    const expectedExit = isQuitting || expectedBackendExits.has(child)
    if (backendProcess === child) {
      backendProcess = null
    }

    if (!expectedExit) {
      dialog.showErrorBox(
        'OfficeWhere backend 종료',
        `Python backend가 예기치 않게 종료되었습니다.\n\n로그: ${backendLogPath}`
      )
      app.quit()
    }
  })

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (exited) throw new Error(`backend process exited before health check: ${backendLogPath}`)
    if (await pingHealth(backendBaseUrl)) return
    await delay(400)
  }

  throw new Error(`backend health check timed out: ${backendBaseUrl}`)
}

function getBackendCommand(port: number, dataDir: string): { file: string; args: string[]; cwd: string } {
  const args = ['--host', HOST, '--port', String(port), '--data-dir', dataDir]
  const override = process.env.ODJ_BACKEND_EXE
  if (override) {
    return { file: override, args, cwd: path.dirname(override) }
  }

  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'officewhere-backend.exe' : 'officewhere-backend'
    const file = path.join(process.resourcesPath, 'backend', exeName)
    return { file, args, cwd: path.dirname(file) }
  }

  const repoRoot = path.resolve(app.getAppPath(), '..')
  const script = path.join(repoRoot, 'backend_server.py')
  return { file: getPythonExecutable(repoRoot), args: [script, ...args], cwd: repoRoot }
}

function getPythonExecutable(repoRoot: string): string {
  const configured = process.env.ODJ_PYTHON
  if (configured) return configured

  const venvPython =
    process.platform === 'win32'
      ? path.join(repoRoot, 'venv', 'Scripts', 'python.exe')
      : path.join(repoRoot, 'venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) return venvPython

  return process.platform === 'win32' ? 'python' : 'python3'
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return
  expectedBackendExits.add(backendProcess)
  backendProcess.kill()
}

async function stopBackendAndWait(timeoutMs = 5_000): Promise<boolean> {
  const child = backendProcess
  if (!child || child.killed) return true

  expectedBackendExits.add(child)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timeout = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timeout)
      finish(true)
    })
    child.kill()
  })
}

function getSafeAppPath(name: Parameters<typeof app.getPath>[0]): string {
  try {
    return app.getPath(name)
  } catch {
    return ''
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target)
    return true
  } catch {
    return false
  }
}

async function directorySize(target: string): Promise<number> {
  let total = 0
  const stat = await fs.promises.lstat(target).catch(() => null)
  if (!stat) return 0
  if (!stat.isDirectory()) return stat.size

  const entries = await fs.promises.readdir(target, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(target, entry.name)
      if (entry.isSymbolicLink()) {
        const childStat = await fs.promises.lstat(child).catch(() => null)
        total += childStat?.size ?? 0
      } else if (entry.isDirectory()) {
        total += await directorySize(child)
      } else {
        const childStat = await fs.promises.lstat(child).catch(() => null)
        total += childStat?.size ?? 0
      }
    })
  )
  return total
}

async function buildAppDataCandidates(): Promise<AppDataCandidate[]> {
  const userData = app.getPath('userData')
  const appData = app.getPath('appData')
  const logs = app.getPath('logs')
  const sessionData = getSafeAppPath('sessionData') || userData
  const crashDumps = getSafeAppPath('crashDumps')
  const legacyHomeData = path.join(app.getPath('home'), '.officewhere')

  const candidates: AppDataCandidate[] = [
    {
      id: 'backend-data',
      label: 'Backend database and index',
      path: path.join(userData, 'backend-data'),
      exists: false,
      description: 'Electron 실행에서 사용하는 data.db, WAL/SHM, 검색 색인 데이터입니다.',
      allowedRoot: userData,
    },
    {
      id: 'logs',
      label: 'Application logs',
      path: logs,
      exists: false,
      description: 'Backend 실행 로그와 앱 진단 로그입니다.',
      allowedRoot: userData,
    },
    {
      id: 'chromium-cache',
      label: 'Chromium cache',
      path: path.join(sessionData, 'Cache'),
      exists: false,
      description: 'Electron Chromium HTTP/cache 파일입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-code-cache',
      label: 'Chromium code cache',
      path: path.join(sessionData, 'Code Cache'),
      exists: false,
      description: 'Electron renderer JavaScript code cache입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-local-storage',
      label: 'Chromium local/session storage',
      path: path.join(sessionData, 'Local Storage'),
      exists: false,
      description: 'Electron localStorage 등 renderer 저장 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-session-storage',
      label: 'Chromium session storage',
      path: path.join(sessionData, 'Session Storage'),
      exists: false,
      description: 'Electron sessionStorage 관련 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-gpu-cache',
      label: 'Chromium GPU cache',
      path: path.join(sessionData, 'GPUCache'),
      exists: false,
      description: 'Electron GPU 렌더링 cache입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'legacy-home-data',
      label: 'Legacy direct-backend data',
      path: legacyHomeData,
      exists: false,
      description: '직접 backend 실행 시 사용하던 ~/.officewhere 데이터입니다.',
      allowedRoot: app.getPath('home'),
    },
  ]

  if (crashDumps) {
    candidates.push({
      id: 'crash-dumps',
      label: 'Crash dumps',
      path: crashDumps,
      exists: false,
      description: 'Electron/Chromium crash dump 파일입니다.',
      allowedRoot: path.dirname(crashDumps),
    })
  }

  candidates.push({
    id: 'user-data-root',
    label: 'Full Electron userData reset',
    path: userData,
    exists: false,
    description: 'OfficeWhere Electron 프로필 전체입니다. 원본 문서는 삭제하지 않지만 앱 설정/세션이 초기화됩니다.',
    dangerous: true,
    allowedRoot: appData,
  })

  return Promise.all(
    candidates.map(async (candidate) => {
      const exists = await pathExists(candidate.path)
      return {
        ...candidate,
        exists,
        sizeBytes: exists ? await directorySize(candidate.path) : 0,
      }
    })
  )
}

async function getPublicAppDataCandidates(): Promise<PublicAppDataCandidate[]> {
  const candidates = await buildAppDataCandidates()
  return candidates.map(({ allowedRoot: _allowedRoot, ...candidate }) => candidate)
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

async function assertCandidatePathSafe(candidate: AppDataCandidate): Promise<void> {
  const targetExists = await pathExists(candidate.path)
  if (!targetExists) return

  const allowedRootReal = await fs.promises.realpath(candidate.allowedRoot)
  const targetReal = await fs.promises.realpath(candidate.path)
  if (!isPathInside(allowedRootReal, targetReal)) {
    throw new Error('삭제 대상이 앱 소유 경로 밖을 가리킵니다.')
  }

  if (candidate.path === candidate.allowedRoot && candidate.allowedRoot === app.getPath('appData')) {
    throw new Error('appData 루트는 삭제할 수 없습니다.')
  }
}

function dedupeCandidates(candidates: AppDataCandidate[]): AppDataCandidate[] {
  return [...candidates]
    .sort((left, right) => left.path.length - right.path.length)
    .filter((candidate, index, sorted) => {
      const candidatePath = path.resolve(candidate.path)
      return !sorted.slice(0, index).some((parent) => isPathInside(path.resolve(parent.path), candidatePath))
    })
}

async function removeWithRetry(target: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= DATA_CLEANUP_RETRIES; attempt += 1) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 })
      return
    } catch (error) {
      lastError = error
      await delay(200 * attempt)
    }
  }
  throw lastError
}

function touchesElectronSessionData(candidate: AppDataCandidate): boolean {
  return candidate.id === 'user-data-root' || candidate.id.startsWith('chromium-')
}

async function closeRendererForAppDataCleanup(candidates: AppDataCandidate[]): Promise<void> {
  if (!candidates.some(touchesElectronSessionData)) return

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = null
    await delay(200)
  }

  try {
    session.defaultSession.flushStorageData()
  } catch {
    // best-effort flush before removing on-disk app-owned data
  }
  await session.defaultSession.clearCache().catch(() => undefined)
}

async function clearAppData(payload: unknown): Promise<ClearAppDataResult> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('clear payload is required')
  }
  const { candidateIds, relaunch } = payload as { candidateIds?: unknown; relaunch?: unknown }
  if (!Array.isArray(candidateIds) || !candidateIds.every((id) => typeof id === 'string')) {
    throw new Error('candidateIds must be a string array')
  }

  const candidates = await buildAppDataCandidates()
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const unknownIds = candidateIds.filter((id) => !byId.has(id))
  if (unknownIds.length > 0) {
    throw new Error(`unknown app data candidate id: ${unknownIds.join(', ')}`)
  }

  const selected = dedupeCandidates(candidateIds.map((id) => byId.get(id)).filter((item): item is AppDataCandidate => !!item))
  if (selected.length === 0) {
    throw new Error('no app data candidates selected')
  }

  const result: ClearAppDataResult = {
    success: true,
    deleted: [],
    failed: [],
    backendStopped: false,
    restartScheduled: false,
  }

  appDataCleanupInProgress = true
  try {
    result.backendStopped = await stopBackendAndWait()
    await closeRendererForAppDataCleanup(selected)

    for (const candidate of selected) {
      try {
        await assertCandidatePathSafe(candidate)
        if (!(await pathExists(candidate.path))) continue
        await removeWithRetry(candidate.path)
        result.deleted.push(candidate.path)
      } catch (error) {
        result.success = false
        result.failed.push({ id: candidate.id, path: candidate.path, error: errorToMessage(error) })
      }
    }

    if (result.success && relaunch === true) {
      result.restartScheduled = true
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 250)
    }

    return result
  } finally {
    if (!result.restartScheduled) {
      appDataCleanupInProgress = false
    }
  }
}

async function pickAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, HOST, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate backend port')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

async function pingHealth(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const request = http.get(`${baseUrl}/api/health`, (response) => {
      response.resume()
      finish(response.statusCode === 200)
    })

    request.setTimeout(1_000, () => {
      request.destroy()
      finish(false)
    })
    request.on('error', () => finish(false))
  })
}

async function pickFile() {
  const options = {
    properties: ['openFile'],
    filters: [
      { name: 'Office files', extensions: ['xlsx', 'xls', 'docx', 'pptx'] },
      { name: 'All files', extensions: ['*'] },
    ],
  } as Electron.OpenDialogOptions
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  const selected = result.filePaths[0] ?? ''
  return {
    cancelled: result.canceled || !selected,
    path: selected ? path.normalize(selected) : '',
  }
}

async function pickFolder() {
  const options = {
    properties: ['openDirectory'],
  } as Electron.OpenDialogOptions
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  const selected = result.filePaths[0] ?? ''
  return {
    cancelled: result.canceled || !selected,
    folder_path: selected ? path.normalize(selected) : '',
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function showFatalError(title: string, error: unknown) {
  dialog.showErrorBox(title, errorToMessage(error))
}
