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
  let label = fileType || 'Unknown'
  let tone: Tone = 'neutral'
  let icon = 'description'
  if (raw.includes('excel') || raw === 'xlsx') {
    tone = 'success'
    label = 'Excel'
    icon = 'table_chart'
  } else if (raw.includes('word') || raw === 'docx') {
    tone = 'primary'
    label = 'Word'
    icon = 'article'
  } else if (raw.includes('power') || raw === 'pptx' || raw === 'ppt') {
    tone = 'warning'
    label = 'PowerPoint'
    icon = 'slideshow'
  } else if (raw.includes('pdf')) {
    tone = 'danger'
    label = 'PDF'
    icon = 'picture_as_pdf'
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full pl-1.5 pr-2 py-0.5 type-label-sm ${TONE[tone]}`}
    >
      <span className="material-symbol" style={{ fontSize: '14px' }}>
        {icon}
      </span>
      {label}
    </span>
  )
}
