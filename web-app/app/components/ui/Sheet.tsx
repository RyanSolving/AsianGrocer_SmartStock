'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type SheetProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Sticky action row at the bottom of the sheet. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Element to focus first; defaults to the first focusable element in the body. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Prevents closing on backdrop tap / Esc (for in-flight actions). */
  dismissible?: boolean
}

const WIDTH = { sm: 'md:max-w-md', md: 'md:max-w-xl', lg: 'md:max-w-3xl' }

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Bottom sheet on phones, centred dialog from md up.
 * Focus is trapped inside, Esc and a backdrop tap close it, and focus returns on close.
 */
export function Sheet({ open, onClose, title, description, children, footer, size = 'md', initialFocusRef, dismissible = true }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const focusFirst = () => {
      const panel = panelRef.current
      if (!panel) return
      const target = initialFocusRef?.current ?? panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel
      target.focus({ preventScroll: true })
    }
    const frame = requestAnimationFrame(focusFirst)

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [open, dismissible, initialFocusRef])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-forest-950/45"
        aria-hidden="true"
        onClick={() => {
          if (dismissible) onClose()
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full animate-sheet-in flex-col rounded-t-card bg-surface shadow-raised outline-none md:rounded-card ${WIDTH[size]}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 md:hidden" aria-hidden="true" />
        <div className="flex items-start gap-3 px-5 pb-3 pt-3 md:pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[18px] font-semibold leading-snug text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-[14px] text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-slate-100"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div> : null}
        {footer ? (
          <div className="safe-bottom border-t border-line px-5 pt-3">
            <div className="flex flex-col-reverse gap-2 pb-3 sm:flex-row sm:justify-end">{footer}</div>
          </div>
        ) : (
          <div className="safe-bottom" />
        )}
      </div>
    </div>,
    document.body,
  )
}
