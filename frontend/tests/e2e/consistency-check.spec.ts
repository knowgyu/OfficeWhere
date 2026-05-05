import { test, expect, registerAndRescan } from './fixtures'

/**
 * Tier 2 — version-family group flow.
 *
 * The bundled examples library has three version families: 주간보고 (.docx),
 * 사업예산 (.xlsx), 프로젝트상태 (.pptx). After registration, each family
 * surfaces as a single LibraryGroup in the consistency tab. This spec opens
 * the tab and asserts the version-family group cards render — proving the
 * full path through library_scanner → library_groups → /api/library/groups.
 *
 * Per-family diff rendering (Word block diff / Excel cell grid / PPT slide
 * diff) is exercised by separate Vitest component tests against the
 * rendering components (Phase 3.4).
 */

test.describe('변경 이력 (Tier 2)', () => {
  test('version-family groups for 주간보고 / 사업예산 / 프로젝트상태 render', async ({
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '이력' })
      .click()

    // Each family's base_name appears as a group card title. Use first()
    // because base_name is rendered both as the bold title and as a smaller
    // subtitle in the same card.
    await expect(mainWindow.getByText('주간보고').first()).toBeAttached({
      timeout: 30_000,
    })
    await expect(mainWindow.getByText('사업예산').first()).toBeAttached({
      timeout: 10_000,
    })
    await expect(mainWindow.getByText('프로젝트상태').first()).toBeAttached({
      timeout: 10_000,
    })
  })

  test('수정본 묶음 filter narrows to version_family groups', async ({
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '이력' })
      .click()

    await expect(mainWindow.getByText('주간보고').first()).toBeAttached({
      timeout: 30_000,
    })

    // Open the filter panel ("필터" button — distinct from "필터 초기화"
    // which has trailing words). Use exact-match string to avoid the
    // strict-mode violation between the two.
    await mainWindow.getByRole('button', { name: '필터', exact: true }).click()
    await mainWindow.getByRole('button', { name: '수정본 묶음' }).click()

    // The three version families should still be present.
    await expect(mainWindow.getByText('주간보고').first()).toBeAttached({
      timeout: 15_000,
    })
    await expect(mainWindow.getByText('사업예산').first()).toBeAttached()
    await expect(mainWindow.getByText('프로젝트상태').first()).toBeAttached()
  })

  test('clicking 변경 내용 보기 expands the timeline for a group', async ({
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '이력' })
      .click()

    await expect(mainWindow.getByText('주간보고').first()).toBeAttached({
      timeout: 30_000,
    })

    // Click the first 변경 내용 보기 button (associated with the topmost group
    // in the list — sort=recent default places 주간보고 v4 newest at top).
    await mainWindow.getByRole('button', { name: '변경 내용 보기' }).first().click()

    // After expansion, the same button toggles to "접기".
    await expect(mainWindow.getByRole('button', { name: '접기' }).first()).toBeAttached({
      timeout: 15_000,
    })
  })
})
