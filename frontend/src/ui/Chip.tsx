import { ButtonHTMLAttributes, ReactNode } from 'react'

import { Icon } from './Icon'

type ChipTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'warning'
  | 'danger'

type ChipKind = 'assist' | 'filter' | 'input' | 'suggestion'

const TONE: Record<ChipTone, string> = {
  neutral:
    'bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-on-surface-variant)] border border-[var(--md-sys-color-outline-variant)]',
  primary:
    'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]',
  secondary:
    'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]',
  tertiary:
    'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)]',
  success:
    'bg-[var(--md-sys-color-success-container)] text-[var(--md-sys-color-on-success-container)]',
  warning:
    'bg-[var(--md-sys-color-warning-container)] text-[var(--md-sys-color-on-warning-container)]',
  danger:
    'bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]',
}

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: ReactNode
  tone?: ChipTone
  kind?: ChipKind
  icon?: string
  trailingIcon?: string
  selected?: boolean
  onRemove?: () => void
  as?: 'button' | 'span'
}

export function Chip({
  label,
  tone = 'neutral',
  kind = 'assist',
  icon,
  trailingIcon,
  selected = false,
  onRemove,
  as = 'button',
  className = '',
  disabled,
  ...rest
}: ChipProps) {
  const Component: 'button' | 'span' = onRemove || rest.onClick ? 'button' : as
  const selectedClass =
    kind === 'filter' && selected
      ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] border-transparent'
      : ''

  const padding = icon || (kind === 'filter' && selected) ? 'pl-2 pr-3' : 'px-3'
  const trailingPad = trailingIcon || onRemove ? 'pr-1.5' : ''

  return (
    <Component
      type={Component === 'button' ? rest.type ?? 'button' : undefined}
      disabled={Component === 'button' ? disabled : undefined}
      className={`state-host relative inline-flex items-center gap-1.5 h-8 rounded-sm type-label-lg transition-colors duration-150 ease-md-standard outline-none select-none ${
        TONE[tone]
      } ${selectedClass} ${padding} ${trailingPad} ${
        disabled ? 'opacity-40' : ''
      } ${Component === 'button' ? 'cursor-pointer' : ''} ${className}`}
      {...rest}
    >
      {Component === 'button' && <span className="state-layer" />}
      {kind === 'filter' && selected ? (
        <Icon name="check" size={18} />
      ) : icon ? (
        <Icon name={icon} size={18} />
      ) : null}
      <span className="relative">{label}</span>
      {trailingIcon && <Icon name={trailingIcon} size={18} />}
      {onRemove && (
        <span
          role="button"
          aria-label="제거"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className="relative ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[rgba(0,0,0,0.08)]"
        >
          <Icon name="close" size={14} />
        </span>
      )}
    </Component>
  )
}
