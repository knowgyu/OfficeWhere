import { InputHTMLAttributes, ReactNode, forwardRef, useId } from 'react'

import { Icon } from './Icon'

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode
  description?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className = '', id: idProp, checked, disabled, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-2.5 group ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span className="relative state-host inline-flex h-10 w-10 items-center justify-center rounded-full -m-2.5 shrink-0">
        <span className="state-layer" />
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="peer absolute h-5 w-5 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 items-center justify-center rounded-xs border-2 transition-colors ${
            checked
              ? 'bg-[var(--md-sys-color-primary)] border-[var(--md-sys-color-primary)]'
              : 'border-[var(--md-sys-color-outline)] bg-transparent'
          }`}
        >
          {checked && <Icon name="check" size={16} className="text-[var(--md-sys-color-on-primary)]" />}
        </span>
      </span>
      {(label || description) && (
        <span className="flex flex-col gap-0.5 pt-0.5 min-w-0">
          {label && (
            <span className="type-body-md text-[var(--md-sys-color-on-surface)]">{label}</span>
          )}
          {description && (
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  )
})

type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode
  description?: ReactNode
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, description, className = '', id: idProp, checked, disabled, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-2.5 group ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span className="relative state-host inline-flex h-10 w-10 items-center justify-center rounded-full -m-2.5 shrink-0">
        <span className="state-layer" />
        <input
          ref={ref}
          id={id}
          type="radio"
          checked={checked}
          disabled={disabled}
          className="peer absolute h-5 w-5 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
            checked ? 'border-[var(--md-sys-color-primary)]' : 'border-[var(--md-sys-color-outline)]'
          }`}
        >
          {checked && <span className="h-2.5 w-2.5 rounded-full bg-[var(--md-sys-color-primary)]" />}
        </span>
      </span>
      {(label || description) && (
        <span className="flex flex-col gap-0.5 pt-0.5 min-w-0">
          {label && (
            <span className="type-body-md text-[var(--md-sys-color-on-surface)]">{label}</span>
          )}
          {description && (
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  )
})

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode
  description?: ReactNode
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, description, className = '', id: idProp, checked, disabled, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-3 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span
        className={`relative inline-flex h-7 w-12 items-center rounded-full border-2 transition-colors duration-200 ease-md-standard ${
          checked
            ? 'bg-[var(--md-sys-color-primary)] border-[var(--md-sys-color-primary)]'
            : 'bg-[var(--md-sys-color-surface-container-highest)] border-[var(--md-sys-color-outline)]'
        }`}
      >
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={`absolute top-1/2 h-5 w-5 rounded-full transition-all duration-200 ease-md-standard shadow-elev-1 ${
            checked
              ? 'translate-x-[22px] bg-[var(--md-sys-color-on-primary)]'
              : 'translate-x-1 bg-[var(--md-sys-color-outline)]'
          }`}
          style={{ transform: `${checked ? 'translateX(22px)' : 'translateX(4px)'} translateY(-50%)` }}
        />
      </span>
      {(label || description) && (
        <span className="flex flex-col gap-0.5 min-w-0">
          {label && (
            <span className="type-body-md text-[var(--md-sys-color-on-surface)]">{label}</span>
          )}
          {description && (
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  )
})
