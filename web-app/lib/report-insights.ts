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
  /** Sold at least FAST_SELL_THROUGH of available stock. Independent of ORDER. */
  fast: boolean
}

export type QuantityMap = Record<string, number | null | undefined>

function toNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) ? value : null
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
  const sold = available - closing

  if (sold < 0) {
    // Closing is higher than what could have been available: entry error or missing stock-in.
    return { ...base, sold, status: 'negative' }
  }

  const sellThroughPct = available > 0 ? sold / available : null
  const suggestedQty = Math.max(0, Math.ceil(sold - closing))
  // Out of stock only matters when it sold today; an item at 0 that sold 0 is just not in season.
  const soldOut = closing === 0 && sold > 0
  const flag: OrderFlag = suggestedQty > 0 || soldOut ? 'ORDER' : null
  const fast = sellThroughPct !== null && sellThroughPct >= FAST_SELL_THROUGH

  return { ...base, sold, sellThroughPct, status: 'ok', suggestedQty, flag, fast }
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
