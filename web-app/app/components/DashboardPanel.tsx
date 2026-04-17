'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownAZ, ArrowUpAZ, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react'

import type { DashboardMetricItem, DashboardResponseFilters, DashboardStockLevelItem } from '../../lib/dashboard-analytics'

type DashboardOverviewResponse = {
  selected_date: string
  filters: DashboardResponseFilters
  summary: {
    total_products_in_stock: number
    total_products: number
    generated_at: string
  }
  top_highest: DashboardMetricItem[]
  top_lowest: DashboardMetricItem[]
}

type DashboardStockLevelResponse = {
  selected_date: string
  filters: DashboardResponseFilters
  items: DashboardStockLevelItem[]
  generated_at: string
}

type DashboardTab = 'overview' | 'stock-level-manage'

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function DashboardStatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </div>
  )
}

function MetricList({
  title,
  icon: Icon,
  items,
  emptyLabel,
}: {
  title: string
  icon: typeof ArrowDownAZ
  items: DashboardMetricItem[]
  emptyLabel: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item, index) => (
            <div key={`${item.product_name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.product_name}</p>
                <p className="text-xs text-slate-500">{item.category}</p>
              </div>
              <p className="text-sm font-semibold text-slate-900">{item.quantity}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function DashboardPanel() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedLocation, setSelectedLocation] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null)
  const [stockLevels, setStockLevels] = useState<DashboardStockLevelResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const requestIdRef = useRef(0)

  const activeData = activeTab === 'overview' ? overview : stockLevels
  const locations = activeData?.filters.locations ?? []
  const categories = activeData?.filters.categories ?? []

  useEffect(() => {
    let isMounted = true
    const requestId = ++requestIdRef.current
    const controller = new AbortController()

    async function loadData() {
      setIsLoading(true)
      setError(null)

      try {
        const endpoint = activeTab === 'overview' ? '/api/dashboard/overview' : '/api/dashboard/stock-level-manage'
        const params = new URLSearchParams({ date: selectedDate })
        if (selectedLocation !== 'all') params.set('location', selectedLocation)
        if (selectedCategory !== 'all') params.set('category', selectedCategory)

        const response = await fetch(`${endpoint}?${params.toString()}`, {
          signal: controller.signal,
        })

        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Failed to load dashboard data.')
        }

        if (requestId !== requestIdRef.current || !isMounted) {
          return
        }

        if (activeTab === 'overview') {
          setOverview(payload as DashboardOverviewResponse)
        } else {
          setStockLevels(payload as DashboardStockLevelResponse)
        }
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

  const generatedAt = activeTab === 'overview' ? overview?.summary.generated_at : stockLevels?.generated_at

  return (
    <section className="card-surface rounded-2xl p-5 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Dashboard</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">Inventory analytics</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Overview surfaces today&apos;s product standing, while stock level management compares current quantity against arrival quantity and flags items below the 20% sold-out threshold.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRefreshTick((value) => value + 1)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'overview' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Overview
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
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-5">
        {isLoading && !activeData ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading dashboard metrics...
            </div>
          </div>
        ) : activeTab === 'overview' ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <DashboardStatCard
                label="No. of products in stocks"
                value={overview ? String(overview.summary.total_products_in_stock) : '0'}
                hint="Products with quantity above zero in the selected date scope."
              />
              <DashboardStatCard
                label="Total products tracked"
                value={overview ? String(overview.summary.total_products) : '0'}
                hint="Unique products returned from the selected Snowflake date slice."
              />
              <DashboardStatCard
                label="Last refreshed"
                value={generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}
                hint={generatedAt ? new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No refresh yet'}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <MetricList
                title="Top 5 products with highest stock"
                icon={ArrowUpAZ}
                items={overview?.top_highest ?? []}
                emptyLabel="No products available for this filter set."
              />
              <MetricList
                title="Top 5 products with lowest stock"
                icon={ArrowDownAZ}
                items={overview?.top_lowest ?? []}
                emptyLabel="No products available for this filter set."
              />
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
