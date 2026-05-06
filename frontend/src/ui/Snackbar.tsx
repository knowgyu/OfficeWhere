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

import { Icon } from './Icon'
import { IconButton } from './IconButton'

type Tone = 'neutral' | 'success' | 'danger' | 'warning'

export interface Snack {
  id: number
  message: string
  tone: Tone
  actionLabel?: string
  onAction?: () => void
  durationMs: number
}

interface SnackInput {
  message: string
  tone?: Tone
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

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snacks, setSnacks] = useState<Snack[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setSnacks((current) => current.filter((snack) => snack.id !== id))
  }, [])

  const show = useCallback((input: SnackInput) => {
    const id = nextId.current++
    const snack: Snack = {
      id,
      message: input.message,
      tone: input.tone ?? 'neutral',
      actionLabel: input.actionLabel,
      onAction: input.onAction,
      durationMs: input.durationMs ?? (input.tone === 'danger' ? 6000 : 3500),
    }
    setSnacks((current) => [...current, snack])
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
  }, [onDismiss, snack.durationMs])

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
