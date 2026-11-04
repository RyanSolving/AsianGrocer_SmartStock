'use client'

import { ChevronDown, Database } from 'lucide-react'

import { formatSheetDate } from '../../lib/stock-paper-utils'
import type { ReportSource, ReportSources as Sources } from './useDailyReportData'

function formatSavedAt(iso: string | null | undefined, style: 'time' | 'full' = 'full') {
  if (!iso) return null
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return null
  return style === 'time'
    ? value.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : value.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function SourceRow({ label, source, missing, extra }: { label: string; source: ReportSource | null; missing: string; extra?: string }) {
  const savedAt = formatSavedAt(source?.savedAt)
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${source ? 'bg-forest' : 'bg-slate-300'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[14px] text-ink">
          <span className="font-medium">{label}</span>
          <span className="tabular text-[13px] text-muted">{source ? formatSheetDate(source.date) : '—'}</span>
        </p>
        {source ? (
          <p className="text-[13px] text-muted">
            {savedAt ? `Saved ${savedAt}` : 'Saved time unknown'}
            {extra ? ` · ${extra}` : ''}
            {source.name ? <span className="block truncate text-[12px] text-muted/80" title={source.name}>{source.name}</span> : null}
          </p>
        ) : (
          <p className="text-[13px] text-muted">{missing}</p>
        )}
      </div>
    </li>
  )
}

/**
 * The saved records behind the report: today's closing, the previous closing and the stock-in.
 * Folded into one row with the save times; tap to see each record's name and date.
 */
export function ReportSources({ sources, stockInRecordCount }: { sources: Sources | null; stockInRecordCount: number }) {
  if (!sources) return null
  const closingTime = formatSavedAt(sources.closing?.savedAt, 'time')
  const stockInTime = formatSavedAt(sources.stockIn?.savedAt, 'time')
  const summary = [
    sources.closing ? `Closing ${closingTime ?? ''}`.trim() : 'No closing',
    sources.stockIn ? `Stock in ${stockInTime ?? ''}`.trim() : 'No stock in',
  ].join(' · ')

  return (
    <details className="group rounded-control border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 text-[14px] text-ink [&::-webkit-details-marker]:hidden">
        <Database className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="shrink-0">Sources</span>
        <span className="min-w-0 flex-1 truncate text-right text-[13px] tabular text-muted">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="space-y-2.5 border-t border-line px-3.5 py-3">
        <SourceRow label="Closing" source={sources.closing} missing="No closing saved for this date." />
        <SourceRow label="Previous closing" source={sources.previousClosing} missing="No earlier closing, so units sold is unknown." />
        <SourceRow
          label="Stock in"
          source={sources.stockIn}
          missing="No stock in for this date."
          extra={stockInRecordCount > 1 ? `latest of ${stockInRecordCount}` : undefined}
        />
      </ul>
    </details>
  )
}
