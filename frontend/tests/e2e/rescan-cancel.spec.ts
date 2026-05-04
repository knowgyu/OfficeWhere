import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

import { test, expect } from './fixtures'

/**
 * Rescan-cancel flow. The default 22-file examples library indexes in
 * roughly 1–2 seconds — too fast to reliably observe progress and issue a
 * cancel. This spec inflates the library ×8 (~176 files) so the index runs
 * long enough to observe a non-100% percent and stop the run mid-flight.
 *
 * The two assertions:
 *   1. Rescan enters running state with percent < 100.
 *   2. After POSTing /api/library/rescan/cancel, the run reports a non-
 *      running terminal stage within 15s.
 */

test('start rescan, observe progress, cancel, verify it stops', async ({
  electronApp,
  mainWindow,
}, testInfo) => {
  // Build an inflated library specifically for this test.
  const src = path.resolve(__dirname, '../../../examples/officewhere_test_library')
  const inflated = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), `ow-bulk-w${testInfo.workerIndex}-`)),
  )
  // ×20 = ~440 files. At ~50-150ms parse-and-index per Office file the
  // rescan takes 20-60s — long enough to observe progress < 100 AND issue
  // a cancel before completion.
  for (let i = 0; i < 20; i += 1) {
    await fs.cp(src, path.join(inflated, `copy-${i}`), { recursive: true, force: true })
  }

  // Open the settings tab and add the inflated folder.
  await mainWindow
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '설정' })
    .click()
  await mainWindow.getByPlaceholder('검색/검사 대상 폴더 경로').fill(inflated)
  await mainWindow.getByRole('button', { name: '대상 추가' }).click()

  // Wait for rescan to enter a running state. With 440 files the rescan
  // takes long enough that catching running=true is reliable, but we poll
  // every 100ms so the first few percent ticks are visible.
  let runningStatus: { running: boolean; stage: string; percent: number } | null = null
  const startDeadline = Date.now() + 30_000
  while (Date.now() < startDeadline) {
    runningStatus = await mainWindow.evaluate(async () => {
      const url = await window.officeWhere?.getBackendBaseUrl?.()
      if (!url) return null
      const response = await fetch(`${url}/api/library/rescan/status`)
      if (!response.ok) return null
      return (await response.json()) as { running: boolean; stage: string; percent: number }
    })
    if (runningStatus?.running) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  expect(runningStatus?.running, 'rescan never entered running state').toBe(true)
  // Capture the progress percentage at the moment we cancel — it must be
  // less than 100 to prove cancellation interrupted an in-flight scan.
  const percentAtCancel = runningStatus?.percent ?? 0
  expect(percentAtCancel).toBeLessThan(100)

  // Cancel via the backend API directly (the UI stop button surfaces in
  // FileManager but its label varies; calling /api/library/rescan/cancel
  // through the bridge is the same flow LibraryRescanContext.cancelRescan
  // uses).
  await mainWindow.evaluate(async () => {
    const url = await window.officeWhere?.getBackendBaseUrl?.()
    if (!url) throw new Error('no backend url')
    await fetch(`${url}/api/library/rescan/cancel`, { method: 'POST' })
  })

  // Within ~15s the rescan should report a non-running terminal stage.
  let finalStatus: { running: boolean; stage: string } | null = null
  const cancelDeadline = Date.now() + 15_000
  while (Date.now() < cancelDeadline) {
    finalStatus = await mainWindow.evaluate(async () => {
      const url = await window.officeWhere?.getBackendBaseUrl?.()
      if (!url) return null
      const response = await fetch(`${url}/api/library/rescan/status`)
      if (!response.ok) return null
      return (await response.json()) as { running: boolean; stage: string }
    })
    if (finalStatus && !finalStatus.running) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  expect(finalStatus?.running, 'rescan did not stop within 15s of cancel').toBe(false)
  expect(['cancelled', 'completed', 'failed']).toContain(finalStatus?.stage ?? '')

  // Cleanup inflated library.
  await fs.rm(inflated, { recursive: true, force: true })

  // Keep electronApp referenced so eslint doesn't warn — fixture cleanup
  // happens automatically.
  void electronApp
})
