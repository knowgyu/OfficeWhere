import { HTMLAttributes, ReactNode } from 'react'

type Variant = 'elevated' | 'filled' | 'outlined'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  interactive?: boolean
  children?: ReactNode
}

const VARIANT: Record<Variant, string> = {
  elevated: 'bg-[var(--md-sys-color-surface-container-low)] shadow-elev-1',
  filled: 'bg-[var(--md-sys-color-surface-container-high)]',
  outlined:
    'bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)]',
}

export function Card({
  variant = 'outlined',
  interactive = false,
  className = '',
  children,
  ...rest
}: CardProps) {
  const base = `rounded-lg transition-all duration-150 ease-md-standard ${VARIANT[variant]}`
  const hover = interactive
    ? 'state-host relative cursor-pointer hover:shadow-elev-2'
    : ''
  return (
    <div className={`${base} ${hover} ${className}`} {...rest}>
      {interactive && <span className="state-layer" />}
      {children}
    </div>
  )
}

export function CardSection({
  title,
  description,
  trailing,
  className = '',
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  trailing?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={`space-y-4 p-6 ${className}`}>
      {(title || trailing || description) && (
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 space-y-1">
            {title && <h2 className="type-title-md text-[var(--md-sys-color-on-surface)]">{title}</h2>}
            {description && (
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">{description}</p>
            )}
          </div>
          {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
