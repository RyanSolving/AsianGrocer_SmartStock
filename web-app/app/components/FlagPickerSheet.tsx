'use client'

import { Check } from 'lucide-react'

import { describeAutoFlag, formatQuantity, stockFlags, type ItemInsight, type StockFlag } from '../../lib/report-insights'
import { StockFlagBadge } from './StockFlagBadge'
import { Sheet } from './ui/Sheet'
import type { FlagChoice } from './useDailyReportData'

type FlagPickerSheetProps = {
  open: boolean
  onClose: () => void
  itemName: string
  insight: ItemInsight | null
  onChoose: (choice: FlagChoice) => void
  /** The override table is not set up yet: show the reason, keep the choices read-only. */
  unavailable?: boolean
}

/**
 * Change one item's badge: keep the calculated one (Automatic), pick another, or remove it.
 * One tap applies and closes, so fixing a badge costs two taps.
 */
export function FlagPickerSheet({ open, onClose, itemName, insight, onChoose, unavailable = false }: FlagPickerSheetProps) {
  if (!insight) return null

  const isManual = insight.flagSource === 'manual'
  const autoFlag = insight.autoStockFlag !== undefined ? insight.autoStockFlag : insight.stockFlag
  const hasSold = insight.status === 'ok' || insight.status === 'negative'
  const multiDay = hasSold && insight.days > 1
  // Over several days: "6 a day (12 over 2 days)".
  const sold = !hasSold
    ? '–'
    : multiDay
      ? `${formatQuantity(insight.sold).replace('-', '−')} a day (${formatQuantity(insight.soldTotal).replace('-', '−')} over ${insight.days} days)`
      : formatQuantity(insight.sold).replace('-', '−')

  const option = (key: string, selected: boolean, onSelect: () => void, label: React.ReactNode, hint?: string) => (
    <li key={key}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={unavailable}
        onClick={onSelect}
        className={`flex min-h-12 w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'bg-forest-50' : 'enabled:hover:bg-slate-50'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-[15px] text-ink">{label}</span>
          {hint ? <span className="mt-0.5 block text-[13px] text-muted">{hint}</span> : null}
        </span>
        <Check className={`h-5 w-5 shrink-0 text-forest ${selected ? '' : 'invisible'}`} aria-hidden="true" />
      </button>
    </li>
  )

  const choose = (choice: FlagChoice) => {
    onChoose(choice)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={itemName}
      description={insight.arrivedSince
        ? `Closing ${formatQuantity(insight.closing) || '–'} + ${formatQuantity(insight.arrivedSince)} in = ${formatQuantity(insight.current)} now · Sold ${sold}`
        : `Closing ${formatQuantity(insight.closing) || '–'} · Sold ${sold}`}
      size="sm"
    >
      {unavailable ? (
        <p role="status" className="mb-3 rounded-control bg-warning-soft px-3 py-2.5 text-[14px] leading-5 text-warning">
          Changing badges needs a one-time database update: run the Supabase migration
          {' '}<span className="font-medium">20261104_report_flag_overrides.sql</span>.
        </p>
      ) : null}
      <ul role="radiogroup" aria-label={`Badge for ${itemName}`} className="-mx-1 space-y-0.5">
        {option(
          'auto',
          !isManual,
          () => choose('auto'),
          <>
            <span className="font-medium">Automatic</span>
            {autoFlag ? <StockFlagBadge flag={autoFlag} /> : <span className="text-[13px] text-muted">No badge</span>}
          </>,
          describeAutoFlag(insight),
        )}
        <li aria-hidden="true" className="mx-3 my-1 border-t border-line" />
        {stockFlags.map((flag: StockFlag) => option(
          flag,
          isManual && insight.stockFlag === flag,
          () => choose(flag),
          <StockFlagBadge flag={flag} />,
        ))}
        {option(
          'none',
          isManual && insight.stockFlag === null,
          () => choose(null),
          <span className="font-medium">No badge</span>,
          'Hide the badge for this item on this date.',
        )}
      </ul>
    </Sheet>
  )
}
