/**
 * Daily report sales insights, computed per catalog code.
 *
 *   sold = previous closing + stock-in - today's closing
 *   current = today's closing + stock in that arrived after it (before the next closing)
 *
 * Badges and refill hints use current stock, so a delivery the next morning clears a
 * Stock-out at once; sold stays the day's figure until the next closing is saved.
 *
 * All quantities are in the same outer unit (box/bag/...), so the formula holds per code.
 */

// --- Tunable order-hint rules (v1) -------------------------------------------------
/** Sell-through at or above this share of available stock marks an item as selling fast. */
export const FAST_SELL_THROUGH = 0.8
// -----------------------------------------------------------------------------------

export type InsightStatus = 'ok' | 'no-baseline' | 'negative' | 'no-closing'

/** ORDER = expected demand tomorrow (today's sold) is not covered by closing stock. */
export type OrderFlag = 'ORDER' | null

export const stockFlags = ['Stock-out', 'Low stock', 'Over-stock', 'No sell today'] as const
export type StockFlag = typeof stockFlags[number]

export function getStockFlag(closing: number | null, sold: number | null): StockFlag | null {
  if (closing === null || !Number.isFinite(closing) || closing < 0) return null
  if (closing === 0) return 'Stock-out'
  if (sold === null || !Number.isFinite(sold) || sold < 0) return null
  if (sold === 0) return 'No sell today'

  // Ignore binary floating-point noise at the exact thresholds for fractional quantities.
  const cover = Number((closing / sold).toPrecision(14))
  if (cover < 3) return 'Low stock'
  if (cover > 7) return 'Over-stock'
  return null
}

export type ItemInsight = {
  code: string
  prevClosing: number | null
  stockIn: number
  closing: number | null
  /** Stock in that arrived after this closing (none once a later closing exists). */
  arrivedSince: number
  /** closing + arrivedSince: what is on hand now. Null when the item is not on the closing. */
  current: number | null
  sold: number | null
  sellThroughPct: number | null
  status: InsightStatus
  suggestedQty: number
  flag: OrderFlag
  stockFlag: StockFlag | null
  /** The calculated flag, kept when staff change it by hand. */
  autoStockFlag?: StockFlag | null
  /** 'manual' when staff chose the flag (or removed it) on the Daily Report. */
  flagSource?: 'auto' | 'manual'
  /** Sold at least FAST_SELL_THROUGH of available stock. Independent of ORDER. */
  fast: boolean
}

export type QuantityMap = Record<string, number | null | undefined>

function toNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) ? value : null
}

export function unitsSold(available: number, closing: number) {
  const difference = available - closing
  const roundingError = Number.EPSILON * Math.max(Math.abs(available), Math.abs(closing))
  return Math.abs(difference) <= roundingError ? 0 : difference
}

export function computeItemInsight(
  code: string,
  input: {
    closing: number | null | undefined
    prevClosing: number | null | undefined
    stockIn: number | null | undefined
    arrivedSince?: number | null | undefined
  },
): ItemInsight {
  const closing = toNumber(input.closing)
  const prevClosing = toNumber(input.prevClosing)
  const stockIn = toNumber(input.stockIn) ?? 0
  const arrivedSince = toNumber(input.arrivedSince) ?? 0
  const current = closing === null ? null : closing + arrivedSince

  const base: ItemInsight = {
    code,
    prevClosing,
    stockIn,
    closing,
    arrivedSince,
    current,
    sold: null,
    sellThroughPct: null,
    status: 'ok',
    suggestedQty: 0,
    flag: null,
    stockFlag: getStockFlag(current, null),
    fast: false,
  }

  if (closing === null) {
    return { ...base, status: 'no-closing' }
  }

  if (prevClosing === null) {
    // Never treat a missing baseline as zero: that would report a huge fake "sold" number.
    return { ...base, status: 'no-baseline' }
  }

  const available = prevClosing + stockIn
  const sold = unitsSold(available, closing)

  if (sold < 0) {
    // Closing is higher than what could have been available: entry error or missing stock-in.
    return { ...base, sold, status: 'negative' }
  }

  const sellThroughPct = available > 0 ? sold / available : null
  const onHand = current ?? closing
  const suggestedQty = Math.max(0, Math.ceil(sold - onHand))
  // The refill quantity is a separate one-day demand estimate.
  const soldOut = onHand === 0 && sold > 0
  const flag: OrderFlag = suggestedQty > 0 || soldOut ? 'ORDER' : null
  const fast = sellThroughPct !== null && sellThroughPct >= FAST_SELL_THROUGH

  return { ...base, sold, sellThroughPct, status: 'ok', suggestedQty, flag, fast, stockFlag: getStockFlag(onHand, sold) }
}

export function computeItemInsights(input: {
  closingByCode: QuantityMap
  prevClosingByCode: QuantityMap
  stockInByCode: QuantityMap
  /** Stock in saved after the closing date (and before any later closing). */
  arrivedSinceByCode?: QuantityMap
}): Record<string, ItemInsight> {
  const result: Record<string, ItemInsight> = {}

  for (const code of Object.keys(input.closingByCode)) {
    result[code] = computeItemInsight(code, {
      closing: input.closingByCode[code],
      prevClosing: input.prevClosingByCode[code],
      stockIn: input.stockInByCode[code],
      arrivedSince: input.arrivedSinceByCode?.[code],
    })
  }

  return result
}

export type FlagOverrides = Record<string, { flag: string | null } | undefined>

function isStockFlag(value: unknown): value is StockFlag {
  return typeof value === 'string' && (stockFlags as readonly string[]).includes(value)
}

/**
 * Staff choices win over the calculated flag (BUSINESS_RULES.md §3b). An override of
 * `null` removes the badge. Codes match ignoring case and outer spaces.
 */
export function applyFlagOverrides(insights: Record<string, ItemInsight>, overrides: FlagOverrides): Record<string, ItemInsight> {
  const byCode = new Map<string, { flag: string | null }>()
  for (const [code, override] of Object.entries(overrides)) {
    if (override) byCode.set(code.trim().toUpperCase(), override)
  }

  const result: Record<string, ItemInsight> = {}
  for (const [code, insight] of Object.entries(insights)) {
    const override = byCode.get(code.trim().toUpperCase())
    result[code] = override
      ? { ...insight, autoStockFlag: insight.stockFlag, stockFlag: isStockFlag(override.flag) ? override.flag : null, flagSource: 'manual' }
      : { ...insight, autoStockFlag: insight.stockFlag, flagSource: 'auto' }
  }
  return result
}

/** One line on why the calculated flag is what it is, for the badge picker. */
export function describeAutoFlag(
  insight: Pick<ItemInsight, 'closing' | 'sold' | 'status'> & { current?: number | null; autoStockFlag?: StockFlag | null; stockFlag: StockFlag | null },
) {
  const flag = insight.autoStockFlag !== undefined ? insight.autoStockFlag : insight.stockFlag
  const closing = insight.current ?? insight.closing
  const sold = insight.status === 'ok' ? insight.sold : null
  if (closing === 0) return insight.current !== undefined && insight.current !== insight.closing ? 'Current stock is 0.' : 'Closing is 0.'
  if (closing === null) return 'Not on the closing.'
  if (insight.status === 'negative') return `Sold is ${formatQuantity(insight.sold)}: the closing is above the earlier closing plus stock in. Check both counts.`
  if (sold === null) return insight.status === 'no-baseline' ? 'No earlier closing, so units sold is unknown.' : 'Units sold could not be worked out.'
  if (sold === 0) return `${formatQuantity(closing)} left and nothing sold.`
  const cover = Math.round((closing / sold) * 10) / 10
  const rule = flag === 'Low stock' ? ', under 3' : flag === 'Over-stock' ? ', over 7' : ', between 3 and 7'
  return `${formatQuantity(closing)} left ÷ ${formatQuantity(sold)} sold = ${cover} days${rule}.`
}

export type InsightSummary = {
  totalSold: number
  totalStockIn: number
  itemsToOrder: number
  itemsWithoutBaseline: number
  itemsWithNegative: number
}

export function summarizeInsights(insights: Record<string, ItemInsight>): InsightSummary {
  const summary: InsightSummary = {
    totalSold: 0,
    totalStockIn: 0,
    itemsToOrder: 0,
    itemsWithoutBaseline: 0,
    itemsWithNegative: 0,
  }

  for (const insight of Object.values(insights)) {
    summary.totalStockIn += insight.stockIn

    if (insight.status === 'no-baseline') summary.itemsWithoutBaseline += 1
    if (insight.status === 'negative') summary.itemsWithNegative += 1

    if (insight.status === 'ok') {
      summary.totalSold += insight.sold ?? 0
      if (insight.flag === 'ORDER') summary.itemsToOrder += 1
    }
    // A negative figure is a miscount (or a missing stock in). It still counts, so a
    // count that was too low one day and corrected the next nets out over the two days.
    if (insight.status === 'negative') summary.totalSold += insight.sold ?? 0
  }

  return summary
}

export function formatQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) return ''
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}
