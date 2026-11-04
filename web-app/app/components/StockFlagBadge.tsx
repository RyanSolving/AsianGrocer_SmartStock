import type { StockFlag } from '../../lib/report-insights'

const colors: Record<StockFlag, string> = {
  'Stock-out': 'bg-danger text-white',
  'Low stock': 'bg-[#F5C58B] text-[#67360F]',
  'Over-stock': 'bg-[#EFECF8] text-[#574983]',
  'No sell today': 'text-warning',
}

export function StockFlagBadge({ flag, count }: { flag: StockFlag; count?: number }) {
  return <span className={`report-tag inline-block whitespace-nowrap ${colors[flag]}`}>{flag}{count !== undefined && ` · ${count}`}</span>
}
