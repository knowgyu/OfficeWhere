import { test, expect } from './fixtures'

test.describe('app boot (Tier 1)', () => {
  test('main window mounts and React renders the side-nav tabs', async ({ mainWindow }) => {
    // The four primary tabs render with their short labels (검색 / 이력 /
    // 중복 / 설정). Scope to the side-nav <nav aria-label="메인 내비게이션">
    // to avoid colliding with same-named buttons elsewhere on the page
    // (e.g. the FileSearch panel also has a 검색 button).
    const sideNav = mainWindow.getByRole('navigation', { name: '메인 내비게이션' })
    await expect(sideNav.getByRole('button', { name: '검색' })).toBeVisible()
    await expect(sideNav.getByRole('button', { name: '이력' })).toBeVisible()
    await expect(sideNav.getByRole('button', { name: '중복' })).toBeVisible()
    await expect(sideNav.getByRole('button', { name: '설정' })).toBeVisible()
  })

  test('backend health endpoint responds via the renderer', async ({ mainWindow }) => {
    // The backend URL is resolved through the Electron preload bridge. Fetch
    // /api/health from the renderer to prove the full Renderer → preload →
    // main → backend chain works end-to-end.
    const health = await mainWindow.evaluate(async () => {
      const url = await window.officeWhere?.getBackendBaseUrl?.()
      if (!url) return { ok: false, reason: 'no backend url from bridge' }
      const response = await fetch(`${url}/api/health`)
      const body = (await response.json()) as { status?: string; version?: string }
      return { ok: response.ok, status: body.status, version: body.version }
    })

    expect(health.ok).toBe(true)
    expect(health.status).toBe('ok')
  })

  test('initial tab is 문서 검색 (search input is visible)', async ({ mainWindow }) => {
    // The search tab's input placeholder is unique enough to identify the
    // active panel without relying on aria-selected internals.
    await expect(mainWindow.getByPlaceholder(/파일 안의 단어를 검색/)).toBeVisible()
  })
})
