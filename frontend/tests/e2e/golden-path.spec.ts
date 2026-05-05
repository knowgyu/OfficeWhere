import { test, expect } from './fixtures'

/**
 * Tier 1 golden path: from a clean library, register the bundled
 * examples folder, wait for the automatic rescan to complete, switch to
 * the search tab, and verify a known query returns at least one result.
 *
 * This exercises the full Renderer → preload → main → backend → SQLite
 * pipeline plus the rescan polling loop.
 */
test('register folder → rescan completes → search returns results', async ({
  mainWindow,
  testLibrary,
}) => {
  // Open the settings/library tab via the side-nav.
  await mainWindow
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '설정' })
    .click()

  // Fill the folder path with the temp copy of examples/ and submit.
  const folderInput = mainWindow.getByPlaceholder('검색/검사 대상 폴더 경로')
  await folderInput.fill(testLibrary)
  await mainWindow.getByRole('button', { name: '대상 추가' }).click()

  // Adding a folder triggers startRescan('added', 'fast') automatically.
  // Poll the rescan status endpoint until the run completes. Up to 90s to
  // tolerate cold-start backend on CI.
  const deadline = Date.now() + 90_000
  let finalStatus: {
    running?: boolean
    stage?: string
    registered?: number
    updated?: number
    skipped?: number
  } | null = null
  while (Date.now() < deadline) {
    const status = await mainWindow.evaluate(async () => {
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
      finalStatus = status
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  expect(finalStatus, 'rescan did not complete within 90s').not.toBeNull()
  // The examples library has 22 supported Office files. A few may dedupe to
  // the same fingerprint across the version family, but we always expect at
  // least 10 to be indexed.
  expect(
    (finalStatus!.registered ?? 0) + (finalStatus!.updated ?? 0) + (finalStatus!.skipped ?? 0),
  ).toBeGreaterThanOrEqual(10)

  // Switch to the search tab via the side-nav.
  await mainWindow
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '검색' })
    .click()

  // Type a query that matches a filename in examples/officewhere_test_library/.
  // "주간보고" appears in 5 .docx versions, so a filename-only match is enough
  // to prove indexing + search end-to-end without depending on body content.
  const searchInput = mainWindow.getByPlaceholder(/파일 안의 단어를 검색/)
  await searchInput.fill('주간보고')
  // Click the page-scoped 검색 button (not the side-nav 검색 tab).
  await mainWindow
    .locator('button:has-text("검색")')
    .filter({ hasNotText: /^$/ })
    .last()
    .click()

  // The result list renders matching file names. At least one .docx hit is
  // expected; allow ample time for the first FTS query to warm up. We check
  // toBeAttached rather than toBeVisible because the result row may sit below
  // the viewport in the test window — its presence in the DOM is enough to
  // prove search returned hits.
  await expect(mainWindow.getByText(/주간보고.*\.docx/).first()).toBeAttached({
    timeout: 30_000,
  })
})
