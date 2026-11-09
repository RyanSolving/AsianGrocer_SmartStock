'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type PopoverProps = {
  /** The tapped element's box; the panel sits next to it. */
  anchor: { top: number; bottom: number; left: number; right: number }
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}

const MARGIN = 8
const WIDTH = 340
/** The bottom navigation bar covers this much of the screen. */
const NAV_SPACE = 84

/** A small panel next to the tapped element: below it, or above it when there is no room. */
export function Popover({ anchor, onClose, title, description, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [style, setStyle] = useState<{ top: number; left: number; width: number } | null>(null)

  // The panel sits in the page (not fixed to the screen), next to the tapped price: the keyboard
  // opening or a scroll can then never push it off screen, and the browser brings the focused
  // price box into view by itself.
  useLayoutEffect(() => {
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2)
    const height = panelRef.current?.offsetHeight ?? 300
    const scrollY = window.scrollY
    const visibleBottom = scrollY + window.innerHeight - NAV_SPACE
    const below = anchor.bottom + scrollY + 4
    const above = anchor.top + scrollY - height - 4
    // Below the price when it fits on screen; otherwise above it; otherwise below.
    const top = below + height <= visibleBottom ? below : above >= scrollY + MARGIN ? above : below
    const left = Math.min(Math.max(MARGIN, anchor.right - width), window.innerWidth - width - MARGIN)
    setStyle({ top, left, width })
  }, [anchor])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      panel?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })
      panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-forest-950/20" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Change price'}
        style={style ? { top: style.top, left: style.left, width: style.width } : { top: 0, left: 0, width: Math.min(WIDTH, 320), visibility: 'hidden' }}
        className="absolute z-[71] rounded-control border border-slate-200 bg-white p-3 shadow-xl"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{title}</p>
            {description ? <p className="text-[13px] text-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-muted hover:bg-slate-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
        <button type="button" onClick={onClose} className="mt-3 min-h-11 w-full rounded-control bg-forest px-4 text-[16px] font-semibold text-white">Done</button>
      </div>
    </>,
    document.body,
  )
}
