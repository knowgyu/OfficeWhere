import { ReactNode } from 'react'

import { Icon } from './Icon'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: string
}

export function SegmentedButton<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}) {
  const height = size === 'sm' ? 'h-9' : 'h-10'
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-stretch rounded-full border border-[var(--md-sys-color-outline)] overflow-hidden ${height} ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={selected}
            type="button"
            onClick={() => onChange(option.value)}
            className={`state-host relative inline-flex items-center justify-center gap-1.5 px-4 type-label-lg transition-colors ${
              selected
                ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
                : 'text-[var(--md-sys-color-on-surface-variant)]'
            }`}
          >
            <span className="state-layer" />
            {selected ? (
              <Icon name="check" size={18} />
            ) : option.icon ? (
              <Icon name={option.icon} size={18} />
            ) : null}
            <span className="relative whitespace-nowrap">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
