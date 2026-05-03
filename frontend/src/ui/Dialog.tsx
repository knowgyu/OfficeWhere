import { ReactNode, useEffect } from 'react'

import { IconButton } from './IconButton'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  icon?: string
  children?: ReactNode
  actions?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  dismissOnBackdrop?: boolean
}

const SIZE = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  actions,
  size = 'md',
  dismissOnBackdrop = true,
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center overflow-hidden overscroll-contain bg-[var(--ow-dialog-backdrop)] p-4 backdrop-blur-md animate-fade-in"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose()
      }}
      onWheel={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) event.preventDefault()
      }}
      onTouchMove={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) event.preventDefault()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${SIZE[size]} max-h-[88vh] flex flex-col rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--ow-dialog-surface)] shadow-elev-5 animate-scale-in overflow-hidden overscroll-contain`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="flex items-start gap-3 min-w-0">
            {icon && (
              <div className="h-10 w-10 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] flex items-center justify-center shrink-0">
                <span
                  className="material-symbol"
                  style={{ fontSize: '24px' }}
                >
                  {icon}
                </span>
              </div>
            )}
            <div className="min-w-0 space-y-1">
              {title && (
                <h2 className="type-title-lg text-[var(--md-sys-color-on-surface)]">{title}</h2>
              )}
              {description && (
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  {description}
                </p>
              )}
            </div>
          </div>
          <IconButton icon="close" label="닫기" onClick={onClose} size="sm" />
        </div>
        <div className="flex-1 overflow-auto overscroll-contain px-6 pb-4">{children}</div>
        {actions && (
          <div className="px-6 py-4 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/82 flex justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
