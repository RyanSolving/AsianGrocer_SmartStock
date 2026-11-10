'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReportEntry } from '../../lib/report-aggregations'
import { applyFlagOverrides, computeItemInsights, formatQuantity, summarizeInsights, type StockFlag } from '../../lib/report-insights'
import { friendlyError, toast } from '../../lib/toast-store'
import type { IndexedPaperRow, PaperRow } from '../../lib/stock-paper-layout'
import { addDays, daysBetween, describeStockInRecords } from '../../lib/report-records'
import { formatDayLabel, getLocalTodayDate } from '../../lib/date-utils'
import { sectionLabel, sectionsOf, type Section, type SectionChoice } from '../../lib/sections'

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
  /** The section these figures are for. */
  section?: Section
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
 * Shared per-date-and-section cache (Dashboard and Daily Report read the same dates), so switching
 * tabs or dates shows the last result at once and refreshes it quietly.
 */
const reportCache = new Map<string, DailyReportResponse>()
const cacheKey = (date: string, section: Section) => `${date}|${section}`

type SectionReports = Partial<Record<Section, DailyReportResponse>>

function readCached(date: string, choice: SectionChoice): SectionReports {
  const found: SectionReports = {}
  for (const section of sectionsOf(choice)) {
    const cached = reportCache.get(cacheKey(date, section))
    if (cached) found[section] = cached
  }
  return found
}

function reportUrl(date: string, section: Section) {
  // `latest:YYYY-MM-DD` asks the server for the newest date with a report up to that day.
  // `today` lets the server add stock in that arrived after the closing (current stock).
  const query = date.startsWith('latest:')
    ? `date=latest&today=${encodeURIComponent(date.slice('latest:'.length))}`
    : `date=${encodeURIComponent(date)}&today=${encodeURIComponent(getLocalTodayDate())}`
  return `/api/daily-report?${query}&section=${section}`
}

async function fetchReport(date: string, section: Section): Promise<DailyReportResponse> {
  const response = await fetch(reportUrl(date, section), { cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error ?? 'Failed to load the daily report.')
  return payload as DailyReportResponse
}

/**
 * Both sections as one report: figures are keyed by item code and codes are unique, so the maps
 * simply join. Each section's own insights are worked out before this (their previous closings
 * can be on different days).
 */
function mergeReports(parts: DailyReportResponse[]): DailyReportResponse {
  if (parts.length === 1) return parts[0]
  const closed = parts.filter((part) => part.closingFound)
  const base = closed[0] ?? parts[0]
  const join = <T,>(pick: (part: DailyReportResponse) => Record<string, T> | undefined) =>
    Object.assign({}, ...parts.map((part) => pick(part) ?? {})) as Record<string, T>
  const prevDates = closed.map((part) => part.prevClosingDate).filter((day): day is string => Boolean(day)).sort()
  const stockInDates = Array.from(new Set(parts.flatMap((part) => part.stockInDates ?? []))).sort()
  const arrivedDates = Array.from(new Set(parts.flatMap((part) => part.arrivedSinceDates ?? []))).sort()
  const latestFlags = closed.map((part) => part.isLatestClosing)

  return {
    ...base,
    section: undefined,
    closingFound: closed.length > 0,
    closingByCode: join((part) => part.closingByCode),
    redMarkedByCode: join((part) => part.redMarkedByCode),
    prevClosingDate: prevDates[0] ?? null,
    prevClosingByCode: join((part) => part.prevClosingByCode),
    stockInRecordCount: parts.reduce((total, part) => total + part.stockInRecordCount, 0),
    stockInExtraCount: parts.reduce((total, part) => total + (part.stockInExtraCount ?? 0), 0),
    stockInReplacedCount: parts.reduce((total, part) => total + (part.stockInReplacedCount ?? Math.max(0, part.stockInRecordCount - 1)), 0),
    stockInByCode: join((part) => part.stockInByCode),
    stockInDates,
    soldDays: Math.max(...parts.map((part) => part.soldDays ?? 1)),
    isLatestClosing: latestFlags.length === 0 || latestFlags.some((flag) => flag === null || flag === undefined)
      ? null
      : latestFlags.every((flag) => flag === true),
    arrivedSinceByCode: join((part) => part.arrivedSinceByCode),
    arrivedSinceDates: arrivedDates,
    // Sources: the first closing found; the newest Stock In of either section.
    sources: base.sources
      ? {
        ...base.sources,
        stockIn: parts
          .map((part) => part.sources?.stockIn ?? null)
          .filter((source): source is ReportSource => source !== null)
          .sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')))[0] ?? null,
      }
      : undefined,
    flagOverrides: join((part) => part.flagOverrides),
    overridesAvailable: parts.every((part) => part.overridesAvailable !== false),
  }
}

/**
 * `refreshKey`: bump it to refetch. The previous data stays on screen while reloading (no flash).
 * `date` is `YYYY-MM-DD`, or `latest:YYYY-MM-DD` for the newest date with a report up to that day.
 * `section` is Fruit, Vegies or Both; Both loads each section and shows them together.
 */
export function useDailyReportData(date: string, catalogItems: ReportCatalogItem[], refreshKey = 0, section: SectionChoice = 'both') {
  const [reports, setReports] = useState<SectionReports>(() => readCached(date, section))
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestRequestRef = useRef(`${date}|${section}`)

  const reload = useCallback(async () => {
    const requestId = `${date}|${section}`
    latestRequestRef.current = requestId
    const wanted = sectionsOf(section)
    const cached = readCached(date, section)
    setReports(cached)
    setIsLoading(true)
    setError(null)

    try {
      let fetched = await Promise.all(wanted.map((name) => fetchReport(date, name)))

      // "Latest" is worked out per section; if they land on different days, show the newest day
      // that has a closing and load the other section for that same day.
      if (date.startsWith('latest:') && fetched.length > 1) {
        const withClosing = fetched.filter((part) => part.closingFound)
        const target = (withClosing.length > 0 ? withClosing : fetched).map((part) => part.date).sort().at(-1)
        if (target && fetched.some((part) => part.date !== target)) {
          fetched = await Promise.all(fetched.map((part, index) =>
            part.date === target ? part : fetchReport(target, wanted[index])))
        }
      }

      const next: SectionReports = {}
      fetched.forEach((part, index) => {
        reportCache.set(cacheKey(part.date, wanted[index]), part)
        // The `latest:` key is kept too, so the next visit shows it at once.
        reportCache.set(cacheKey(date, wanted[index]), part)
        next[wanted[index]] = part
      })
      if (latestRequestRef.current === requestId) setReports(next)
    } catch (loadError) {
      if (latestRequestRef.current !== requestId) return
      // Keep the last good result on screen; just say the refresh failed.
      setError(
        wanted.every((name) => cached[name])
          ? 'Could not refresh. Showing the last loaded numbers.'
          : loadError instanceof Error ? loadError.message : 'Failed to load the daily report.',
      )
    } finally {
      if (latestRequestRef.current === requestId) setIsLoading(false)
    }
  }, [date, section])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  // The sections that have loaded, fruit first.
  const parts = useMemo(
    () => sectionsOf(section).map((name) => reports[name]).filter((part): part is DailyReportResponse => Boolean(part)),
    [reports, section],
  )
  const data = useMemo(() => (parts.length > 0 ? mergeReports(parts) : null), [parts])

  // Days since the previous closing: units sold is a daily average when it is more than 1
  // (e.g. Thursday's closing, no closing on Friday, Saturday's closing = 2 days).
  const soldDays = data?.prevClosingDate ? Math.max(1, daysBetween(data.prevClosingDate, data.date)) : 1

  const insights = useMemo(() => {
    if (!data) return {}
    // Each section against its own previous closing.
    const calculated = Object.assign({}, ...parts.map((part) => computeItemInsights({
      closingByCode: part.closingByCode,
      prevClosingByCode: part.prevClosingByCode,
      stockInByCode: part.stockInByCode,
      arrivedSinceByCode: part.arrivedSinceByCode ?? {},
      days: part.prevClosingDate ? daysBetween(part.prevClosingDate, part.date) : 1,
    })))
    return applyFlagOverrides(calculated, data.flagOverrides ?? {})
  }, [data, parts])

  /**
   * Changes one item's badge for this date. The screen updates at once; if the save fails the
   * previous badge comes back and a toast says why.
   */
  const setFlagOverride = useCallback(async (code: string, choice: FlagChoice) => {
    const previous = reports
    const wanted = sectionsOf(section).filter((name) => previous[name])
    if (wanted.length === 0) return false
    const requestId = `${date}|${section}`

    const withFlag = (report: DailyReportResponse): DailyReportResponse => {
      const nextOverrides = { ...(report.flagOverrides ?? {}) }
      if (choice === 'auto') delete nextOverrides[code]
      else nextOverrides[code] = { flag: choice, updatedAt: new Date().toISOString() }
      return { ...report, flagOverrides: nextOverrides }
    }
    const store = (value: SectionReports) => {
      for (const name of wanted) {
        const report = value[name]
        if (report) reportCache.set(cacheKey(date, name), report)
      }
      if (latestRequestRef.current === requestId) setReports(value)
    }

    store(Object.fromEntries(wanted.map((name) => [name, withFlag(previous[name]!)])) as SectionReports)

    try {
      const response = await fetch('/api/daily-report/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: parts[0]?.date ?? date, code, flag: choice }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.details ? `${payload.error} ${payload.details}` : payload?.error ?? 'Could not save the badge.')
      }
      return true
    } catch (failure) {
      store(previous)
      const friendly = friendlyError(failure instanceof Error ? failure.message : 'Could not save the badge.')
      toast.error(friendly.message, { details: friendly.details })
      return false
    }
  }, [reports, section, date, parts])

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
      list.push({
        id: 'no-closing',
        severity: 'blocking',
        text: parts.length > 1
          ? 'No closing saved for this date, for fruit or vegies. Save it in Stock Close first.'
          : `No ${sectionLabel[parts[0]?.section ?? 'fruit'].toLowerCase()} closing saved for this date. Save it in Stock Close first.`,
      })
    }
    // With both sections shown, one missing a closing is a note: the other still has a report.
    if (data?.closingFound && parts.length > 1) {
      for (const part of parts) {
        if (!part.closingFound) {
          list.push({ id: `no-closing-${part.section}`, severity: 'note', text: `No ${sectionLabel[part.section ?? 'fruit'].toLowerCase()} closing saved for this date, so its items are left out.` })
        }
      }
    }
    const closedParts = parts.filter((part) => part.closingFound)
    if (closedParts.length > 0 && closedParts.every((part) => !part.prevClosingDate)) {
      list.push({ id: 'no-prev', severity: 'blocking', text: "No earlier closing, so units sold can't be worked out." })
    } else if (parts.length > 1) {
      for (const part of closedParts) {
        if (!part.prevClosingDate) {
          list.push({ id: `no-prev-${part.section}`, severity: 'note', text: `No earlier ${sectionLabel[part.section ?? 'fruit'].toLowerCase()} closing, so its units sold can't be worked out.` })
        }
      }
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
  }, [data, parts, summary, entries, soldDays])

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
