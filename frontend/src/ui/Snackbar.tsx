import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button } from './Button'
import { Icon } from './Icon'
import { IconButton } from './IconButton'

type Tone = 'neutral' | 'success' | 'danger' | 'warning'

export interface Snack {
  id: number
  key?: string
  message: string
  tone: Tone
  actionLabel?: string
  onAction?: () => void
  durationMs: number
  createdAt: number
}

interface NotificationEntry {
  id: number
  key?: string
  message: string
  tone: Tone
  actionLabel?: string
  createdAt: number
  count: number
}

interface SnackInput {
  message: string
  tone?: Tone
  key?: string
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

interface SnackbarApi {
  show: (input: SnackInput) => void
  error: (message: string, durationMs?: number) => void
  success: (message: string, durationMs?: number) => void
  info: (message: string, durationMs?: number) => void
  warn: (message: string, durationMs?: number) => void
}

const SnackbarContext = createContext<SnackbarApi | null>(null)

export function useSnackbar(): SnackbarApi {
  const value = useContext(SnackbarContext)
  if (!value) throw new Error('useSnackbar must be used inside SnackbarProvider')
  return value
}

const ICONS: Record<Tone, string> = {
  neutral: 'info',
  success: 'check_circle',
  danger: 'error',
  warning: 'warning',
}

const TONE: Record<Tone, string> = {
  neutral:
    'border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)]',
  success:
    'bg-[var(--md-sys-color-success)] text-white',
  danger:
    'bg-[var(--md-sys-color-error)] text-white',
  warning:
    'bg-[var(--md-sys-color-warning)] text-white',
}

const PANEL_TONE: Record<Tone, string> = {
  neutral: 'text-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/55',
  success: 'text-[var(--md-sys-color-success)] bg-[var(--md-sys-color-success)]/12',
  danger: 'text-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)]/70',
  warning: 'text-[var(--md-sys-color-warning)] bg-[var(--md-sys-color-warning)]/14',
}

const TONE_LABELS: Record<Tone, string> = {
  neutral: '안내',
  success: '완료',
  danger: '오류',
  warning: '주의',
}

const MAX_ACTIVE_SNACKS = 4
const MAX_NOTIFICATION_HISTORY = 50

function formatNotificationTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snacks, setSnacks] = useState<Snack[]>([])
  const [notifications, setNotifications] = useState<NotificationEntry[]>([])
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const nextId = useRef(1)
  const nextNotificationId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setSnacks((current) => current.filter((snack) => snack.id !== id))
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications([])
    setNotificationPanelOpen(false)
  }, [])

  const show = useCallback((input: SnackInput) => {
    const now = Date.now()
    const tone = input.tone ?? 'neutral'
    const durationMs = input.durationMs ?? (tone === 'danger' ? 6000 : 3500)

    setNotifications((current) => {
      const existingIndex = input.key ? current.findIndex((item) => item.key === input.key) : -1
      if (existingIndex >= 0) {
        const existing = current[existingIndex]
        const updated: NotificationEntry = {
          ...existing,
          message: input.message,
          tone,
          actionLabel: input.actionLabel,
          createdAt: now,
          count: existing.count + 1,
        }
        return [updated, ...current.slice(0, existingIndex), ...current.slice(existingIndex + 1)].slice(
          0,
          MAX_NOTIFICATION_HISTORY,
        )
      }

      const entry: NotificationEntry = {
        id: nextNotificationId.current++,
        key: input.key,
        message: input.message,
        tone,
        actionLabel: input.actionLabel,
        createdAt: now,
        count: 1,
      }
      return [entry, ...current].slice(0, MAX_NOTIFICATION_HISTORY)
    })

    setSnacks((current) => {
      if (input.key) {
        const existingIndex = current.findIndex((snack) => snack.key === input.key)
        if (existingIndex >= 0) {
          const updated: Snack = {
            ...current[existingIndex],
            message: input.message,
            tone,
            actionLabel: input.actionLabel,
            onAction: input.onAction,
            durationMs,
            createdAt: now,
          }
          return current.map((snack, index) => (index === existingIndex ? updated : snack))
        }
      }

      const snack: Snack = {
        id: nextId.current++,
        key: input.key,
        message: input.message,
        tone,
        actionLabel: input.actionLabel,
        onAction: input.onAction,
        durationMs,
        createdAt: now,
      }
      return [...current, snack].slice(-MAX_ACTIVE_SNACKS)
    })
  }, [])

  const api = useMemo<SnackbarApi>(
    () => ({
      show,
      error: (message, durationMs) => show({ message, tone: 'danger', durationMs }),
      success: (message, durationMs) => show({ message, tone: 'success', durationMs }),
      info: (message, durationMs) => show({ message, tone: 'neutral', durationMs }),
      warn: (message, durationMs) => show({ message, tone: 'warning', durationMs }),
    }),
    [show],
  )

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      <div className="fixed right-4 top-4 z-[61] flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setNotificationPanelOpen((open) => !open)}
          className="state-host relative inline-flex h-10 items-center gap-2 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-3 type-label-lg text-[var(--md-sys-color-on-surface)] shadow-elev-2 transition-colors hover:bg-[var(--md-sys-color-surface-container-highest)]"
          aria-label={
            notifications.length > 0
              ? `알림함 열기, 최근 알림 ${notifications.length}개`
              : '알림함 열기'
          }
          aria-expanded={notificationPanelOpen}
          aria-controls="officewhere-notification-center"
        >
          <span className="state-layer" />
          <Icon name="notifications" size={18} />
          <span>알림</span>
          {notifications.length > 0 && (
            <span className="ml-0.5 inline-flex min-w-5 justify-center rounded-full bg-[var(--md-sys-color-primary)] px-1.5 py-0.5 text-[0.7rem] font-semibold leading-none text-[var(--md-sys-color-on-primary)]">
              {notifications.length > 99 ? '99+' : notifications.length}
            </span>
          )}
        </button>

        {notificationPanelOpen && (
          <section
            id="officewhere-notification-center"
            role="dialog"
            aria-label="알림함"
            className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] shadow-elev-4"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--md-sys-color-outline-variant)] px-4 py-3">
              <div>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">알림함</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  최근 작업 결과를 다시 확인합니다
                </p>
              </div>
              <Button
                variant="text"
                size="sm"
                leadingIcon="delete_sweep"
                onClick={clearNotifications}
                disabled={notifications.length === 0}
              >
                모두 지우기
              </Button>
            </header>
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-[var(--md-sys-color-on-surface-variant)]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--md-sys-color-surface-container-highest)]">
                  <Icon name="notifications_none" size={22} />
                </span>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">확인할 알림이 없습니다</p>
                <p className="type-body-sm">작업 완료나 오류가 생기면 여기에 남습니다.</p>
              </div>
            ) : (
              <ul className="max-h-[26rem] overflow-y-auto p-2">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="rounded-lg border border-transparent px-3 py-2.5 hover:border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          PANEL_TONE[notification.tone]
                        }`}
                      >
                        <Icon name={ICONS[notification.tone]} size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[var(--md-sys-color-on-surface-variant)]">
                          <span className="type-label-md">{TONE_LABELS[notification.tone]}</span>
                          <span aria-hidden="true">·</span>
                          <time className="type-label-md" dateTime={new Date(notification.createdAt).toISOString()}>
                            {formatNotificationTime(notification.createdAt)}
                          </time>
                          {notification.count > 1 && (
                            <span className="rounded-full bg-[var(--md-sys-color-surface-container-highest)] px-1.5 py-0.5 text-[0.68rem] font-semibold">
                              {notification.count}회
                            </span>
                          )}
                        </div>
                        <p className="mt-1 break-words type-body-sm text-[var(--md-sys-color-on-surface)]">
                          {notification.message}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div
        className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-[60] px-4"
        aria-live="polite"
      >
        <div className="flex flex-col gap-2 w-full max-w-md">
          {snacks.map((snack) => (
            <SnackbarItem key={snack.id} snack={snack} onDismiss={() => dismiss(snack.id)} />
          ))}
        </div>
      </div>
    </SnackbarContext.Provider>
  )
}

function SnackbarItem({ snack, onDismiss }: { snack: Snack; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, snack.durationMs)
    return () => clearTimeout(timer)
  }, [onDismiss, snack.createdAt, snack.durationMs])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded-xs px-4 py-3 shadow-elev-3 animate-slide-up ${
        TONE[snack.tone]
      }`}
    >
      <Icon name={ICONS[snack.tone]} size={20} />
      <p className="type-body-md flex-1 min-w-0">{snack.message}</p>
      {snack.actionLabel && (
        <button
          onClick={() => {
            snack.onAction?.()
            onDismiss()
          }}
          className="type-label-lg uppercase tracking-wide px-2 py-1 rounded-full hover:bg-white/10"
        >
          {snack.actionLabel}
        </button>
      )}
      <IconButton
        icon="close"
        label="알림 닫기"
        size="sm"
        onClick={onDismiss}
        className="opacity-80 hover:opacity-100"
      />
    </div>
  )
}
