'use client'

import type { ReactNode } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'

export type HistoryRow = { name: string; quantity: number; special?: boolean; note?: string }
export type HistoryGroup = { title: string; rows: HistoryRow[] }

/** "Sun 8 Nov 2026" */
export function formatDayHeading(date: Date) {
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

/** Newest first, split into one section per calendar day of the timestamp. */
export function groupByDay<T>(entries: T[], getTimestamp: (entry: T) => string): Array<{ key: string; heading: string; entries: T[] }> {
  const sorted = [...entries].sort((a, b) => new Date(getTimestamp(b)).getTime() - new Date(getTimestamp(a)).getTime())
  const days: Array<{ key: string; heading: string; entries: T[] }> = []
  for (const entry of sorted) {
    const date = new Date(getTimestamp(entry))
    const key = Number.isNaN(date.getTime()) ? 'unknown' : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const last = days[days.length - 1]
    if (last && last.key === key) {
      last.entries.push(entry)
    } else {
      days.push({ key, heading: Number.isNaN(date.getTime()) ? 'Unknown date' : formatDayHeading(date), entries: [entry] })
    }
  }
  return days
}

/** Items counted, grouped by area, sorted by name; blank counts are left out. */
export function buildGroups(rows: Array<HistoryRow & { area: string }>): HistoryGroup[] {
  const map = new Map<string, HistoryRow[]>()
  for (const { area, ...row } of rows) {
    const list = map.get(area)
    if (list) list.push(row)
    else map.set(area, [row])
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map(([title, list]) => ({ title, rows: list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })) }))
}

export function HistoryDay({ heading, count, children }: { heading: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline justify-between px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">
        <span>{heading}</span>
        <span className="font-normal normal-case tracking-normal tabular">{count} {count === 1 ? 'record' : 'records'}</span>
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

type HistoryCardProps = {
  title: string
  subtitle: string
  badge?: { label: string; tone: 'success' | 'warning' | 'neutral' }
  summary: string
  groups: HistoryGroup[]
  expanded: boolean
  onToggle: () => void
  onLoadToEdit: () => void
  onDelete: () => void
  isDeleting: boolean
  deleteDisabled: boolean
  extraActions?: ReactNode
}

const BADGE_TONE = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-slate-200 text-slate-700',
} as const

export function HistoryCard({
  title, subtitle, badge, summary, groups, expanded, onToggle, onLoadToEdit, onDelete, isDeleting, deleteDisabled, extraActions,
}: HistoryCardProps) {
  return (
    <article className="rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 rounded-card p-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-ink">{title}</span>
            {badge ? <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${BADGE_TONE[badge.tone]}`}>{badge.label}</span> : null}
          </span>
          <span className="mt-0.5 block text-[13px] text-muted">{subtitle}</span>
          <span className="mt-1.5 block text-[14px] text-ink">{summary}</span>
        </span>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-muted transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {expanded ? (
        <div className="border-t border-line px-4 pb-4 pt-3">
          {groups.length === 0 ? (
            <p className="py-2 text-[14px] text-muted">Nothing was counted in this record.</p>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.title} className="overflow-hidden rounded-control border border-line">
                  <p className="bg-slate-50 px-3 py-2 text-[13px] font-semibold text-ink">{group.title}</p>
                  <ul className="divide-y divide-line">
                    {group.rows.map((row, index) => (
                      <li key={`${row.name}-${index}`} className="flex items-start gap-3 px-3 py-2 text-[14px]">
                        <span className="min-w-0 flex-1">
                          <span className="text-ink">{row.name}</span>
                          {row.special ? <span className="report-tag report-tag-special ml-1.5 align-[1px]">Special</span> : null}
                          {row.note ? <span className="block text-[13px] italic text-muted">{row.note}</span> : null}
                        </span>
                        <span className="shrink-0 font-semibold tabular text-ink">{row.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={onLoadToEdit}
          className="inline-flex min-h-11 items-center justify-center rounded-control bg-forest px-4 text-[15px] font-semibold text-white transition-colors hover:bg-forest-700"
        >
          Load to edit
        </button>
        {extraActions}
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          className="ml-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-3 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {isDeleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </article>
  )
}
