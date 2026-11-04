import type { ItemInsight, StockFlag } from './report-insights'

/**
 * Aggregations behind the Daily Report summary photo (charts + refill list).
 * Only items with a reliable sold figure (status "ok") are counted.
 */

export type ReportEntry = {
  code: string
  name: string
  category: string
  insight: ItemInsight
}

export type SellerBar = { code: string; name: string; sold: number; closing: number }

export type CategorySlice = { label: string; sold: number; share: number }

export type RefillFlag = Extract<StockFlag, 'Stock-out' | 'Low stock'>

export type RefillItem = {
  code: string
  name: string
  category: string
  closing: number
  /** Null when there is no reliable sold figure (no earlier closing, or counts that don't add up). */
  sold: number | null
  flag: RefillFlag
  /** Closing ÷ sold: days of stock left at today's pace. Null when nothing (reliable) sold. */
  cover: number | null
}

function soldOf(entry: ReportEntry) {
  return entry.insight.status === 'ok' ? entry.insight.sold ?? 0 : 0
}

export function topSellers(entries: ReportEntry[], limit: number): SellerBar[] {
  return entries
    .filter((entry) => entry.insight.status === 'ok' && soldOf(entry) > 0)
    .map((entry) => ({ code: entry.code, name: entry.name, sold: soldOf(entry), closing: entry.insight.closing ?? 0 }))
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export type RankedProduct = SellerBar & {
  /** Share of the day's total units sold. */
  share: number
  /** Part of the smallest set of best sellers that together make up `TOP_CONTRIBUTION_SHARE` of sales. */
  isTopContributor: boolean
}

/** Best sellers that together reach this share of the day's units sold are highlighted. */
export const TOP_CONTRIBUTION_SHARE = 0.5

/**
 * Every item with a reliable sold figure, best seller first (zero sellers last, by stock left).
 * Marks the top contributors: walking down the ranking, items are included until their
 * cumulative units sold reach `share` of the total (the item that crosses the line counts).
 */
export function rankProductsBySales(entries: ReportEntry[], share = TOP_CONTRIBUTION_SHARE): RankedProduct[] {
  const ranked = entries
    .filter((entry) => entry.insight.status === 'ok')
    .map((entry) => ({ code: entry.code, name: entry.name, sold: soldOf(entry), closing: entry.insight.closing ?? 0 }))
    .sort((a, b) => b.sold - a.sold || b.closing - a.closing || a.name.localeCompare(b.name))

  const total = ranked.reduce((sum, item) => sum + item.sold, 0)
  let cumulative = 0

  return ranked.map((item) => {
    const reachedBefore = total > 0 && cumulative >= total * share
    cumulative += item.sold
    return {
      ...item,
      share: total > 0 ? item.sold / total : 0,
      isTopContributor: total > 0 && item.sold > 0 && !reachedBefore,
    }
  })
}

function soldByKey(entries: ReportEntry[], keyOf: (entry: ReportEntry) => string, maxSlices: number): CategorySlice[] {
  const totals = new Map<string, number>()

  for (const entry of entries) {
    const sold = soldOf(entry)
    if (sold <= 0) continue
    const label = keyOf(entry).trim() || 'Other'
    totals.set(label, (totals.get(label) ?? 0) + sold)
  }

  const sorted = Array.from(totals.entries())
    .map(([label, sold]) => ({ label, sold }))
    .sort((a, b) => b.sold - a.sold || a.label.localeCompare(b.label))

  const grandTotal = sorted.reduce((sum, slice) => sum + slice.sold, 0)
  if (grandTotal === 0) return []

  let slices = sorted
  if (sorted.length > maxSlices) {
    const head = sorted.slice(0, maxSlices - 1)
    const otherSold = sorted.slice(maxSlices - 1).reduce((sum, slice) => sum + slice.sold, 0)
    slices = [...head, { label: 'Other', sold: otherSold }]
  }

  return slices.map((slice) => ({ ...slice, share: slice.sold / grandTotal }))
}

/** Sold units per category, biggest first; categories beyond `maxSlices - 1` collapse into "Other". */
export function soldByCategory(entries: ReportEntry[], maxSlices: number): CategorySlice[] {
  return soldByKey(entries, (entry) => entry.category || 'Other', maxSlices)
}

/** Sold units per product (sales contribution), same collapsing rule as soldByCategory. */
export function soldByProduct(entries: ReportEntry[], maxSlices: number): CategorySlice[] {
  return soldByKey(entries, (entry) => entry.name || entry.code, maxSlices)
}

/** Stock on hand after closing: how many products still have stock, and total units left. */
export function inventoryTotals(entries: ReportEntry[]) {
  let productsInHand = 0
  let currentInventory = 0

  for (const entry of entries) {
    const closing = entry.insight.closing ?? 0
    if (closing > 0) productsInHand += 1
    currentInventory += Math.max(0, closing)
  }

  return { productsInHand, currentInventory }
}

/**
 * Items to refill for tomorrow: Stock-out and Low stock only (see BUSINESS_RULES.md).
 * Order: Stock-out first (best sellers first), then Low stock by least cover, then most sold.
 */
export function refillList(entries: ReportEntry[]): RefillItem[] {
  const rank: Record<RefillFlag, number> = { 'Stock-out': 0, 'Low stock': 1 }
  return entries
    .filter((entry): entry is ReportEntry & { insight: ItemInsight & { stockFlag: RefillFlag } } =>
      entry.insight.stockFlag === 'Stock-out' || entry.insight.stockFlag === 'Low stock')
    .map((entry) => {
      const closing = entry.insight.closing ?? 0
      const sold = entry.insight.status === 'ok' ? entry.insight.sold : null
      return {
        code: entry.code,
        name: entry.name,
        category: entry.category,
        closing,
        sold,
        flag: entry.insight.stockFlag,
        cover: sold !== null && sold > 0 ? closing / sold : null,
      }
    })
    .sort((a, b) =>
      rank[a.flag] - rank[b.flag]
      || (a.flag === 'Low stock' ? (a.cover ?? 0) - (b.cover ?? 0) : 0)
      || (b.sold ?? -1) - (a.sold ?? -1)
      || a.name.localeCompare(b.name),
    )
}
