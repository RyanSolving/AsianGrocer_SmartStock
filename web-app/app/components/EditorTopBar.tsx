'use client'

import { ChevronLeft } from 'lucide-react'
import { inputClass } from './ui/Input'

/**
 * One short row at the top of the Stock In and Check Stock editors: back to the menu
 * on the left, the stock date on the right. On a phone the big page title is hidden
 * (the app bar already names the section) so the item and quantity fields start
 * near the top of the screen; it stays visible when it carries extra meaning
 * (e.g. "Edit closing count").
 */
export function EditorTopBar({
  title,
  showTitleOnPhone = false,
  onBack,
  dateId,
  dateValue,
  onDateChange,
  dateDisabled = false,
}: {
  title: string
  showTitleOnPhone?: boolean
  onBack: () => void
  dateId: string
  dateValue: string
  onDateChange: (value: string) => void
  dateDisabled?: boolean
}) {
  return (
    <header className="mb-3 border-b border-line pb-2 md:mb-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-control px-2 text-[15px] font-medium text-muted hover:bg-slate-100 hover:text-ink"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          Menu
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={dateId} className="whitespace-nowrap text-[13px] font-medium text-muted">Date</label>
          <input
            id={dateId}
            type="date"
            value={dateValue}
            onChange={(event) => onDateChange(event.target.value)}
            disabled={dateDisabled}
            className={`${inputClass} w-auto max-w-[11rem] tabular`}
          />
        </div>
      </div>
      <h1
        className={
          showTitleOnPhone
            ? 'mt-1 text-lg font-semibold leading-tight text-ink md:text-2xl'
            : 'sr-only md:not-sr-only md:mt-1 md:block md:text-2xl md:font-semibold md:leading-tight md:text-ink'
        }
      >
        {title}
      </h1>
    </header>
  )
}
