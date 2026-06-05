import { ReactNode } from 'react'

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'tertiary'

const TONE: Record<Tone, string> = {
  neutral:
    'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]',
  primary:
    'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]',
  success:
    'bg-[var(--md-sys-color-success-container)] text-[var(--md-sys-color-on-success-container)]',
  warning:
    'bg-[var(--md-sys-color-warning-container)] text-[var(--md-sys-color-on-warning-container)]',
  danger:
    'bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]',
  tertiary:
    'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)]',
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 type-label-sm ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function FileTypeBadge({ fileType }: { fileType: string }) {
  const raw = fileType.toLowerCase()
  let label = 'FILE'
  let tone: Tone = 'neutral'
  if (raw.includes('excel') || raw === 'xlsx' || raw === 'xls') {
    tone = 'success'
    label = 'XLSX'
  } else if (raw.includes('word') || raw === 'docx' || raw === 'doc') {
    tone = 'primary'
    label = 'DOCX'
  } else if (raw.includes('power') || raw === 'pptx' || raw === 'ppt') {
    tone = 'warning'
    label = 'PPTX'
  } else if (raw.includes('pdf')) {
    tone = 'danger'
    label = 'PDF'
  } else if (raw.includes('markdown') || raw === 'md') {
    label = 'MD'
  } else if (raw.includes('text') || raw === 'txt') {
    label = 'TXT'
  }
  return (
    <span
      className={`inline-flex w-12 items-center justify-center rounded-full px-0 py-0.5 text-center type-label-sm tabular-nums ${TONE[tone]}`}
    >
      {label}
    </span>
  )
}
