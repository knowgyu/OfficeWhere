import { expect, registerAndRescan, test } from './fixtures'
import type { ElectronApplication, Page } from '@playwright/test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

async function maybeCapture(page: Page, fileName: string) {
  const outputDir = process.env.OW_VISUAL_QA_DIR
  if (!outputDir) return
  await fs.mkdir(outputDir, { recursive: true })
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: true,
    animations: 'disabled',
  })
}

async function openQuickSearchPalette(electronApp: ElectronApplication, mainWindow: Page) {
  const existingQuickWindow = electronApp.windows().find((window) => window.url().includes('quickSearch=1'))
  const quickWindowPromise = existingQuickWindow
    ? Promise.resolve(existingQuickWindow)
    : electronApp.waitForEvent('window', { timeout: 15_000 })
  await mainWindow.getByRole('button', { name: /지금 열기/ }).click()
  const quickWindow = await quickWindowPromise
  await quickWindow.waitForLoadState('domcontentloaded')
  await expect(quickWindow.getByRole('searchbox', { name: '빠른 문서 검색' })).toBeVisible()
  return quickWindow
}

async function isQuickSearchVisible(electronApp: ElectronApplication) {
  return electronApp.evaluate((electron) => {
    const { BrowserWindow } = electron as unknown as typeof import('electron')
    const win = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('quickSearch=1'))
    return Boolean(win && !win.isDestroyed() && win.isVisible())
  })
}

test.describe('quick search visual smoke (Electron)', () => {
  test('settings tab and floating palette render the quick-search UX against a real backend', async ({
    electronApp,
    mainWindow,
    testLibrary,
  }) => {
    await registerAndRescan(mainWindow, testLibrary)

    await mainWindow
      .getByRole('navigation', { name: '메인 내비게이션' })
      .getByRole('button', { name: '설정' })
      .click()
    await mainWindow.getByRole('tab', { name: /앱 동작/ }).click()
    await expect(mainWindow.getByRole('heading', { name: '표시와 앱 동작' })).toBeVisible()
    await expect(mainWindow.getByText('빠른 검색 팔레트')).toBeVisible()
    await expect(mainWindow.getByText('전역 단축키로 빠른 검색 열기')).toBeVisible()
    await expect(mainWindow.getByText('팔레트에 최근 검색어 표시')).toHaveCount(0)
    await expect(mainWindow.getByRole('button', { name: '빠른 검색 단축키 직접 지정' })).toBeVisible()
    await expect(mainWindow.getByRole('button', { name: /지금 열기/ })).toBeVisible()
    await expect(mainWindow.locator('.kbd-token').filter({ hasText: /^Ctrl$/ }).first()).toBeVisible()
    await expect(mainWindow.locator('.kbd-token').filter({ hasText: /^Alt$/ }).first()).toBeVisible()
    await expect(mainWindow.locator('.kbd-token').filter({ hasText: /^F$/ }).first()).toBeVisible()
    await expect(mainWindow.getByText(/Ctrl\/\u2318|Alt\/\u2325|\u2318|\u2325|\u21e7/)).toHaveCount(0)
    await mainWindow.getByRole('button', { name: '빠른 검색 단축키 직접 지정' }).click()
    await mainWindow.keyboard.press('Control+Alt+G')
    await expect(mainWindow.locator('.kbd-token').filter({ hasText: /^G$/ }).first()).toBeVisible()
    await maybeCapture(mainWindow, 'settings-app-behavior-quick-search.png')

    const quickWindow = await openQuickSearchPalette(electronApp, mainWindow)
    await expect.poll(() => isQuickSearchVisible(electronApp)).toBe(true)
    await expect(quickWindow.getByText('OfficeWhere 빠른 검색')).toHaveCount(0)
    await expect(quickWindow.getByText('최근 검색')).toHaveCount(0)
    await expect(quickWindow.getByRole('button', { name: '닫기' })).toHaveCount(0)
    await expect(quickWindow.getByRole('button', { name: /알림함 열기/ })).toHaveCount(0)
    await maybeCapture(quickWindow, 'quick-search-empty.png')

    const searchBox = quickWindow.getByRole('searchbox', { name: '빠른 문서 검색' })
    await searchBox.fill('주간보고')
    await expect(quickWindow.getByText(/개 문서/)).toBeVisible({ timeout: 30_000 })
    await expect(quickWindow.getByText(/주간보고.*\.docx/).first()).toBeVisible()
    await expect(quickWindow.getByText('↑↓ 이동 · Enter 상세 · Ctrl/Cmd Enter 위치 · Shift Enter 열기')).toBeVisible()
    await expect(quickWindow.getByText(/개 일치/)).toHaveCount(0)
    await maybeCapture(quickWindow, 'quick-search-results-collapsed-weekly-report.png')
    await quickWindow.getByRole('button', { name: /주간보고.*선택/ }).first().click()
    await expect(quickWindow.getByText(/개 일치/)).toHaveCount(0)
    await quickWindow.keyboard.press('Enter')
    await expect(quickWindow.getByText(/개 일치/).first()).toBeVisible()
    await maybeCapture(quickWindow, 'quick-search-results-detail-weekly-report.png')
    await quickWindow.keyboard.press('Escape')
    await expect.poll(() => isQuickSearchVisible(electronApp)).toBe(false)

    const transparentMarginWindow = await openQuickSearchPalette(electronApp, mainWindow)
    await expect.poll(() => isQuickSearchVisible(electronApp)).toBe(true)
    await expect(transparentMarginWindow.getByRole('searchbox', { name: '빠른 문서 검색' })).toHaveValue('')
    await transparentMarginWindow.mouse.click(460, 180)
    await expect.poll(() => isQuickSearchVisible(electronApp)).toBe(false)
  })
})
