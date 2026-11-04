'use client'

import { useEffect, type RefObject } from 'react'

/** Gap kept between the app bar (or the top of the visible area) and the entry fields. */
const TOP_GAP = 8

/**
 * Phone typing helper for the Stock In and Check Stock entry fields.
 *
 * When the item search or quantity field inside `entryRef` is focused on a phone,
 * the on-screen keyboard leaves only a small strip of page visible. This scrolls
 * the entry block up to just under the app bar, so the item, quantity and Add button
 * all sit above the keyboard, and sizes the search results to the space left
 * (`--stock-results-height`). The editor (the closest `.keypad-editor`) gets
 * `--keypad-inset`, a bottom spacer as tall as the keyboard, so even a short page
 * can scroll that far.
 */
export function useKeypadEntry(entryRef: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    const entry = entryRef.current
    if (!entry || !active) return
    const viewport = window.visualViewport
    const editor = entry.closest<HTMLElement>('.keypad-editor')
    let frame = 0

    const fit = () => {
      if (window.innerWidth >= 768) return
      const input = document.activeElement
      if (!(input instanceof HTMLInputElement) || !entry.contains(input)) return
      const visibleTop = viewport?.offsetTop ?? 0
      const visibleHeight = viewport?.height ?? window.innerHeight
      editor?.style.setProperty('--keypad-inset', `${Math.max(0, window.innerHeight - visibleHeight)}px`)

      const appBarBottom = document.querySelector('header.safe-top')?.getBoundingClientRect().bottom ?? 0
      const target = Math.max(visibleTop, appBarBottom) + TOP_GAP
      const offset = entry.getBoundingClientRect().top - target
      if (Math.abs(offset) > 2) window.scrollBy(0, offset)

      const visibleBottom = visibleTop + visibleHeight - TOP_GAP
      entry.style.setProperty(
        '--stock-results-height',
        `${Math.max(96, visibleBottom - input.getBoundingClientRect().bottom - 4)}px`,
      )
    }
    const scheduleFit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    }

    entry.addEventListener('focusin', scheduleFit)
    viewport?.addEventListener('resize', scheduleFit)
    window.addEventListener('resize', scheduleFit)
    return () => {
      cancelAnimationFrame(frame)
      entry.removeEventListener('focusin', scheduleFit)
      viewport?.removeEventListener('resize', scheduleFit)
      window.removeEventListener('resize', scheduleFit)
      editor?.style.removeProperty('--keypad-inset')
    }
  }, [entryRef, active])
}
