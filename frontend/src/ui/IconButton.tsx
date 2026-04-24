import { ButtonHTMLAttributes, forwardRef } from 'react'

import { Icon } from './Icon'

type Variant = 'standard' | 'filled' | 'tonal' | 'outlined'
type Size = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string
  variant?: Variant
  size?: Size
  iconFilled?: boolean
  label: string
  selected?: boolean
}

const BASE =
  'state-host relative inline-flex items-center justify-center rounded-full outline-none' +
  ' transition-colors duration-150 ease-md-standard disabled:opacity-40 disabled:cursor-not-allowed'

const SIZE: Record<Size, { box: string; icon: number }> = {
  sm: { box: 'h-8 w-8', icon: 18 },
  md: { box: 'h-10 w-10', icon: 20 },
  lg: { box: 'h-12 w-12', icon: 22 },
}

const VARIANT: Record<Variant, string> = {
  standard: 'text-[var(--md-sys-color-on-surface-variant)]',
  filled: 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
  tonal:
    'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]',
  outlined:
    'border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface-variant)]',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    variant = 'standard',
    size = 'md',
    iconFilled = false,
    label,
    selected = false,
    className = '',
    ...rest
  },
  ref,
) {
  const s = SIZE[size]
  const selectedClass = selected
    ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
    : ''
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      className={`${BASE} ${s.box} ${VARIANT[variant]} ${selectedClass} ${className}`}
      {...rest}
    >
      <span className="state-layer" />
      <Icon name={icon} size={s.icon} filled={iconFilled || selected} />
    </button>
  )
})
