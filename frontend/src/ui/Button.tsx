import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react'

import { Icon } from './Icon'

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  leadingIcon?: string
  trailingIcon?: string
  iconFilled?: boolean
  loading?: boolean
  fullWidth?: boolean
  children?: ReactNode
}

const BASE =
  'state-host relative inline-flex items-center justify-center gap-2 rounded-full font-medium' +
  ' transition-colors duration-150 ease-md-standard outline-none focus-visible:outline-none' +
  ' disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap'

const SIZE: Record<Size, string> = {
  sm: 'h-9 px-4 text-[0.8125rem]',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-6 text-[0.9375rem]',
}

const VARIANT: Record<Variant, string> = {
  filled:
    'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow-elev-1 hover:shadow-elev-2',
  tonal:
    'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]',
  outlined:
    'bg-transparent text-[var(--md-sys-color-primary)] border border-[var(--md-sys-color-outline)] hover:border-[var(--md-sys-color-primary)]',
  text: 'bg-transparent text-[var(--md-sys-color-primary)]',
  elevated:
    'bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-primary)] shadow-elev-1 hover:shadow-elev-2',
  danger:
    'bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-error-container)_80%,var(--md-sys-color-error))]',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'filled',
    size = 'md',
    leadingIcon,
    trailingIcon,
    iconFilled = false,
    loading = false,
    fullWidth = false,
    className = '',
    disabled,
    children,
    ...rest
  },
  ref,
) {
  const iconSize = size === 'lg' ? 20 : 18
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      <span className="state-layer" />
      {loading ? (
        <Icon name="progress_activity" size={iconSize} className="animate-spin" />
      ) : leadingIcon ? (
        <Icon name={leadingIcon} size={iconSize} filled={iconFilled} />
      ) : null}
      {children && <span className="relative">{children}</span>}
      {!loading && trailingIcon && <Icon name={trailingIcon} size={iconSize} filled={iconFilled} />}
    </button>
  )
})
