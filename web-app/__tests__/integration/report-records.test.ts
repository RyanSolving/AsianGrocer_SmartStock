import { describe, expect, it } from '@jest/globals'

import { addDays, buildSalesTrend } from '../../lib/report-records'

const closing = (date: string, quantities: Record<string, number>) => ({
  date,
  item_data: { items: Object.entries(quantities).map(([code, quantity]) => ({ code, quantity })) },
})
const stockIn = (stock_date: string, quantities: Record<string, number>, log_time = `${stock_date}T07:00:00Z`) => ({
  stock_date,
  log_time,
  final_output: { stock_date, items: Object.entries(quantities).map(([catalog_code, quantity]) => ({ catalog_code, quantity })) },
})

describe('addDays', () => {
  it('moves across month ends', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('buildSalesTrend', () => {
  it('works out units sold per day like the Daily Report', () => {
    const days = buildSalesTrend({
      start: '2026-11-03',
      end: '2026-11-04',
      closings: [
        closing('2026-11-02', { A: 10, B: 5 }), // baseline before the range
        closing('2026-11-03', { A: 6, B: 5 }), // sold A 4 + 0 stock in
        closing('2026-11-04', { A: 8, B: 1 }), // A: 6 + 5 in - 8 = 3; B: 5 - 1 = 4
      ],
      stockIns: [stockIn('2026-11-04', { A: 5 })],
    })

    expect(days).toEqual([
      { date: '2026-11-03', unitsSold: 4, stockIn: 0, closingFound: true },
      { date: '2026-11-04', unitsSold: 7, stockIn: 5, closingFound: true },
    ])
  })

  it('leaves a day empty when it has no closing, and bridges to the next closing', () => {
    const days = buildSalesTrend({
      start: '2026-11-03',
      end: '2026-11-04',
      closings: [closing('2026-11-02', { A: 10 }), closing('2026-11-04', { A: 7 })],
      stockIns: [],
    })

    expect(days[0]).toEqual({ date: '2026-11-03', unitsSold: null, stockIn: 0, closingFound: false })
    expect(days[1].unitsSold).toBe(3) // against 2 Nov, the latest earlier closing
  })

  it('has no figure for the first day without an earlier closing', () => {
    const days = buildSalesTrend({ start: '2026-11-04', end: '2026-11-04', closings: [closing('2026-11-04', { A: 3 })], stockIns: [] })
    expect(days[0]).toMatchObject({ unitsSold: null, closingFound: true })
  })

  it('uses only the latest stock in of a day', () => {
    const days = buildSalesTrend({
      start: '2026-11-04',
      end: '2026-11-04',
      closings: [closing('2026-11-03', { A: 0 }), closing('2026-11-04', { A: 2 })],
      stockIns: [
        stockIn('2026-11-04', { A: 9 }, '2026-11-04T06:00:00Z'),
        stockIn('2026-11-04', { A: 5 }, '2026-11-04T08:00:00Z'),
      ],
    })
    expect(days[0]).toMatchObject({ stockIn: 5, unitsSold: 3 })
  })
})
