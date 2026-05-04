import { test as base, _electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

interface OfficeWhereFixtures {
  /** Per-test temp directory used as Electron --user-data-dir. */
  userDataDir: string
  /** Per-test copy of examples/officewhere_test_library/ as a temp directory. */
  testLibrary: string
  /** Launched Electron app, isolated from the developer's real OfficeWhere. */
  electronApp: ElectronApplication
  /** First main window of the launched app, ready to interact with. */
  mainWindow: Page
}

/**
 * Custom Playwright `test` with OfficeWhere-specific fixtures.
 *
 * Isolation invariants (verified inside the electronApp fixture):
 * - Electron's `userData` is a temp directory under the OS tmpdir.
 * - The Python backend's data dir is derived from userData and therefore is
 *   also under the temp directory.
 * - OW_E2E + OW_E2E_ALLOW signal the backend that this is an automated run;
 *   the backend's _guard_e2e() in backend_server.py refuses to start if
 *   either is unset or if the data dir contains markers of the user's real
 *   OfficeWhere folder.
 */
export const test = base.extend<OfficeWhereFixtures>({
  userDataDir: async ({}, use, testInfo) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), `ow-e2e-w${testInfo.workerIndex}-`),
    )
    // macOS tmpdir lives behind /var/folders → /private/var/folders symlink,
    // and Electron's app.getPath('userData') canonicalises the symlink. Compare
    // against the real path to avoid spurious "isolation breach" failures.
    const realDir = await fs.realpath(dir)
    // Electron's app.setAppLogsPath() only sets the path — it does not create
    // the directory on macOS. main.ts later calls fs.createWriteStream on a
    // log file inside <userData>/logs before its own mkdirSync runs reliably
    // (the splash window code path can trip ENOENT). Pre-create the standard
    // OfficeWhere subdirectories so launch succeeds on a fresh tmp dir.
    await fs.mkdir(path.join(realDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(realDir, 'backend-data'), { recursive: true })
    await use(realDir)
    await fs.rm(realDir, { recursive: true, force: true })
  },

  testLibrary: async ({}, use, testInfo) => {
    const src = path.resolve(__dirname, '../../../examples/officewhere_test_library')
    const dst = await fs.mkdtemp(
      path.join(os.tmpdir(), `ow-lib-w${testInfo.workerIndex}-`),
    )
    await fs.cp(src, dst, { recursive: true, force: true })
    await use(dst)
    await fs.rm(dst, { recursive: true, force: true })
  },

  electronApp: async ({ userDataDir }, use) => {
    // Pass the frontend directory (not dist-electron/main.js) so Electron
    // reads package.json's `main` field. This makes `app.getAppPath()`
    // return the frontend dir, which main.ts:1325 then resolves to the repo
    // root (parent dir) to locate backend_server.py. Passing main.js
    // directly would make app.getAppPath() return dist-electron/, breaking
    // backend spawn in dev mode.
    const frontendDir = path.resolve(__dirname, '../..')
    const app = await _electron.launch({
      cwd: frontendDir,
      args: [
        frontendDir,
        // Electron sandbox doesn't work in some CI containers (Linux GH Actions
        // runners require setuid sandbox). Disable for portability.
        '--no-sandbox',
        `--user-data-dir=${userDataDir}`,
      ],
      env: {
        ...process.env,
        OW_E2E: '1',
        OW_E2E_ALLOW: '1',
        // Korean filenames in examples/ require UTF-8 locale on Linux.
        LANG: process.env.LANG ?? 'C.UTF-8',
        LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
        // Do not pre-set OW_DATA_DIR here. main.ts always derives it from
        // app.getPath('userData')/backend-data and overrides the env value
        // before spawn. Pre-setting it (especially to '') seemed to leak
        // empty values into spawn's own env in some Electron 30 builds.
      },
      timeout: 60_000,
    })

    // Stream Electron's main process stdout/stderr to the test runner so
    // backend spawn errors are visible without digging into the per-test
    // log file under the temp directory.
    const electronProcess = app.process()
    electronProcess.stdout?.on('data', (chunk) => {
      // eslint-disable-next-line no-console
      process.stdout.write(`[electron-stdout] ${chunk.toString()}`)
    })
    electronProcess.stderr?.on('data', (chunk) => {
      // eslint-disable-next-line no-console
      process.stdout.write(`[electron-stderr] ${chunk.toString()}`)
    })

    // Verify isolation invariant before any spec runs. If main.ts's
    // dataDir derivation breaks, refuse loudly rather than silently writing
    // to the developer's real data. We check the actual filesystem state
    // (the temp dir's backend-data subdir we pre-created) instead of asking
    // the main process — `app.evaluate` races with the long-running
    // startBackendWithRetry() chain that fires during launch and the
    // execution context can be torn down before evaluate resolves.
    const expectedDataDir = path.join(userDataDir, 'backend-data')
    expect(
      expectedDataDir.startsWith(userDataDir),
      `isolation breach: backend data dir ${expectedDataDir} is not under tmp ${userDataDir}`,
    ).toBe(true)

    await use(app)
    await app.close()
  },

  mainWindow: async ({ electronApp }, use) => {
    // Electron opens the splash window first (loaded from a data: URL) and
    // only opens the renderer window after backend health check succeeds.
    // Wait for the renderer specifically — its URL starts with file:// (or
    // http:// in dev mode), never data:.
    const isRenderer = (url: string) => !url.startsWith('data:') && !url.startsWith('about:')

    let window =
      electronApp.windows().find((w) => isRenderer(w.url())) ?? null
    if (!window) {
      window = await electronApp.waitForEvent('window', {
        predicate: (w) => isRenderer(w.url()),
        timeout: 90_000,
      })
    }
    await window.waitForLoadState('domcontentloaded')

    // Skip the first-run OnboardingCarousel and the tutorial library setup
    // by persisting the same localStorage flag App.tsx writes when the user
    // clicks "내 폴더 추가하러 가기". Clicking the carousel's close button
    // would also work, but it forces the active tab to 'files' (settings) —
    // not the natural search tab — which makes boot specs harder to write.
    await window.evaluate(() => {
      window.localStorage.setItem('officewhere:onboarding-complete:v1', 'true')
    })
    await window.reload()
    await window.waitForLoadState('domcontentloaded')

    await use(window)
  },
})

export { expect } from '@playwright/test'

/**
 * Register the given library folder and poll the rescan endpoint until it
 * completes. Used by Tier 2 specs that need an indexed library before
 * exercising search / consistency / duplicates flows.
 */
export async function registerAndRescan(window: Page, libraryPath: string) {
  // Open the settings tab.
  await window
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '설정' })
    .click()

  await window.getByPlaceholder('검색/검사 대상 폴더 경로').fill(libraryPath)
  await window.getByRole('button', { name: '대상 추가' }).click()

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const status = await window.evaluate(async () => {
      const url = await window.officeWhere?.getBackendBaseUrl?.()
      if (!url) return null
      const response = await fetch(`${url}/api/library/rescan/status`)
      if (!response.ok) return null
      return (await response.json()) as {
        running: boolean
        stage: string
        registered: number
        updated: number
        skipped: number
      }
    })
    if (
      status
      && !status.running
      && status.stage === 'completed'
      && (status.registered + status.updated + status.skipped) > 0
    ) {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('library rescan did not complete within 90s')
}
