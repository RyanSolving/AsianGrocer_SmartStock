'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-forest-900 text-white hover:bg-forest-700 active:bg-forest-950 disabled:bg-forest-900/40',
  secondary: 'border border-line bg-surface text-ink hover:bg-slate-100 active:bg-slate-200 disabled:text-ink/40',
  ghost: 'text-ink hover:bg-slate-100 active:bg-slate-200 disabled:text-ink/40',
  danger: 'bg-danger text-white hover:bg-[#991d14] active:bg-[#7d170f] disabled:bg-danger/40',
  success: 'bg-success text-white hover:bg-[#177447] disabled:bg-success/40',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[14px] gap-1.5',
  md: 'min-h-11 px-4 text-[15px] gap-2',
  lg: 'min-h-[52px] px-5 text-[16px] gap-2',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Text shown while loading, e.g. "Saving…". */
  loadingLabel?: ReactNode
  icon?: ReactNode
  block?: boolean
}

export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', block = false) =>
  `inline-flex select-none items-center justify-center rounded-control font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''}`

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, loadingLabel, icon, block = false, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass(variant, size, block)} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
})

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  tone?: 'default' | 'onDark' | 'danger'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'default', className = '', children, type = 'button', ...rest },
  ref,
) {
  const toneClass =
    tone === 'onDark'
      ? 'text-white/85 hover:bg-white/10 active:bg-white/15'
      : tone === 'danger'
        ? 'text-danger hover:bg-danger-soft'
        : 'text-ink hover:bg-slate-100 active:bg-slate-200'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-500 disabled:opacity-40 ${toneClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})
