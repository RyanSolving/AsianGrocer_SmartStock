/**
 * Daily report sales insights, computed per catalog code.
 *
 *   sold = previous closing + stock-in - today's closing
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
  sold: number | null
  sellThroughPct: number | null
  status: InsightStatus
  suggestedQty: number
  flag: OrderFlag
  stockFlag: StockFlag | null
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
  input: { closing: number | null | undefined; prevClosing: number | null | undefined; stockIn: number | null | undefined },
): ItemInsight {
  const closing = toNumber(input.closing)
  const prevClosing = toNumber(input.prevClosing)
  const stockIn = toNumber(input.stockIn) ?? 0

  const base: ItemInsight = {
    code,
    prevClosing,
    stockIn,
    closing,
    sold: null,
    sellThroughPct: null,
    status: 'ok',
    suggestedQty: 0,
    flag: null,
    stockFlag: getStockFlag(closing, null),
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
  const suggestedQty = Math.max(0, Math.ceil(sold - closing))
  // The refill quantity is a separate one-day demand estimate.
  const soldOut = closing === 0 && sold > 0
  const flag: OrderFlag = suggestedQty > 0 || soldOut ? 'ORDER' : null
  const fast = sellThroughPct !== null && sellThroughPct >= FAST_SELL_THROUGH

  return { ...base, sold, sellThroughPct, status: 'ok', suggestedQty, flag, fast, stockFlag: getStockFlag(closing, sold) }
}

export function computeItemInsights(input: {
  closingByCode: QuantityMap
  prevClosingByCode: QuantityMap
  stockInByCode: QuantityMap
}): Record<string, ItemInsight> {
  const result: Record<string, ItemInsight> = {}

  for (const code of Object.keys(input.closingByCode)) {
    result[code] = computeItemInsight(code, {
      closing: input.closingByCode[code],
      prevClosing: input.prevClosingByCode[code],
      stockIn: input.stockInByCode[code],
    })
  }

  return result
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
  }

  return summary
}

export function formatQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) return ''
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}
