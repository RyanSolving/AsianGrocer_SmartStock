import { computeItemInsights, summarizeInsights } from './report-insights'

/**
 * Reading saved records into per-item quantities, shared by the Daily Report API and the
 * sales trend. Quantities on several rows of one code are added together.
 */

export type QuantityByCode = Record<string, number>

export function toQuantity(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readClosingItems(itemData: unknown) {
  const items = (itemData as { items?: unknown } | null)?.items
  const quantities: QuantityByCode = {}
  const redMarked: Record<string, boolean> = {}

  if (!Array.isArray(items)) return { quantities, redMarked }

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { code?: unknown; quantity?: unknown; red_marked?: unknown }
    const code = typeof item.code === 'string' ? item.code.trim() : ''
    const quantity = toQuantity(item.quantity)
    if (!code || quantity === null) continue

    quantities[code] = (quantities[code] ?? 0) + quantity
    if (item.red_marked === true) redMarked[code] = true
  }

  return { quantities, redMarked }
}

export function readStockInItems(finalOutput: unknown) {
  const items = (finalOutput as { items?: unknown } | null)?.items
  const quantities: QuantityByCode = {}

  if (!Array.isArray(items)) return quantities

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { catalog_code?: unknown; quantity?: unknown }
    const code = typeof item.catalog_code === 'string' ? item.catalog_code.trim() : ''
    const quantity = toQuantity(item.quantity)
    if (!code || quantity === null) continue

    quantities[code] = (quantities[code] ?? 0) + quantity
  }

  return quantities
}

/** `YYYY-MM-DD` plus `days` (negative goes back), in calendar days. */
export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day + days))
  return value.toISOString().slice(0, 10)
}

export type TrendDay = {
  date: string
  /** Units sold, by the Daily Report formula. Null when there is no closing or no earlier one. */
  unitsSold: number | null
  stockIn: number
  closingFound: boolean
}

/**
 * Units sold per day from `start` to `end`, the same way the Daily Report works it out:
 * each day's closing against the latest closing before it, plus that day's latest stock in.
 * `closings` may include days before `start`, which serve as the first day's baseline.
 */
export function buildSalesTrend(input: {
  start: string
  end: string
  closings: Array<{ date: string; item_data: unknown }>
  /** Newest first per date is not required: the latest `log_time` per stock date is used. */
  stockIns: Array<{ stock_date: string; final_output: unknown; log_time: string | null }>
}): TrendDay[] {
  const closings = [...input.closings].sort((a, b) => a.date.localeCompare(b.date))
  const closingByDate = new Map(closings.map((row) => [row.date, readClosingItems(row.item_data).quantities]))

  const latestStockIn = new Map<string, { log_time: string; final_output: unknown }>()
  for (const row of input.stockIns) {
    const current = latestStockIn.get(row.stock_date)
    const logTime = row.log_time ?? ''
    if (!current || logTime > current.log_time) latestStockIn.set(row.stock_date, { log_time: logTime, final_output: row.final_output })
  }

  const days: TrendDay[] = []
  for (let date = input.start; date <= input.end; date = addDays(date, 1)) {
    const closing = closingByDate.get(date)
    const stockInByCode = latestStockIn.has(date) ? readStockInItems(latestStockIn.get(date)!.final_output) : {}
    const stockIn = Object.values(stockInByCode).reduce((sum, value) => sum + value, 0)
    const previous = [...closings].reverse().find((row) => row.date < date)

    if (!closing || !previous) {
      days.push({ date, unitsSold: null, stockIn, closingFound: Boolean(closing) })
      continue
    }

    const insights = computeItemInsights({
      closingByCode: closing,
      prevClosingByCode: closingByDate.get(previous.date) ?? {},
      stockInByCode,
    })
    days.push({ date, unitsSold: summarizeInsights(insights).totalSold, stockIn, closingFound: true })
  }
  return days
}
