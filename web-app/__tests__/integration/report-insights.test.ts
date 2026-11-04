/**
 * Daily report sales insights: sold = previous closing + stock-in - today's closing.
 */

import { describe, expect, it } from '@jest/globals'

import {
  computeItemInsight,
  computeItemInsights,
  getStockFlag,
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

    expect(summary.totalSold).toBe(21)
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
