import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from 'react'

import { Icon } from './Icon'

type BaseProps = {
  label?: string
  helper?: string
  error?: string
  leadingIcon?: string
  trailing?: ReactNode
  fullWidth?: boolean
}

const FIELD_BASE =
  'peer w-full h-11 rounded-sm bg-[var(--md-sys-color-surface-container-highest)] px-3' +
  ' text-[0.9375rem] text-[var(--md-sys-color-on-surface)] outline-none border-0' +
  ' focus:ring-2 focus:ring-[var(--md-sys-color-primary)] focus:ring-inset' +
  ' placeholder:text-[var(--md-sys-color-on-surface-variant)] disabled:opacity-60'

function Shell({
  label,
  helper,
  error,
  leadingIcon,
  trailing,
  fullWidth,
  children,
  id,
}: BaseProps & { children: ReactNode; id: string }) {
  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label
          htmlFor={id}
          className="block mb-1.5 type-label-md text-[var(--md-sys-color-on-surface-variant)]"
        >
          {label}
        </label>
      )}
      <div
        className={`relative flex items-center ${
          error ? 'ring-2 ring-[var(--md-sys-color-error)] rounded-sm' : ''
        }`}
      >
        {leadingIcon && (
          <Icon
            name={leadingIcon}
            size={20}
            className="pointer-events-none absolute left-3 text-[var(--md-sys-color-on-surface-variant)]"
          />
        )}
        <div className={`flex-1 ${leadingIcon ? 'pl-8' : ''}`}>{children}</div>
        {trailing && <div className="absolute right-2 flex items-center gap-1">{trailing}</div>}
      </div>
      {(helper || error) && (
        <p
          className={`mt-1.5 type-body-sm ${
            error ? 'text-[var(--md-sys-color-error)]' : 'text-[var(--md-sys-color-on-surface-variant)]'
          }`}
        >
          {error ?? helper}
        </p>
      )}
    </div>
  )
}

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    BaseProps {}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    helper,
    error,
    leadingIcon,
    trailing,
    fullWidth = true,
    className = '',
    id: idProp,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Shell
      id={id}
      label={label}
      helper={helper}
      error={error}
      leadingIcon={leadingIcon}
      trailing={trailing}
      fullWidth={fullWidth}
    >
      <input ref={ref} id={id} className={`${FIELD_BASE} ${className}`} {...rest} />
    </Shell>
  )
})

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement>, BaseProps {}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  {
    label,
    helper,
    error,
    leadingIcon,
    trailing,
    fullWidth = true,
    className = '',
    children,
    id: idProp,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Shell
      id={id}
      label={label}
      helper={helper}
      error={error}
      leadingIcon={leadingIcon}
      trailing={
        trailing ?? (
          <Icon
            name="expand_more"
            size={20}
            className="pointer-events-none text-[var(--md-sys-color-on-surface-variant)] mr-1.5"
          />
        )
      }
      fullWidth={fullWidth}
    >
      <select
        ref={ref}
        id={id}
        className={`${FIELD_BASE} appearance-none pr-10 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </Shell>
  )
})

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, BaseProps {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    helper,
    error,
    leadingIcon,
    trailing,
    fullWidth = true,
    className = '',
    id: idProp,
    rows = 4,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Shell
      id={id}
      label={label}
      helper={helper}
      error={error}
      leadingIcon={leadingIcon}
      trailing={trailing}
      fullWidth={fullWidth}
    >
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className={`${FIELD_BASE} h-auto py-2.5 resize-y ${className}`}
        {...rest}
      />
    </Shell>
  )
})
