'use client'

import { ChevronDown, Database } from 'lucide-react'

import { formatSheetDate } from '../../lib/stock-paper-utils'
import { formatDayLabel } from '../../lib/date-utils'
import type { ReportSource, ReportSources as Sources } from './useDailyReportData'

function formatSavedAt(iso: string | null | undefined, style: 'time' | 'full' = 'full') {
  if (!iso) return null
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return null
  return style === 'time'
    ? value.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : value.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** Shared look for the quiet fold-out rows under the report date (Notes, Sources). */
export const infoSummaryClass =
  'flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-[13px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden'

function SourceRow({ label, source, missing, extra }: { label: string; source: ReportSource | null; missing: string; extra?: string }) {
  const savedAt = formatSavedAt(source?.savedAt)
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${source ? 'bg-forest' : 'bg-slate-300'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px] text-ink">
          <span className="font-medium">{label}</span>
          <span className="tabular text-[13px] text-muted">{source ? formatSheetDate(source.date) : '—'}</span>
        </p>
        {source ? (
          <p className="text-[12px] text-muted">
            {savedAt ? `Saved ${savedAt}` : 'Saved time unknown'}
            {extra ? ` · ${extra}` : ''}
            {source.name ? <span className="block truncate text-[11px] text-muted/80" title={source.name}>{source.name}</span> : null}
          </p>
        ) : (
          <p className="text-[12px] text-muted">{missing}</p>
        )}
      </div>
    </li>
  )
}

/**
 * The saved records behind the report: the closing, the previous closing and the stock in
 * (plus any stock in since, counted in current stock). One quiet row; tap for details.
 */
export function ReportSources({ sources, stockInNote, arrivedDates = [] }: { sources: Sources | null; stockInNote?: string; arrivedDates?: string[] }) {
  if (!sources) return null
  const closingTime = formatSavedAt(sources.closing?.savedAt, 'time')
  const stockInTime = formatSavedAt(sources.stockIn?.savedAt, 'time')
  const summary = [
    sources.closing ? `Closing ${closingTime ?? ''}`.trim() : 'No closing',
    arrivedDates.length > 0
      ? `+ ${arrivedDates.length === 1 ? formatDayLabel(arrivedDates[0]).split(',')[0] : `${arrivedDates.length} days`} stock in`
      : sources.stockIn ? `Stock in ${stockInTime ?? ''}`.trim() : 'No stock in',
  ].join(' · ')

  return (
    <details className="group">
      <summary className={infoSummaryClass}>
        <Database className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="shrink-0">Sources</span>
        <span className="min-w-0 flex-1 truncate text-right text-[12px] tabular">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="space-y-2 px-3 pb-3 pt-0.5">
        <SourceRow label="Closing" source={sources.closing} missing="No closing saved for this date." />
        <SourceRow label="Previous closing" source={sources.previousClosing} missing="No earlier closing, so units sold is unknown." />
        <SourceRow label="Stock in" source={sources.stockIn} missing="No stock in for this date." extra={stockInNote} />
        {arrivedDates.length > 0 ? (
          <li className="flex items-start gap-2.5">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-forest" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">Stock in since</p>
              <p className="text-[12px] text-muted">
                {arrivedDates.map((day) => formatDayLabel(day)).join(', ')} · added to current stock
              </p>
            </div>
          </li>
        ) : null}
      </ul>
    </details>
  )
}
