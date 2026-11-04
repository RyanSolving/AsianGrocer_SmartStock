'use client'

import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className = '', padded = true, children, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={`rounded-card border border-line bg-surface ${padded ? 'p-4 sm:p-5' : ''} ${className}`} {...rest}>
      {children}
    </div>
  )
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand'

const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  brand: 'bg-forest-50 text-forest-800',
}

export function Badge({ tone = 'neutral', icon, children, className = '' }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ${BADGE[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  )
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode }

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
  size = 'md',
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex rounded-control bg-slate-100 p-1 ${className}`}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 font-medium transition-colors duration-150 ${size === 'sm' ? 'min-h-9 text-[14px]' : 'min-h-10 text-[15px]'} ${active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(20,32,27,0.12)]' : 'text-muted hover:text-ink'}`}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Screen header: title, optional subtitle, actions on the right. */
export function ScreenHeader({ title, subtitle, actions, leading }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-[14px] text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

/** Sticky bottom action bar that sits above the phone tab bar. */
export function ActionBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`sticky z-30 -mx-3 border-t border-line bg-surface/95 px-3 py-3 backdrop-blur bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] sm:-mx-4 sm:px-4 md:bottom-0 md:mx-0 md:rounded-card md:border ${className}`}
    >
      {children}
    </div>
  )
}
