import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/msw/server'
import { SnackbarProvider, useSnackbar } from '../ui'
import type { LibraryRescanStatus } from '../api/library'
import { LibraryRescanProvider, useLibraryRescan } from './LibraryRescanContext'

// Asserting Snackbar messages requires reaching into the SnackbarProvider's
// API. We render a tiny capture component beside the rescan hook to record
// every call.
function makeSnackbarSpy() {
  const calls: Array<{ method: 'success' | 'error' | 'warn' | 'info'; message: string }> = []
  function CaptureSnackbar() {
    const snackbar = useSnackbar()
    const original = useRefOnce(() => ({
      success: snackbar.success,
      error: snackbar.error,
      warn: snackbar.warn,
      info: snackbar.info,
    }))
    snackbar.success = (message, durationMs) => {
      calls.push({ method: 'success', message })
      original.success(message, durationMs)
    }
    snackbar.error = (message, durationMs) => {
      calls.push({ method: 'error', message })
      original.error(message, durationMs)
    }
    snackbar.warn = (message, durationMs) => {
      calls.push({ method: 'warn', message })
      original.warn(message, durationMs)
    }
    snackbar.info = (message, durationMs) => {
      calls.push({ method: 'info', message })
      original.info(message, durationMs)
    }
    return null
  }
  return { calls, CaptureSnackbar }
}

function useRefOnce<T>(factory: () => T): T {
  // Tiny stand-in so the snackbar wrapper above doesn't re-evaluate the
  // factory on every render.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return require('react').useRef(factory()).current as T
}

const baseStatus: LibraryRescanStatus = {
  running: false,
  stage: 'idle',
  message: '',
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
  missing: 0,
  recovered: 0,
  purged_missing: 0,
  cancel_requested: false,
}

function statusOverride(overrides: Partial<LibraryRescanStatus>): LibraryRescanStatus {
  return { ...baseStatus, ...overrides }
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SnackbarProvider>
      <LibraryRescanProvider>{children}</LibraryRescanProvider>
    </SnackbarProvider>
  )
}

describe('LibraryRescanProvider', () => {
  it('fetches the initial rescan status on mount', async () => {
    let hits = 0
    server.use(
      http.get('*/api/library/rescan/status', () => {
        hits += 1
        return HttpResponse.json(statusOverride({ stage: 'idle' }))
      }),
    )

    const { result } = renderHook(() => useLibraryRescan(), { wrapper })

    await waitFor(() => expect(result.current.status?.stage).toBe('idle'))
    expect(hits).toBeGreaterThanOrEqual(1)
    expect(result.current.running).toBe(false)
  })

  it('startRescan calls /api/library/rescan/start with the mode', async () => {
    let captured: { mode?: string } | undefined
    server.use(
      http.post('*/api/library/rescan/start', async ({ request }) => {
        captured = (await request.json()) as { mode?: string }
        return HttpResponse.json(statusOverride({ running: true, stage: 'queued', mode: 'fast' }))
      }),
    )

    const { result } = renderHook(() => useLibraryRescan(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())

    await act(async () => {
      await result.current.startRescan('fast', 'fast')
    })

    expect(captured?.mode).toBe('fast')
    expect(result.current.running).toBe(true)
  })

  it('exposes cancelling=true while cancel_requested or stage=cancelling', async () => {
    server.use(
      http.get('*/api/library/rescan/status', () =>
        HttpResponse.json(
          statusOverride({ running: true, stage: 'cancelling', cancel_requested: true }),
        ),
      ),
    )

    const { result } = renderHook(() => useLibraryRescan(), { wrapper })

    await waitFor(() => expect(result.current.cancelling).toBe(true))
  })

  it('cancelRescan calls /api/library/rescan/cancel', async () => {
    let cancelled = false
    server.use(
      http.post('*/api/library/rescan/cancel', () => {
        cancelled = true
        return HttpResponse.json(
          statusOverride({ running: true, stage: 'cancelling', cancel_requested: true }),
        )
      }),
    )

    const { result } = renderHook(() => useLibraryRescan(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())

    await act(async () => {
      await result.current.cancelRescan()
    })

    expect(cancelled).toBe(true)
    expect(result.current.cancelling).toBe(true)
  })

  it('refreshStatus returns null on network failure rather than throwing', async () => {
    server.use(
      http.get('*/api/library/rescan/status', () => HttpResponse.error()),
    )

    const { result } = renderHook(() => useLibraryRescan(), { wrapper })

    let refreshed: unknown
    await act(async () => {
      refreshed = await result.current.refreshStatus()
    })

    expect(refreshed).toBeNull()
  })

  it('polls every 700ms while running and stops when not running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    let runningHits = 0
    let polled = 0
    let runningSnapshot: LibraryRescanStatus = statusOverride({
      running: true,
      stage: 'indexing',
    })
    server.use(
      http.get('*/api/library/rescan/status', () => {
        polled += 1
        if (runningSnapshot.running) runningHits += 1
        return HttpResponse.json(runningSnapshot)
      }),
    )

    const { result } = renderHook(() => useLibraryRescan(), { wrapper })

    await waitFor(() => expect(result.current.running).toBe(true))
    const baselineHits = polled

    // Three poll cycles at 700ms each
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700 * 3 + 50)
    })

    expect(polled).toBeGreaterThanOrEqual(baselineHits + 3)

    // Backend now reports completion. Polling should stop once running flips.
    runningSnapshot = statusOverride({ running: false, stage: 'completed' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    await waitFor(() => expect(result.current.running).toBe(false))

    const afterStop = polled
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700 * 3)
    })
    expect(polled).toBeLessThanOrEqual(afterStop + 1) // at most a trailing fetch from React batching

    vi.useRealTimers()
    void runningHits // avoid unused warning under strict configs
  })

  describe('completion notifications', () => {
    function setupRescanThen(finalStatus: LibraryRescanStatus) {
      let phase: 'running' | 'done' = 'running'
      server.use(
        http.get('*/api/library/rescan/status', () =>
          HttpResponse.json(
            phase === 'running'
              ? statusOverride({ running: true, stage: 'indexing' })
              : finalStatus,
          ),
        ),
        http.post('*/api/library/rescan/start', () =>
          HttpResponse.json(statusOverride({ running: true, stage: 'queued' })),
        ),
      )
      return () => {
        phase = 'done'
      }
    }

    it('fires snackbar.success on successful manual completion', async () => {
      const spy = makeSnackbarSpy()
      const finish = setupRescanThen(
        statusOverride({
          running: false,
          stage: 'completed',
          updated_at: '2026-05-05T01:00:00Z',
          registered: 3,
          updated: 1,
          skipped: 0,
          failed: 0,
          summary: {
            registered: 3,
            updated: 1,
            skipped: 0,
            failed: 0,
            cancelled: 0,
            pruned_unsupported: 0,
            missing: 0,
            recovered: 0,
            purged_missing: 0,
            results: [],
          },
        }),
      )

      function Combo() {
        return (
          <SnackbarProvider>
            <spy.CaptureSnackbar />
            <LibraryRescanProvider>
              <RescanProbe />
            </LibraryRescanProvider>
          </SnackbarProvider>
        )
      }
      function RescanProbe() {
        const { startRescan, refreshStatus, status } = useLibraryRescan()
        ;(globalThis as { __rescanProbe?: unknown }).__rescanProbe = {
          startRescan,
          refreshStatus,
          status,
        }
        return null
      }

      const { unmount } = renderHook(() => null, { wrapper: Combo })
      const probe = () =>
        (globalThis as { __rescanProbe?: { startRescan: typeof Function.prototype; refreshStatus: typeof Function.prototype; status: LibraryRescanStatus | null } }).__rescanProbe
      await waitFor(() => expect(probe()).toBeDefined())

      await act(async () => {
        await probe()!.startRescan('manual', 'normal')
      })

      finish()
      await act(async () => {
        await probe()!.refreshStatus()
      })

      expect(spy.calls.some((c) => c.method === 'success')).toBe(true)
      const successCall = spy.calls.find((c) => c.method === 'success')
      expect(successCall?.message).toMatch(/문서 새로고침 완료/)
      expect(successCall?.message).toMatch(/신규 3/)
      expect(successCall?.message).toMatch(/갱신 1/)

      unmount()
      delete (globalThis as { __rescanProbe?: unknown }).__rescanProbe
    })

    it('fires snackbar.warn on cancelled completion', async () => {
      const spy = makeSnackbarSpy()
      const finish = setupRescanThen(
        statusOverride({
          running: false,
          stage: 'cancelled',
          updated_at: '2026-05-05T01:01:00Z',
          registered: 1,
          updated: 0,
          cancelled: 5,
          summary: {
            registered: 1,
            updated: 0,
            skipped: 0,
            failed: 0,
            cancelled: 5,
            pruned_unsupported: 0,
            missing: 0,
            recovered: 0,
            purged_missing: 0,
            results: [],
          },
        }),
      )

      function Combo() {
        return (
          <SnackbarProvider>
            <spy.CaptureSnackbar />
            <LibraryRescanProvider>
              <RescanProbe />
            </LibraryRescanProvider>
          </SnackbarProvider>
        )
      }
      function RescanProbe() {
        const ctx = useLibraryRescan()
        ;(globalThis as { __rescanProbe?: unknown }).__rescanProbe = ctx
        return null
      }

      const { unmount } = renderHook(() => null, { wrapper: Combo })
      const probe = () =>
        (globalThis as { __rescanProbe?: ReturnType<typeof useLibraryRescan> }).__rescanProbe
      await waitFor(() => expect(probe()).toBeDefined())

      await act(async () => {
        await probe()!.startRescan('manual', 'normal')
      })
      finish()
      await act(async () => {
        await probe()!.refreshStatus()
      })

      const warnCall = spy.calls.find((c) => c.method === 'warn')
      expect(warnCall?.message).toMatch(/정지됨/)

      unmount()
      delete (globalThis as { __rescanProbe?: unknown }).__rescanProbe
    })

    it('fires snackbar.error on failed completion', async () => {
      const spy = makeSnackbarSpy()
      const finish = setupRescanThen(
        statusOverride({
          running: false,
          stage: 'failed',
          updated_at: '2026-05-05T01:02:00Z',
          error: '디스크 공간 부족',
          summary: {
            registered: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            cancelled: 0,
            pruned_unsupported: 0,
            missing: 0,
            recovered: 0,
            purged_missing: 0,
            results: [],
          },
        }),
      )

      function Combo() {
        return (
          <SnackbarProvider>
            <spy.CaptureSnackbar />
            <LibraryRescanProvider>
              <RescanProbe />
            </LibraryRescanProvider>
          </SnackbarProvider>
        )
      }
      function RescanProbe() {
        const ctx = useLibraryRescan()
        ;(globalThis as { __rescanProbe?: unknown }).__rescanProbe = ctx
        return null
      }

      const { unmount } = renderHook(() => null, { wrapper: Combo })
      const probe = () =>
        (globalThis as { __rescanProbe?: ReturnType<typeof useLibraryRescan> }).__rescanProbe
      await waitFor(() => expect(probe()).toBeDefined())

      await act(async () => {
        await probe()!.startRescan('manual', 'normal')
      })
      finish()
      await act(async () => {
        await probe()!.refreshStatus()
      })

      const errorCall = spy.calls.find((c) => c.method === 'error')
      expect(errorCall?.message).toMatch(/디스크 공간 부족/)

      unmount()
      delete (globalThis as { __rescanProbe?: unknown }).__rescanProbe
    })

    it('does not duplicate the completion notification when the same status is observed twice', async () => {
      const spy = makeSnackbarSpy()
      let phase: 'running' | 'done' = 'running'
      const completedStatus = statusOverride({
        running: false,
        stage: 'completed',
        updated_at: '2026-05-05T01:03:00Z',
        registered: 2,
        summary: {
          registered: 2,
          updated: 0,
          skipped: 0,
          failed: 0,
          cancelled: 0,
          pruned_unsupported: 0,
          missing: 0,
          recovered: 0,
          purged_missing: 0,
          results: [],
        },
      })
      server.use(
        http.get('*/api/library/rescan/status', () =>
          HttpResponse.json(
            phase === 'running'
              ? statusOverride({ running: true, stage: 'indexing' })
              : completedStatus,
          ),
        ),
        http.post('*/api/library/rescan/start', () =>
          HttpResponse.json(statusOverride({ running: true, stage: 'queued' })),
        ),
      )

      function Combo() {
        return (
          <SnackbarProvider>
            <spy.CaptureSnackbar />
            <LibraryRescanProvider>
              <RescanProbe />
            </LibraryRescanProvider>
          </SnackbarProvider>
        )
      }
      function RescanProbe() {
        const ctx = useLibraryRescan()
        ;(globalThis as { __rescanProbe?: unknown }).__rescanProbe = ctx
        return null
      }

      const { unmount } = renderHook(() => null, { wrapper: Combo })
      const probe = () =>
        (globalThis as { __rescanProbe?: ReturnType<typeof useLibraryRescan> }).__rescanProbe
      await waitFor(() => expect(probe()).toBeDefined())

      await act(async () => {
        await probe()!.startRescan('manual', 'normal')
      })
      phase = 'done'
      await act(async () => {
        await probe()!.refreshStatus()
      })
      await act(async () => {
        await probe()!.refreshStatus()
      })
      await act(async () => {
        await probe()!.refreshStatus()
      })

      const successCalls = spy.calls.filter((c) => c.method === 'success')
      expect(successCalls).toHaveLength(1)

      unmount()
      delete (globalThis as { __rescanProbe?: unknown }).__rescanProbe
    })
  })
})
