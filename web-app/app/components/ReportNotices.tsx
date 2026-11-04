'use client'

import { AlertTriangle, ChevronDown, Info } from 'lucide-react'

import { ReportSources, infoSummaryClass } from './ReportSources'
import type { ReportNotice, ReportSources as Sources } from './useDailyReportData'

function Marker({ symbol, warning }: { symbol?: string; warning?: boolean }) {
  if (warning) return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
  if (!symbol) return <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
  return (
    <span
      className="tabular inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-slate-100 px-1 text-[12px] font-semibold leading-none text-ink"
      aria-hidden="true"
    >
      {symbol}
    </span>
  )
}

/**
 * What sits between the report date and the sheet. Only blocking notices (why the sheet
 * is empty) stay open; warnings such as "sold below zero" fold into the Notes row with a
 * small amber mark. Notes and Sources share one light box, read as fine print.
 */
export function ReportInfo({ notices, sources, stockInNote, arrivedDates = [] }: {
  notices: ReportNotice[]
  sources: Sources | null
  stockInNote?: string
  arrivedDates?: string[]
}) {
  const blocking = notices.filter((notice) => notice.severity === 'blocking')
  // Warnings first: they are the ones to check.
  const notes = [
    ...notices.filter((notice) => notice.severity === 'warning'),
    ...notices.filter((notice) => notice.severity === 'note'),
  ]
  const toCheck = notes
    .filter((notice) => notice.severity === 'warning')
    .reduce((total, notice) => total + (notice.count ?? 1), 0)
  const otherNotes = notes.filter((notice) => notice.severity === 'note').length

  return (
    <>
      {blocking.map((notice) => (
        <p key={notice.id} role="status" className="flex items-start gap-2.5 rounded-control bg-warning-soft px-3.5 py-2.5 text-[14px] leading-5 text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice.text}</span>
        </p>
      ))}

      {notes.length > 0 || sources ? (
        <div className="divide-y divide-line/70 rounded-control border border-line/70">
          {notes.length > 0 ? (
            <details className="group">
              <summary className={infoSummaryClass}>
                <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {toCheck > 0 ? <span className="text-warning">{toCheck} {toCheck === 1 ? 'item' : 'items'} to check</span> : null}
                  {toCheck > 0 && otherNotes > 0 ? ' · ' : null}
                  {otherNotes > 0 ? (otherNotes === 1 ? '1 note' : `${otherNotes} notes`) : null}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="space-y-2 px-3 pb-3 pt-0.5 text-[13px] leading-5 text-ink">
                {notes.map((notice) => (
                  <li key={notice.id} className={`flex items-start gap-2 ${notice.severity === 'warning' ? 'text-warning' : ''}`}>
                    <Marker symbol={notice.marker} warning={notice.severity === 'warning'} />
                    <span>{notice.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <ReportSources sources={sources} stockInNote={stockInNote} arrivedDates={arrivedDates} />
        </div>
      ) : null}
    </>
  )
}
