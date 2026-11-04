'use client'

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { AlertCircle } from 'lucide-react'

import {
  TOP_CONTRIBUTION_SHARE,
  inventoryTotals,
  rankProductsBySales,
  refillList,
  soldByCategory,
  type CategorySlice,
  type ReportEntry,
} from '../../lib/report-aggregations'
import { formatQuantity, summarizeInsights } from '../../lib/report-insights'
import { formatSheetDate } from '../../lib/stock-paper-utils'
import { squarify } from '../../lib/treemap'

/**
 * Daily summary (Dashboard tab + exported photo for the owner).
 *
 * Screen question: did today's stock sell, and what do we buy tomorrow?
 * Style: achromatic ledger (taste skill, seed 1181075752) with the brand kept:
 * - The chrome is ink and grey; the only hue is the brand green on the main data element
 *   (units sold, and the categories that make half of sales). Inventory is the neutral series.
 * - Face: a sage ground from the produce world (#f2f5f2) under white, flat, bordered panels.
 * - Signature element: the "half of today's sales" emphasis, shared by the ranking and the treemap.
 * - Data colours checked with the dataviz validator; text tiers hold 4.5:1 on their surfaces.
 * On screen the layout is fluid; the photo is a fixed 1080px sheet.
 */

const C = {
  ground: '#f2f5f2',
  surface: '#ffffff',
  border: '#e8e8e8',
  rule: '#f0f1f0',
  text: '#111111',
  muted: '#5f6368',
  sold: '#23a565', // the one data hue (brand green, 3.2:1 on white)
  inventory: '#6b7280', // neutral comparison series
  emphasisWash: '#edf6f0',
  tileQuiet: '#e5e7eb',
  tileInk: '#0b1f14', // near-black on the green tile, 5.4:1
  brand: '#2bb673', // the logo mark only
  negativeBg: '#ffedea',
  negativeInk: '#831c1e',
}

const TREEMAP_SLICES = 12
const PRODUCT_LIST_HEIGHT = 372 // on-screen scroll box; the treemap matches the list card's height
const REFILL_ROW_LIMIT = 12
const BAR_RADIUS = '0 4px 4px 0' // rounded data end, square on the baseline

type TooltipState = {
  x: number
  y: number
  title: string
  rows: Array<{ label: string; value: string; color?: string }>
} | null

type ShowTooltip = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>, content: Omit<NonNullable<TooltipState>, 'x' | 'y'>) => void

type DailyReportSummaryProps = {
  containerRef?: Ref<HTMLDivElement>
  /** Photo mode: fixed 1080px sheet, top contributors only, no scroll box, no hover layer. */
  photoMode?: boolean
  date: string
  prevClosingDate: string | null
  entries: ReportEntry[]
}

/** Measures an element so the treemap can fill exactly the space its card gives it. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-white ${className}`} style={{ borderColor: C.border }}>
      {children}
    </section>
  )
}

function PanelTitle({ children, subtitle, aside }: { children: ReactNode; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:gap-3">
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold" style={{ color: C.text }}>{children}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px]" style={{ color: C.muted }}>{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  )
}

function LegendKey({ color, label, shape = 'bar' }: { color: string; label: string; shape?: 'bar' | 'tile' }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={shape === 'bar' ? 'h-2.5 w-3.5' : 'h-3 w-3'}
        style={{ backgroundColor: color, borderRadius: shape === 'bar' ? BAR_RADIUS : 3 }}
      />
      {label}
    </span>
  )
}

function Tooltip({ state }: { state: TooltipState }) {
  if (!state) return null

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 min-w-[160px] rounded-md bg-white px-3 py-2 text-[12px]"
      style={{ left: state.x + 14, top: state.y + 14, color: C.text, border: `1px solid ${C.border}`, boxShadow: '0 6px 20px rgba(17, 17, 17, 0.12)' }}
    >
      <p className="mb-1" style={{ color: C.muted }}>{state.title}</p>
      {state.rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2">
          {row.color ? <span className="h-[2px] w-3" style={{ backgroundColor: row.color }} /> : null}
          <span className="text-[13px] font-semibold tabular-nums">{row.value}</span>
          <span style={{ color: C.muted }}>{row.label}</span>
        </p>
      ))}
    </div>
  )
}

/** Categories that, biggest first, reach the top-contribution share ("Other" never counts). */
function topCategoryLabels(slices: CategorySlice[]) {
  const labels = new Set<string>()
  let cumulative = 0
  for (const slice of slices) {
    if (slice.label === 'Other') continue
    if (cumulative >= TOP_CONTRIBUTION_SHARE) break
    labels.add(slice.label)
    cumulative += slice.share
  }
  return labels
}

function Treemap({ slices, width, height, onHover, onLeave }: {
  slices: CategorySlice[]
  width: number
  height: number
  onHover?: ShowTooltip
  onLeave?: () => void
}) {
  const rects = squarify(slices, (slice) => slice.sold, width, height)
  const emphasised = topCategoryLabels(slices)

  return (
    <div className="relative" style={{ width, height }} role="img" aria-label="Units sold by category">
      {rects.map((rect) => {
        const isEmphasised = emphasised.has(rect.item.label)
        const share = `${Math.round(rect.item.share * 100)}%`
        const content = {
          title: rect.item.label,
          rows: [
            { label: 'units sold', value: formatQuantity(rect.item.sold) },
            { label: 'of sales', value: share },
          ],
        }
        // A label is printed inside a tile only when it fits with padding; the tooltip carries the rest.
        const labelFits = rect.width - 16 >= Math.max(rect.item.label.length, 4) * 6.8 && rect.height >= 44
        const shareFits = rect.width >= 36 && rect.height >= 26
        return (
          <div
            key={rect.item.label}
            tabIndex={onHover ? 0 : undefined}
            aria-label={`${rect.item.label}: ${formatQuantity(rect.item.sold)} units, ${share} of sales`}
            onPointerMove={onHover ? (event) => onHover(event, content) : undefined}
            onFocus={onHover ? (event) => onHover(event, content) : undefined}
            onPointerLeave={onLeave}
            onBlur={onLeave}
            className="absolute outline-none transition-[filter] hover:brightness-[1.04] focus-visible:brightness-[1.04]"
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, padding: 1 }}
          >
            {/* Each tile is inset 1px, so neighbours are split by a 2px gap of the panel's white. */}
            <div
              className="flex h-full w-full flex-col justify-between rounded-[4px] p-2"
              style={{ backgroundColor: isEmphasised ? C.sold : C.tileQuiet, color: isEmphasised ? C.tileInk : C.text }}
            >
              {labelFits ? <span className="text-[12px] font-medium leading-tight">{rect.item.label}</span> : <span />}
              {shareFits ? <span className="text-[12px] font-semibold tabular-nums">{share}</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DailyReportSummary({ containerRef, photoMode = false, date, prevClosingDate, entries }: DailyReportSummaryProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const [treemapBoxRef, treemapBox] = useElementSize<HTMLDivElement>()

  const insights = Object.fromEntries(entries.map((entry) => [entry.code, entry.insight]))
  const summary = summarizeInsights(insights)
  const inventory = inventoryTotals(entries)
  const products = rankProductsBySales(entries)
  const topContributors = products.filter((product) => product.isTopContributor)
  const topContributorShare = topContributors.reduce((sum, product) => sum + product.share, 0)
  // On screen every item scrolls; the photo keeps only the items that make half of sales.
  const listedProducts = photoMode ? topContributors : products
  const hiddenProductCount = products.length - listedProducts.length
  const topCategory = soldByCategory(entries, 50)[0]
  const categorySlices = soldByCategory(entries, TREEMAP_SLICES)
  const refill = refillList(entries)
  const soldOutCount = refill.filter((item) => item.soldOut).length
  const visibleRefill = refill.slice(0, REFILL_ROW_LIMIT)
  const hiddenRefillCount = refill.length - visibleRefill.length
  const maxBar = Math.max(1, ...products.flatMap((product) => [product.sold, product.closing]))
  const maxRefill = Math.max(1, ...visibleRefill.map((item) => item.suggestedQty))
  const unreliable = summary.itemsWithoutBaseline + summary.itemsWithNegative

  // The screen's one finding, read first under the title.
  const finding = [
    topContributors.length > 0
      ? `${topContributors.length} item${topContributors.length === 1 ? '' : 's'} made ${Math.round(topContributorShare * 100)}% of ${formatQuantity(summary.totalSold)} units sold`
      : 'No sales recorded for this date',
    refill.length > 0
      ? `${refill.length} to refill${soldOutCount > 0 ? `, ${soldOutCount} sold out` : ''}`
      : 'nothing to refill',
  ].join(' · ')

  const showTooltip: ShowTooltip | undefined = photoMode
    ? undefined
    : (event, content) => {
      if ('clientX' in event) {
        setTooltip({ ...content, x: event.clientX, y: event.clientY })
        return
      }
      const box = event.currentTarget.getBoundingClientRect()
      setTooltip({ ...content, x: box.right - 40, y: box.top })
    }
  const hideTooltip = photoMode ? undefined : () => setTooltip(null)

  const kpis = [
    { label: 'Units sold', value: formatQuantity(summary.totalSold), note: `Stock in today ${formatQuantity(summary.totalStockIn)}`, lead: true },
    { label: 'Products in hand', value: String(inventory.productsInHand), note: 'Items with stock left' },
    { label: 'Current inventory', value: formatQuantity(inventory.currentInventory), note: 'Units left after closing' },
    {
      label: 'Top selling category',
      value: topCategory?.label ?? '—',
      isText: true,
      note: topCategory ? `${formatQuantity(topCategory.sold)} units · ${Math.round(topCategory.share * 100)}% of sales` : 'No sales recorded',
    },
  ]

  return (
    <div
      ref={containerRef}
      className={`${photoMode ? 'w-[1080px] p-8' : 'w-full p-4 sm:p-6'}`}
      style={{ backgroundColor: C.ground, color: C.text }}
    >
      {/* Title row: product mark, the screen's name, the finding, the date */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg text-[13px] font-bold leading-[1.15] text-white"
            style={{ backgroundColor: C.brand }}
          >
            <span>新興</span>
            <span>雜貨</span>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium" style={{ color: C.muted }}>Asian Grocer</p>
            <h2 className="text-[24px] font-semibold leading-tight">Daily summary</h2>
          </div>
        </div>
        <div className={photoMode ? 'text-right' : 'w-full sm:w-auto sm:text-right'}>
          <p className="text-[16px] font-semibold tabular-nums">{formatSheetDate(date)}</p>
          <p className="text-[13px]" style={{ color: C.muted }}>
            {prevClosingDate ? `Sold vs closing of ${formatSheetDate(prevClosingDate)}` : 'No earlier closing found'}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[15px]" style={{ color: C.text }}>{finding}</p>

      {/* KPI strip: one panel split by 1px dividers; units sold leads */}
      <Panel className="mt-4 overflow-hidden">
        <div className={`grid ${photoMode ? 'grid-cols-4' : 'grid-cols-2 lg:grid-cols-4'}`}>
          {kpis.map((kpi, index) => (
            <div
              key={kpi.label}
              className="px-5 py-4"
              style={{
                borderLeft: index % (photoMode ? 4 : 2) === 0 ? undefined : `1px solid ${C.border}`,
                borderTop: !photoMode && index >= 2 ? `1px solid ${C.border}` : undefined,
              }}
            >
              <p className="text-[13px]" style={{ color: C.muted }}>{kpi.label}</p>
              <p
                className={`mt-1 break-normal leading-tight tabular-nums ${kpi.lead
                  ? 'text-[36px] font-semibold'
                  : kpi.isText && !photoMode
                    ? 'pt-[6px] text-[18px] font-medium sm:text-[24px]'
                    : 'pt-[6px] text-[24px] font-medium'}`}
              >
                {kpi.value}
              </p>
              <p className="mt-1 text-[12px]" style={{ color: C.muted }}>{kpi.note}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Charts: the ranking and the category share end on one line */}
      <div className={`mt-4 grid gap-4 ${photoMode ? 'grid-cols-[minmax(0,1fr)_440px]' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]'}`}>
        <Panel className="min-w-0 px-5 py-4">
          <PanelTitle
            subtitle={topContributors.length > 0
              ? `Highlighted: the ${topContributors.length} item${topContributors.length === 1 ? '' : 's'} making ${Math.round(TOP_CONTRIBUTION_SHARE * 100)}% of units sold`
              : undefined}
            aside={(
              <div className="flex shrink-0 items-center gap-3 pt-1 text-[12px]" style={{ color: C.muted }}>
                <LegendKey color={C.sold} label="Units sold" />
                <LegendKey color={C.inventory} label="Inventory" />
              </div>
            )}
          >
            Top selling products
          </PanelTitle>

          {products.length === 0 ? (
            <p className="mt-4 text-[14px]" style={{ color: C.muted }}>No sales recorded for this date.</p>
          ) : (
            <ol
              className={`mt-3 space-y-[2px] pr-1 ${photoMode ? '' : 'overflow-y-auto'}`}
              style={photoMode ? undefined : { maxHeight: PRODUCT_LIST_HEIGHT }}
              onPointerLeave={hideTooltip}
            >
              {listedProducts.map((product, index) => {
                const tooltipContent = {
                  title: product.name,
                  rows: [
                    { label: 'units sold', value: formatQuantity(product.sold), color: C.sold },
                    { label: 'inventory', value: formatQuantity(product.closing), color: C.inventory },
                    { label: 'of sales', value: `${Math.round(product.share * 100)}%` },
                  ],
                }
                return (
                  <li
                    key={product.code}
                    tabIndex={photoMode ? undefined : 0}
                    onPointerMove={showTooltip ? (event) => showTooltip(event, tooltipContent) : undefined}
                    onFocus={showTooltip ? (event) => showTooltip(event, tooltipContent) : undefined}
                    onBlur={hideTooltip}
                    className="flex items-center gap-3 rounded-md px-2 py-[5px] outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    style={{ backgroundColor: product.isTopContributor ? C.emphasisWash : undefined }}
                  >
                    <span className="w-5 shrink-0 text-right text-[12px] tabular-nums" style={{ color: C.muted }}>{index + 1}</span>
                    <span className={`w-28 shrink-0 truncate text-[13px] sm:w-40 ${product.isTopContributor ? 'font-semibold' : ''}`} title={product.name}>
                      {product.name}
                    </span>
                    {/* Paired bars on one shared axis (same unit), 2px apart. */}
                    <div className="min-w-0 flex-1 space-y-[2px]">
                      <div className="flex items-center gap-1.5">
                        <div className="h-[10px]" style={{ width: `${Math.max(1.5, (product.sold / maxBar) * 78)}%`, backgroundColor: C.sold, borderRadius: BAR_RADIUS }} />
                        <span className="text-[12px] font-semibold tabular-nums">{formatQuantity(product.sold)}</span>
                        {product.isTopContributor ? (
                          <span className="text-[12px] tabular-nums" style={{ color: C.muted }}>{Math.round(product.share * 100)}%</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-[10px]" style={{ width: `${Math.max(1.5, (product.closing / maxBar) * 78)}%`, backgroundColor: C.inventory, borderRadius: BAR_RADIUS }} />
                        <span className="text-[12px] tabular-nums" style={{ color: C.muted }}>{formatQuantity(product.closing)}</span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          {photoMode && hiddenProductCount > 0 ? (
            <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
              {hiddenProductCount} more item{hiddenProductCount === 1 ? '' : 's'} on the Dashboard and the detailed sheet
            </p>
          ) : null}
        </Panel>

        <Panel className="flex min-w-0 flex-col px-5 py-4">
          <PanelTitle subtitle="Tile area is units sold">Sales by category</PanelTitle>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: C.muted }}>
            <LegendKey shape="tile" color={C.sold} label={`Making ${Math.round(TOP_CONTRIBUTION_SHARE * 100)}% of sales`} />
            <LegendKey shape="tile" color={C.tileQuiet} label="Other categories" />
          </div>
          {/* The treemap fills whatever height the row gives it, so both cards end on one line. */}
          <div ref={treemapBoxRef} className="relative mt-3 min-h-[220px] flex-1">
            {categorySlices.length === 0 ? (
              <p className="text-[14px]" style={{ color: C.muted }}>No sales recorded for this date.</p>
            ) : treemapBox.width > 0 && treemapBox.height > 0 ? (
              // Absolutely placed so the drawing never props its own box open: the box takes its size from the row.
              <div className="absolute inset-0">
                <Treemap
                  slices={categorySlices}
                  width={Math.floor(treemapBox.width)}
                  height={Math.floor(treemapBox.height)}
                  onHover={showTooltip}
                  onLeave={hideTooltip}
                />
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      {/* Refill recommendations: the job for tomorrow */}
      <Panel className="mt-4 px-5 py-4">
        <PanelTitle
          subtitle="Sold out first, then the biggest shortfall"
          aside={<span className="shrink-0 pt-1 text-[13px] tabular-nums" style={{ color: C.muted }}>{refill.length} item{refill.length === 1 ? '' : 's'}</span>}
        >
          Refill for tomorrow
        </PanelTitle>

        {visibleRefill.length === 0 ? (
          <p className="mt-3 text-[14px]" style={{ color: C.muted }}>Nothing to refill. Closing stock covers today&apos;s sales.</p>
        ) : (
          <div className="mt-2">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="text-[12px]" style={{ color: C.muted }}>
                  <th className="py-2 pr-2 font-normal">Item</th>
                  <th className={`py-2 pr-2 font-normal ${photoMode ? '' : 'hidden sm:table-cell'}`}>Category</th>
                  <th className="py-2 pr-2 text-right font-normal">Closing</th>
                  <th className="whitespace-nowrap py-2 text-right font-normal">
                    {photoMode ? 'Units sold' : <><span className="sm:hidden">Sold</span><span className="hidden sm:inline">Units sold</span></>}
                  </th>
                  <th className={`py-2 pl-4 font-normal sm:w-[38%] sm:pl-8 ${photoMode ? 'w-[38%] pl-8' : ''}`}>Order<span className={photoMode ? '' : 'hidden sm:inline'}> for tomorrow</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRefill.map((item) => (
                  <tr key={item.code} style={{ borderTop: `1px solid ${C.rule}` }}>
                    <td className="py-2.5 pr-2 font-medium">
                      {item.name}
                      {photoMode ? null : <span className="block text-[12px] font-normal sm:hidden" style={{ color: C.muted }}>{item.category}</span>}
                    </td>
                    <td className={`py-2.5 pr-2 ${photoMode ? '' : 'hidden sm:table-cell'}`} style={{ color: C.muted }}>{item.category}</td>
                    <td className="py-2.5 pr-2 text-right tabular-nums">{formatQuantity(item.closing)}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatQuantity(item.sold)}</td>
                    <td className={`py-2.5 pl-4 sm:pl-8 ${photoMode ? 'pl-8' : ''}`}>
                      <div className="flex items-center justify-end gap-3">
                        <div className={`h-[10px] flex-1 ${photoMode ? '' : 'hidden sm:block'}`}>
                          <div
                            className="h-full"
                            style={{ width: `${Math.max(4, (item.suggestedQty / maxRefill) * 100)}%`, backgroundColor: C.sold, borderRadius: BAR_RADIUS }}
                          />
                        </div>
                        {item.soldOut ? (
                          <span
                            className="inline-flex flex-none items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium"
                            style={{ backgroundColor: C.negativeBg, color: C.negativeInk }}
                          >
                            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            Sold out
                          </span>
                        ) : (
                          <span className="w-12 flex-none text-right text-[14px] font-semibold tabular-nums">+{item.suggestedQty}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hiddenRefillCount > 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
            {hiddenRefillCount} more item(s) tagged REFILL on the detailed sheet
          </p>
        ) : null}
      </Panel>

      <p className="mt-3 text-[12px]" style={{ color: C.muted }}>
        Units sold = previous closing + stock in − closing. Refill = units sold − closing.
        {unreliable > 0 ? ` ${unreliable} item(s) left out: no earlier closing, or counts that do not add up.` : ''}
      </p>

      {photoMode ? null : <Tooltip state={tooltip} />}
    </div>
  )
}
