/**
 * Daily report sales insights: sold = previous closing + stock-in - today's closing.
 */

import { describe, expect, it } from '@jest/globals'

import {
  applyFlagOverrides,
  computeItemInsight,
  computeItemInsights,
  describeAutoFlag,
  getStockFlag,
  perDay,
  summarizeInsights,
} from '../../lib/report-insights'

describe('computeItemInsight', () => {
  it('computes units sold from previous closing, stock-in and closing', () => {
    const insight = computeItemInsight('A1', { prevClosing: 10, stockIn: 20, closing: 12 })

    expect(insight.status).toBe('ok')
    expect(insight.sold).toBe(18)
    expect(insight.sellThroughPct).toBeCloseTo(0.6)
  })

  it('treats a missing stock-in as zero', () => {
    const insight = computeItemInsight('A1', { prevClosing: 10, stockIn: undefined, closing: 4 })

    expect(insight.sold).toBe(6)
    expect(insight.stockIn).toBe(0)
  })

  it('reports no-baseline (not zero) when there is no previous closing', () => {
    const insight = computeItemInsight('A1', { prevClosing: undefined, stockIn: 20, closing: 5 })

    expect(insight.status).toBe('no-baseline')
    expect(insight.sold).toBeNull()
    expect(insight.flag).toBeNull()
  })

  it('reports negative when closing exceeds what could have been available', () => {
    const insight = computeItemInsight('A1', { prevClosing: 5, stockIn: 0, closing: 9 })

    expect(insight.status).toBe('negative')
    expect(insight.sold).toBe(-4)
    expect(insight.suggestedQty).toBe(0)
  })

  it('reports no-closing when today has no count', () => {
    const insight = computeItemInsight('A1', { prevClosing: 5, stockIn: 0, closing: null })

    expect(insight.status).toBe('no-closing')
    expect(insight.sold).toBeNull()
  })

  it('leaves sell-through empty when nothing was available', () => {
    const insight = computeItemInsight('A1', { prevClosing: 0, stockIn: 0, closing: 0 })

    expect(insight.sold).toBe(0)
    expect(insight.sellThroughPct).toBeNull()
  })

  it('flags ORDER when tomorrow expected demand exceeds closing', () => {
    // sold 18, closing 4 -> need 14 more
    const insight = computeItemInsight('A1', { prevClosing: 2, stockIn: 20, closing: 4 })

    expect(insight.flag).toBe('ORDER')
    expect(insight.suggestedQty).toBe(14)
  })

  it('flags ORDER when an item sold out', () => {
    const insight = computeItemInsight('A1', { prevClosing: 3, stockIn: 0, closing: 0 })

    expect(insight.flag).toBe('ORDER')
  })

  it('does not flag an item that is at zero and sold nothing', () => {
    const insight = computeItemInsight('A1', { prevClosing: 0, stockIn: 0, closing: 0 })

    expect(insight.flag).toBeNull()
  })

  it('does not flag ORDER when closing covers expected demand', () => {
    // available 10, sold 4, closing 6 -> covered
    const calm = computeItemInsight('A2', { prevClosing: 10, stockIn: 0, closing: 6 })

    expect(calm.suggestedQty).toBe(0)
    expect(calm.flag).toBeNull()
    expect(calm.fast).toBe(false)
  })

  it('marks fast sellers at 80% sell-through or more', () => {
    // available 10, sold 8, closing 2
    const fast = computeItemInsight('A3', { prevClosing: 10, stockIn: 0, closing: 2 })

    expect(fast.fast).toBe(true)
    expect(fast.flag).toBe('ORDER')
  })

  it('does not flag items with no baseline or negative status', () => {
    expect(computeItemInsight('A1', { prevClosing: null, stockIn: 5, closing: 0 }).flag).toBeNull()
    expect(computeItemInsight('A2', { prevClosing: 1, stockIn: 0, closing: 9 }).flag).toBeNull()
  })
})

describe('computeItemInsights + summarizeInsights', () => {
  it('matches by code and summarizes totals', () => {
    const insights = computeItemInsights({
      closingByCode: { A1: 12, B2: 0, C3: 5, D4: 9 },
      prevClosingByCode: { A1: 10, B2: 3, D4: 1 },
      stockInByCode: { A1: 20, C3: 5 },
    })

    expect(insights.A1.sold).toBe(18)
    expect(insights.B2.sold).toBe(3)
    expect(insights.C3.status).toBe('no-baseline')
    expect(insights.D4.status).toBe('negative')

    const summary = summarizeInsights(insights)

    // 18 + 3, plus D4's miscount of -8 (1 + 0 - 9): negatives count so a miscount nets out.
    expect(summary.totalSold).toBe(13)
    expect(summary.totalStockIn).toBe(25)
    expect(summary.itemsWithoutBaseline).toBe(1)
    expect(summary.itemsWithNegative).toBe(1)
    // A1: sold 18 > closing 12 -> ORDER; B2: closing 0 -> ORDER
    expect(summary.itemsToOrder).toBe(2)
  })
})

describe('stock coverage flags', () => {
  it.each([
    [0, 0, 'Stock-out'], [0, null, 'Stock-out'], [0, 5, 'Stock-out'],
    [5, 0, 'No sell today'], [5, 2, 'Low stock'], [6, 2, null],
    [10, 2, null], [14, 2, null], [15, 2, 'Over-stock'],
    [0.3, 0.1, null], [null, 2, null], [3, null, null], [3, -1, null],
  ] as const)('closing %s and sold %s give %s', (closing, sold, expected) => {
    expect(getStockFlag(closing, sold)).toBe(expected)
  })

  it('keeps zero sales distinct from missing sales', () => {
    expect(computeItemInsight('A', { prevClosing: 0.1, stockIn: 0.2, closing: 0.3 }).stockFlag).toBe('No sell today')
    expect(computeItemInsight('A', { prevClosing: null, stockIn: 0, closing: 3 }).stockFlag).toBeNull()
    expect(computeItemInsight('A', { prevClosing: null, stockIn: 0, closing: 0 }).stockFlag).toBe('Stock-out')
  })
})

describe('applyFlagOverrides', () => {
  const insights = {
    A: computeItemInsight('A', { prevClosing: 30, stockIn: 0, closing: 24 }), // sold 6, cover 4: no flag
    B: computeItemInsight('B', { prevClosing: 10, stockIn: 0, closing: 0 }), // Stock-out
    C: computeItemInsight('C', { prevClosing: 20, stockIn: 0, closing: 18 }), // sold 2, cover 9: Over-stock
  }

  it('lets a chosen flag replace the calculated one and keeps the calculated one', () => {
    const result = applyFlagOverrides(insights, { a: { flag: 'Low stock' } })
    expect(result.A.stockFlag).toBe('Low stock')
    expect(result.A.autoStockFlag).toBeNull()
    expect(result.A.flagSource).toBe('manual')
  })

  it('removes the badge when the override is null', () => {
    const result = applyFlagOverrides(insights, { C: { flag: null } })
    expect(result.C.stockFlag).toBeNull()
    expect(result.C.autoStockFlag).toBe('Over-stock')
  })

  it('leaves items without an override on their calculated flag', () => {
    const result = applyFlagOverrides(insights, {})
    expect(result.B).toMatchObject({ stockFlag: 'Stock-out', autoStockFlag: 'Stock-out', flagSource: 'auto' })
  })

  it('treats an unknown flag value as no badge', () => {
    expect(applyFlagOverrides(insights, { B: { flag: 'Sold well' } }).B.stockFlag).toBeNull()
  })
})

describe('describeAutoFlag', () => {
  it('explains cover in plain numbers', () => {
    const insight = computeItemInsight('C', { prevClosing: 20, stockIn: 0, closing: 18 })
    expect(describeAutoFlag(insight)).toBe('18 left ÷ 2 sold = 9 days, over 7.')
  })

  it('explains stock-out and no-sale items', () => {
    expect(describeAutoFlag(computeItemInsight('B', { prevClosing: 10, stockIn: 0, closing: 0 }))).toBe('Closing is 0.')
    expect(describeAutoFlag(computeItemInsight('D', { prevClosing: 7, stockIn: 0, closing: 7 }))).toBe('7 left and nothing sold.')
  })
})

describe('current stock (closing + stock in since)', () => {
  it('keeps sold for the closing day and badges on current stock', () => {
    const insight = computeItemInsight('A', { closing: 0, prevClosing: 4, stockIn: 0, arrivedSince: 6 })
    expect(insight.sold).toBe(4)
    expect(insight.current).toBe(6)
    expect(insight.stockFlag).toBe('Low stock')
    expect(insight.flag).toBeNull()
  })

  it('equals the closing when nothing arrived', () => {
    const insight = computeItemInsight('A', { closing: 0, prevClosing: 4, stockIn: 0 })
    expect(insight.current).toBe(0)
    expect(insight.stockFlag).toBe('Stock-out')
  })
})

describe('new stock not on the closing', () => {
  it('gets a row with current = what arrived and no sold figure', () => {
    const insights = computeItemInsights({ closingByCode: { A: 1 }, prevClosingByCode: { A: 1 }, stockInByCode: {}, arrivedSinceByCode: { N: 5 } })
    expect(insights.N.current).toBe(5)
    expect(insights.N.status).toBe('no-closing')
    expect(insights.N.sold).toBeNull()
    expect(insights.N.stockFlag).toBeNull()
  })
})

describe('closings more than a day apart (Thursday, then Saturday)', () => {
  it('shows sold as a daily average and keeps the total', () => {
    // Thu closing 10, Fri stock in 6, Sat closing 4: 12 sold over 2 days.
    const insight = computeItemInsight('A', { closing: 4, prevClosing: 10, stockIn: 6, days: 2 })
    expect(insight.soldTotal).toBe(12)
    expect(insight.sold).toBe(6)
    expect(insight.days).toBe(2)
    // Cover uses the daily figure: 4 left ÷ 6 a day < 3 days.
    expect(insight.stockFlag).toBe('Low stock')
  })

  it('rounds the average up to a whole unit', () => {
    expect(perDay(25, 2)).toBe(13) // 12.5
    expect(perDay(40, 3)).toBe(14) // 13.33
    expect(perDay(26, 2)).toBe(13) // exact stays
    expect(perDay(0.3 * 3, 3)).toBe(1) // no floating-point bump past an exact value
    expect(perDay(7, 1)).toBe(7)
    expect(computeItemInsight('A', { closing: 0, prevClosing: 7, stockIn: 0, days: 3 }).sold).toBe(3)
  })

  it('rounds a negative average away from zero', () => {
    expect(perDay(-5, 2)).toBe(-3)
  })

  it('averages a negative figure too', () => {
    const insight = computeItemInsight('A', { closing: 9, prevClosing: 5, stockIn: 0, days: 2 })
    expect(insight.status).toBe('negative')
    expect(insight.sold).toBe(-2)
    expect(insight.soldTotal).toBe(-4)
  })

  it('summarises units sold per day from the total', () => {
    const insights = computeItemInsights({
      closingByCode: { A: 4, B: 0 },
      prevClosingByCode: { A: 10, B: 3 },
      stockInByCode: { A: 6 },
      days: 2,
    })
    const summary = summarizeInsights(insights)
    expect(summary.totalSoldAllDays).toBe(15)
    expect(summary.totalSold).toBe(8) // 7.5 rounded up
    expect(summary.days).toBe(2)
  })

  it('explains the badge with a per-day rate', () => {
    const insight = computeItemInsight('A', { closing: 4, prevClosing: 10, stockIn: 6, days: 2 })
    expect(describeAutoFlag(insight)).toContain('6 sold a day')
  })
})
