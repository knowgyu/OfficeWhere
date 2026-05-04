import { test, expect, registerAndRescan } from './fixtures'

/**
 * The duplicates tab surfaces files that share content but have *different*
 * names (see tests/test_duplicate_files.py:20). The bundled examples library
 * only has two same-name + same-content pairs (공통양식.xlsx ×2) and a
 * same-name + different-content pair (회의록.docx ×2), so this E2E asserts
 * the tab renders and shows the empty state correctly. The detection logic
 * itself is covered by the backend pytest.
 */
test('duplicates tab renders the empty state when no different-name pairs exist', async ({
  mainWindow,
  testLibrary,
}) => {
  await registerAndRescan(mainWindow, testLibrary)

  // Open the duplicates tab.
  await mainWindow
    .getByRole('navigation', { name: '메인 내비게이션' })
    .getByRole('button', { name: '중복' })
    .click()

  // The tab heading and the empty-state title should both render.
  await expect(mainWindow.getByText('같은 내용 문서').first()).toBeVisible({
    timeout: 10_000,
  })
  await expect(
    mainWindow.getByText('파일명만 다른 동일 내용 문서를 찾지 못했습니다'),
  ).toBeVisible({ timeout: 10_000 })

  // The summary chips show "0개" for both groups and files.
  await expect(mainWindow.locator('text=/^0개$/').first()).toBeVisible()
})
