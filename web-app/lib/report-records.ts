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

/**
 * Stock In records from several dates (e.g. every day since the previous closing): each date
 * is combined on its own (latest main save + extra deliveries), then the dates are added.
 */
export function combineStockInByDate<T extends StockInRecord>(records: T[], dateOf: (record: T) => string | null) {
  const byDate = new Map<string, T[]>()
  for (const record of records) {
    const date = dateOf(record)
    if (!date) continue
    byDate.set(date, [...(byDate.get(date) ?? []), record])
  }
  const quantities: QuantityByCode = {}
  let extraCount = 0
  let replacedCount = 0
  /** The newest record used (main or extra), for the Sources row. */
  let latest: T | null = null
  for (const group of Array.from(byDate.values())) {
    const combined = combineStockInRecords(group)
    extraCount += combined.extras.length
    replacedCount += combined.replacedCount
    for (const record of [...(combined.main ? [combined.main] : []), ...combined.extras]) {
      if (!latest || (record.log_time ?? '') > (latest.log_time ?? '')) latest = record
    }
    for (const [code, quantity] of Object.entries(combined.quantities)) {
      quantities[code] = (quantities[code] ?? 0) + quantity
    }
  }
  return { quantities, dates: Array.from(byDate.keys()).sort(), extraCount, replacedCount, latest }
}

/** Whole calendar days from `from` to `to` (`YYYY-MM-DD`); 0 or less when `to` is not later. */
export function daysBetween(from: string, to: string) {
  const toUtc = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
}

/** The stock date a Stock In record was saved for, or null. */
export function stockDateOf(record: { final_output: unknown }) {
  const value = (record.final_output as { stock_date?: unknown } | null)?.stock_date
  return typeof value === 'string' ? value : null
}

/** Short note for the report's Sources row, or undefined when one record was used. */
export function describeStockInRecords(extraCount: number, replacedCount: number) {
  const parts: string[] = []
  if (extraCount > 0) parts.push(`plus ${extraCount} extra ${extraCount === 1 ? 'delivery' : 'deliveries'}`)
  if (replacedCount > 0) parts.push(`${replacedCount} earlier ${replacedCount === 1 ? 'save' : 'saves'} replaced`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

/**
 * The newest date, up to `today`, that has a full Daily Report: a closing saved that day and an
 * earlier closing to work out units sold from. Null when there is none yet.
 */
export function latestReportDate(closingDates: string[], today: string): string | null {
  const dates = Array.from(new Set(closingDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today)))
    .sort((a, b) => b.localeCompare(a))
  return dates.length >= 2 ? dates[0] : null
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
    const dayStockIn = combineStockInRecords(stockInsByDate.get(date) ?? []).quantities
    const stockIn = Object.values(dayStockIn).reduce((sum, value) => sum + value, 0)
    const previous = [...closings].reverse().find((row) => row.date < date)

    if (!closing || !previous) {
      days.push({ date, unitsSold: null, stockIn, closingFound: Boolean(closing) })
      continue
    }

    // Same rule as the Daily Report: every stock in since the previous closing, and sold as a
    // daily average when the closings are more than a day apart.
    const sinceRecords = input.stockIns.filter((row) => row.stock_date > previous.date && row.stock_date <= date)
    const insights = computeItemInsights({
      closingByCode: closing,
      prevClosingByCode: closingByDate.get(previous.date) ?? {},
      stockInByCode: combineStockInByDate(sinceRecords, (row) => row.stock_date).quantities,
      days: daysBetween(previous.date, date),
    })
    days.push({ date, unitsSold: summarizeInsights(insights).totalSold, stockIn, closingFound: true })
  }
  return days
}

/** How many days an item that is no longer on the closing stays on the report as out of stock. */
export const OUT_OF_STOCK_VISIBLE_DAYS = 7

/**
 * Codes that had stock (more than 0) at a closing in the `OUT_OF_STOCK_VISIBLE_DAYS` days before
 * `date`, but are not on `date`'s closing. Maps each code to the last closing date it had stock.
 */
export function findRecentlyStockedCodes(input: {
  date: string
  closingByCode: QuantityByCode
  earlierClosings: Array<{ date: string; item_data: unknown }>
}): Record<string, string> {
  const onClosing = new Set(Object.keys(input.closingByCode).map((code) => code.trim().toUpperCase()))
  const from = addDays(input.date, -OUT_OF_STOCK_VISIBLE_DAYS)
  const found: Record<string, string> = {}
  for (const row of input.earlierClosings) {
    if (row.date < from || row.date >= input.date) continue
    for (const [code, quantity] of Object.entries(readClosingItems(row.item_data).quantities)) {
      if (quantity <= 0 || onClosing.has(code.trim().toUpperCase())) continue
      if (!found[code] || row.date > found[code]) found[code] = row.date
    }
  }
  return found
}

/**
 * The closing and "arrived since" figures the report works from, with two kinds of item that a
 * blank or forgotten closing count would otherwise hide:
 * - on the newest report, stock in for the period of an item that is not on the closing counts as
 *   arrived (so a delivery missed at Stock Close still shows, as New);
 * - an item that had stock at a closing in the last 7 days but is not on this closing shows with
 *   a closing of 0 (out of stock) until the 7 days pass.
 */
export function withMissedCounts(input: {
  closingByCode: QuantityByCode
  stockInByCode: QuantityByCode
  arrivedSinceByCode?: QuantityByCode
  recentlyStockedByCode?: Record<string, string>
  isLatestClosing?: boolean | null
}) {
  const closingByCode: QuantityByCode = { ...input.closingByCode }
  const arrivedSinceByCode: QuantityByCode = { ...(input.arrivedSinceByCode ?? {}) }

  if (input.isLatestClosing === true) {
    for (const [code, quantity] of Object.entries(input.stockInByCode)) {
      if (!(quantity > 0) || code in closingByCode) continue
      arrivedSinceByCode[code] = (arrivedSinceByCode[code] ?? 0) + quantity
    }
  }
  for (const code of Object.keys(input.recentlyStockedByCode ?? {})) {
    if (code in closingByCode || (arrivedSinceByCode[code] ?? 0) > 0) continue
    closingByCode[code] = 0
  }
  return { closingByCode, arrivedSinceByCode }
}
