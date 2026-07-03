import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/msw/server'
import { installBridge } from '../test/bridge'
import { api } from './client'

// Tests focus on the public API surface (api.files, api.search, api.check,
// api.app). They verify that:
// 1. Each call hits the expected backend route with the expected payload.
// 2. Responses keep the existing .data shape.
// 3. Errors keep the existing response.status/data shape.
//
// IPC-backed app methods (app.getDataPaths, app.clearData, ...) need an
// installed bridge. Methods that fall through to HTTP (app.getExampleLibraryPath
// in web mode) hit MSW.

describe('api.files', () => {
  it('files.list fetches /api/files', async () => {
    const sample = [{ id: 1, path: '/x.xlsx', name: 'x.xlsx', file_type: 'Excel', column_count: 0 }]
    server.use(http.get('*/api/files', () => HttpResponse.json(sample)))

    const res = await api.files.list()

    expect(res.data).toEqual(sample)
  })

  it('files.page passes query/file_types/limit/offset/sort/include_missing as query string', async () => {
    let captured: URLSearchParams | undefined
    server.use(
      http.get('*/api/files/page', ({ request }) => {
        captured = new URL(request.url).searchParams
        return HttpResponse.json({ total: 0, items: [], counts_by_type: {}, limit: 60, offset: 0 })
      }),
    )

    await api.files.page({
      query: '회의',
      fileTypes: ['Excel', 'Word'],
      limit: 10,
      offset: 20,
      sort: 'created_at_desc',
      includeMissing: false,
    })

    expect(captured?.get('q')).toBe('회의')
    expect(captured?.getAll('file_types')).toEqual(['Excel', 'Word'])
    expect(captured?.get('limit')).toBe('10')
    expect(captured?.get('offset')).toBe('20')
    expect(captured?.get('sort')).toBe('created_at_desc')
    expect(captured?.get('include_missing')).toBe('false')
  })

  it('files.register POSTs /api/files with the body', async () => {
    let captured: { path?: string } | undefined
    server.use(
      http.post('*/api/files', async ({ request }) => {
        captured = (await request.json()) as { path?: string }
        return HttpResponse.json({ id: 42, name: 'a.xlsx', file_type: 'Excel' })
      }),
    )

    const res = await api.files.register({ path: '/somewhere/a.xlsx' })

    expect(captured?.path).toBe('/somewhere/a.xlsx')
    expect(res.data).toEqual({ id: 42, name: 'a.xlsx', file_type: 'Excel' })
  })

  it('files.delete hits DELETE /api/files/:id', async () => {
    let capturedUrl = ''
    server.use(
      http.delete('*/api/files/:id', ({ request }) => {
        capturedUrl = request.url
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await api.files.delete(7)

    expect(capturedUrl).toMatch(/\/api\/files\/7$/)
  })

  it('files.duplicates passes limit and offset', async () => {
    let captured: URLSearchParams | undefined
    server.use(
      http.get('*/api/files/duplicates', ({ request }) => {
        captured = new URL(request.url).searchParams
        return HttpResponse.json({ total: 0, groups: [], limit: 50, offset: 0 })
      }),
    )

    await api.files.duplicates({ limit: 25, offset: 50 })

    expect(captured?.get('limit')).toBe('25')
    expect(captured?.get('offset')).toBe('50')
  })

  it('files.showInFolder prefers the Electron bridge when both fileId and bridge are available', async () => {
    const bridge = installBridge({
      showItemInFolder: vi.fn().mockResolvedValue(undefined),
    })

    const res = await api.files.showInFolder(1, '/path/to/x.xlsx')

    expect(bridge.showItemInFolder).toHaveBeenCalledWith('/path/to/x.xlsx')
    expect(res.data).toEqual({ message: '폴더 열기 요청을 보냈습니다.' })
  })

  it('files.showInFolder falls back to backend when bridge throws', async () => {
    let backendHit = false
    installBridge({
      showItemInFolder: vi.fn().mockRejectedValue(new Error('shell failed')),
    })
    server.use(
      http.post('*/api/files/:id/show-in-folder', () => {
        backendHit = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await api.files.showInFolder(1, '/path/x.xlsx')

    expect(backendHit).toBe(true)
  })
})

describe('api.search', () => {
  it('search.query POSTs the request body to /api/search', async () => {
    let captured:
      | { query?: string; search_scope?: string; file_types?: string[]; excluded_folder_paths?: string[] }
      | undefined
    server.use(
      http.post('*/api/search', async ({ request }) => {
        captured = (await request.json()) as typeof captured
        return HttpResponse.json({
          query: '회의',
          total: 0,
          results: [],
          file_count: 0,
          file_limit: 20,
          has_more: false,
        })
      }),
    )

    await api.search.query({
      query: '회의',
      search_scope: 'content',
      file_types: ['Excel'],
      excluded_folder_paths: ['/archive'],
      file_limit: 20,
    })

    expect(captured?.query).toBe('회의')
    expect(captured?.search_scope).toBe('content')
    expect(captured?.file_types).toEqual(['Excel'])
    expect(captured?.excluded_folder_paths).toEqual(['/archive'])
  })

  it('search.reindex returns the success/failed/skipped counts', async () => {
    server.use(
      http.post('*/api/search/reindex', () =>
        HttpResponse.json({ success: 5, failed: 0, skipped: 1 }),
      ),
    )

    const res = await api.search.reindex()

    expect(res.data).toEqual({ success: 5, failed: 0, skipped: 1 })
  })

  it('search.updateSettings sends the settings as PUT body', async () => {
    let captured: unknown
    server.use(
      http.put('*/api/search/settings', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ mode: 'interval', interval_hours: 6, daily_time: '03:00' })
      }),
    )

    const res = await api.search.updateSettings({
      mode: 'interval',
      interval_hours: 6,
      daily_time: '03:00',
    })

    expect(captured).toEqual({ mode: 'interval', interval_hours: 6, daily_time: '03:00' })
    expect(res.data.mode).toBe('interval')
  })
})

describe('api.check', () => {
  it('check.run posts the file_ids as JSON', async () => {
    let captured: { file_ids?: number[] } | undefined
    server.use(
      http.post('*/api/check', async ({ request }) => {
        captured = (await request.json()) as typeof captured
        return HttpResponse.json({ mode: 'excel' })
      }),
    )

    await api.check.run({ file_ids: [1, 2, 3] })

    expect(captured?.file_ids).toEqual([1, 2, 3])
  })

  it('check surfaces 4xx errors with the detail intact', async () => {
    server.use(
      http.post('*/api/check', () =>
        HttpResponse.json({ detail: 'at least two files are required' }, { status: 400 }),
      ),
    )

    await expect(api.check.run({ file_ids: [1] })).rejects.toMatchObject({
      response: { status: 400, data: { detail: 'at least two files are required' } },
    })
  })

  it('check surfaces 5xx errors', async () => {
    server.use(http.post('*/api/check', () => new HttpResponse(null, { status: 500 })))

    await expect(api.check.run({ file_ids: [1, 2] })).rejects.toMatchObject({
      response: { status: 500 },
    })
  })
})

describe('api.app (bridge-dependent)', () => {
  it('app.getDataPaths fails clearly when no Electron bridge is installed', async () => {
    await expect(api.app.getDataPaths()).rejects.toMatchObject({
      response: { data: { detail: expect.stringContaining('Electron') } },
    })
  })

  it('app.getDataPaths returns the bridge result when installed', async () => {
    const candidates = [
      { id: 'cache', label: 'cache', path: '/tmp/cache', exists: true, description: '' },
    ]
    installBridge({
      getAppDataPaths: vi.fn().mockResolvedValue(candidates),
    })

    const res = await api.app.getDataPaths()

    expect(res.data).toEqual(candidates)
  })

  it('app.consumeResetState returns a default when no bridge is installed (graceful fallback)', async () => {
    const res = await api.app.consumeResetState()

    expect(res.data).toEqual({ resetPending: false })
  })

  it('app.checkForUpdates returns an empty result when no bridge (web mode)', async () => {
    const res = await api.app.checkForUpdates()

    expect(res.data.updateAvailable).toBe(false)
    expect(res.data.currentVersion).toBe('')
  })

  it('app.getQuickSearchSettings returns desktop-only fallback without a bridge', async () => {
    const res = await api.app.getQuickSearchSettings()

    expect(res.data.supported).toBe(false)
    expect(res.data.registered).toBe(false)
    expect(res.data.showRecent).toBe(false)
    expect(res.data.displayShortcut).toBe('Ctrl + Alt + F')
  })

  it('app.setQuickSearchSettings passes settings through the Electron bridge', async () => {
    const bridge = installBridge()

    const res = await api.app.setQuickSearchSettings({ enabled: false, showRecent: false })

    expect(bridge.setQuickSearchSettings).toHaveBeenCalledWith({ enabled: false, showRecent: false })
    expect(res.data.enabled).toBe(false)
    expect(res.data.showRecent).toBe(false)
  })

  it('app.showQuickSearch opens the Electron palette through the bridge', async () => {
    const bridge = installBridge()

    await api.app.showQuickSearch()

    expect(bridge.showQuickSearch).toHaveBeenCalled()
  })
})
