import { test, expect, registerAndRescan } from './fixtures'

/**
 * Tier 2 search filter flows. The deeper question of "does
 * file_types=['xlsx'] actually narrow the backend result set" is covered by
 * backend pytest. Here we exercise the user-visible filter wiring: clicking a
 * filter chip shows the active-filter banner, scope changes drive the
 * SegmentedButton state, and 필터 지우기 wipes both.
 */

test.describe('search filters (Tier 2)', () => {
  test('toggling a file-type chip shows the "현재 필터" banner', async ({
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '검색' })
      .click()

    const searchInput = mainWindow.getByPlaceholder(/파일 안의 단어를 검색/)
    await searchInput.fill('보고')
    await mainWindow.locator('button:has-text("검색")').last().click()

    await expect(mainWindow.getByText(/주간보고.*\.docx/).first()).toBeAttached({
      timeout: 30_000,
    })

    // Initially no active filter banner.
    await expect(mainWindow.getByText('현재 필터:')).not.toBeVisible()

    // Click the .xlsx file-type chip. The chip is in the file-type panel
    // alongside .docx and .pptx; pick the first match (the chip itself, not
    // a result-row badge).
    await mainWindow.getByRole('button', { name: '.xlsx' }).first().click()

    // The filter is applied: the "현재 필터:" banner appears with the
    // .xlsx chip beside it.
    await expect(mainWindow.getByText('현재 필터:')).toBeVisible({ timeout: 5_000 })
  })

  test('search scope = 파일명만 keeps filename matches in view', async ({
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '검색' })
      .click()

    const searchInput = mainWindow.getByPlaceholder(/파일 안의 단어를 검색/)
    // "공통" matches the filename 공통양식.xlsx (×2 in 부서A and 부서B).
    await searchInput.fill('공통')
    await mainWindow.locator('button:has-text("검색")').last().click()

    await expect(mainWindow.getByText(/공통양식\.xlsx/).first()).toBeAttached({
      timeout: 30_000,
    })

    // Switch scope to 파일명만; the radio's aria-checked should flip.
    const filenameRadio = mainWindow.getByRole('radio', { name: '파일명만' })
    await filenameRadio.click()
    await expect(filenameRadio).toHaveAttribute('aria-checked', 'true')

    // Filename hits remain (the underlying API still returns matches).
    await expect(mainWindow.getByText(/공통양식\.xlsx/).first()).toBeAttached({
      timeout: 15_000,
    })
  })

  test('필터 지우기 removes the "현재 필터" banner', async ({
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '검색' })
      .click()

    await mainWindow.getByPlaceholder(/파일 안의 단어를 검색/).fill('보고')
    await mainWindow.locator('button:has-text("검색")').last().click()
    await expect(mainWindow.getByText(/주간보고.*\.docx/).first()).toBeAttached({
      timeout: 30_000,
    })

    // Apply a filter (select a non-default search scope so the banner shows
    // even without picking a file-type chip).
    await mainWindow.getByRole('radio', { name: '본문만' }).click()
    await expect(mainWindow.getByText('현재 필터:')).toBeVisible({ timeout: 5_000 })

    // Reset.
    await mainWindow.getByRole('button', { name: '필터 지우기' }).click()
    await expect(mainWindow.getByText('현재 필터:')).not.toBeVisible({ timeout: 5_000 })
  })
})
