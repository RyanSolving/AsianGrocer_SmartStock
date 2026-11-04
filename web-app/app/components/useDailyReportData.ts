'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReportEntry } from '../../lib/report-aggregations'
import { computeItemInsights, summarizeInsights } from '../../lib/report-insights'
import type { IndexedPaperRow, PaperRow } from '../../lib/stock-paper-layout'

/**
 * Loads one day's report data (closing, previous closing, stock-in) and derives the
 * per-item insights. Shared by the Dashboard summary and the Daily Report detail sheet.
 */

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

export type DailyReportResponse = {
  date: string
  closingFound: boolean
  closingByCode: Record<string, number>
  redMarkedByCode: Record<string, boolean>
  prevClosingDate: string | null
  prevClosingByCode: Record<string, number>
  stockInRecordCount: number
  stockInByCode: Record<string, number>
}

export type ReportRow = PaperRow & {
  code: string
  closing: number
  redMarked: boolean
}

export type IndexedReportRow = IndexedPaperRow<ReportRow>

function toReportRow(item: ReportCatalogItem, closing: number, redMarked: boolean): ReportRow {
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
    redMarked,
  }
}

/**
 * Shared per-date cache (Dashboard and Daily Report read the same dates), so switching tabs
 * or dates shows the last result at once and refreshes it quietly.
 */
const reportCache = new Map<string, DailyReportResponse>()

/** `refreshKey`: bump it to refetch. The previous data stays on screen while reloading (no flash). */
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
      const response = await fetch(`/api/daily-report?date=${encodeURIComponent(date)}`, { cache: 'no-store' })
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

  const insights = useMemo(() => {
    if (!data) return {}
    return computeItemInsights({
      closingByCode: data.closingByCode,
      prevClosingByCode: data.prevClosingByCode,
      stockInByCode: data.stockInByCode,
    })
  }, [data])

  const summary = useMemo(() => summarizeInsights(insights), [insights])

  const indexedRows = useMemo<IndexedReportRow[]>(() => {
    if (!data) return []

    const catalogByCode = new Map(catalogItems.map((item) => [item.code.trim().toUpperCase(), item]))
    const rows: ReportRow[] = []

    for (const [code, closing] of Object.entries(data.closingByCode)) {
      const item = catalogByCode.get(code.trim().toUpperCase())
      if (!item) continue
      rows.push(toReportRow(item, closing, data.redMarkedByCode[code] === true))
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

  const warnings = useMemo(() => {
    const list: string[] = []
    if (data && !data.closingFound) {
      list.push('No saved stock closing for this date. Save it in Check Stock first.')
    }
    if (data?.closingFound && !data.prevClosingDate) {
      list.push('No earlier closing was found, so units sold cannot be calculated.')
    }
    if (data?.closingFound && data.stockInRecordCount === 0) {
      list.push('No stock-in record found for this date. Sold counts assume nothing arrived.')
    }
    if (data && data.stockInRecordCount > 1) {
      list.push(`${data.stockInRecordCount} stock-in records found for this date. Using the latest one.`)
    }
    if (summary.itemsWithoutBaseline > 0) {
      list.push(`${summary.itemsWithoutBaseline} item(s) have no previous closing and show "-".`)
    }
    if (summary.itemsWithNegative > 0) {
      list.push(`${summary.itemsWithNegative} item(s) show "?" because closing is higher than previous closing plus stock-in.`)
    }
    return list
  }, [data, summary])

  const hasReport = Boolean(data?.closingFound) && indexedRows.length > 0

  return { data, isLoading, error, reload, insights, summary, indexedRows, entries, warnings, hasReport }
}
