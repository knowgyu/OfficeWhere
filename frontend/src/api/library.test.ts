import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/msw/server'
import { api } from './client'
import { getLibraryGroups } from './library'

describe('libraryApi.getSettings / updateSettings', () => {
  it('getSettings GETs /api/library/settings', async () => {
    const settings = {
      watched_folders: [{ path: '/tmp/lib', recursive: true }],
      excluded_folder_names: ['.git'],
      auto_rescan_mode: 'manual' as const,
      auto_rescan_interval_hours: 24,
      auto_rescan_daily_time: '03:00',
      fast_worker_count: 4,
    }
    server.use(http.get('*/api/library/settings', () => HttpResponse.json(settings)))

    const res = await api.library.getSettings()

    expect(res.data).toEqual(settings)
  })

  it('updateSettings sends the watched_folders array intact', async () => {
    let captured: { watched_folders?: Array<{ path: string; recursive: boolean }> } | undefined
    server.use(
      http.put('*/api/library/settings', async ({ request }) => {
        captured = (await request.json()) as typeof captured
        return HttpResponse.json({
          watched_folders: captured?.watched_folders ?? [],
          excluded_folder_names: [],
          auto_rescan_mode: 'manual',
          auto_rescan_interval_hours: 24,
          auto_rescan_daily_time: '03:00',
          fast_worker_count: 4,
        })
      }),
    )

    await api.library.updateSettings({
      watched_folders: [
        { path: '/a', recursive: true },
        { path: '/b', recursive: false },
      ],
      excluded_folder_names: [],
      auto_rescan_mode: 'manual',
      auto_rescan_interval_hours: 24,
      auto_rescan_daily_time: '03:00',
      fast_worker_count: 4,
    })

    expect(captured?.watched_folders).toEqual([
      { path: '/a', recursive: true },
      { path: '/b', recursive: false },
    ])
  })
})

describe('libraryApi.rescan / startRescan / status / cancel', () => {
  it('rescan sends the mode in the POST body', async () => {
    let captured: { mode?: string } | undefined
    server.use(
      http.post('*/api/library/rescan', async ({ request }) => {
        captured = (await request.json()) as { mode?: string }
        return HttpResponse.json({
          registered: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          results: [],
          cancelled: 0,
          pruned_unsupported: 0,
        })
      }),
    )

    await api.library.rescan('fast')

    expect(captured?.mode).toBe('fast')
  })

  it('rescan defaults to mode=normal when no argument is given', async () => {
    let captured: { mode?: string } | undefined
    server.use(
      http.post('*/api/library/rescan', async ({ request }) => {
        captured = (await request.json()) as { mode?: string }
        return HttpResponse.json({
          registered: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          results: [],
          cancelled: 0,
          pruned_unsupported: 0,
        })
      }),
    )

    await api.library.rescan()

    expect(captured?.mode).toBe('normal')
  })

  it('startRescan posts mode to /api/library/rescan/start', async () => {
    let captured: { mode?: string } | undefined
    server.use(
      http.post('*/api/library/rescan/start', async ({ request }) => {
        captured = (await request.json()) as { mode?: string }
        return HttpResponse.json({
          running: true,
          stage: 'queued',
          message: '',
          mode: 'fast',
          worker_count: 1,
          folders_total: 0,
          folders_processed: 0,
          found: 0,
          total: 0,
          processed: 0,
          percent: 0,
          registered: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          cancelled: 0,
          pruned_unsupported: 0,
          cancel_requested: false,
        })
      }),
    )

    const res = await api.library.startRescan('fast')

    expect(captured?.mode).toBe('fast')
    expect(res.data.running).toBe(true)
  })

  it('rescanStatus passes through stage and percent', async () => {
    server.use(
      http.get('*/api/library/rescan/status', () =>
        HttpResponse.json({
          running: true,
          stage: 'indexing',
          message: '진행 중',
          mode: 'normal',
          worker_count: 4,
          folders_total: 1,
          folders_processed: 0,
          found: 22,
          total: 22,
          processed: 11,
          percent: 50,
          registered: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          cancelled: 0,
          pruned_unsupported: 0,
          cancel_requested: false,
        }),
      ),
    )

    const res = await api.library.rescanStatus()

    expect(res.data.stage).toBe('indexing')
    expect(res.data.percent).toBe(50)
    expect(res.data.processed).toBe(11)
  })

  it('cancelRescan POSTs /api/library/rescan/cancel', async () => {
    let captured = false
    server.use(
      http.post('*/api/library/rescan/cancel', () => {
        captured = true
        return HttpResponse.json({
          running: true,
          stage: 'cancelling',
          message: '취소 중',
          mode: 'normal',
          worker_count: 1,
          folders_total: 0,
          folders_processed: 0,
          found: 0,
          total: 0,
          processed: 0,
          percent: 0,
          registered: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          cancelled: 0,
          pruned_unsupported: 0,
          cancel_requested: true,
        })
      }),
    )

    const res = await api.library.cancelRescan()

    expect(captured).toBe(true)
    expect(res.data.cancel_requested).toBe(true)
  })
})

describe('libraryApi.groups', () => {
  it('serializes kind, type, query, sort, limit, offset as URL params', async () => {
    let captured: URLSearchParams | undefined
    server.use(
      http.get('*/api/library/groups', ({ request }) => {
        captured = new URL(request.url).searchParams
        return HttpResponse.json({
          total: 0,
          groups: [],
          limit: 50,
          offset: 0,
          counts_by_kind: {},
        })
      }),
    )

    await getLibraryGroups({
      kind: 'version_family',
      fileType: 'Excel',
      query: '주간보고',
      sort: 'recent',
      limit: 10,
      offset: 20,
      includeDuplicates: true,
      cacheOnly: true,
    })

    expect(captured?.get('kind')).toBe('version_family')
    expect(captured?.get('type')).toBe('Excel')
    expect(captured?.get('q')).toBe('주간보고')
    expect(captured?.get('sort')).toBe('recent')
    expect(captured?.get('limit')).toBe('10')
    expect(captured?.get('offset')).toBe('20')
    expect(captured?.get('include_duplicates')).toBe('true')
    expect(captured?.get('cache_only')).toBe('true')
  })

  it('omits unset params from the query string', async () => {
    let capturedSearch = ''
    server.use(
      http.get('*/api/library/groups', ({ request }) => {
        capturedSearch = new URL(request.url).search
        return HttpResponse.json({
          total: 0,
          groups: [],
          limit: 50,
          offset: 0,
          counts_by_kind: {},
        })
      }),
    )

    await getLibraryGroups()

    expect(capturedSearch).toBe('')
  })

  it('groupDetail GETs /api/library/groups/:id with the id encoded', async () => {
    let capturedUrl = ''
    server.use(
      http.get('*/api/library/groups/:id', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({
          id: 'grp-1',
          group_kind: 'version_family',
          file_type: 'Excel',
          base_name: '사업예산',
          canonical_name: '사업예산',
          title: '사업예산',
          file_count: 4,
          confidence: 'high',
          reason: '',
          tokens_summary: [],
          content_status: 'content_differs',
          fingerprint_coverage: 1,
          fingerprint_unique_count: 4,
          content_evidence: '',
          files: [],
        })
      }),
    )

    const res = await api.library.groupDetail('group with spaces')

    expect(capturedUrl).toMatch(/group%20with%20spaces/)
    expect(res.data.id).toBe('grp-1')
  })

  it('setGroupLatestFile PUTs the file_id in the body', async () => {
    let captured: { file_id?: number } | undefined
    server.use(
      http.put('*/api/library/groups/:id/latest-file', async ({ request }) => {
        captured = (await request.json()) as { file_id?: number }
        return HttpResponse.json({
          id: 'grp-1',
          group_kind: 'version_family',
          file_type: 'Excel',
          base_name: '',
          canonical_name: '',
          title: '',
          file_count: 0,
          confidence: '',
          reason: '',
          tokens_summary: [],
          content_status: 'pending',
          fingerprint_coverage: 0,
          fingerprint_unique_count: 0,
          content_evidence: '',
          files: [],
          manual_latest_file_id: 42,
        })
      }),
    )

    await api.library.setGroupLatestFile('grp-1', 42)

    expect(captured?.file_id).toBe(42)
  })

  it('clearGroupLatestFile DELETEs /api/library/groups/:id/latest-file', async () => {
    let capturedMethod = ''
    server.use(
      http.delete('*/api/library/groups/:id/latest-file', ({ request }) => {
        capturedMethod = request.method
        return HttpResponse.json({
          id: 'grp-1',
          group_kind: 'version_family',
          file_type: 'Excel',
          base_name: '',
          canonical_name: '',
          title: '',
          file_count: 0,
          confidence: '',
          reason: '',
          tokens_summary: [],
          content_status: 'pending',
          fingerprint_coverage: 0,
          fingerprint_unique_count: 0,
          content_evidence: '',
          files: [],
        })
      }),
    )

    await api.library.clearGroupLatestFile('grp-1')

    expect(capturedMethod).toBe('DELETE')
  })
})
