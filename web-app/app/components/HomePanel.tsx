'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronRight, ClipboardList, PackagePlus, ScanSearch } from 'lucide-react'

import { getLocalTodayDate } from '../../lib/date-utils'
import { rankProductsBySales, refillList } from '../../lib/report-aggregations'
import { formatQuantity } from '../../lib/report-insights'
import { addDays } from '../../lib/report-records'
import { useSectionChoice } from '../../lib/section-store'
import { useDailyReportData, type ReportCatalogItem } from './useDailyReportData'

export type HomeDestination = 'daily-report' | 'data-entry' | 'stock-check' | 'dashboard'

type HomePanelProps = {
  catalogItems: ReportCatalogItem[]
  /** `reportDate` opens the Daily Report on that date (the one shown on Home). */
  onNavigate: (section: HomeDestination, options?: { reportDate?: string }) => void
  /** Bump to refresh quietly (each time Home is opened). */
  refreshKey?: number
}

function toLocalDate(iso: string) {
  return new Date(`${iso}T00:00:00`)
}

function dayShort(iso: string) {
  return toLocalDate(iso).toLocaleDateString('en-AU', { weekday: 'short' })
}

function dayLong(iso: string) {
  return toLocalDate(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeOf(iso: string | null | undefined) {
  if (!iso) return null
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? null : value.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

function greeting(now: Date) {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function StatTile({ label, value, note, dot, onClick }: { label: string; value: string; note?: string; dot?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-[13px] text-muted">
        {dot ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" /> : null}
        {label}
      </p>
      <p className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink tabular" title={value}>{value}</p>
      {note ? <p className="mt-0.5 truncate text-[12px] text-muted" title={note}>{note}</p> : null}
    </>
  )
  const className = 'min-w-0 rounded-card border border-line bg-surface px-4 py-3.5 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} transition-colors duration-150 hover:bg-slate-50`}>{body}</button>
  ) : (
    <div className={className}>{body}</div>
  )
}

type Action = {
  id: HomeDestination
  title: string
  description: string
  icon: typeof ClipboardList
  status: { label: string; done?: boolean }
}

function ActionCard({ action, isNext, onOpen }: { action: Action; isNext: boolean; onOpen: () => void }) {
  const Icon = action.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full items-center gap-3.5 rounded-card border bg-surface px-4 py-3.5 text-left transition-[background-color,box-shadow] duration-150 hover:bg-slate-50 ${
        isNext ? 'border-forest shadow-[0_0_0_1px_theme(colors.forest.DEFAULT)]' : 'border-line'
      }`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control ${isNext ? 'bg-forest text-white' : 'bg-forest-50 text-forest'}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{action.title}</span>
          <span className={`flex shrink-0 items-center gap-1 text-[12px] font-medium ${action.status.done ? 'text-success' : isNext ? 'text-forest' : 'text-muted'}`}>
            {action.status.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {action.status.label}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span>{action.description}</span>
          {isNext ? <span className="rounded-full bg-forest-50 px-2 py-0.5 text-[11px] font-semibold text-forest">Up next</span> : null}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
  )
}

/**
 * Home: the latest report (units sold, stock in, top seller, flags) and what to do
 * next today (Daily Report, Stock In, Stock close), with the most useful step marked Up next.
 */
export function HomePanel(props: HomePanelProps) {
  // Dates and greeting come from the phone's clock and time zone, so Home renders in the
  // browser only (the server would format them differently and fail hydration).
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])
  if (!now) return <HomeSkeleton />
  return <HomeContent {...props} now={now} />
}

function HomeSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading home">
      <div className="space-y-2 pt-1">
        <div className="h-3.5 w-40 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
        <div className="h-8 w-56 animate-pulse rounded-[8px] bg-slate-200 motion-reduce:animate-none" />
      </div>
      <div className="h-64 animate-pulse rounded-card bg-forest/80 motion-reduce:animate-none" />
    </div>
  )
}

function HomeContent({ catalogItems, onNavigate, refreshKey = 0, now }: HomePanelProps & { now: Date }) {
  const today = useMemo(() => getLocalTodayDate(), [])
  const yesterday = useMemo(() => addDays(today, -1), [today])

  // The newest date with a full report (today's only exists after the 4 PM close).
  const [choice] = useSectionChoice()
  const report = useDailyReportData(`latest:${today}`, catalogItems, refreshKey, choice)
  const todayReport = useDailyReportData(today, catalogItems, refreshKey, choice)
  const reportDate = report.data?.date ?? null
  const reportLabel = reportDate === today ? 'Today' : reportDate === yesterday ? 'Yesterday' : 'Latest report'

  const products = useMemo(() => rankProductsBySales(report.entries), [report.entries])
  const topSeller = products[0] && products[0].sold > 0 ? products[0] : null
  const stockOuts = report.entries.filter((entry) => entry.insight.stockFlag === 'Stock-out').length
  const lowStock = report.entries.filter((entry) => entry.insight.stockFlag === 'Low stock').length
  const refillCount = useMemo(() => refillList(report.entries).length, [report.entries])

  const hasReport = Boolean(report.data?.closingFound)
  const unitsSold = hasReport && report.data?.prevClosingDate ? report.summary.totalSold : null

  const stockInToday = todayReport.sources?.stockIn ?? null
  const closingToday = todayReport.sources?.closing ?? null
  const afterFour = now.getHours() >= 16

  const actions: Action[] = [
    {
      id: 'daily-report',
      title: 'Daily Report',
      description: 'Closing, units sold and badges',
      icon: ClipboardList,
      status: hasReport && reportDate ? { label: `${dayShort(reportDate)} ready`, done: true } : { label: 'No closing' },
    },
    {
      id: 'data-entry',
      title: 'Stock in',
      description: "Count this morning's delivery",
      icon: PackagePlus,
      status: stockInToday ? { label: `Saved ${timeOf(stockInToday.savedAt) ?? ''}`.trim(), done: true } : { label: 'Not started' },
    },
    {
      id: 'stock-check',
      title: 'Stock close',
      description: "Count what's left at 4 PM",
      icon: ScanSearch,
      status: closingToday ? { label: `Saved ${timeOf(closingToday.savedAt) ?? ''}`.trim(), done: true } : { label: afterFour ? 'Due now' : 'Due 4 PM' },
    },
  ]
  // The morning delivery comes first, then the 4 PM count; with both done, read the report.
  const nextId: HomeDestination = !stockInToday ? 'data-entry' : !closingToday ? 'stock-check' : 'daily-report'

  const isLoadingHero = report.isLoading && !report.data

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <p className="text-[13px] text-muted">
          {now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">{greeting(now)}</h1>
      </header>

      {/* The latest report at a glance */}
      <section aria-labelledby="home-yesterday" className="overflow-hidden rounded-card bg-forest text-white shadow-panel">
        <div className="px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="home-yesterday" className="text-[13px] font-medium text-white/80">
              {reportDate ? `${reportLabel} · ${dayLong(reportDate)}` : 'Latest report'}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="inline-flex min-h-9 items-center gap-1 rounded-[8px] px-2 text-[13px] font-medium text-white/85 hover:bg-white/10 hover:text-white"
            >
              Dashboard <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {isLoadingHero ? (
            <div className="mt-3 space-y-2" aria-hidden="true">
              <div className="h-12 w-32 animate-pulse rounded-[8px] bg-white/15 motion-reduce:animate-none" />
              <div className="h-4 w-44 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
            </div>
          ) : unitsSold !== null ? (
            <>
              <p className="mt-2 flex items-end gap-2.5">
                <span className="text-[52px] font-semibold leading-none tracking-[-0.03em] tabular">{formatQuantity(unitsSold)}</span>
                <span className="pb-1.5 text-[15px] text-white/85">{report.soldPeriod ? 'units sold a day' : 'units sold'}</span>
              </p>
              {report.soldPeriod ? (
                <p className="mt-1.5 text-[13px] text-white/80">
                  {report.soldPeriod.short}, {report.soldPeriod.range} · {formatQuantity(report.summary.totalSoldAllDays)} in total
                </p>
              ) : null}
              {refillCount > 0 ? (
                <p className="mt-2.5 text-[13px] text-white/80">{refillCount} to refill today</p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-[15px] leading-6 text-white/90">
              {hasReport
                ? 'Units sold needs an earlier closing to compare with.'
                : 'No report yet. It appears after two days of Stock Close.'}
            </p>
          )}
        </div>

      </section>

      {hasReport ? (
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="Stock in" value={`${formatQuantity(report.summary.totalStockIn)}`} note={report.soldPeriod ? `units in ${report.soldPeriod.days} days` : 'units arrived'} />
          <StatTile
            label="Top seller"
            value={topSeller ? topSeller.name : '—'}
            note={topSeller ? `${formatQuantity(topSeller.sold)} units${report.soldPeriod ? ' a day' : ''} · ${Math.round(topSeller.share * 100)}% of sales` : 'No sales recorded'}
          />
          <StatTile label="Stock-out" value={String(stockOuts)} note="items at 0" dot="#B53C2B" onClick={() => onNavigate('daily-report', reportDate ? { reportDate } : undefined)} />
          <StatTile label="Low stock" value={String(lowStock)} note="under 3 days left" dot="#A8561F" onClick={() => onNavigate('daily-report', reportDate ? { reportDate } : undefined)} />
        </div>
      ) : null}

      {/* Next actions */}
      <section aria-labelledby="home-next" className="space-y-2.5">
        <h2 id="home-next" className="px-1 text-[15px] font-semibold text-ink">Today</h2>
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            isNext={action.id === nextId}
            onOpen={() => onNavigate(action.id, action.id === 'daily-report' && reportDate ? { reportDate } : undefined)}
          />
        ))}
      </section>
    </div>
  )
}
