'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, ClipboardList, PackagePlus, ScanSearch } from 'lucide-react'

import { getLocalTodayDate } from '../../lib/date-utils'
import { rankProductsBySales, refillList } from '../../lib/report-aggregations'
import { formatQuantity } from '../../lib/report-insights'
import { addDays, type TrendDay } from '../../lib/report-records'
import { useDailyReportData, type ReportCatalogItem } from './useDailyReportData'

export type HomeDestination = 'daily-report' | 'data-entry' | 'stock-check' | 'dashboard'

type HomePanelProps = {
  catalogItems: ReportCatalogItem[]
  /** `reportDate` opens the Daily Report on that date (Home always means yesterday's). */
  onNavigate: (section: HomeDestination, options?: { reportDate?: string }) => void
  /** Bump to refresh quietly (each time Home is opened). */
  refreshKey?: number
}

const TREND_DAYS = 7
const trendCache = new Map<string, TrendDay[]>()

function useSalesTrend(end: string, refreshKey: number) {
  const [days, setDays] = useState<TrendDay[] | null>(() => trendCache.get(end) ?? null)
  const latest = useRef(end)

  useEffect(() => {
    latest.current = end
    let cancelled = false
    fetch(`/api/daily-report/trend?end=${encodeURIComponent(end)}&days=${TREND_DAYS}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || latest.current !== end || !Array.isArray(payload?.days)) return
        trendCache.set(end, payload.days)
        setDays(payload.days)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [end, refreshKey])

  return days
}

function toLocalDate(iso: string) {
  return new Date(`${iso}T00:00:00`)
}

function dayShort(iso: string) {
  return toLocalDate(iso).toLocaleDateString(undefined, { weekday: 'short' })
}

function dayLong(iso: string) {
  return toLocalDate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeOf(iso: string | null | undefined) {
  if (!iso) return null
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? null : value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function greeting(now: Date) {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Seven days of units sold, yesterday highlighted. One series on its own baseline; only the
 * selected day carries its number. Tap a day to read it.
 */
function TrendBars({ days, selected, onSelect }: { days: TrendDay[]; selected: number; onSelect: (index: number) => void }) {
  const max = Math.max(1, ...days.map((day) => day.unitsSold ?? 0))
  return (
    <div className="grid grid-cols-7 items-end gap-2" role="group" aria-label="Units sold, last 7 days">
      {days.map((day, index) => {
        const value = day.unitsSold
        const isSelected = index === selected
        const isYesterday = index === days.length - 1
        const height = value === null ? 0 : Math.max(4, Math.round((value / max) * 84))
        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={isSelected}
            aria-label={`${dayLong(day.date)}: ${value === null ? 'no figure' : `${formatQuantity(value)} units sold`}`}
            className="group flex min-w-0 flex-col items-center gap-1.5 rounded-[8px] pt-1 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {/* The number sits on top of its own bar; only the selected day shows one. */}
            <span className="flex h-[104px] w-full flex-col items-center justify-end gap-1">
              <span className={`tabular text-[12px] font-semibold leading-none ${isSelected ? 'text-white' : 'invisible'}`}>
                {value === null ? '–' : formatQuantity(value)}
              </span>
              {value === null ? (
                <span className="h-[2px] w-full max-w-[22px] rounded-full bg-white/25" aria-hidden="true" />
              ) : (
                <span
                  className={`w-full max-w-[22px] rounded-t-[4px] transition-colors duration-150 ${isSelected || isYesterday ? 'bg-white' : 'bg-white/30 group-hover:bg-white/50'}`}
                  style={{ height }}
                  aria-hidden="true"
                />
              )}
            </span>
            <span className={`text-[11px] leading-none ${isSelected ? 'font-semibold text-white' : 'text-white/70'}`}>
              {isYesterday ? 'Yday' : dayShort(day.date)}
            </span>
          </button>
        )
      })}
    </div>
  )
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
 * Home: how yesterday went (units sold, 7-day trend, stock in, top seller, flags) and what to do
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

  const report = useDailyReportData(yesterday, catalogItems, refreshKey)
  const todayReport = useDailyReportData(today, catalogItems, refreshKey)
  const trend = useSalesTrend(yesterday, refreshKey)
  const [selectedDay, setSelectedDay] = useState(TREND_DAYS - 1)

  const products = useMemo(() => rankProductsBySales(report.entries), [report.entries])
  const topSeller = products[0] && products[0].sold > 0 ? products[0] : null
  const stockOuts = report.entries.filter((entry) => entry.insight.stockFlag === 'Stock-out').length
  const lowStock = report.entries.filter((entry) => entry.insight.stockFlag === 'Low stock').length
  const refillCount = useMemo(() => refillList(report.entries).length, [report.entries])

  const hasYesterday = Boolean(report.data?.closingFound)
  const unitsSold = hasYesterday && report.data?.prevClosingDate ? report.summary.totalSold : null
  const dayBefore = trend && trend.length >= 2 ? trend[trend.length - 2] : null
  const delta = unitsSold !== null && dayBefore?.unitsSold ? (unitsSold - dayBefore.unitsSold) / dayBefore.unitsSold : null
  const trendValues = (trend ?? []).map((day) => day.unitsSold).filter((value): value is number => value !== null)
  const average = trendValues.length > 0 ? Math.round(trendValues.reduce((sum, value) => sum + value, 0) / trendValues.length) : null

  const stockInToday = todayReport.sources?.stockIn ?? null
  const closingToday = todayReport.sources?.closing ?? null
  const afterFour = now.getHours() >= 16

  const actions: Action[] = [
    {
      id: 'daily-report',
      title: 'Daily Report',
      description: "Yesterday's closing, units sold and badges",
      icon: ClipboardList,
      status: hasYesterday ? { label: `${dayShort(yesterday)} ready`, done: true } : { label: 'No closing' },
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
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">{greeting(now)}</h1>
      </header>

      {/* Yesterday at a glance */}
      <section aria-labelledby="home-yesterday" className="overflow-hidden rounded-card bg-forest text-white shadow-panel">
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="home-yesterday" className="text-[13px] font-medium text-white/80">Yesterday · {dayLong(yesterday)}</h2>
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
                <span className="pb-1.5 text-[15px] text-white/85">units sold</span>
              </p>
              <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-white/80">
                {delta !== null && dayBefore ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 font-semibold text-white">
                      {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}
                      {Math.abs(Math.round(delta * 100))}%
                    </span>
                    <span>vs {dayLong(dayBefore.date)}</span>
                  </>
                ) : null}
                {refillCount > 0 ? <span>{delta !== null ? '· ' : ''}{refillCount} to refill today</span> : null}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[15px] leading-6 text-white/90">
              {hasYesterday
                ? 'Units sold needs an earlier closing to compare with.'
                : `No closing was saved for ${dayLong(yesterday)}.`}
            </p>
          )}
        </div>

        {trend && trend.length > 0 ? (
          <div className="mt-4 border-t border-white/10 px-4 pb-4 pt-3">
            <TrendBars days={trend} selected={selectedDay} onSelect={setSelectedDay} />
            {average !== null ? (
              <p className="mt-3 text-center text-[12px] text-white/70">
                7-day average <span className="font-semibold text-white tabular">{formatQuantity(average)}</span> units a day
              </p>
            ) : null}
          </div>
        ) : (
          <div className="h-5" />
        )}
      </section>

      {hasYesterday ? (
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="Stock in" value={`${formatQuantity(report.summary.totalStockIn)}`} note="units arrived" />
          <StatTile
            label="Top seller"
            value={topSeller ? topSeller.name : '—'}
            note={topSeller ? `${formatQuantity(topSeller.sold)} units · ${Math.round(topSeller.share * 100)}% of sales` : 'No sales recorded'}
          />
          <StatTile label="Stock-out" value={String(stockOuts)} note="items at 0" dot="#B53C2B" onClick={() => onNavigate('daily-report', { reportDate: yesterday })} />
          <StatTile label="Low stock" value={String(lowStock)} note="under 3 days left" dot="#A8561F" onClick={() => onNavigate('daily-report', { reportDate: yesterday })} />
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
            onOpen={() => onNavigate(action.id, action.id === 'daily-report' ? { reportDate: yesterday } : undefined)}
          />
        ))}
      </section>
    </div>
  )
}
