'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react'

import type { DashboardResponseFilters, DashboardStockLevelItem } from '../../lib/dashboard-analytics'

type DashboardStockLevelResponse = {
  selected_date: string
  filters: DashboardResponseFilters
  items: DashboardStockLevelItem[]
  generated_at: string
}

type DashboardTab = 'powerbi-report' | 'stock-level-manage'

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

const POWERBI_EMBED_URL =
  'https://app.powerbi.com/view?r=eyJrIjoiNzhjMDMzMTUtMzMwZS00OWMyLWJkZGYtNDEwYmY1NDVlM2NhIiwidCI6IjJlZmEwMzAzLTllNTItNDQxNC1hOGMzLWY5YTIxMjhiNTFkNSJ9'

export function DashboardPanel() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [activeTab, setActiveTab] = useState<DashboardTab>('powerbi-report')
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedLocation, setSelectedLocation] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [stockLevels, setStockLevels] = useState<DashboardStockLevelResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const requestIdRef = useRef(0)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile viewport so we can switch the Power BI iframe to portrait mode
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const embedUrl = isMobile
    ? `${POWERBI_EMBED_URL}&isMobile=true`
    : POWERBI_EMBED_URL

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
            Interactive Power&nbsp;BI report with mobile-responsive layout, plus stock level management comparing current quantity against arrival quantity.
          </p>
        </div>

        {activeTab === 'stock-level-manage' && (
          <button
            type="button"
            onClick={() => setRefreshTick((value) => value + 1)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setActiveTab('powerbi-report')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'powerbi-report' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Power BI Report
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('stock-level-manage')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'stock-level-manage' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Stock level manage
        </button>

        {activeTab === 'stock-level-manage' && (
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
          </div>
        )}
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* ── Tab content ── */}
      <div className="mt-5">
        {activeTab === 'powerbi-report' ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div
              className="relative w-full"
              style={isMobile ? { height: '85vh' } : { paddingBottom: '59.77%' }}
            >
              <iframe
                title="Power BI Report"
                src={embedUrl}
                className="absolute inset-0 h-full w-full border-0"
                allowFullScreen
              />
            </div>
          </div>
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
                Current quantity, arrival total quantity, and sold-out percentage are calculated from the selected Snowflake snapshot.
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
