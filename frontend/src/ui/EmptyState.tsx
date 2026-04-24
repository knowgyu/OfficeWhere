import { ReactNode } from 'react'

import { Icon } from './Icon'

export interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
  className?: string
  compact?: boolean
}

export function EmptyState({
  icon = 'folder_open',
  title,
  description,
  action,
  className = '',
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center text-center gap-4 rounded-lg ${
        compact ? 'py-8 px-4' : 'py-14 px-6'
      } ${className}`}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] ${
          compact ? 'h-12 w-12' : 'h-16 w-16'
        }`}
      >
        <Icon name={icon} size={compact ? 24 : 32} />
      </div>
      <div className="space-y-1 max-w-md">
        <h3 className="type-title-md text-[var(--md-sys-color-on-surface)]">{title}</h3>
        {description && (
          <p className="type-body-md text-[var(--md-sys-color-on-surface-variant)]">{description}</p>
        )}
      </div>
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  )
}
