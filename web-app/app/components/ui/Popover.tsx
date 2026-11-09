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

/** A small panel next to the tapped element: below it, or above it when there is no room. */
export function Popover({ anchor, onClose, title, description, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [style, setStyle] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2)
    const height = panelRef.current?.offsetHeight ?? 260
    const spaceBelow = window.innerHeight - anchor.bottom - MARGIN
    const spaceAbove = anchor.top - MARGIN
    const below = spaceBelow >= height || spaceBelow >= spaceAbove
    const maxHeight = Math.max(160, below ? spaceBelow : spaceAbove)
    const shown = Math.min(height, maxHeight)
    const top = below ? anchor.bottom + 4 : Math.max(MARGIN, anchor.top - shown - 4)
    const left = Math.min(Math.max(MARGIN, anchor.right - width), window.innerWidth - width - MARGIN)
    setStyle({ top, left, width, maxHeight })
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
      panelRef.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-forest-950/20" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Change price'}
        style={style ? { top: style.top, left: style.left, width: style.width, maxHeight: style.maxHeight } : { top: 0, left: 0, width: Math.min(WIDTH, 320), visibility: 'hidden' }}
        className="absolute overflow-y-auto rounded-control border border-slate-200 bg-white p-3 shadow-xl"
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
    </div>,
    document.body,
  )
}
