'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw } from 'lucide-react'
import { toPng } from 'html-to-image'
import { getLocalTodayDate } from '../../lib/date-utils'

import type { DashboardResponseFilters, DashboardStockLevelItem } from '../../lib/dashboard-analytics'
import { DailyReportSummary } from './DailyReportSummary'
import { Button, IconButton } from './ui/Button'
import { inputClass } from './ui/Input'
import { ActionBar, ScreenHeader, SegmentedControl } from './ui/Primitives'
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
        <div className="rounded-control bg-danger-soft px-4 py-3 text-[14px] text-danger">{shownError}</div>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-control bg-warning-soft px-4 py-3 text-[14px] text-warning">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isLoading && !data ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-card border border-line bg-surface">
          <div className="flex items-center gap-2 text-[15px] text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading daily summary…
          </div>
        </div>
      ) : null}

      {hasReport ? (
        <>
          {/* Refetch keeps the frame: hold the previous render at reduced opacity. */}
          <div className={`overflow-x-auto rounded-card border border-line transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
            <DailyReportSummary
              containerRef={summaryRef}
              photoMode={isExporting}
              date={date}
              prevClosingDate={data?.prevClosingDate ?? null}
              entries={entries}
            />
          </div>
          <ActionBar className="md:static md:flex md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <Button size="lg" block className="md:w-auto" icon={<Download className="h-5 w-5" aria-hidden="true" />} loading={isExporting} loadingLabel="Exporting…" onClick={() => void exportPhoto()}>
              Export photo for owner
            </Button>
          </ActionBar>
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
    <section className="space-y-4">
      <ScreenHeader
        title="Dashboard"
        subtitle={activeTab === 'daily-summary' ? 'Sales and refill for the day, live from saved counts.' : 'Stock levels from the warehouse snapshot.'}
        actions={
          <IconButton
            label="Refresh"
            onClick={() => (activeTab === 'stock-level-manage' ? setRefreshTick((value) => value + 1) : setSummaryRefreshKey((value) => value + 1))}
            className="border border-line bg-surface"
          >
            {isLoading && activeTab === 'stock-level-manage' ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
          </IconButton>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SegmentedControl<DashboardTab>
          label="Dashboard view"
          value={activeTab}
          onChange={setActiveTab}
          className="w-full sm:w-auto"
          options={[
            { value: 'daily-summary', label: 'Daily summary' },
            { value: 'stock-level-manage', label: 'Stock levels' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            aria-label="Report date"
            className={`${inputClass} w-auto flex-1 tabular sm:flex-none`}
          />
          {activeTab === 'stock-level-manage' ? (
            <>
              <select
                value={selectedLocation}
                onChange={(event) => setSelectedLocation(event.target.value)}
                aria-label="Location"
                className={`${inputClass} w-auto flex-1 sm:flex-none`}
              >
                <option value="all">All locations</option>
                {locations.map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                aria-label="Category"
                className={`${inputClass} w-auto flex-1 sm:flex-none`}
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
        <div className="rounded-control bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</div>
      ) : null}

      {/* ── Tab content ── */}
      <div>
        {activeTab === 'daily-summary' ? (
          <DailySummaryTab
            catalogItems={catalogItems}
            date={selectedDate}
            refreshKey={summaryRefreshKey}
          />
        ) : isLoading && !stockLevels ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-card border border-line bg-surface">
            <div className="flex items-center gap-2 text-[15px] text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading stock levels…
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Stock level management</h2>
              <p className="mt-1 text-sm text-slate-500">
                Current quantity, arrival total quantity, and sold-out percentage are calculated from the selected BigQuery snapshot.
              </p>
            </div>

            {stockLevels?.items.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50 text-left text-[13px] font-medium text-muted">
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
                        <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${item.red_flag ? 'text-danger' : 'text-success'}`}>
                          {formatPercent(item.sold_out_percent)}
                        </td>
                        <td className="px-4 py-3">
                          {item.red_flag ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Red flag
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
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
