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

export function StockFlagBadge({ flag, count }: { flag: StockFlag; count?: number }) {
  return <span className={`report-tag inline-block whitespace-nowrap ${colors[flag]}`}>{flag}{count !== undefined && ` · ${count}`}</span>
}
