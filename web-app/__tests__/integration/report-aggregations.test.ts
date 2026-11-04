/**
 * Daily report summary aggregations: top sellers, sold by category, refill list.
 */

import { describe, expect, it } from '@jest/globals'

import { computeItemInsight } from '../../lib/report-insights'
import {
  inventoryTotals,
  rankProductsBySales,
  refillList,
  soldByCategory,
  soldByProduct,
  topSellers,
  type ReportEntry,
} from '../../lib/report-aggregations'

function entry(code: string, category: string, input: { prev: number | null; stockIn?: number; closing: number }): ReportEntry {
  return {
    code,
    name: `Item ${code}`,
    category,
    insight: computeItemInsight(code, { prevClosing: input.prev, stockIn: input.stockIn ?? 0, closing: input.closing }),
  }
}

const entries: ReportEntry[] = [
  entry('A', 'Apple', { prev: 20, closing: 10 }), // sold 10, order (10 > 10? no)
  entry('B', 'Apple', { prev: 30, closing: 5 }), // sold 25, order 20
  entry('C', 'Berries', { prev: 8, closing: 0 }), // sold 8, sold out
  entry('D', 'Berries', { prev: 0, closing: 0 }), // sold 0, not flagged
  entry('E', 'Melon', { prev: null, closing: 4 }), // no baseline
  entry('F', 'Melon', { prev: 5, closing: 9 }), // negative
]

describe('topSellers', () => {
  it('returns items with sold units, biggest first, limited', () => {
    const result = topSellers(entries, 2)

    expect(result.map((r) => r.code)).toEqual(['B', 'A'])
    expect(result[0].sold).toBe(25)
  })

  it('ignores no-baseline, negative and zero-sold items', () => {
    const codes = topSellers(entries, 10).map((r) => r.code)

    expect(codes).toEqual(['B', 'A', 'C'])
  })
})

describe('soldByCategory', () => {
  it('sums sold per category with shares adding to 1', () => {
    const slices = soldByCategory(entries, 6)

    expect(slices.map((s) => [s.label, s.sold])).toEqual([['Apple', 35], ['Berries', 8]])
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1)
  })

  it('collapses the tail into Other when over the slice limit', () => {
    const withThird = [...entries, entry('G', 'Grape', { prev: 4, closing: 1 })] // sold 3
    const slices = soldByCategory(withThird, 2)

    expect(slices.map((s) => s.label)).toEqual(['Apple', 'Other'])
    expect(slices[1].sold).toBe(11) // Berries 8 + Grape 3
  })

  it('returns nothing when no units were sold', () => {
    expect(soldByCategory([entry('Z', 'Apple', { prev: 3, closing: 3 })], 5)).toEqual([])
  })
})

describe('refillList', () => {
  it('lists ORDER items with sold-out first, then biggest shortfall', () => {
    const list = refillList(entries)

    expect(list.map((r) => r.code)).toEqual(['C', 'B'])
    expect(list[0].soldOut).toBe(true)
    expect(list[1].suggestedQty).toBe(20)
  })

  it('excludes items that are at zero but sold nothing', () => {
    expect(refillList(entries).map((r) => r.code)).not.toContain('D')
  })
})

describe('soldByProduct', () => {
  it('ranks products by units sold', () => {
    const slices = soldByProduct(entries, 10)

    expect(slices.map((s) => s.label)).toEqual(['Item B', 'Item A', 'Item C'])
  })
})

describe('inventoryTotals', () => {
  it('counts products with stock left and sums closing units', () => {
    // closings: A10 B5 C0 D0 E4 F9
    expect(inventoryTotals(entries)).toEqual({ productsInHand: 4, currentInventory: 28 })
  })
})

describe('topSellers closing', () => {
  it('carries the closing count for the inventory bar', () => {
    expect(topSellers(entries, 1)[0]).toMatchObject({ code: 'B', sold: 25, closing: 5 })
  })
})

describe('rankProductsBySales', () => {
  it('lists every reliable item, best seller first, zero sellers last', () => {
    const ranked = rankProductsBySales(entries)

    expect(ranked.map((r) => r.code)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('highlights the smallest set of best sellers reaching 50% of units sold', () => {
    // total 43: B alone (25) already crosses 21.5
    expect(rankProductsBySales(entries).filter((r) => r.isTopContributor).map((r) => r.code)).toEqual(['B'])

    const even = ['P', 'Q', 'R', 'S'].map((code) => entry(code, 'Fruit', { prev: 10, closing: 0 }))
    // 10 each, total 40: P (0 before) and Q (10 before) are in; R starts at 20 = half, so out
    expect(rankProductsBySales(even).filter((r) => r.isTopContributor).map((r) => r.code)).toEqual(['P', 'Q'])
  })

  it('never highlights items that sold nothing', () => {
    const none = [entry('Z', 'Fruit', { prev: 3, closing: 3 })]

    expect(rankProductsBySales(none)[0]).toMatchObject({ isTopContributor: false, share: 0 })
  })
})
