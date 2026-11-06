'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReportEntry } from '../../lib/report-aggregations'
import { applyFlagOverrides, computeItemInsights, formatQuantity, summarizeInsights, type StockFlag } from '../../lib/report-insights'
import { friendlyError, toast } from '../../lib/toast-store'
import type { IndexedPaperRow, PaperRow } from '../../lib/stock-paper-layout'
import { addDays, daysBetween, describeStockInRecords } from '../../lib/report-records'
import { formatDayLabel, getLocalTodayDate } from '../../lib/date-utils'

/**
 * Loads one day's report data (closing, previous closing, stock-in) and derives the
 * per-item insights. Shared by the Dashboard summary and the Daily Report detail sheet.
 */

export type ReportNotice = {
  id: string
  /** Blocking notices explain why figures are missing; warnings ask staff to check counts; notes explain individual cells. */
  severity: 'blocking' | 'warning' | 'note'
  text: string
  /** The symbol shown in the sheet for affected items, if any. */
  marker?: string
  count?: number
}

export type ReportCatalogItem = {
  code: string
  location: string
  sub_location: string
  category: string
  product: string
  official_name: string
  stocklist_name: string
  row_position?: 'left' | 'right' | 'single'
  is_visible?: boolean
}

/** A saved record the report figures come from. */
export type ReportSource = {
  name: string | null
  /** The stock date of the record. */
  date: string
  /** When the record was first saved (closing) or logged (stock in). */
  savedAt: string | null
  uid?: string | null
}

export type ReportSources = {
  closing: ReportSource | null
  previousClosing: ReportSource | null
  stockIn: ReportSource | null
}

/** 'auto' clears the override; null removes the badge; a flag replaces the calculated one. */
export type FlagChoice = StockFlag | null | 'auto'

export type DailyReportResponse = {
  date: string
  closingFound: boolean
  closingByCode: Record<string, number>
  redMarkedByCode: Record<string, boolean>
  prevClosingDate: string | null
  prevClosingByCode: Record<string, number>
  stockInRecordCount: number
  /** Stock In records saved as extra deliveries, added to the main one. */
  stockInExtraCount?: number
  /** Earlier main Stock In saves for the date, replaced by the latest. */
  stockInReplacedCount?: number
  stockInByCode: Record<string, number>
  /** Stock dates of the Stock In records counted (after the previous closing, up to date). */
  stockInDates?: string[]
  /** Days units sold covers (from the previous closing). */
  soldDays?: number
  /** True when no later closing has been saved up to today (null for older servers). */
  isLatestClosing?: boolean | null
  /** Stock in saved after this closing date, up to today, while no later closing exists. */
  arrivedSinceByCode?: Record<string, number>
  arrivedSinceDates?: string[]
  sources?: ReportSources
  flagOverrides?: Record<string, { flag: string | null; updatedAt?: string }>
  /** False until the flag-override migration has been applied. */
  overridesAvailable?: boolean
}

export type ReportRow = PaperRow & {
  code: string
  closing: number
  /** Closing plus stock in that arrived after it. */
  current: number
  redMarked: boolean
  /** Not on the closing; arrived after it. */
  isNew?: boolean
}

export type IndexedReportRow = IndexedPaperRow<ReportRow>

function toReportRow(item: ReportCatalogItem, closing: number, current: number, redMarked: boolean): ReportRow {
  return {
    code: item.code,
    location: item.location,
    sub_location: item.sub_location,
    category: item.category,
    product: item.product,
    official_name: item.official_name,
    stocklist_name: item.stocklist_name,
    row_position: item.row_position ?? 'single',
    source: 'catalog',
    closing,
    current,
    redMarked,
  }
}

/**
 * Shared per-date cache (Dashboard and Daily Report read the same dates), so switching tabs
 * or dates shows the last result at once and refreshes it quietly.
 */
const reportCache = new Map<string, DailyReportResponse>()

/** `refreshKey`: bump it to refetch. The previous data stays on screen while reloading (no flash). */
/** `date` is `YYYY-MM-DD`, or `latest:YYYY-MM-DD` for the newest date with a report up to that day. */
export function useDailyReportData(date: string, catalogItems: ReportCatalogItem[], refreshKey = 0) {
  const [data, setData] = useState<DailyReportResponse | null>(() => reportCache.get(date) ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestDateRef = useRef(date)

  const reload = useCallback(async () => {
    latestDateRef.current = date
    const cached = reportCache.get(date)
    setData(cached ?? null)
    setIsLoading(true)
    setError(null)

    try {
      // `latest:YYYY-MM-DD` asks the server for the newest date with a report up to that day.
      // `today` lets the server add stock in that arrived after the closing (current stock).
      const query = date.startsWith('latest:')
        ? `date=latest&today=${encodeURIComponent(date.slice('latest:'.length))}`
        : `date=${encodeURIComponent(date)}&today=${encodeURIComponent(getLocalTodayDate())}`
      const response = await fetch(`/api/daily-report?${query}`, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load the daily report.')
      }

      reportCache.set(date, payload as DailyReportResponse)
      if (latestDateRef.current === date) setData(payload as DailyReportResponse)
    } catch (loadError) {
      if (latestDateRef.current !== date) return
      // Keep the last good result on screen; just say the refresh failed.
      setError(
        cached
          ? 'Could not refresh. Showing the last loaded numbers.'
          : loadError instanceof Error ? loadError.message : 'Failed to load the daily report.',
      )
    } finally {
      if (latestDateRef.current === date) setIsLoading(false)
    }
  }, [date])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  // Days since the previous closing: units sold is a daily average when it is more than 1
  // (e.g. Thursday's closing, no closing on Friday, Saturday's closing = 2 days).
  const soldDays = data?.prevClosingDate ? Math.max(1, daysBetween(data.prevClosingDate, data.date)) : 1

  const insights = useMemo(() => {
    if (!data) return {}
    const calculated = computeItemInsights({
      closingByCode: data.closingByCode,
      prevClosingByCode: data.prevClosingByCode,
      stockInByCode: data.stockInByCode,
      arrivedSinceByCode: data.arrivedSinceByCode ?? {},
      days: data.prevClosingDate ? daysBetween(data.prevClosingDate, data.date) : 1,
    })
    return applyFlagOverrides(calculated, data.flagOverrides ?? {})
  }, [data])

  /**
   * Changes one item's badge for this date. The screen updates at once; if the save fails the
   * previous badge comes back and a toast says why.
   */
  const setFlagOverride = useCallback(async (code: string, choice: FlagChoice) => {
    const current = reportCache.get(date) ?? data
    if (!current) return false

    const nextOverrides = { ...(current.flagOverrides ?? {}) }
    if (choice === 'auto') delete nextOverrides[code]
    else nextOverrides[code] = { flag: choice, updatedAt: new Date().toISOString() }

    const optimistic: DailyReportResponse = { ...current, flagOverrides: nextOverrides }
    reportCache.set(date, optimistic)
    if (latestDateRef.current === date) setData(optimistic)

    try {
      const response = await fetch('/api/daily-report/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, code, flag: choice }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.details ? `${payload.error} ${payload.details}` : payload?.error ?? 'Could not save the badge.')
      }
      return true
    } catch (failure) {
      reportCache.set(date, current)
      if (latestDateRef.current === date) setData(current)
      const friendly = friendlyError(failure instanceof Error ? failure.message : 'Could not save the badge.')
      toast.error(friendly.message, { details: friendly.details })
      return false
    }
  }, [data, date])

  const summary = useMemo(() => summarizeInsights(insights), [insights])

  const indexedRows = useMemo<IndexedReportRow[]>(() => {
    if (!data) return []

    const catalogByCode = new Map(catalogItems.map((item) => [item.code.trim().toUpperCase(), item]))
    const rows: ReportRow[] = []

    for (const [code, closing] of Object.entries(data.closingByCode)) {
      const item = catalogByCode.get(code.trim().toUpperCase())
      if (!item) continue
      const current = closing + (data.arrivedSinceByCode?.[code] ?? 0)
      rows.push(toReportRow(item, closing, current, data.redMarkedByCode[code] === true))
    }
    // New today: arrived after the closing but not on it. Closing counts as 0.
    for (const [code, arrived] of Object.entries(data.arrivedSinceByCode ?? {})) {
      if (code in data.closingByCode || !(arrived > 0)) continue
      const item = catalogByCode.get(code.trim().toUpperCase())
      if (!item) continue
      rows.push({ ...toReportRow(item, 0, arrived, false), isNew: true })
    }

    return rows.map((row, index) => ({ row, index }))
  }, [catalogItems, data])

  const entries = useMemo<ReportEntry[]>(
    () => indexedRows
      .filter(({ row }) => insights[row.code])
      .map(({ row }) => ({
        code: row.code,
        name: row.official_name,
        category: row.category,
        insight: insights[row.code],
      })),
    [indexedRows, insights],
  )

  const arrivedDates = useMemo(() => data?.arrivedSinceDates ?? [], [data])
  const soldPeriod = useMemo(
    () => (data?.prevClosingDate && soldDays > 1 ? describeSoldPeriod(data.prevClosingDate, data.date, soldDays) : null),
    [data, soldDays],
  )
  const showsCurrent = data?.isLatestClosing === true

  const notices = useMemo(() => {
    const list: ReportNotice[] = []
    if (data && !data.closingFound) {
      list.push({ id: 'no-closing', severity: 'blocking', text: 'No closing saved for this date. Save it in Stock Close first.' })
    }
    if (data?.closingFound && !data.prevClosingDate) {
      list.push({ id: 'no-prev', severity: 'blocking', text: "No earlier closing, so units sold can't be worked out." })
    }
    if (data?.closingFound && data.stockInRecordCount === 0) {
      list.push({
        id: 'no-stock-in',
        severity: 'note',
        text: soldDays > 1
          ? 'No stock in since the previous closing. Sold assumes nothing arrived.'
          : 'No stock-in for this date. Sold assumes nothing arrived.',
      })
    }
    if (data && (data.stockInExtraCount ?? 0) > 0) {
      const extras = data.stockInExtraCount ?? 0
      list.push({ id: 'extra-stock-in', severity: 'note', text: `Stock in includes ${extras} extra ${extras === 1 ? 'delivery' : 'deliveries'}.` })
    }
    if (data && (data.stockInReplacedCount ?? Math.max(0, data.stockInRecordCount - 1)) > 0) {
      list.push({ id: 'multi-stock-in', severity: 'note', text: 'Stock In was saved more than once for this date. Using the latest save.' })
    }
    if (summary.itemsWithoutBaseline > 0) {
      list.push({
        id: 'no-baseline',
        severity: 'note',
        marker: '-',
        count: summary.itemsWithoutBaseline,
        text: `${summary.itemsWithoutBaseline} ${summary.itemsWithoutBaseline === 1 ? 'item has' : 'items have'} no earlier closing.`,
      })
    }
    const negatives = entries.filter((entry) => entry.insight.status === 'negative')
    if (negatives.length > 0) {
      const named = negatives
        .slice(0, 3)
        .map((entry) => `${entry.name} (${formatQuantity(entry.insight.sold).replace('-', '−')}${soldDays > 1 ? ' a day' : ''})`)
        .join(', ')
      const more = negatives.length > 3 ? ` and ${negatives.length - 3} more` : ''
      list.push({
        id: 'negative',
        severity: 'warning',
        count: negatives.length,
        text: `Sold below zero for ${named}${more}. The closing is above the earlier closing plus stock in, so a count or a stock in may be wrong.`,
      })
    }
    return list
  }, [data, summary, entries, soldDays])

  const hasReport = Boolean(data?.closingFound) && indexedRows.length > 0

  return {
    data,
    isLoading,
    error,
    reload,
    insights,
    summary,
    indexedRows,
    entries,
    notices,
    hasReport,
    /** The stock column shows current stock (closing + later stock in), not only the closing. */
    showsCurrent,
    arrivedDates,
    /** Days units sold covers; sold figures are per day when more than 1. */
    soldDays,
    /** Wording for a multi-day sold figure, or null when the closings are consecutive. */
    soldPeriod,
    sources: data?.sources ?? null,
    stockInRecordCount: data?.stockInRecordCount ?? 0,
    stockInNote: data
      ? [
        (data.stockInDates?.length ?? 0) > 1
          ? `${data.stockInDates!.length} days: ${data.stockInDates!.map((day) => formatDayLabel(day)).join(', ')}`
          : undefined,
        describeStockInRecords(data.stockInExtraCount ?? 0, data.stockInReplacedCount ?? Math.max(0, data.stockInRecordCount - 1)),
      ].filter(Boolean).join(' · ') || undefined
      : undefined,
    canChangeFlags: data?.overridesAvailable !== false,
    setFlagOverride,
  }
}

/**
 * Wording for units sold over several days, e.g. closings on Thursday and Saturday:
 * short "2-day average", range "Fri, 6 Nov – Sat, 7 Nov", and a sentence for the notes.
 */
export function describeSoldPeriod(prevClosingDate: string, date: string, days: number) {
  const range = `${formatDayLabel(addDays(prevClosingDate, 1))} – ${formatDayLabel(date)}`
  return {
    days,
    short: `${days}-day average`,
    range,
    sentence: `Sold is a daily average over ${days} days (${range}), since the closing on ${formatDayLabel(prevClosingDate)}.`,
  }
}
