'use client'

import { AlertTriangle, ChevronDown, Info } from 'lucide-react'

import type { ReportNotice } from './useDailyReportData'

function Marker({ symbol }: { symbol?: string }) {
  if (!symbol) return <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
  return (
    <span
      className="tabular inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[6px] bg-slate-100 px-1 text-[13px] font-semibold leading-none text-ink"
      aria-hidden="true"
    >
      {symbol}
    </span>
  )
}

/**
 * Data notices for the Daily Report and Dashboard. Blocking notices (why figures are
 * missing) stay visible; per-cell notes fold into one tappable row so the sheet stays
 * on the first screen.
 */
export function ReportNotices({ notices }: { notices: ReportNotice[] }) {
  if (notices.length === 0) return null
  const blocking = notices.filter((notice) => notice.severity === 'blocking')
  const notes = notices.filter((notice) => notice.severity === 'note')
  const markers = notes.filter((notice) => notice.marker && notice.count)

  return (
    <div className="space-y-2">
      {blocking.map((notice) => (
        <p key={notice.id} role="status" className="flex items-start gap-2.5 rounded-control bg-warning-soft px-3.5 py-2.5 text-[14px] leading-5 text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice.text}</span>
        </p>
      ))}

      {notes.length > 0 ? (
        <details className="group rounded-control border border-line bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 text-[14px] text-ink [&::-webkit-details-marker]:hidden">
            <Info className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="flex-1 truncate">
              {notes.length === 1 ? '1 note on these figures' : `${notes.length} notes on these figures`}
            </span>
            {markers.length > 0 ? (
              <span className="flex shrink-0 items-center gap-1.5 group-open:hidden">
                {markers.map((notice) => (
                  <span key={notice.id} className="inline-flex items-center gap-1 text-[13px] text-muted">
                    <Marker symbol={notice.marker} />
                    <span className="tabular">{notice.count}</span>
                  </span>
                ))}
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="space-y-2 border-t border-line px-3.5 py-3 text-[14px] leading-5 text-ink">
            {notes.map((notice) => (
              <li key={notice.id} className="flex items-start gap-2.5">
                <Marker symbol={notice.marker} />
                <span>{notice.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
