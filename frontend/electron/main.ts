import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} from 'electron'
import { execFile, spawn } from 'node:child_process'
import { resolveBackendStartupBudget } from './backendStartup'
import type { ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'

const HOST = '127.0.0.1'
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
  restartScheduled: boolean
}

type CloseBehavior = 'ask' | 'hide' | 'quit'
type AppResetReason = 'safe' | 'full' | 'custom'

type QuickSearchSettings = {
  enabled: boolean
  showRecent: boolean
  accelerator: string
}

type QuickSearchStatus = QuickSearchSettings & {
  supported: boolean
  registered: boolean
  displayShortcut: string
  reason?: string
}

type AppStartupSettings = {
  supported: boolean
  enabled: boolean
  executablePath: string
  reason?: string
  requiresApproval?: boolean
}

type AppSettings = {
  closeBehavior?: CloseBehavior
  quickSearch?: Partial<QuickSearchSettings>
}

type AppResetState = {
  resetPending: boolean
  reason?: AppResetReason
  resetAt?: string
}

type UpdateAsset = {
  name: string
  url: string
  sizeBytes?: number
  sha256Url?: string
}

type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  asset?: UpdateAsset
}

type UpdateInstallResult = {
  success: boolean
  latestVersion: string
  assetName: string
  filePath: string
  folderPath: string
  alreadyDownloaded: boolean
  restartScheduled: boolean
  message: string
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let quickSearchWindow: BrowserWindow | null = null
let quickSearchWindowCreatePromise: Promise<BrowserWindow> | null = null
let quickSearchReturnWindow: BrowserWindow | null = null
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
let appRelaunchScheduled = false
let cachedUpdateCheck: UpdateCheckResult | null = null
let updateDownloadInProgress = false
let registeredQuickSearchAccelerator: string | null = null
let quickSearchRegistrationError: string | undefined
let quickSearchPrewarmScheduled = false
let quickSearchFocusDismissalInstalled = false

app.setName('OfficeWhere')

// In E2E mode we bypass the single-instance lock so multiple test workers can
// run side-by-side and a developer's regular OfficeWhere instance does not
// silently kill the test process. The lock is keyed by app name, not user-data
// dir, so even with --user-data-dir overrides the second instance would quit
// without this branch.
const hasSingleInstanceLock =
  process.env.OW_E2E === '1' ? true : app.requestSingleInstanceLock()
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
    unregisterQuickSearchShortcut()
    destroyQuickSearchWindow()
    closeSplashWindow()
  })

  app.on('will-quit', () => {
    unregisterQuickSearchShortcut()
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
  installQuickSearchFocusDismissal()
  createSplashWindow()
  ensureTray()
  await startBackendWithRetry()
  registerQuickSearchShortcut()
  await createMainWindow()
  scheduleQuickSearchPrewarm()
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
  ipcMain.handle('app:get-quick-search-settings', () => readQuickSearchStatus())
  ipcMain.handle('app:set-quick-search-settings', (_event, payload: unknown) => setQuickSearchSettings(payload))
  ipcMain.handle('app:show-quick-search', () => showQuickSearchWindow())
  ipcMain.handle('app:hide-quick-search', () => hideQuickSearchWindow())
  ipcMain.handle('app:open-main-search', (_event, payload: unknown) => openMainSearch(payload))
  ipcMain.handle('app:get-startup-settings', () => readStartupSettings())
  ipcMain.handle('app:set-startup-settings', (_event, payload: unknown) => setStartupSettings(payload))
  ipcMain.handle('app:get-example-library-path', () => getExampleLibraryPath())
  ipcMain.handle('app:check-for-updates', () => checkForUpdates())
  ipcMain.handle('app:install-update', () => downloadLatestUpdateZip())
  ipcMain.handle('app:open-release-page', () => openLatestReleasePage())
  ipcMain.handle('app:show-item-in-folder', (_event, payload: unknown) => showItemInFolder(payload))
  ipcMain.handle('dialog:pick-file', async () => pickFile())
  ipcMain.handle('dialog:pick-folder', async () => pickFolder())

  if (process.env.OW_E2E === '1') {
    // Helper for tests to reset main-process caches between specs without
    // tearing down the whole Electron app.
    ipcMain.handle('e2e:reset-caches', () => {
      cachedUpdateCheck = null
      updateDownloadInProgress = false
    })
  }
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

function isAllowedExternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return url.protocol === 'https:' || url.protocol === 'http:'
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

function expectedWindowsZipName(version: string): string {
  const normalized = version.trim().replace(/^v/i, '').toLowerCase()
  return `officewhere-v${normalized}-windows-x64.zip`
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

function findSha256AssetForZip(assets: unknown, zipName: string): string | undefined {
  if (!Array.isArray(assets)) return undefined

  const zipBaseName = zipName.replace(/\.zip$/i, '')
  const expectedShaNames = new Set([
    `${zipBaseName}.sha256.txt`.toLowerCase(),
    `${zipBaseName}.sha256`.toLowerCase(),
  ])
  for (const item of assets as GitHubReleaseAsset[]) {
    const name = typeof item.name === 'string' ? item.name : ''
    const url = typeof item.browser_download_url === 'string' ? item.browser_download_url : ''
    const lowerName = name.toLowerCase()
    if (!expectedShaNames.has(lowerName)) continue
    if (!isAllowedUpdateUrl(url)) continue
    return url
  }

  return undefined
}

function findWindowsZipAsset(assets: unknown, latestVersion: string): UpdateAsset | undefined {
  if (!Array.isArray(assets)) return undefined
  const expectedName = expectedWindowsZipName(latestVersion)
  for (const item of assets as GitHubReleaseAsset[]) {
    const name = typeof item.name === 'string' ? item.name : ''
    const url = typeof item.browser_download_url === 'string' ? item.browser_download_url : ''
    if (name.toLowerCase() !== expectedName) continue
    if (!isAllowedUpdateUrl(url)) continue
    return {
      name,
      url,
      sizeBytes: typeof item.size === 'number' ? item.size : undefined,
      sha256Url: findSha256AssetForZip(assets, name),
    }
  }
  return undefined
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (process.env.OW_E2E === '1') {
    // Tests inject a fixture JSON to avoid hitting GitHub from CI.
    const raw = process.env.OW_E2E_UPDATE_RESPONSE ?? ''
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UpdateCheckResult>
      const currentVersion = app.getVersion()
      const result: UpdateCheckResult = {
        currentVersion: parsed.currentVersion ?? currentVersion,
        latestVersion: parsed.latestVersion ?? currentVersion,
        updateAvailable: parsed.updateAvailable ?? false,
        releaseUrl: parsed.releaseUrl ?? RELEASE_PAGE_URL,
        asset: parsed.asset,
      }
      cachedUpdateCheck = result
      return result
    }
    const currentVersion = app.getVersion()
    const fallback: UpdateCheckResult = {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseUrl: RELEASE_PAGE_URL,
    }
    cachedUpdateCheck = fallback
    return fallback
  }
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
    asset: findWindowsZipAsset(release.assets, latestVersion),
  }
  cachedUpdateCheck = result
  return result
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

function requestUpdateText(urlString: string, redirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isAllowedUpdateUrl(urlString)) {
      reject(new Error('허용되지 않은 업데이트 검증 파일 주소입니다.'))
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
          requestUpdateText(redirected, redirects - 1).then(resolve, reject)
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          reject(new Error(`업데이트 검증 파일을 다운로드하지 못했습니다. (${status})`))
          return
        }

        let bytes = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > 64 * 1024) {
            response.destroy(new Error('업데이트 검증 파일이 너무 큽니다.'))
            return
          }
          chunks.push(buffer)
        })
        response.on('error', reject)
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      },
    )
    request.setTimeout(30_000, () => request.destroy(new Error('업데이트 검증 파일 다운로드 시간이 초과되었습니다.')))
    request.on('error', reject)
  })
}

function parseExpectedSha256(text: string): string {
  const match = text.match(/\b[a-fA-F0-9]{64}\b/)
  if (!match) {
    throw new Error('업데이트 SHA256 검증값을 읽지 못했습니다.')
  }
  return match[0].toLowerCase()
}

function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function appendDownloadSuffix(filePath: string, suffix: number): string {
  const directory = path.dirname(filePath)
  const extension = path.extname(filePath)
  const baseName = path.basename(filePath, extension)
  return path.join(directory, `${baseName} (${suffix})${extension}`)
}

async function resolveDownloadDestination(fileName: string): Promise<string> {
  const downloadDir = app.getPath('downloads')
  await fs.promises.mkdir(downloadDir, { recursive: true })

  const preferredPath = path.join(downloadDir, fileName)
  if (!(await pathExists(preferredPath))) return preferredPath

  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const candidate = appendDownloadSuffix(preferredPath, suffix)
    if (!(await pathExists(candidate))) return candidate
  }

  throw new Error('다운로드 폴더에 같은 이름의 파일이 너무 많습니다. 기존 OfficeWhere zip 파일을 정리한 뒤 다시 시도해 주세요.')
}

async function findExistingVerifiedDownload(fileName: string, expectedSha256: string): Promise<string | undefined> {
  const downloadDir = app.getPath('downloads')
  const preferredPath = path.join(downloadDir, fileName)
  const candidates = [preferredPath]
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    candidates.push(appendDownloadSuffix(preferredPath, suffix))
  }

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue
    const hash = await hashFileSha256(candidate).catch(() => '')
    if (hash === expectedSha256) return candidate
  }

  return undefined
}

async function downloadLatestUpdateZip(): Promise<UpdateInstallResult> {
  if (process.env.OW_E2E === '1') {
    // Avoid actually downloading anything during E2E. Tests assert the dialog
    // wires the install flow correctly, not that the network download works.
    const update = cachedUpdateCheck ?? (await checkForUpdates())
    return {
      success: true,
      latestVersion: update.latestVersion,
      assetName: update.asset?.name ?? 'e2e-mock.zip',
      filePath: '',
      folderPath: '',
      alreadyDownloaded: true,
      restartScheduled: false,
      message: 'E2E mock: download skipped',
    }
  }
  if (updateDownloadInProgress) {
    throw new Error('업데이트 zip을 이미 다운로드하고 있습니다.')
  }

  updateDownloadInProgress = true

  try {
    const update = cachedUpdateCheck ?? (await checkForUpdates())
    if (!update.updateAvailable || !update.asset) {
      throw new Error('다운로드할 새 Windows zip 릴리즈가 없습니다.')
    }
    if (!update.asset.sha256Url) {
      throw new Error('업데이트 검증 파일이 없어 다운로드를 중단했습니다. 릴리즈 페이지에서 직접 확인해 주세요.')
    }

    const fileName = sanitizeUpdateFileName(update.asset.name)
    const expectedSha256 = parseExpectedSha256(await requestUpdateText(update.asset.sha256Url))
    const existingPath = await findExistingVerifiedDownload(fileName, expectedSha256)
    if (existingPath) {
      shell.showItemInFolder(existingPath)
      return {
        success: true,
        latestVersion: update.latestVersion,
        assetName: update.asset.name,
        filePath: existingPath,
        folderPath: path.dirname(existingPath),
        alreadyDownloaded: true,
        restartScheduled: false,
        message: '이미 다운로드된 업데이트 zip을 확인했습니다. 압축을 풀고 새 OfficeWhere.exe를 실행해 주세요.',
      }
    }

    const destination = await resolveDownloadDestination(fileName)
    await downloadToFile(update.asset.url, destination)

    const actualSha256 = await hashFileSha256(destination)
    if (actualSha256 !== expectedSha256) {
      await fs.promises.rm(destination, { force: true }).catch(() => undefined)
      throw new Error('업데이트 파일 검증에 실패했습니다. 다운로드한 파일의 SHA256 값이 릴리즈 정보와 다릅니다.')
    }

    shell.showItemInFolder(destination)

    return {
      success: true,
      latestVersion: update.latestVersion,
      assetName: update.asset.name,
      filePath: destination,
      folderPath: path.dirname(destination),
      alreadyDownloaded: false,
      restartScheduled: false,
      message: '업데이트 zip을 다운로드했습니다. 압축을 풀고 새 OfficeWhere.exe를 실행해 주세요.',
    }
  } finally {
    updateDownloadInProgress = false
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

async function loadRendererWindow(window: BrowserWindow, query?: Record<string, string>) {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    const url = new URL(rendererUrl)
    Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
    await window.loadURL(url.toString())
    return
  }

  const rendererIndex = getRendererIndexPath()
  if (fs.existsSync(rendererIndex)) {
    if (query) {
      await window.loadFile(rendererIndex, { query })
    } else {
      await window.loadFile(rendererIndex)
    }
    return
  }

  const fallbackUrl = new URL('http://localhost:15173')
  Object.entries(query ?? {}).forEach(([key, value]) => fallbackUrl.searchParams.set(key, value))
  await window.loadURL(fallbackUrl.toString())
}

async function createMainWindow(query?: Record<string, string>) {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
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
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  await loadRendererWindow(mainWindow, query)
}

async function createQuickSearchWindow() {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) return quickSearchWindow
  if (quickSearchWindowCreatePromise) return quickSearchWindowCreatePromise

  quickSearchWindowCreatePromise = (async () => {
    quickSearchWindow = new BrowserWindow({
      width: 920,
      height: 560,
      minWidth: 780,
      minHeight: 360,
      maxWidth: 1120,
      maxHeight: 700,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: false,
      transparent: true,
      backgroundColor: '#00000000',
      title: 'OfficeWhere 빠른 검색',
      icon: getAppIconPath(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    quickSearchWindow.removeMenu()
    quickSearchWindow.setMenuBarVisibility(false)
    quickSearchWindow.on('close', (event) => {
      if (isQuitting || appDataCleanupInProgress) return
      event.preventDefault()
      hideQuickSearchWindow()
    })
    quickSearchWindow.on('closed', () => {
      quickSearchWindow = null
    })
    quickSearchWindow.on('blur', () => {
      setTimeout(() => {
        if (quickSearchWindow && !quickSearchWindow.isDestroyed() && !quickSearchWindow.isFocused()) {
          hideQuickSearchWindow()
        }
      }, 24)
    })
    quickSearchWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    await loadRendererWindow(quickSearchWindow, { quickSearch: '1' })
    return quickSearchWindow
  })()

  try {
    return await quickSearchWindowCreatePromise
  } finally {
    quickSearchWindowCreatePromise = null
  }
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

const QUICK_SEARCH_DEFAULT_ACCELERATOR = 'CommandOrControl+Alt+F'

const DEFAULT_QUICK_SEARCH_SETTINGS: QuickSearchSettings = {
  enabled: true,
  showRecent: false,
  accelerator: QUICK_SEARCH_DEFAULT_ACCELERATOR,
}

function isCloseBehavior(value: unknown): value is CloseBehavior {
  return value === 'hide' || value === 'quit' || value === 'ask'
}

function normalizeQuickSearchSettings(value: unknown): QuickSearchSettings {
  if (!value || typeof value !== 'object') return DEFAULT_QUICK_SEARCH_SETTINGS
  const record = value as Record<string, unknown>
  const rawAccelerator = typeof record.accelerator === 'string' ? record.accelerator.trim() : ''
  const accelerator = rawAccelerator || DEFAULT_QUICK_SEARCH_SETTINGS.accelerator
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_QUICK_SEARCH_SETTINGS.enabled,
    showRecent: typeof record.showRecent === 'boolean' ? record.showRecent : DEFAULT_QUICK_SEARCH_SETTINGS.showRecent,
    accelerator,
  }
}

function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      closeBehavior: isCloseBehavior(parsed.closeBehavior) ? parsed.closeBehavior : undefined,
      quickSearch: normalizeQuickSearchSettings(parsed.quickSearch),
    }
  } catch {
    return { quickSearch: DEFAULT_QUICK_SEARCH_SETTINGS }
  }
}

function writeSettings(patch: AppSettings) {
  const next = { ...readSettings(), ...patch }
  if (patch.quickSearch) {
    next.quickSearch = {
      ...normalizeQuickSearchSettings(readSettings().quickSearch),
      ...patch.quickSearch,
    }
  }
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

function formatAcceleratorForDisplay(accelerator: string): string {
  const keySymbol: Record<string, string> = {
    CommandOrControl: process.platform === 'darwin' ? 'Cmd' : 'Ctrl',
    Command: 'Cmd',
    Cmd: 'Cmd',
    Control: 'Ctrl',
    Ctrl: 'Ctrl',
    Alt: 'Alt',
    Option: 'Alt',
    Shift: 'Shift',
    Super: process.platform === 'darwin' ? 'Cmd' : 'Super',
    Space: 'Space',
  }
  return accelerator
    .split('+')
    .map((part) => keySymbol[part] ?? part)
    .join(' + ')
}

function quickSearchSupported(): boolean {
  return process.env.OW_E2E !== '1'
}

function readQuickSearchSettings(): QuickSearchSettings {
  return normalizeQuickSearchSettings(readSettings().quickSearch)
}

function readQuickSearchStatus(): QuickSearchStatus {
  const settings = readQuickSearchSettings()
  const supported = quickSearchSupported()
  const registered = Boolean(
    supported &&
      settings.enabled &&
      registeredQuickSearchAccelerator &&
      globalShortcut.isRegistered(registeredQuickSearchAccelerator),
  )
  return {
    ...settings,
    supported,
    registered,
    displayShortcut: formatAcceleratorForDisplay(settings.accelerator),
    reason: !supported
      ? '테스트 실행 중에는 전역 단축키를 등록하지 않습니다.'
      : !settings.enabled
        ? '빠른 검색 팔레트가 꺼져 있습니다.'
        : registered
          ? undefined
          : quickSearchRegistrationError || '단축키를 등록하지 못했습니다. 다른 앱이 같은 단축키를 사용 중일 수 있습니다.',
  }
}

function registerQuickSearchShortcut(): QuickSearchStatus {
  unregisterQuickSearchShortcut()
  quickSearchRegistrationError = undefined
  const settings = readQuickSearchSettings()
  if (!quickSearchSupported() || !settings.enabled) return readQuickSearchStatus()

  try {
    const ok = globalShortcut.register(settings.accelerator, () => {
      void toggleQuickSearchWindow()
    })
    if (ok) {
      registeredQuickSearchAccelerator = settings.accelerator
    } else {
      registeredQuickSearchAccelerator = null
      quickSearchRegistrationError = `"${formatAcceleratorForDisplay(settings.accelerator)}" 단축키를 OS에 등록하지 못했습니다.`
    }
  } catch (error) {
    registeredQuickSearchAccelerator = null
    quickSearchRegistrationError = error instanceof Error ? error.message : '단축키 등록 중 알 수 없는 오류가 발생했습니다.'
  }

  return readQuickSearchStatus()
}

function unregisterQuickSearchShortcut(): void {
  if (registeredQuickSearchAccelerator) {
    try {
      globalShortcut.unregister(registeredQuickSearchAccelerator)
    } catch {
      // Best effort during shutdown/re-registration.
    }
  }
  registeredQuickSearchAccelerator = null
}

function setQuickSearchSettings(payload: unknown): QuickSearchStatus {
  const current = readQuickSearchSettings()
  const patch: Partial<QuickSearchSettings> =
    payload && typeof payload === 'object'
      ? {
          enabled:
            'enabled' in payload && typeof (payload as { enabled?: unknown }).enabled === 'boolean'
              ? (payload as { enabled: boolean }).enabled
              : undefined,
          showRecent:
            'showRecent' in payload && typeof (payload as { showRecent?: unknown }).showRecent === 'boolean'
              ? (payload as { showRecent: boolean }).showRecent
              : undefined,
          accelerator:
            'accelerator' in payload && typeof (payload as { accelerator?: unknown }).accelerator === 'string'
              ? (payload as { accelerator: string }).accelerator.trim()
              : undefined,
        }
      : {}

  const next = normalizeQuickSearchSettings({
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  })
  writeSettings({ quickSearch: next })
  const status = registerQuickSearchShortcut()
  if (status.supported && status.enabled) scheduleQuickSearchPrewarm()
  return status
}

function startupSettingsSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')
}

function startupUnsupportedReason(): string {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return 'Windows와 macOS 패키지 앱에서만 시작프로그램 등록을 지원합니다.'
  }
  if (!app.isPackaged) {
    return '개발 실행 중에는 시작프로그램을 등록하지 않습니다. 패키지 앱에서 사용할 수 있습니다.'
  }
  return ''
}

function startupLoginItemOptions(): Electron.LoginItemSettingsOptions | undefined {
  if (process.platform !== 'win32') return undefined
  return { path: process.execPath, args: [] }
}

function readStartupSettings(): AppStartupSettings {
  if (!startupSettingsSupported()) {
    return {
      supported: false,
      enabled: false,
      executablePath: process.execPath,
      reason: startupUnsupportedReason(),
    }
  }

  try {
    const settings = app.getLoginItemSettings(startupLoginItemOptions())
    const enabled =
      process.platform === 'win32'
        ? Boolean(settings.openAtLogin || settings.executableWillLaunchAtLogin)
        : Boolean(settings.openAtLogin)
    return {
      supported: true,
      enabled,
      executablePath: process.execPath,
      requiresApproval: settings.status === 'requires-approval',
      reason:
        settings.status === 'requires-approval'
          ? 'macOS 시스템 설정에서 로그인을 허용해야 시작프로그램으로 실행됩니다.'
          : undefined,
    }
  } catch (error) {
    return {
      supported: false,
      enabled: false,
      executablePath: process.execPath,
      reason: error instanceof Error ? error.message : '시작프로그램 상태를 확인하지 못했습니다.',
    }
  }
}

function setStartupSettings(payload: unknown): AppStartupSettings {
  const enabled =
    typeof payload === 'object' && payload && 'enabled' in payload
      ? Boolean((payload as { enabled?: unknown }).enabled)
      : Boolean(payload)

  if (!startupSettingsSupported()) return readStartupSettings()

  const settings: Electron.Settings =
    process.platform === 'win32'
      ? { openAtLogin: enabled, enabled, path: process.execPath, args: [], name: 'OfficeWhere' }
      : { openAtLogin: enabled }

  app.setLoginItemSettings(settings)
  const next = readStartupSettings()
  if (next.supported && next.enabled !== enabled) {
    return {
      ...next,
      reason: enabled
        ? '시작프로그램 등록 상태를 확인하지 못했습니다. 시스템 시작 항목에서 OfficeWhere를 확인해 주세요.'
        : '다른 시작 항목이 남아 있을 수 있습니다. 시스템 시작 항목에서 OfficeWhere를 확인해 주세요.',
    }
  }
  return next
}

function ensureTray() {
  if (tray) return
  const trayImage = nativeImage.createFromPath(getTrayIconPath())
  const trayIcon =
    process.platform === 'win32'
      ? trayImage
      : trayImage.resize({ width: 18, height: 18 })
  tray = new Tray(trayIcon)
  tray.setToolTip('OfficeWhere')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'OfficeWhere 열기', click: () => showMainWindow() },
      { label: '빠른 검색 열기', click: () => void toggleQuickSearchWindow(true) },
      { type: 'separator' },
      {
        label: '종료',
        click: () => requestAppQuit(),
      },
    ])
  )
  tray.on('double-click', () => showMainWindow())
}

function positionQuickSearchWindow(window: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 920
  const height = 560
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + Math.max(48, display.workArea.height * 0.14))
  window.setBounds({ x, y, width, height }, false)
}

function rememberQuickSearchReturnWindow(window: BrowserWindow) {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (focusedWindow && !focusedWindow.isDestroyed() && focusedWindow.id !== window.id) {
    quickSearchReturnWindow = focusedWindow
    return
  }
  quickSearchReturnWindow = null
}

function setQuickSearchFocusable(window: BrowserWindow, focusable: boolean) {
  if (process.platform !== 'win32') return
  try {
    window.setFocusable(focusable)
  } catch {
    // Best-effort only: focus restoration should never prevent the palette from closing.
  }
}

function restoreQuickSearchReturnFocus() {
  const returnWindow = quickSearchReturnWindow
  quickSearchReturnWindow = null
  if (!returnWindow || returnWindow.isDestroyed() || !returnWindow.isVisible()) return
  setTimeout(() => {
    if (!returnWindow.isDestroyed() && returnWindow.isVisible()) {
      returnWindow.focus()
    }
  }, 0)
}

function installQuickSearchFocusDismissal() {
  if (quickSearchFocusDismissalInstalled) return
  quickSearchFocusDismissalInstalled = true
  app.on('browser-window-focus', (_event, focusedWindow) => {
    if (!quickSearchWindow || quickSearchWindow.isDestroyed() || !quickSearchWindow.isVisible()) return
    if (!focusedWindow || focusedWindow.id === quickSearchWindow.id) return
    hideQuickSearchWindow()
  })
}

function scheduleQuickSearchPrewarm() {
  if (quickSearchPrewarmScheduled || isQuitting || appDataCleanupInProgress) return
  const settings = readQuickSearchSettings()
  if (!quickSearchSupported() || !settings.enabled) return
  quickSearchPrewarmScheduled = true
  setTimeout(() => {
    if (isQuitting || appDataCleanupInProgress) return
    void createQuickSearchWindow().catch(() => {
      quickSearchPrewarmScheduled = false
    })
  }, 650)
}

async function showQuickSearchWindow() {
  if (isQuitting || appDataCleanupInProgress) return
  const window = await createQuickSearchWindow()
  if (window.isDestroyed()) return
  rememberQuickSearchReturnWindow(window)
  positionQuickSearchWindow(window)
  setQuickSearchFocusable(window, true)
  window.webContents.send('quick-search:opened', {
    displayShortcut: readQuickSearchStatus().displayShortcut,
  })
  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.show()
  window.focus()
  setTimeout(() => {
    if (window.isDestroyed() || !window.isVisible()) return
    window.setAlwaysOnTop(false)
  }, 30)
}

function hideQuickSearchWindow() {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) {
    quickSearchWindow.setAlwaysOnTop(false)
    quickSearchWindow.hide()
    quickSearchWindow.blur()
    setQuickSearchFocusable(quickSearchWindow, false)
    restoreQuickSearchReturnFocus()
  }
}

async function toggleQuickSearchWindow(forceOpen = false) {
  if (!forceOpen && quickSearchWindow && !quickSearchWindow.isDestroyed() && quickSearchWindow.isVisible()) {
    hideQuickSearchWindow()
    return
  }
  await showQuickSearchWindow()
}

function destroyQuickSearchWindow() {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) {
    quickSearchWindow.destroy()
  }
  quickSearchWindow = null
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

async function openMainSearch(payload: unknown) {
  const query =
    payload && typeof payload === 'object' && 'query' in payload && typeof (payload as { query?: unknown }).query === 'string'
      ? (payload as { query: string }).query
      : ''
  hideQuickSearchWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createMainWindow(query ? { openSearch: query } : undefined)
  } else {
    showMainWindow()
    mainWindow.webContents.send('app:open-search', { query })
  }
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
      detail: '백그라운드에서 계속 실행하면 트레이에 남아 문서 변경을 자동으로 확인할 수 있습니다.',
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
  destroyQuickSearchWindow()
  closeSplashWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
  }
  mainWindow = null
}

function requestAppQuit(exitCode = 0) {
  void shutdownApp(exitCode)
}

function scheduleAppRelaunch(): boolean {
  if (appRelaunchScheduled) return true

  try {
    app.relaunch()
    appRelaunchScheduled = true
    return true
  } catch {
    return false
  }
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
    'OfficeWhere 문서 서비스 시작 실패',
    `문서 서비스를 시작하지 못했습니다.\n\n${detail}\n\n진단 기록: ${backendLogPath || '생성되지 않음'}`,
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
  const startupBudget = resolveBackendStartupBudget(dataDir)
  const logStream = fs.createWriteStream(backendLogPath, { flags: 'a' })
  logStream.write(`[officewhere] command: ${command.file} ${command.args.join(' ')}\n`)
  logStream.write(`[officewhere] index performance log: ${indexPerfLogPath}\n`)
  logStream.write(
    `[officewhere] backend data footprint: ${startupBudget.footprintBytes} bytes; ` +
      `startup timeout: ${startupBudget.timeoutMs} ms (${startupBudget.reason})\n`,
  )

  let spawnError: Error | null = null
  let exited = false
  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OW_DATA_DIR: dataDir,
    OW_HOST: HOST,
    OW_PORT: String(port),
    OW_INDEX_PERF_LOG_PATH: indexPerfLogPath,
    PYTHONUTF8: '1',
    PYTHONPYCACHEPREFIX: pythonCacheDir,
    OW_E2E: process.env.OW_E2E ?? '',
    OW_E2E_ALLOW: process.env.OW_E2E_ALLOW ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
  }
  if (app.isPackaged) {
    delete backendEnv.PYTHONHOME
    delete backendEnv.PYTHONPATH
    backendEnv.PYTHONNOUSERSITE = '1'
  }

  const child = spawn(command.file, command.args, {
    cwd: command.cwd,
    env: backendEnv,
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
        'OfficeWhere 문서 서비스 종료',
        `문서 서비스를 다시 시작해야 합니다.\n\n진단 기록: ${backendLogPath}`,
      )
      requestAppQuit(1)
    }
  })

  const deadline = Date.now() + startupBudget.timeoutMs
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (exited) throw new Error(`backend process exited before health check: ${backendLogPath}`)
    if (await pingHealth(backendBaseUrl)) return
    await delay(400)
  }

  throw new Error(`backend health check timed out after ${startupBudget.timeoutMs}ms: ${backendBaseUrl}`)
}

function getBackendCommand(port: number, dataDir: string): { file: string; args: string[]; cwd: string } {
  const args = ['--host', HOST, '--port', String(port), '--data-dir', dataDir]

  if (app.isPackaged) {
    const backendRoot = path.join(process.resourcesPath, 'backend-source')
    const script = path.join(backendRoot, 'backend_server.py')
    const configuredPython = process.env.OW_PYTHON
    return { file: configuredPython || getBundledPythonExecutable(), args: [script, ...args], cwd: backendRoot }
  }

  const repoRoot = path.resolve(app.getAppPath(), '..')
  const script = path.join(repoRoot, 'backend_server.py')
  return { file: getPythonExecutable(repoRoot), args: [script, ...args], cwd: repoRoot }
}

function getBundledPythonExecutable(): string {
  if (process.platform === 'win32') {
    return path.join(process.resourcesPath, 'python-runtime', 'python.exe')
  }
  if (process.platform === 'darwin') {
    return path.join(process.resourcesPath, 'python-runtime', 'bin', 'python3')
  }
  return path.join(process.resourcesPath, 'python-runtime', 'bin', 'python3')
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
      label: 'Search and app data',
      path: path.join(userData, 'backend-data'),
      exists: false,
      description: '앱이 검색과 문서 목록을 준비할 때 사용하는 데이터입니다.',
      allowedRoot: userData,
    },
    {
      id: 'logs',
      label: 'Application diagnostics',
      path: logs,
      exists: false,
      description: '문제 해결에 사용하는 앱 진단 기록입니다.',
      allowedRoot: userData,
    },
    {
      id: 'chromium-cache',
      label: 'Temporary display cache',
      path: path.join(sessionData, 'Cache'),
      exists: false,
      description: '화면 표시 속도를 위해 보관된 임시 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-code-cache',
      label: 'Temporary app cache',
      path: path.join(sessionData, 'Code Cache'),
      exists: false,
      description: '앱 화면을 빠르게 열기 위한 임시 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-local-storage',
      label: 'Window session data',
      path: path.join(sessionData, 'Local Storage'),
      exists: false,
      description: '창 상태와 앱 세션에 필요한 저장 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-session-storage',
      label: 'Temporary session data',
      path: path.join(sessionData, 'Session Storage'),
      exists: false,
      description: '현재 세션에 필요한 임시 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'chromium-gpu-cache',
      label: 'Temporary graphics cache',
      path: path.join(sessionData, 'GPUCache'),
      exists: false,
      description: '화면 표시를 빠르게 하기 위한 그래픽 임시 데이터입니다.',
      allowedRoot: sessionData,
    },
    {
      id: 'legacy-home-data',
      label: 'Previous app data',
      path: legacyHomeData,
      exists: false,
      description: '이전 실행 방식에서 사용하던 앱 데이터입니다.',
      allowedRoot: app.getPath('home'),
    },
  ]

  if (crashDumps) {
    candidates.push({
      id: 'crash-dumps',
      label: 'Crash reports',
      path: crashDumps,
      exists: false,
      description: '오류 원인 확인에 사용하는 충돌 보고서입니다.',
      allowedRoot: path.dirname(crashDumps),
    })
  }

  candidates.push({
    id: 'user-data-root',
    label: 'Full app profile reset',
    path: userData,
    exists: false,
    description: 'OfficeWhere 앱 프로필 전체입니다. 원본 문서는 삭제하지 않지만 앱 설정과 세션이 초기화됩니다.',
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
    restartScheduled: false,
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
      if (result.success) {
        result.restartScheduled = scheduleAppRelaunch()
      }
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
  if (process.env.OW_E2E === '1') {
    // Native dialogs cannot be driven under Xvfb; tests inject a path via env.
    const overridePath = process.env.OW_E2E_PICK_FILE_PATH ?? ''
    return {
      cancelled: !overridePath,
      path: overridePath ? path.normalize(overridePath) : '',
    }
  }
  const options = {
    properties: ['openFile'],
    filters: [
      { name: 'Office files', extensions: ['xlsx', 'docx', 'pptx'] },
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
  if (process.env.OW_E2E === '1') {
    const overridePath = process.env.OW_E2E_PICK_FOLDER_PATH ?? ''
    return {
      cancelled: !overridePath,
      folder_path: overridePath ? path.normalize(overridePath) : '',
    }
  }
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

function showItemInFolder(payload: unknown) {
  const requestedPath =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object' && typeof (payload as { path?: unknown }).path === 'string'
        ? (payload as { path: string }).path
        : ''
  const filePath = path.normalize(requestedPath.trim())
  if (!filePath) throw new Error('file path is required')
  if (!fs.existsSync(filePath)) throw new Error(`file does not exist: ${filePath}`)
  shell.showItemInFolder(filePath)
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
