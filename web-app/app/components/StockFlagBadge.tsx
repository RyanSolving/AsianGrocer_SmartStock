import type { StockFlag } from '../../lib/report-insights'

/**
 * Flag colours (BUSINESS_RULES.md). The three action flags are solid fills of matching
 * darkness with white text: brick 5.8:1, orange 5.2:1, violet 9.5:1.
 */
const colors: Record<StockFlag, string> = {
  'Stock-out': 'bg-[#B53C2B] text-white',
  'Low stock': 'bg-[#A8561F] text-white',
  'Over-stock': 'bg-[#3E2BB5] text-white',
  'No sell today': 'text-warning',
}

/** `edited`: chosen by hand on the Daily Report; a small mark after the badge says so on screen. */
export function StockFlagBadge({ flag, count, edited = false }: { flag: StockFlag; count?: number; edited?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`report-tag inline-block whitespace-nowrap ${colors[flag]}`}>{flag}{count !== undefined && ` · ${count}`}</span>
      {edited ? <EditedMark /> : null}
    </span>
  )
}

/** Marks a badge that staff set or removed by hand. */
export function EditedMark() {
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label="Changed by hand" className="h-3 w-3 shrink-0 text-muted">
      <title>Changed by hand</title>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
