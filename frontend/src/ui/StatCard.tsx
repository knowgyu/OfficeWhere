import { Icon } from './Icon'

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

export interface StatCardProps {
  label: string
  value: string | number
  icon?: string
  tone?: Tone
  hint?: string
}

const TONE: Record<Tone, string> = {
  neutral:
    'bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-on-surface)]',
  primary:
    'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]',
  success:
    'bg-[var(--md-sys-color-success-container)] text-[var(--md-sys-color-on-success-container)]',
  warning:
    'bg-[var(--md-sys-color-warning-container)] text-[var(--md-sys-color-on-warning-container)]',
  danger:
    'bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]',
}

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-[var(--md-sys-color-surface-container-high)]',
  primary: 'bg-white/40',
  success: 'bg-white/40',
  warning: 'bg-white/40',
  danger: 'bg-white/40',
}

export function StatCard({ label, value, icon, tone = 'neutral', hint }: StatCardProps) {
  return (
    <div className={`rounded-md p-4 flex items-start gap-3 ${TONE[tone]}`}>
      {icon && (
        <div
          className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${ICON_TONE[tone]}`}
        >
          <Icon name={icon} size={22} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="type-headline-sm leading-tight">{value}</p>
        <p className="type-body-sm mt-0.5 opacity-80">{label}</p>
        {hint && <p className="type-body-sm mt-1 opacity-70">{hint}</p>}
      </div>
    </div>
  )
}
