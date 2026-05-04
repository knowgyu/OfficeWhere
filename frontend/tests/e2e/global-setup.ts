import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Build the renderer (`dist/`) and Electron main (`dist-electron/`) before
 * any spec runs. Without this, `_electron.launch()` either fails to load
 * `dist-electron/main.js` or shows a blank window because `dist/index.html`
 * is missing.
 *
 * The build is skipped when both outputs already exist AND the OW_E2E_SKIP_BUILD
 * env var is set, so iterating locally on a single spec doesn't pay the
 * full build cost on every run.
 */
async function globalSetup(): Promise<void> {
  const frontendRoot = path.resolve(__dirname, '../../')
  const distMain = path.join(frontendRoot, 'dist-electron', 'main.js')
  const distIndex = path.join(frontendRoot, 'dist', 'index.html')

  if (
    process.env.OW_E2E_SKIP_BUILD === '1'
    && fs.existsSync(distMain)
    && fs.existsSync(distIndex)
  ) {
    // eslint-disable-next-line no-console
    console.log('[e2e] OW_E2E_SKIP_BUILD=1 — reusing existing dist/ and dist-electron/')
    return
  }

  const run = (cmd: string, args: string[]) => {
    const result = spawnSync(cmd, args, {
      cwd: frontendRoot,
      stdio: 'inherit',
      env: process.env,
    })
    if (result.status !== 0) {
      throw new Error(`[e2e] '${cmd} ${args.join(' ')}' failed with exit code ${result.status}`)
    }
  }

  run('npm', ['run', 'build'])
  run('npm', ['run', 'build:electron'])
}

export default globalSetup
