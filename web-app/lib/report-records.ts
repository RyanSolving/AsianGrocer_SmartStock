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

export type StockInRecord = { final_output: unknown; log_time: string | null }

/** A Stock In saved as an extra delivery adds to the day's main Stock In instead of replacing it. */
export function isExtraDelivery(finalOutput: unknown) {
  return (finalOutput as { extra_delivery?: unknown } | null)?.extra_delivery === true
}

/**
 * One date's Stock In figures from all records saved for it.
 * The latest main record counts (earlier main records are re-saves of the same delivery and
 * would double count), plus every record saved as an extra delivery.
 */
export function combineStockInRecords<T extends StockInRecord>(records: T[]) {
  const newestFirst = [...records].sort((a, b) => (b.log_time ?? '').localeCompare(a.log_time ?? ''))
  const main = newestFirst.find((record) => !isExtraDelivery(record.final_output)) ?? null
  const extras = newestFirst.filter((record) => isExtraDelivery(record.final_output))
  const quantities: QuantityByCode = {}
  for (const record of [...(main ? [main] : []), ...extras]) {
    for (const [code, quantity] of Object.entries(readStockInItems(record.final_output))) {
      quantities[code] = (quantities[code] ?? 0) + quantity
    }
  }
  const replacedCount = newestFirst.length - extras.length - (main ? 1 : 0)
  return { quantities, main, extras, replacedCount }
}

/** Short note for the report's Sources row, or undefined when one record was used. */
export function describeStockInRecords(extraCount: number, replacedCount: number) {
  const parts: string[] = []
  if (extraCount > 0) parts.push(`plus ${extraCount} extra ${extraCount === 1 ? 'delivery' : 'deliveries'}`)
  if (replacedCount > 0) parts.push(`${replacedCount} earlier ${replacedCount === 1 ? 'save' : 'saves'} replaced`)
  return parts.length > 0 ? parts.join(', ') : undefined
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
 * each day's closing against the latest closing before it, plus that day's stock in.
 * `closings` may include days before `start`, which serve as the first day's baseline.
 */
export function buildSalesTrend(input: {
  start: string
  end: string
  closings: Array<{ date: string; item_data: unknown }>
  /** Any order: per date, the latest main record plus every extra delivery is used. */
  stockIns: Array<{ stock_date: string; final_output: unknown; log_time: string | null }>
}): TrendDay[] {
  const closings = [...input.closings].sort((a, b) => a.date.localeCompare(b.date))
  const closingByDate = new Map(closings.map((row) => [row.date, readClosingItems(row.item_data).quantities]))

  const stockInsByDate = new Map<string, StockInRecord[]>()
  for (const row of input.stockIns) {
    const list = stockInsByDate.get(row.stock_date) ?? []
    list.push(row)
    stockInsByDate.set(row.stock_date, list)
  }

  const days: TrendDay[] = []
  for (let date = input.start; date <= input.end; date = addDays(date, 1)) {
    const closing = closingByDate.get(date)
    const stockInByCode = combineStockInRecords(stockInsByDate.get(date) ?? []).quantities
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
