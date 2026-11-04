'use client'

import { forwardRef, type FocusEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

/** Field look without a width; add your own (`w-auto`, `w-[92px]`) or use `fieldClass`. */
export const inputClass =
  'min-h-11 rounded-control border border-line bg-surface px-3 text-[16px] text-ink placeholder:text-slate-400 transition-colors duration-150 focus:border-forest-600 focus:outline-none focus:ring-2 focus:ring-forest-600/15 disabled:bg-slate-100 disabled:text-ink/50'

/** Full-width field. */
export const fieldClass = `${inputClass} block w-full`

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  leading?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className = '', leading, ...rest }, ref) {
  if (!leading) {
    return <input ref={ref} className={`${fieldClass} ${className}`} {...rest} />
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">{leading}</span>
      <input ref={ref} className={`${fieldClass} pl-10 ${className}`} {...rest} />
    </div>
  )
})

/**
 * Quantity field: numeric keypad on phones, 16px (no iOS zoom), tabular digits,
 * and the whole value selected on focus so a new count replaces the old one.
 */
export const NumberInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function NumberInput(
  { className = '', onFocus, inputMode = 'decimal', enterKeyHint = 'done', ...rest },
  ref,
) {
  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    const target = event.currentTarget
    requestAnimationFrame(() => {
      try {
        target.select()
      } catch {
        /* some input types do not support selection */
      }
    })
    onFocus?.(event)
  }
  return (
    <input
      ref={ref}
      type="text"
      inputMode={inputMode}
      enterKeyHint={enterKeyHint}
      autoComplete="off"
      onFocus={handleFocus}
      className={`${fieldClass} tabular text-right ${className}`}
      {...rest}
    />
  )
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`${fieldClass} pr-8 ${className}`} {...rest}>
      {children}
    </select>
  )
})

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[14px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  )
}
