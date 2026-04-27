import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { api, LibraryRescanResponse, LibraryRescanStatus } from '../api/client'
import { useSnackbar } from '../ui'

type RescanReason = 'manual' | 'added'

interface LibraryRescanContextValue {
  status: LibraryRescanStatus | null
  summary: LibraryRescanResponse | null
  running: boolean
  cancelling: boolean
  completionKey: number
  startRescan: (reason?: RescanReason) => Promise<LibraryRescanStatus | null>
  cancelRescan: () => Promise<void>
  refreshStatus: () => Promise<LibraryRescanStatus | null>
}

const LibraryRescanContext = createContext<LibraryRescanContextValue | null>(null)

function statusToSummary(status: LibraryRescanStatus): LibraryRescanResponse {
  return {
    registered: status.registered,
    updated: status.updated,
    skipped: status.skipped,
    failed: status.failed,
    cancelled: status.cancelled,
    results: [],
  }
}

export function LibraryRescanProvider({ children }: { children: ReactNode }) {
  const snackbar = useSnackbar()
  const [status, setStatus] = useState<LibraryRescanStatus | null>(null)
  const [summary, setSummary] = useState<LibraryRescanResponse | null>(null)
  const [completionKey, setCompletionKey] = useState(0)
  const reasonRef = useRef<RescanReason>('manual')
  const notifiedStatusRef = useRef<string | null>(null)
  const observedRunningRef = useRef(false)

  const running = Boolean(status?.running)
  const cancelling = Boolean(status?.cancel_requested || status?.stage === 'cancelling')

  const applyStatus = useCallback((next: LibraryRescanStatus) => {
    if (next.running) observedRunningRef.current = true
    setStatus(next)
    if (next.summary) setSummary(next.summary)
    if (!next.running && ['completed', 'failed', 'cancelled'].includes(next.stage)) {
      setCompletionKey((key) => key + 1)
    }
    return next
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const response = await api.library.rescanStatus()
      return applyStatus(response.data)
    } catch {
      return null
    }
  }, [applyStatus])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 700)
    return () => window.clearInterval(timer)
  }, [refreshStatus, running])

  useEffect(() => {
    if (!status || status.running || notifiedStatusRef.current === status.updated_at) return
    if (!observedRunningRef.current) return
    if (!['completed', 'failed', 'cancelled'].includes(status.stage)) return

    notifiedStatusRef.current = status.updated_at ?? `${status.stage}-${Date.now()}`
    const currentSummary = status.summary ?? summary ?? statusToSummary(status)
    const unchangedText = currentSummary.skipped > 0 ? ` · 변경 없음 ${currentSummary.skipped}` : ''
    if (status.stage === 'failed') {
      observedRunningRef.current = false
      snackbar.error(status.error || status.message || '문서 새로고침에 실패했습니다.')
      return
    }
    if (status.stage === 'cancelled') {
      observedRunningRef.current = false
      snackbar.warn(`문서 새로고침 정지됨 · 신규 ${currentSummary.registered} · 갱신 ${currentSummary.updated}${unchangedText}`)
      return
    }
    if (currentSummary.failed > 0) {
      observedRunningRef.current = false
      snackbar.warn(`문서 새로고침 완료 · 신규 ${currentSummary.registered} · 갱신 ${currentSummary.updated}${unchangedText} · 실패 ${currentSummary.failed}`)
      return
    }
    observedRunningRef.current = false
    snackbar.success(
      reasonRef.current === 'added'
        ? `폴더 추가 및 색인 완료 · 등록/확인 ${currentSummary.registered + currentSummary.updated + currentSummary.skipped} · 신규 ${currentSummary.registered} · 갱신 ${currentSummary.updated}${unchangedText}`
        : `문서 새로고침 완료 · 신규 ${currentSummary.registered} · 갱신 ${currentSummary.updated}${unchangedText}`,
    )
  }, [snackbar, status, summary])

  const startRescan = useCallback(
    async (reason: RescanReason = 'manual') => {
      reasonRef.current = reason
      notifiedStatusRef.current = null
      observedRunningRef.current = true
      setSummary(null)
      try {
        const response = await api.library.startRescan()
        return applyStatus(response.data)
      } catch (error) {
        const detail =
          (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          '문서 새로고침에 실패했습니다.'
        snackbar.error(detail)
        return null
      }
    },
    [applyStatus, snackbar],
  )

  const cancelRescan = useCallback(async () => {
    try {
      const response = await api.library.cancelRescan()
      applyStatus(response.data)
    } catch {
      snackbar.error('정지 요청을 보내지 못했습니다.')
    }
  }, [applyStatus, snackbar])

  const value = useMemo<LibraryRescanContextValue>(
    () => ({
      status,
      summary,
      running,
      cancelling,
      completionKey,
      startRescan,
      cancelRescan,
      refreshStatus,
    }),
    [cancelRescan, cancelling, completionKey, refreshStatus, running, startRescan, status, summary],
  )

  return <LibraryRescanContext.Provider value={value}>{children}</LibraryRescanContext.Provider>
}

export function useLibraryRescan() {
  const value = useContext(LibraryRescanContext)
  if (!value) throw new Error('useLibraryRescan must be used inside LibraryRescanProvider')
  return value
}
