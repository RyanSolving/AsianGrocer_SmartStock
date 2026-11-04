import type { ItemInsight } from './report-insights'

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

export type RefillItem = {
  code: string
  name: string
  category: string
  closing: number
  sold: number
  suggestedQty: number
  soldOut: boolean
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

/** Items flagged ORDER, most urgent first: sold-out items, then biggest shortfall. */
export function refillList(entries: ReportEntry[]): RefillItem[] {
  return entries
    .filter((entry) => entry.insight.status === 'ok' && entry.insight.flag === 'ORDER')
    .map((entry) => ({
      code: entry.code,
      name: entry.name,
      category: entry.category,
      closing: entry.insight.closing ?? 0,
      sold: soldOf(entry),
      suggestedQty: entry.insight.suggestedQty,
      soldOut: (entry.insight.closing ?? 0) === 0,
    }))
    .sort((a, b) =>
      Number(b.soldOut) - Number(a.soldOut)
      || b.suggestedQty - a.suggestedQty
      || a.name.localeCompare(b.name),
    )
}
