import { describe, expect, it } from '@jest/globals'

import { addDays, buildSalesTrend, combineStockInByDate, daysBetween, combineStockInRecords, describeStockInRecords, latestReportDate } from '../../lib/report-records'

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
      stockIns: [stockIn('2026-11-03', { A: 4 })],
    })

    expect(days[0]).toEqual({ date: '2026-11-03', unitsSold: null, stockIn: 4, closingFound: false })
    // Against 2 Nov: 10 + 4 (3 Nov stock in) − 7 = 7 over 2 days = 3.5, rounded up to 4 a day.
    expect(days[1].unitsSold).toBe(4)
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

const extra = (record: ReturnType<typeof stockIn>) => ({
  ...record,
  final_output: { ...record.final_output, extra_delivery: true },
})

describe('combineStockInRecords', () => {
  it('uses the latest main save and ignores earlier re-saves', () => {
    const result = combineStockInRecords([
      stockIn('2026-11-04', { A: 5 }, '2026-11-04T07:00:00Z'),
      stockIn('2026-11-04', { A: 6 }, '2026-11-04T07:30:00Z'),
    ])
    expect(result.quantities).toEqual({ A: 6 })
    expect(result.replacedCount).toBe(1)
    expect(result.extras).toHaveLength(0)
  })

  it('adds every extra delivery to the main save', () => {
    const result = combineStockInRecords([
      stockIn('2026-11-04', { A: 5, B: 2 }, '2026-11-04T07:00:00Z'),
      extra(stockIn('2026-11-04', { A: 3 }, '2026-11-04T13:00:00Z')),
      extra(stockIn('2026-11-04', { C: 1 }, '2026-11-04T15:00:00Z')),
    ])
    expect(result.quantities).toEqual({ A: 8, B: 2, C: 1 })
    expect(result.extras).toHaveLength(2)
    expect(result.replacedCount).toBe(0)
  })

  it('still counts extras when there is no main save', () => {
    expect(combineStockInRecords([extra(stockIn('2026-11-04', { A: 3 }))]).quantities).toEqual({ A: 3 })
  })

  it('feeds the sales trend the same way', () => {
    const days = buildSalesTrend({
      start: '2026-11-04',
      end: '2026-11-04',
      closings: [closing('2026-11-03', { A: 10 }), closing('2026-11-04', { A: 4 })],
      stockIns: [stockIn('2026-11-04', { A: 5 }), extra(stockIn('2026-11-04', { A: 3 }, '2026-11-04T13:00:00Z'))],
    })
    // 10 + (5 + 3) - 4
    expect(days[0].unitsSold).toBe(14)
    expect(days[0].stockIn).toBe(8)
  })
})

describe('describeStockInRecords', () => {
  it('names extras and replaced saves', () => {
    expect(describeStockInRecords(0, 0)).toBeUndefined()
    expect(describeStockInRecords(1, 0)).toBe('plus 1 extra delivery')
    expect(describeStockInRecords(2, 1)).toBe('plus 2 extra deliveries, 1 earlier save replaced')
  })
})

describe('latestReportDate', () => {
  it('picks the newest closing that has an earlier one', () => {
    expect(latestReportDate(['2026-11-01', '2026-11-04', '2026-11-03'], '2026-11-05')).toBe('2026-11-04')
  })
  it('ignores closings dated after today', () => {
    expect(latestReportDate(['2026-11-03', '2026-11-04', '2026-11-09'], '2026-11-05')).toBe('2026-11-04')
  })
  it('needs an earlier closing to compare against', () => {
    expect(latestReportDate(['2026-11-04'], '2026-11-05')).toBeNull()
    expect(latestReportDate(['2026-11-04', '2026-11-04'], '2026-11-05')).toBeNull()
  })
})

describe('combineStockInByDate (stock in since the closing)', () => {
  const dateOf = (record: { final_output: unknown }) => (record.final_output as { stock_date: string }).stock_date

  it('combines each date on its own, then adds the dates', () => {
    const records = [
      stockIn('2026-11-05', { A: 3 }, '2026-11-05T07:00:00Z'),
      stockIn('2026-11-05', { A: 5 }, '2026-11-05T08:00:00Z'), // re-save replaces the 07:00 one
      stockIn('2026-11-06', { A: 2, B: 1 }),
    ]
    const result = combineStockInByDate(records, dateOf)
    expect(result.quantities).toEqual({ A: 7, B: 1 })
    expect(result.dates).toEqual(['2026-11-05', '2026-11-06'])
  })

  it('is empty without records', () => {
    expect(combineStockInByDate([], dateOf)).toMatchObject({ quantities: {}, dates: [], extraCount: 0, replacedCount: 0, latest: null })
  })
})

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-11-05', '2026-11-07')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysBetween('2026-11-07', '2026-11-07')).toBe(0)
  })
})

describe('combineStockInByDate counts', () => {
  it('adds extras and replaced saves over dates and keeps the newest record', () => {
    const dateOf = (record: { final_output: unknown }) => (record.final_output as { stock_date: string }).stock_date
    const extra = (record: ReturnType<typeof stockIn>) => ({ ...record, final_output: { ...record.final_output, extra_delivery: true } })
    const result = combineStockInByDate([
      stockIn('2026-11-06', { A: 1 }, '2026-11-06T07:00:00Z'),
      stockIn('2026-11-06', { A: 2 }, '2026-11-06T08:00:00Z'),
      extra(stockIn('2026-11-07', { B: 3 }, '2026-11-07T09:00:00Z')),
    ], dateOf)
    expect(result.quantities).toEqual({ A: 2, B: 3 })
    expect(result.extraCount).toBe(1)
    expect(result.replacedCount).toBe(1)
    expect(result.latest?.log_time).toBe('2026-11-07T09:00:00Z')
  })
})
