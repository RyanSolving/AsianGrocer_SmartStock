import { findUncountedItems } from '../../lib/closing-completeness'

const catalog = [
  { code: 'A', label: 'Apple', section: 'Coolroom / Apple' },
  { code: 'B', label: 'Banana', section: 'Outside' },
  { code: 'C', label: 'Cherry', section: 'Coolroom / Berries' },
  { code: 'D', label: 'Durian', section: 'Outside' },
]

describe('findUncountedItems', () => {
  it('asks about items with stock last closing that are blank, missing or 0 now', () => {
    const result = findUncountedItems({
      sheet: [
        { code: 'A', label: 'Apple', section: 'Coolroom / Apple', quantity: null },
        { code: 'B', label: 'Banana', section: 'Outside', quantity: 0 },
      ],
      catalog,
      prevClosingByCode: { A: 5, B: 2, C: 4 },
      stockInByCode: {},
    })

    expect(result.map((item) => [item.code, item.reason])).toEqual([
      ['A', 'blank'], // blanks first, by area
      ['C', 'blank'], // not on the sheet at all
      ['B', 'zero'],
    ])
    expect(result[0].previousClosing).toBe(5)
  })

  it('asks about items that arrived today even with no stock last closing', () => {
    const result = findUncountedItems({
      sheet: [],
      catalog,
      prevClosingByCode: { D: 0 },
      stockInByCode: { D: 6 },
    })

    expect(result).toEqual([
      { code: 'D', label: 'Durian', section: 'Outside', previousClosing: 0, stockIn: 6, current: null, reason: 'blank' },
    ])
  })

  it('does not ask about counted items, items with no stock and no arrival, or items gone from the catalog', () => {
    const result = findUncountedItems({
      sheet: [{ code: 'a', label: 'Apple', section: 'Coolroom / Apple', quantity: 3 }],
      catalog,
      prevClosingByCode: { A: 5, B: 0, Z: 9 },
      stockInByCode: { B: 0 },
    })

    expect(result).toEqual([])
  })

  it('treats a code on two rows as counted when either row has a number', () => {
    const result = findUncountedItems({
      sheet: [
        { code: 'A', label: 'Apple', section: 'Coolroom / Apple', quantity: null },
        { code: 'A', label: 'Apple', section: 'Coolroom / Apple', quantity: 2 },
      ],
      catalog,
      prevClosingByCode: { A: 5 },
      stockInByCode: {},
    })

    expect(result).toEqual([])
  })
})
