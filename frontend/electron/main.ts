import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

const HOST = '127.0.0.1'
const STARTUP_TIMEOUT_MS = 30_000
const STARTUP_ATTEMPTS = 2

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
const expectedBackendExits = new WeakSet<ChildProcess>()
let backendBaseUrl = ''
let backendLogPath = ''
let isQuitting = false

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
    app.quit()
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
