'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { toPng } from 'html-to-image'
import { getLocalTodayDate } from '../../lib/date-utils'

import type { DashboardResponseFilters, DashboardStockLevelItem } from '../../lib/dashboard-analytics'
import { DailyReportSummary } from './DailyReportSummary'
import { useDailyReportData, type ReportCatalogItem } from './useDailyReportData'

type DashboardStockLevelResponse = {
  selected_date: string
  filters: DashboardResponseFilters
  items: DashboardStockLevelItem[]
  generated_at: string
}

type DashboardTab = 'daily-summary' | 'stock-level-manage'

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

type DashboardPanelProps = {
  catalogItems: ReportCatalogItem[]
}

function DailySummaryTab({ catalogItems, date, refreshKey }: { catalogItems: ReportCatalogItem[]; date: string; refreshKey: number }) {
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { data, isLoading, error, entries, warnings, hasReport } = useDailyReportData(date, catalogItems, refreshKey)

  async function exportPhoto() {
    if (!summaryRef.current) return

    setIsExporting(true)
    setExportError(null)

    try {
      // Let the photo layout (top contributors only) render before capturing.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const dataUrl = await toPng(summaryRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: '#f3f4f6' })
      const link = document.createElement('a')
      link.download = `daily-summary-${date}.png`
      link.href = dataUrl
      link.click()
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Failed to export the summary photo.')
    } finally {
      setIsExporting(false)
    }
  }

  const shownError = exportError ?? error

  return (
    <div className="space-y-3">
      {shownError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{shownError}</div>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isLoading && !data ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading daily summary...
          </div>
        </div>
      ) : null}

      {hasReport ? (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void exportPhoto()}
              disabled={isExporting}
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#1d1f20] px-3 py-2 text-sm font-medium text-white hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export photo for owner
            </button>
          </div>
          {/* Refetch keeps the frame: hold the previous render at reduced opacity. */}
          <div className={`overflow-x-auto rounded-lg border border-[#e8e8e8] transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
            <DailyReportSummary
              containerRef={summaryRef}
              photoMode={isExporting}
              date={date}
              prevClosingDate={data?.prevClosingDate ?? null}
              entries={entries}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

export function DashboardPanel({ catalogItems }: DashboardPanelProps) {
  const today = useMemo(() => getLocalTodayDate(), [])
  const [activeTab, setActiveTab] = useState<DashboardTab>('daily-summary')
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedLocation, setSelectedLocation] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [stockLevels, setStockLevels] = useState<DashboardStockLevelResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const requestIdRef = useRef(0)
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0)

  const locations = stockLevels?.filters.locations ?? []
  const categories = stockLevels?.filters.categories ?? []

  useEffect(() => {
    if (activeTab !== 'stock-level-manage') return

    let isMounted = true
    const requestId = ++requestIdRef.current
    const controller = new AbortController()

    async function loadData() {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ date: selectedDate })
        if (selectedLocation !== 'all') params.set('location', selectedLocation)
        if (selectedCategory !== 'all') params.set('category', selectedCategory)

        const response = await fetch(`/api/dashboard/stock-level-manage?${params.toString()}`, {
          signal: controller.signal,
        })

        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Failed to load dashboard data.')
        }

        if (requestId !== requestIdRef.current || !isMounted) {
          return
        }

        setStockLevels(payload as DashboardStockLevelResponse)
      } catch (loadError) {
        if (controller.signal.aborted || requestId !== requestIdRef.current || !isMounted) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : 'Unexpected dashboard error.')
      } finally {
        if (requestId === requestIdRef.current && isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [activeTab, selectedDate, selectedLocation, selectedCategory, refreshTick])

  return (
    <section className="card-surface rounded-2xl p-5 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Dashboard</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">Inventory analytics</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Daily summary from the saved stock-in and closing (live from Supabase, no ETL wait), plus stock level management from the BigQuery snapshot.
          </p>
        </div>

        <button
          type="button"
          onClick={() => (activeTab === 'stock-level-manage' ? setRefreshTick((value) => value + 1) : setSummaryRefreshKey((value) => value + 1))}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {isLoading && activeTab === 'stock-level-manage' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setActiveTab('daily-summary')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'daily-summary' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Daily Summary
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('stock-level-manage')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'stock-level-manage' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Stock level manage
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <SlidersHorizontal className="h-4 w-4 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="bg-transparent text-sm text-slate-700 focus:outline-none"
              />
            </div>

            {activeTab === 'stock-level-manage' ? (
            <>
            <select
              value={selectedLocation}
              onChange={(event) => setSelectedLocation(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
            >
              <option value="all">All locations</option>
              {locations.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>

            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            </>
            ) : null}
          </div>
      </div>

      {error && activeTab === 'stock-level-manage' ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* ── Tab content ── */}
      <div className="mt-5">
        {activeTab === 'daily-summary' ? (
          <DailySummaryTab
            catalogItems={catalogItems}
            date={selectedDate}
            refreshKey={summaryRefreshKey}
          />
        ) : isLoading && !stockLevels ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading dashboard metrics...
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Stock level management</h2>
              <p className="mt-1 text-sm text-slate-500">
                Current quantity, arrival total quantity, and sold-out percentage are calculated from the selected BigQuery snapshot.
              </p>
            </div>

            {stockLevels?.items.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Current qty</th>
                      <th className="px-4 py-3 text-right">Arrival total</th>
                      <th className="px-4 py-3 text-right">% Sold out</th>
                      <th className="px-4 py-3">Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {stockLevels.items.map((item) => (
                      <tr key={item.product_name} className="align-top">
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">{item.product_name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{item.category}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{item.current_quantity}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{item.arrival_total_quantity}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold ${item.red_flag ? 'text-red-700' : 'text-emerald-700'}`}>
                          {formatPercent(item.sold_out_percent)}
                        </td>
                        <td className="px-4 py-3">
                          {item.red_flag ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Red flag
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex min-h-[220px] items-center justify-center px-4 py-8 text-sm text-slate-500">
                No stock level items found for the selected filters.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
