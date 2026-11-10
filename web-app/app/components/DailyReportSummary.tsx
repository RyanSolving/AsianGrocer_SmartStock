'use client'

import { useState, type FocusEvent, type PointerEvent, type ReactNode, type Ref } from 'react'

import {
  TOP_CONTRIBUTION_SHARE,
  inventoryTotals,
  rankProductsBySales,
  refillList,
  soldByCategory,
  type CategorySlice,
  type ReportEntry,
} from '../../lib/report-aggregations'
import { formatQuantity, stockFlags, summarizeInsights } from '../../lib/report-insights'
import { formatSheetDate } from '../../lib/stock-paper-utils'
import { StockFlagBadge } from './StockFlagBadge'
import { BrandTile } from './BrandMark'

/**
 * Daily summary (Dashboard tab + exported photo for the owner).
 *
 * Screen question: did today's stock sell, and what do we buy tomorrow?
 * Colour carries the reading order: units sold > contribution > stock left.
 * - Units sold: the forest lead tile and the strongest green bars.
 * - Contribution (what makes half of sales): the brand green, as washes, tiles and the share meter.
 * - Stock left: violet, on thinner bars with muted labels, so it reads last.
 * - Refill rows carry their stock flag (Stock-out brick, Low stock orange); rules in BUSINESS_RULES.md.
 * - Face: a sage ground from the produce world (#f2f5f2) under white, flat, bordered panels.
 * - Signature element: the "half of today's sales" emphasis, shared by the product and category rankings.
 * - Data colours checked with the dataviz validator; text tiers hold 4.5:1 on their surfaces.
 * On screen the layout is fluid; the photo is a fixed 1080px sheet.
 */

const C = {
  ground: '#f2f5f2',
  surface: '#ffffff',
  border: '#e4e8e5',
  rule: '#eef1ef',
  text: '#14201b',
  muted: '#5b6660',
  forest: '#37604C', // lead tile ground; white text on it is 6.9:1
  sold: '#16804F', // sales series (validated with stock: CVD dE 20.5, both 3:1 on white)
  contribution: '#2BB673', // brand green: what makes half of sales
  contributionWash: '#e6f6ed',
  contributionLine: '#9fd4b5',
  soldQuiet: '#a8cdb8', // sales outside the top half: same hue, stepped back
  contributionInk: '#176b43', // share figures as text, 5.9:1 on the wash
  stock: '#8C82E0', // stock left: violet, thinner marks
}

const CATEGORY_ROWS = 10 // nine categories plus "Other"; ranked bars stay readable well past a pie's limit
const PRODUCT_LIST_HEIGHT = 372 // on-screen scroll box
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
  /** Stock figures include stock in that arrived after the closing. */
  showsCurrent?: boolean
  /** Fruit or Vegies, shown after the title; left out for Both. */
  sectionTitle?: string
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

/**
 * Units sold by category as ranked horizontal bars: one baseline, largest first, so close
 * values (9% vs 8%) can be told apart. One hue: the categories making half of sales are the
 * brand green, the rest the same hue stepped back, split by a cut-off line. "Other" stays last.
 */
function CategoryBars({ slices, onHover, onLeave, soldLabel = 'units sold' }: {
  slices: CategorySlice[]
  onHover?: ShowTooltip
  onLeave?: () => void
  /** "units sold", or "sold a day" when the figures are daily averages. */
  soldLabel?: string
}) {
  const emphasised = topCategoryLabels(slices)
  const maxSold = Math.max(1, ...slices.map((slice) => slice.sold))
  const emphasisedShare = slices.filter((slice) => emphasised.has(slice.label)).reduce((sum, slice) => sum + slice.share, 0)

  return (
    <ol className="mt-3" onPointerLeave={onLeave} aria-label="Units sold by category">
      {slices.map((slice, index) => {
        const isEmphasised = emphasised.has(slice.label)
        const share = `${Math.round(slice.share * 100)}%`
        const next = slices[index + 1]
        const isCutoff = isEmphasised && next !== undefined && !emphasised.has(next.label)
        const content = {
          title: slice.label,
          rows: [
            { label: soldLabel, value: formatQuantity(slice.sold) },
            { label: 'of sales', value: share },
          ],
        }
        return (
          <li key={slice.label}>
            <div
              tabIndex={onHover ? 0 : undefined}
              aria-label={`${slice.label}: ${formatQuantity(slice.sold)} units, ${share} of sales`}
              onPointerMove={onHover ? (event) => onHover(event, content) : undefined}
              onFocus={onHover ? (event) => onHover(event, content) : undefined}
              onBlur={onLeave}
              className="flex items-center gap-2 rounded-md px-1 py-[6px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              <span className={`w-24 shrink-0 truncate ${isEmphasised ? 'font-semibold' : ''}`} title={slice.label}>{slice.label}</span>
              <div className="h-[10px] min-w-0 flex-1">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(1.5, (slice.sold / maxSold) * 100)}%`,
                    backgroundColor: isEmphasised ? C.contribution : C.soldQuiet,
                    borderRadius: BAR_RADIUS,
                  }}
                />
              </div>
              <span className="w-7 shrink-0 text-right tabular-nums" style={{ color: C.muted }}>{formatQuantity(slice.sold)}</span>
              <span
                className="w-9 shrink-0 text-right tabular-nums"
                style={{ color: isEmphasised ? C.contributionInk : C.text, fontWeight: isEmphasised ? 600 : 400 }}
              >
                {share}
              </span>
            </div>
            {isCutoff ? (
              <div className="my-1 flex items-center gap-2 text-[11px]" style={{ color: C.contributionInk }}>
                <span className="h-px flex-1" style={{ backgroundColor: C.contributionLine }} />
                {Math.round(emphasisedShare * 100)}% of sales above this line
                <span className="h-px w-4" style={{ backgroundColor: C.contributionLine }} />
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function DailyReportSummary({ containerRef, photoMode = false, date, prevClosingDate, entries, showsCurrent = false, sectionTitle }: DailyReportSummaryProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(null)

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
  const categorySlices = soldByCategory(entries, CATEGORY_ROWS)
  const refill = refillList(entries)
  const soldOutCount = refill.filter((item) => item.flag === 'Stock-out').length
  const lowStockCount = refill.length - soldOutCount
  // The photo keeps the most urgent rows; the screen lists every one.
  const visibleRefill = photoMode ? refill.slice(0, REFILL_ROW_LIMIT) : refill
  const hiddenRefillCount = refill.length - visibleRefill.length
  const maxSold = Math.max(1, ...products.map((product) => product.sold))
  const unreliable = summary.itemsWithoutBaseline + summary.itemsWithNegative
  // Closings more than a day apart (e.g. Thursday, then Saturday): every sold figure is a
  // daily average, and the labels say so.
  const days = summary.days
  const multiDay = days > 1
  const perDay = multiDay ? ' a day' : ''

  // The screen's one finding, read first under the title.
  const salesFinding = topContributors.length > 0
      ? (
        <>
          {topContributors.length} item{topContributors.length === 1 ? '' : 's'} made{' '}
          <span className="font-semibold" style={{ color: C.contributionInk }}>{Math.round(topContributorShare * 100)}%</span> of{' '}
          <span className="font-semibold">{formatQuantity(summary.totalSold)}</span> units sold{perDay}
        </>
      )
      : 'No sales recorded for this date'
  const refillFinding = refill.length > 0
      ? `${refill.length} to refill${soldOutCount > 0 ? `, ${soldOutCount} stock-out` : ''}`
      : 'nothing to refill'

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

  type Kpi = { label: string; value: string; note: string; tier: 'sold' | 'contribution' | 'stock'; share?: number }
  const kpis: Kpi[] = [
    {
      label: multiDay ? 'Units sold a day' : 'Units sold',
      value: formatQuantity(summary.totalSold),
      note: multiDay
        ? `${formatQuantity(summary.totalSoldAllDays)} over ${days} days · stock in ${formatQuantity(summary.totalStockIn)}`
        : `Stock in today ${formatQuantity(summary.totalStockIn)}`,
      tier: 'sold',
    },
    {
      label: 'Top selling category',
      value: topCategory?.label ?? '—',
      note: topCategory ? `${formatQuantity(topCategory.sold)} units${perDay} · ${Math.round(topCategory.share * 100)}% of sales` : 'No sales recorded',
      tier: 'contribution',
      share: topCategory?.share,
    },
    { label: 'Stock left', value: formatQuantity(inventory.currentInventory), note: showsCurrent ? 'Units on hand now' : 'Units after closing', tier: 'stock' },
    { label: 'Products in hand', value: String(inventory.productsInHand), note: 'Items with stock left', tier: 'stock' },
  ]

  return (
    <div
      ref={containerRef}
      className={`${photoMode ? 'w-[1080px] p-8' : 'w-full p-4 sm:p-6'}`}
      style={{ backgroundColor: C.ground, color: C.text }}
    >
      {/* The photo carries its own title and date; on screen the app bar and date picker already say both. */}
      {photoMode ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandTile size="md" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium" style={{ color: C.muted }}>Asian Grocer</p>
              <h2 className="text-[24px] font-semibold leading-tight">{sectionTitle ? `Daily summary · ${sectionTitle}` : 'Daily summary'}</h2>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[16px] font-semibold tabular-nums">{formatSheetDate(date)}</p>
            <p className="text-[13px]" style={{ color: C.muted }}>
              {prevClosingDate
                ? multiDay
                  ? `Daily average over ${days} days since closing of ${formatSheetDate(prevClosingDate)}`
                  : `Sold vs closing of ${formatSheetDate(prevClosingDate)}`
                : 'No earlier closing found'}
            </p>
          </div>
        </div>
      ) : null}
      {/* The finding and flag counts belong to the photo; on screen the tiles and charts carry them. */}
      {photoMode ? (
        <>
          <p className="mt-2 text-[15px]">
            {salesFinding} · <span className={`whitespace-nowrap ${refill.length ? 'font-semibold text-danger' : ''}`}>{refillFinding}</span>
          </p>
          <div aria-label="Stock flags" className="mt-3 flex flex-wrap gap-2">
            {stockFlags.map(flag => {
              const count = entries.filter(entry => entry.insight.stockFlag === flag).length
              return count > 0 ? <StockFlagBadge key={flag} flag={flag} count={count} /> : null
            })}
          </div>
        </>
      ) : null}

      {/* KPI tiles: colour steps down from units sold to contribution to stock left */}
      <div className={`${photoMode ? 'mt-4' : ''} grid gap-2 ${photoMode ? 'grid-cols-4' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {kpis.map((kpi) => {
          const tone = kpi.tier === 'sold'
            ? { backgroundColor: C.forest, color: '#ffffff', borderColor: C.forest }
            : kpi.tier === 'contribution'
              ? { backgroundColor: C.contributionWash, color: C.text, borderColor: C.contributionLine }
              : { backgroundColor: C.surface, color: C.text, borderColor: C.border }
          const subtle = kpi.tier === 'sold' ? 'rgba(255,255,255,0.85)' : C.muted
          return (
            <div key={kpi.label} className="flex min-w-0 flex-col rounded-lg border px-4 py-3.5" style={tone}>
              <p className="flex items-center gap-1.5 text-[13px]" style={{ color: subtle }}>
                {kpi.tier === 'stock' ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: C.stock }} aria-hidden="true" /> : null}
                {kpi.label}
              </p>
              <p
                className={`mt-1 truncate leading-tight tabular-nums ${kpi.tier === 'sold'
                  ? 'text-[36px] font-semibold'
                  : kpi.tier === 'contribution'
                    ? `${photoMode ? 'text-[24px]' : 'text-[20px] sm:text-[24px]'} pt-[5px] font-semibold`
                    : 'pt-[5px] text-[22px] font-medium'}`}
                title={kpi.value}
              >
                {kpi.value}
              </p>
              {kpi.share !== undefined ? (
                <div className="mt-2 h-[6px] rounded-full bg-white" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, kpi.share * 100)}%`, backgroundColor: C.contribution }} />
                </div>
              ) : null}
              <p className="mt-1.5 text-[12px]" style={{ color: subtle }}>{kpi.note}</p>
            </div>
          )
        })}
      </div>

      {/* Charts: the ranking and the category share end on one line */}
      <div className={`mt-4 grid gap-4 ${photoMode ? 'grid-cols-[minmax(0,1fr)_440px]' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]'}`}>
        <Panel className="min-w-0 px-5 py-4">
          <PanelTitle
            subtitle={topContributors.length > 0
              ? `Ranked by units sold${perDay}. The top ${topContributors.length} make ${Math.round(topContributorShare * 100)}% of sales.`
              : `Ranked by units sold${perDay}`}
          >
            Top selling products
          </PanelTitle>

          {products.length === 0 ? (
            <p className="mt-4 text-[14px]" style={{ color: C.muted }}>No sales recorded for this date.</p>
          ) : (
            <ol
              className={`mt-3 pr-1 ${photoMode ? '' : 'overflow-y-auto'}`}
              style={photoMode ? undefined : { maxHeight: PRODUCT_LIST_HEIGHT }}
              onPointerLeave={hideTooltip}
            >
              {listedProducts.map((product, index) => {
                const tooltipContent = {
                  title: product.name,
                  rows: [
                    { label: multiDay ? 'sold a day' : 'units sold', value: formatQuantity(product.sold), color: C.sold },
                    { label: 'of sales', value: `${Math.round(product.share * 100)}%` },
                    { label: 'stock left', value: formatQuantity(product.closing) },
                  ],
                }
                const isCutoff = product.isTopContributor && !listedProducts[index + 1]?.isTopContributor && index < listedProducts.length - 1
                return (
                  <li key={product.code}>
                    <div
                      tabIndex={photoMode ? undefined : 0}
                      onPointerMove={showTooltip ? (event) => showTooltip(event, tooltipContent) : undefined}
                      onFocus={showTooltip ? (event) => showTooltip(event, tooltipContent) : undefined}
                      onBlur={hideTooltip}
                      className="rounded-md px-1 py-[7px] outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      <div className="flex items-baseline gap-2 text-[13px]">
                        <span className="w-5 shrink-0 text-right text-[12px] tabular-nums" style={{ color: C.muted }}>{index + 1}</span>
                        <span className={`min-w-0 flex-1 truncate ${product.isTopContributor ? 'font-semibold' : ''}`} title={product.name}>{product.name}</span>
                        <span className="text-[14px] font-semibold tabular-nums">{formatQuantity(product.sold)}</span>
                        <span
                          className="w-9 shrink-0 text-right text-[12px] tabular-nums"
                          style={{ color: product.isTopContributor ? C.contributionInk : C.muted, fontWeight: product.isTopContributor ? 600 : 400 }}
                        >
                          {Math.round(product.share * 100)}%
                        </span>
                      </div>
                      {/* One series on its own axis: bar length is units sold against today's best seller. */}
                      <div className="mt-1 flex items-center gap-2 pl-7">
                        <div className="h-[8px] min-w-0 flex-1">
                          <div
                            className="h-full"
                            style={{
                              width: `${Math.max(1.5, (product.sold / maxSold) * 100)}%`,
                              backgroundColor: product.isTopContributor ? C.sold : C.soldQuiet,
                              borderRadius: BAR_RADIUS,
                            }}
                          />
                        </div>
                        <span className="flex w-[64px] shrink-0 items-center justify-end gap-1 text-[11px] tabular-nums" style={{ color: C.muted }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: C.stock }} aria-hidden="true" />
                          {formatQuantity(product.closing)} left
                        </span>
                      </div>
                    </div>
                    {isCutoff ? (
                      <div className="my-1.5 flex items-center gap-2 pl-7 text-[11px]" style={{ color: C.contributionInk }}>
                        <span className="h-px flex-1" style={{ backgroundColor: C.contributionLine }} />
                        {Math.round(topContributorShare * 100)}% of sales above this line
                        <span className="h-px w-4" style={{ backgroundColor: C.contributionLine }} />
                      </div>
                    ) : null}
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
          <PanelTitle subtitle={`Units sold${perDay} and share of sales, largest first`}>Sales by category</PanelTitle>
          {categorySlices.length === 0 ? (
            <p className="mt-3 text-[14px]" style={{ color: C.muted }}>No sales recorded for this date.</p>
          ) : (
            <CategoryBars slices={categorySlices} onHover={showTooltip} onLeave={hideTooltip} soldLabel={multiDay ? 'sold a day' : 'units sold'} />
          )}
        </Panel>
      </div>

      {/* Refill recommendations: the job for tomorrow */}
      <Panel className="mt-4 px-5 py-4">
        <PanelTitle
          subtitle="Stock-out first, then low stock with the least cover"
          aside={(
            <span className="shrink-0 pt-1 text-[13px] tabular-nums" style={{ color: C.muted }}>
              {soldOutCount} stock-out · {lowStockCount} low
            </span>
          )}
        >
          Refill for tomorrow
        </PanelTitle>

        {visibleRefill.length === 0 ? (
          <p className="mt-3 text-[14px]" style={{ color: C.muted }}>Nothing to refill. No item is out or low.</p>
        ) : (
          <div className="mt-2">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="text-[12px]" style={{ color: C.muted }}>
                  <th className="py-2 pr-2 font-normal">Item</th>
                  <th className={`py-2 pr-2 font-normal ${photoMode ? '' : 'hidden sm:table-cell'}`}>Category</th>
                  <th className="py-2 pr-2 text-right font-normal">{showsCurrent ? 'Current' : 'Closing'}</th>
                  <th className="py-2 pr-3 text-right font-normal">{multiDay ? 'Sold/day' : 'Sold'}</th>
                  <th className="py-2 text-right font-normal">Status</th>
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
                    <td className="py-2.5 pr-3 text-right tabular-nums">{item.sold === null ? '–' : formatQuantity(item.sold)}</td>
                    <td className="py-2.5 text-right">
                      <StockFlagBadge flag={item.flag} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hiddenRefillCount > 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
            {hiddenRefillCount} more item{hiddenRefillCount === 1 ? '' : 's'} out or low on the Dashboard
          </p>
        ) : null}
      </Panel>

      <p className="mt-3 text-[12px]" style={{ color: C.muted }}>
        Units sold = previous closing + stock in − closing.
        {multiDay ? ` The closings are ${days} days apart, so sold figures are a daily average.` : ''}
        {' '}Low stock = less than 3× {multiDay ? 'a day\u2019s' : 'today\u2019s'} sales left.
        {unreliable > 0 ? ` ${unreliable} item(s) left out: no earlier closing, or counts that do not add up.` : ''}
      </p>

      {photoMode ? null : <Tooltip state={tooltip} />}
    </div>
  )
}
