import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, Tray } from 'electron'
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'

const HOST = '127.0.0.1'
const STARTUP_TIMEOUT_MS = 30_000
const STARTUP_ATTEMPTS = 2
const RELEASE_API_URL = 'https://api.github.com/repos/knowgyu/OfficeWhere/releases/latest'
const RELEASE_PAGE_URL = 'https://github.com/knowgyu/OfficeWhere/releases/latest'
const UPDATE_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

const DATA_CLEANUP_RETRIES = 3
const SAFE_RESET_CANDIDATE_IDS = new Set([
  'backend-data',
  'logs',
  'chromium-cache',
  'chromium-code-cache',
  'chromium-local-storage',
  'chromium-session-storage',
  'chromium-gpu-cache',
  'legacy-home-data',
])

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
  exitScheduled: boolean
}

type CloseBehavior = 'ask' | 'hide' | 'quit'
type AppResetReason = 'safe' | 'full' | 'custom'

type AppResetState = {
  resetPending: boolean
  reason?: AppResetReason
  resetAt?: string
}

type UpdateAsset = {
  name: string
  url: string
  sizeBytes?: number
}

type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  asset?: UpdateAsset
}

type UpdateDownloadResult = {
  success: boolean
  path: string
  fileName: string
  sizeBytes: number
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null
const expectedBackendExits = new WeakSet<ChildProcess>()
const backendLogStreams = new WeakMap<ChildProcess, fs.WriteStream>()
let backendBaseUrl = ''
let backendLogPath = ''
let isQuitting = false
let appDataCleanupInProgress = false
let closePromptInProgress = false
let appShutdownInProgress = false
let cachedUpdateCheck: UpdateCheckResult | null = null

app.setName('OfficeWhere')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopBackend()
    destroyTray()
    closeSplashWindow()
  })

  app.on('window-all-closed', () => {
    if (!appDataCleanupInProgress && !appShutdownInProgress) requestAppQuit()
  })

  app.on('activate', () => {
    showMainWindow()
  })

  app.whenReady()
    .then(startApp)
    .catch((error: unknown) => {
      closeSplashWindow()
      showFatalError('앱 시작 실패', error)
      requestAppQuit(1)
    })
}

async function startApp() {
  app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'))
  registerIpcHandlers()
  createSplashWindow()
  ensureTray()
  await startBackendWithRetry()
  await createMainWindow()
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-backend-base-url', () => backendBaseUrl)
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-log-path', () => backendLogPath)
  ipcMain.handle('app:get-data-paths', async () => getPublicAppDataCandidates())
  ipcMain.handle('app:clear-app-data', async (_event, payload: unknown) => clearAppData(payload))
  ipcMain.handle('app:consume-reset-state', () => consumeResetState())
  ipcMain.handle('app:get-close-behavior', () => readCloseBehavior())
  ipcMain.handle('app:set-close-behavior', async (_event, payload: unknown) => setCloseBehavior(payload))
  ipcMain.handle('app:get-example-library-path', () => getExampleLibraryPath())
  ipcMain.handle('app:check-for-updates', () => checkForUpdates())
  ipcMain.handle('app:download-update', () => downloadLatestUpdate())
  ipcMain.handle('app:open-release-page', () => openLatestReleasePage())
  ipcMain.handle('dialog:pick-file', async () => pickFile())
  ipcMain.handle('dialog:pick-folder', async () => pickFolder())
}

type GitHubReleaseAsset = {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
}

type GitHubRelease = {
  tag_name?: unknown
  html_url?: unknown
  assets?: unknown
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
}

function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left)
  const b = normalizeVersion(right)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function isAllowedUpdateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return url.protocol === 'https:' && UPDATE_DOWNLOAD_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function sanitizeUpdateFileName(name: string): string {
  const baseName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
  if (!baseName.toLowerCase().endsWith('.zip')) {
    throw new Error('업데이트 파일은 zip 형식이어야 합니다.')
  }
  if (!baseName.toLowerCase().startsWith('officewhere')) {
    throw new Error('OfficeWhere 릴리즈 파일만 다운로드할 수 있습니다.')
  }
  return baseName
}

function requestJson<T>(urlString: string, redirects = 3): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const protocol = url.protocol === 'https:' ? https : http
    const request = protocol.request(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `OfficeWhere/${app.getVersion()}`,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location
        if (status >= 300 && status < 400 && location && redirects > 0) {
          response.resume()
          const redirected = new URL(location, url).toString()
          requestJson<T>(redirected, redirects - 1).then(resolve, reject)
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          reject(new Error(`GitHub 릴리즈 정보를 확인하지 못했습니다. (${status})`))
          return
        }

        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    request.setTimeout(10_000, () => request.destroy(new Error('업데이트 확인 시간이 초과되었습니다.')))
    request.on('error', reject)
    request.end()
  })
}

function findWindowsZipAsset(assets: unknown): UpdateAsset | undefined {
  if (!Array.isArray(assets)) return undefined
  for (const item of assets as GitHubReleaseAsset[]) {
    const name = typeof item.name === 'string' ? item.name : ''
    const url = typeof item.browser_download_url === 'string' ? item.browser_download_url : ''
    const lowerName = name.toLowerCase()
    if (!lowerName.endsWith('.zip')) continue
    if (!lowerName.includes('windows') || !lowerName.includes('x64')) continue
    if (!isAllowedUpdateUrl(url)) continue
    return {
      name,
      url,
      sizeBytes: typeof item.size === 'number' ? item.size : undefined,
    }
  }
  return undefined
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const release = await requestJson<GitHubRelease>(RELEASE_API_URL)
  const latestVersion =
    typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : currentVersion
  const releaseUrl = typeof release.html_url === 'string' ? release.html_url : RELEASE_PAGE_URL
  const result: UpdateCheckResult = {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl,
    asset: findWindowsZipAsset(release.assets),
  }
  cachedUpdateCheck = result
  return result
}

function uniqueDownloadPath(fileName: string): string {
  const downloadsDir = app.getPath('downloads')
  const parsed = path.parse(fileName)
  let candidate = path.join(downloadsDir, fileName)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsDir, `${parsed.name} (${index})${parsed.ext}`)
    index += 1
  }
  return candidate
}

function downloadToFile(urlString: string, destination: string, redirects = 5): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!isAllowedUpdateUrl(urlString)) {
      reject(new Error('허용되지 않은 업데이트 다운로드 주소입니다.'))
      return
    }

    const url = new URL(urlString)
    const protocol = url.protocol === 'https:' ? https : http
    const request = protocol.get(
      url,
      {
        headers: {
          'User-Agent': `OfficeWhere/${app.getVersion()}`,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location
        if (status >= 300 && status < 400 && location && redirects > 0) {
          response.resume()
          const redirected = new URL(location, url).toString()
          downloadToFile(redirected, destination, redirects - 1).then(resolve, reject)
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          reject(new Error(`업데이트 파일을 다운로드하지 못했습니다. (${status})`))
          return
        }

        let bytes = 0
        const output = fs.createWriteStream(destination, { flags: 'wx' })
        response.on('data', (chunk: Buffer | string) => {
          bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
        })
        response.on('error', (error) => {
          output.destroy()
          fs.rm(destination, { force: true }, () => reject(error))
        })
        output.on('error', (error) => {
          response.destroy()
          fs.rm(destination, { force: true }, () => reject(error))
        })
        output.on('finish', () => {
          output.close(() => resolve(bytes))
        })
        response.pipe(output)
      },
    )
    request.setTimeout(60_000, () => request.destroy(new Error('업데이트 다운로드 시간이 초과되었습니다.')))
    request.on('error', reject)
  })
}

async function downloadLatestUpdate(): Promise<UpdateDownloadResult> {
  const update = cachedUpdateCheck ?? (await checkForUpdates())
  if (!update.updateAvailable || !update.asset) {
    throw new Error('다운로드할 새 Windows zip 릴리즈가 없습니다.')
  }
  const fileName = sanitizeUpdateFileName(update.asset.name)
  const destination = uniqueDownloadPath(fileName)
  const sizeBytes = await downloadToFile(update.asset.url, destination)
  return {
    success: true,
    path: destination,
    fileName,
    sizeBytes,
  }
}

async function openLatestReleasePage(): Promise<void> {
  const releaseUrl = cachedUpdateCheck?.releaseUrl ?? RELEASE_PAGE_URL
  if (!releaseUrl.startsWith('https://github.com/knowgyu/OfficeWhere/releases/')) {
    await shell.openExternal(RELEASE_PAGE_URL)
    return
  }
  await shell.openExternal(releaseUrl)
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    icon: getAppIconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.removeMenu()
  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('ready-to-show', () => {
    closeSplashWindow()
    mainWindow?.show()
  })
  mainWindow.on('close', (event) => {
    if (isQuitting || appDataCleanupInProgress) return
    event.preventDefault()
    void handleMainWindowClose()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
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

  await mainWindow.loadURL('http://localhost:15173')
}

function createSplashWindow() {
  if (splashWindow || isQuitting) return

  splashWindow = new BrowserWindow({
    width: 360,
    height: 260,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    center: true,
    backgroundColor: '#f8fafc',
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  splashWindow.once('ready-to-show', () => splashWindow?.show())
  splashWindow.on('closed', () => {
    splashWindow = null
  })
  void splashWindow.loadURL(createSplashHtml()).catch(() => undefined)
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null
    return
  }
  splashWindow.destroy()
  splashWindow = null
}

function createSplashHtml(): string {
  const logo = getLogoDataUrl()
  const logoMarkup = logo
    ? `<img class="logo" src="${escapeHtml(logo)}" alt="OfficeWhere" />`
    : '<div class="logo-fallback" aria-hidden="true">OW</div>'
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 100vw;
      height: 100vh;
      display: grid;
      place-items: center;
      overflow: hidden;
      color: #0f172a;
      background:
        radial-gradient(circle at 32% 18%, rgba(59, 130, 246, 0.18), transparent 28%),
        radial-gradient(circle at 78% 78%, rgba(37, 99, 235, 0.12), transparent 34%),
        linear-gradient(145deg, #ffffff 0%, #f8fafc 48%, #eef4ff 100%);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-app-region: drag;
    }
    .card {
      width: 292px;
      min-height: 196px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      border: 1px solid rgba(148, 163, 184, 0.26);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.78);
      box-shadow:
        0 24px 60px rgba(30, 41, 59, 0.14),
        0 1px 0 rgba(255, 255, 255, 0.9) inset;
      backdrop-filter: blur(18px);
    }
    .logo-wrap {
      width: 76px;
      height: 76px;
      position: relative;
      display: grid;
      place-items: center;
    }
    .logo-wrap::before {
      content: "";
      position: absolute;
      inset: 2px;
      border-radius: 22px;
      border: 2px solid rgba(59, 130, 246, 0.18);
      border-top-color: rgba(37, 99, 235, 0.9);
      animation: spin 1.35s linear infinite;
    }
    .logo, .logo-fallback {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.2);
    }
    .logo {
      object-fit: contain;
      background: #fff;
      padding: 6px;
    }
    .logo-fallback {
      display: grid;
      place-items: center;
      color: #ffffff;
      font-size: 17px;
      font-weight: 750;
      letter-spacing: -0.04em;
      background: linear-gradient(135deg, #2563eb, #0f172a);
    }
    .title {
      margin: 2px 0 0;
      font-size: 18px;
      font-weight: 760;
      letter-spacing: -0.04em;
    }
    .subtitle {
      margin: 0;
      color: #64748b;
      font-size: 13px;
      font-weight: 560;
      letter-spacing: -0.01em;
    }
    .dots {
      display: flex;
      gap: 5px;
      margin-top: 2px;
    }
    .dots span {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: #2563eb;
      animation: pulse 1.2s ease-in-out infinite;
      opacity: 0.34;
    }
    .dots span:nth-child(2) { animation-delay: 0.16s; }
    .dots span:nth-child(3) { animation-delay: 0.32s; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.32; }
      40% { transform: translateY(-4px); opacity: 0.9; }
    }
  </style>
</head>
<body>
  <main class="card" aria-label="OfficeWhere 시작 중">
    <div class="logo-wrap">${logoMarkup}</div>
    <h1 class="title">OfficeWhere</h1>
    <p class="subtitle">문서 검색 준비 중</p>
    <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
  </main>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function getLogoDataUrl(): string {
  const logoPath = getAppIconPath()
  if (!fs.existsSync(logoPath)) return ''
  try {
    const ext = path.extname(logoPath).toLowerCase()
    const mime = ext === '.ico' ? 'image/x-icon' : 'image/png'
    return `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`
  } catch {
    return ''
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getRendererIndexPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer', 'index.html')
  }
  return path.join(app.getAppPath(), 'dist', 'index.html')
}

function getAppIconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'renderer', 'officewhere-logo.png')]
    : [
        path.join(app.getAppPath(), 'dist', 'officewhere-logo.png'),
        path.join(app.getAppPath(), 'public', 'officewhere-logo.png'),
      ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) return found

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer', 'officewhere-logo.png')
  }
  return path.join(app.getAppPath(), 'dist', 'officewhere-logo.png')
}

function getTrayIconPath(): string {
  const iconName = process.platform === 'win32' ? 'officewhere-icon.ico' : 'officewhere-logo.png'
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'renderer')
    : path.join(app.getAppPath(), 'dist')
  const iconPath = path.join(basePath, iconName)
  const publicIconPath = path.join(app.getAppPath(), 'public', iconName)
  if (fs.existsSync(publicIconPath)) return publicIconPath
  return fs.existsSync(iconPath) ? iconPath : getAppIconPath()
}

function getExampleLibraryPath(): { available: boolean; path: string; reason?: string } {
  const candidates = app.isPackaged
    ? [
        path.join(path.dirname(app.getPath('exe')), 'examples', 'officewhere_test_library'),
        path.join(path.dirname(app.getPath('exe')), '..', 'examples', 'officewhere_test_library'),
        path.join(process.resourcesPath, 'examples', 'officewhere_test_library'),
      ]
    : [
        path.resolve(app.getAppPath(), '..', 'examples', 'officewhere_test_library'),
        path.resolve(process.cwd(), '..', 'examples', 'officewhere_test_library'),
        path.resolve(process.cwd(), 'examples', 'officewhere_test_library'),
      ]

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) return { available: true, path: found }

  return {
    available: false,
    path: '',
    reason: '예제 라이브러리 폴더를 찾지 못했습니다. examples/officewhere_test_library를 생성해 주세요.',
  }
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function resetMarkerPath(): string {
  return path.join(app.getPath('appData'), 'officewhere-reset-pending.json')
}

function resetReasonForCandidates(candidates: AppDataCandidate[]): AppResetReason {
  if (candidates.some((candidate) => candidate.id === 'user-data-root')) return 'full'
  if (candidates.every((candidate) => SAFE_RESET_CANDIDATE_IDS.has(candidate.id))) return 'safe'
  return 'custom'
}

function writeResetMarker(candidates: AppDataCandidate[]): void {
  const marker = {
    resetPending: true,
    reason: resetReasonForCandidates(candidates),
    resetAt: new Date().toISOString(),
  } satisfies AppResetState

  try {
    fs.writeFileSync(resetMarkerPath(), JSON.stringify(marker, null, 2), 'utf-8')
  } catch {
    // Best effort only. The on-disk app data has already been removed safely.
  }
}

function consumeResetState(): AppResetState {
  const markerPath = resetMarkerPath()
  try {
    const raw = fs.readFileSync(markerPath, 'utf-8')
    fs.rmSync(markerPath, { force: true })
    const parsed = JSON.parse(raw) as AppResetState
    return parsed.resetPending ? parsed : { resetPending: false }
  } catch {
    return { resetPending: false }
  }
}

function readSettings(): { closeBehavior?: CloseBehavior } {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { closeBehavior?: unknown }
    return parsed.closeBehavior === 'hide' || parsed.closeBehavior === 'quit' || parsed.closeBehavior === 'ask'
      ? { closeBehavior: parsed.closeBehavior }
      : {}
  } catch {
    return {}
  }
}

function writeSettings(patch: { closeBehavior?: CloseBehavior }) {
  const next = { ...readSettings(), ...patch }
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
}

function readCloseBehavior(): CloseBehavior {
  return readSettings().closeBehavior ?? 'ask'
}

function setCloseBehavior(payload: unknown): CloseBehavior {
  const value =
    typeof payload === 'object' && payload && 'behavior' in payload
      ? (payload as { behavior?: unknown }).behavior
      : payload
  if (value !== 'ask' && value !== 'hide' && value !== 'quit') {
    throw new Error('unknown close behavior')
  }
  writeSettings({ closeBehavior: value })
  return value
}

function ensureTray() {
  if (tray) return
  tray = new Tray(getTrayIconPath())
  tray.setToolTip('OfficeWhere')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'OfficeWhere 열기', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '종료',
        click: () => requestAppQuit(),
      },
    ])
  )
  tray.on('double-click', () => showMainWindow())
}

function showMainWindow() {
  if (isQuitting || appDataCleanupInProgress) return
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show()
    splashWindow.focus()
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function handleMainWindowClose() {
  if (!mainWindow || mainWindow.isDestroyed() || closePromptInProgress) return

  const behavior = readCloseBehavior()
  if (behavior === 'hide') {
    mainWindow.hide()
    return
  }
  if (behavior === 'quit') {
    requestAppQuit()
    return
  }

  closePromptInProgress = true
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'OfficeWhere 닫기',
      message: '창을 닫으면 어떻게 할까요?',
      detail: '백그라운드에서 계속 실행하면 트레이에 남아 자동 색인을 계속 수행할 수 있습니다.',
      buttons: ['백그라운드에서 계속 실행', '종료', '취소'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: '이 선택 기억하기',
      checkboxChecked: false,
    })

    if (result.response === 0) {
      if (result.checkboxChecked) writeSettings({ closeBehavior: 'hide' })
      mainWindow?.hide()
      return
    }
    if (result.response === 1) {
      if (result.checkboxChecked) writeSettings({ closeBehavior: 'quit' })
      requestAppQuit()
    }
  } finally {
    closePromptInProgress = false
  }
}

function destroyTray() {
  tray?.destroy()
  tray = null
}

function destroyAppWindows() {
  closeSplashWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
  }
  mainWindow = null
}

function requestAppQuit(exitCode = 0) {
  void shutdownApp(exitCode)
}

async function shutdownApp(exitCode = 0) {
  if (appShutdownInProgress) return

  appShutdownInProgress = true
  isQuitting = true
  closePromptInProgress = false
  destroyTray()
  destroyAppWindows()

  const stopped = await stopBackendAndWait(2_500).catch(() => false)
  if (!stopped && backendProcess) {
    await forceKillProcessTree(backendProcess).catch(() => undefined)
    await waitForProcessExit(backendProcess, 1_000).catch(() => false)
  }

  destroyTray()
  destroyAppWindows()
  app.exit(exitCode)
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
  const pythonCacheDir = path.join(dataDir, 'pycache')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(pythonCacheDir, { recursive: true })

  const logDir = app.getPath('logs')
  fs.mkdirSync(logDir, { recursive: true })
  backendLogPath = path.join(logDir, `backend-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  const indexPerfLogPath = path.join(logDir, 'index-performance.log')

  const command = getBackendCommand(port, dataDir)
  const logStream = fs.createWriteStream(backendLogPath, { flags: 'a' })
  logStream.write(`[officewhere] command: ${command.file} ${command.args.join(' ')}\n`)
  logStream.write(`[officewhere] index performance log: ${indexPerfLogPath}\n`)

  let spawnError: Error | null = null
  let exited = false

  const child = spawn(command.file, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      OW_DATA_DIR: dataDir,
      OW_HOST: HOST,
      OW_PORT: String(port),
      OW_INDEX_PERF_LOG_PATH: indexPerfLogPath,
      PYTHONUTF8: '1',
      PYTHONPYCACHEPREFIX: pythonCacheDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  backendProcess = child

  child.stdout?.pipe(logStream, { end: false })
  child.stderr?.pipe(logStream, { end: false })
  backendLogStreams.set(child, logStream)

  child.once('error', (error) => {
    spawnError = error
    logStream.write(`[officewhere] spawn error: ${error.message}\n`)
  })

  child.once('exit', (code, signal) => {
    exited = true
    child.stdout?.unpipe(logStream)
    child.stderr?.unpipe(logStream)
    logStream.write(`[officewhere] backend exited code=${code ?? ''} signal=${signal ?? ''}\n`)
    logStream.end()
    backendLogStreams.delete(child)

    const expectedExit = isQuitting || expectedBackendExits.has(child)
    if (backendProcess === child) {
      backendProcess = null
    }

    if (!expectedExit) {
      dialog.showErrorBox(
        'OfficeWhere backend 종료',
        `Python backend가 예기치 않게 종료되었습니다.\n\n로그: ${backendLogPath}`
      )
      requestAppQuit(1)
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

  if (app.isPackaged) {
    const backendRoot = path.join(process.resourcesPath, 'backend-source')
    const script = path.join(backendRoot, 'backend_server.py')
    const bundledPython = path.join(process.resourcesPath, 'python-runtime', 'python.exe')
    const configuredPython = process.env.OW_PYTHON
    return { file: configuredPython || bundledPython, args: [script, ...args], cwd: backendRoot }
  }

  const repoRoot = path.resolve(app.getAppPath(), '..')
  const script = path.join(repoRoot, 'backend_server.py')
  return { file: getPythonExecutable(repoRoot), args: [script, ...args], cwd: repoRoot }
}

function getPythonExecutable(repoRoot: string): string {
  const configured = process.env.OW_PYTHON
  if (configured) return configured

  const venvPython =
    process.platform === 'win32'
      ? path.join(repoRoot, 'venv', 'Scripts', 'python.exe')
      : path.join(repoRoot, 'venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) return venvPython

  return process.platform === 'win32' ? 'python' : 'python3'
}

function stopBackend() {
  if (!backendProcess) return
  expectedBackendExits.add(backendProcess)
  const logStream = backendLogStreams.get(backendProcess)
  backendProcess.stdout?.unpipe(logStream)
  backendProcess.stderr?.unpipe(logStream)
  if (!backendProcess.killed) backendProcess.kill()
}

async function stopBackendAndWait(timeoutMs = 5_000): Promise<boolean> {
  const child = backendProcess
  if (!child) return true

  expectedBackendExits.add(child)
  const exitPromise = waitForProcessExit(child, timeoutMs)
  if (!child.killed) child.kill()
  if (await exitPromise) return true

  await forceKillProcessTree(child)
  return waitForProcessExit(child, 2_000)
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (backendProcess !== child) return Promise.resolve(true)
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)

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
  })
}

async function forceKillProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid) return

  expectedBackendExits.add(child)
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
    })
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process may have exited between the timeout and the forced kill.
  }
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

async function clearRendererStorageData(): Promise<void> {
  try {
    session.defaultSession.flushStorageData()
  } catch {
    // best-effort flush before clearing Chromium-managed state
  }
  await session.defaultSession
    .clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'websql',
        'serviceworkers',
        'cachestorage',
      ],
    })
    .catch(() => undefined)
  await session.defaultSession.clearCache().catch(() => undefined)
}

async function closeRendererForAppDataCleanup(candidates: AppDataCandidate[]): Promise<void> {
  if (!candidates.some(touchesElectronSessionData)) return

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = null
    await delay(200)
  }

  await clearRendererStorageData()
}

async function clearAppData(payload: unknown): Promise<ClearAppDataResult> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('clear payload is required')
  }
  const { candidateIds, exitAfterClear } = payload as {
    candidateIds?: unknown
    exitAfterClear?: unknown
  }
  if (!Array.isArray(candidateIds) || !candidateIds.every((id) => typeof id === 'string')) {
    throw new Error('candidateIds must be a string array')
  }
  const shouldExitAfterClear = exitAfterClear !== false

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
    exitScheduled: false,
  }

  appDataCleanupInProgress = true
  if (shouldExitAfterClear) {
    isQuitting = true
    destroyTray()
  }
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
  } catch (error) {
    result.success = false
    result.failed.push({
      id: 'app-data-cleanup',
      path: app.getPath('userData'),
      error: errorToMessage(error),
    })
  }

  try {
    if (result.success) writeResetMarker(selected)

    if (shouldExitAfterClear) {
      result.exitScheduled = true
      setTimeout(() => requestAppQuit(), 250)
    }

    return result
  } finally {
    if (!result.exitScheduled) {
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
