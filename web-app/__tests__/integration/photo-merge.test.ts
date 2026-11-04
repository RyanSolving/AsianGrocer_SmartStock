import { mergePhotoRows, type MergeableRow } from '../../lib/photo-merge'

function row(code: string | null, name: string, quantity: number | null, notes = ''): MergeableRow {
  return { code, official_name: name, stocklist_name: name, product: name, quantity, notes }
}

describe('mergePhotoRows', () => {
  it('fills blanks from the photo and keeps counts already typed', () => {
    const current = [row('A', 'Apple', 5), row('B', 'Banana', null), row('C', 'Cherry', 2)]
    const parsed = [row('a', 'Apple', 7), row('B', 'Banana', 3), row('C', 'Cherry', 2)]

    const result = mergePhotoRows(current, parsed)

    expect(result.rows.map((r) => r.quantity)).toEqual([5, 3, 2])
    expect(result.filled).toBe(1) // Banana
    expect(result.kept).toBe(1) // Apple: typed 5, photo read 7
  })

  it('adds items only the photo has, by code or by name', () => {
    const current = [row('A', 'Apple', 5)]
    const parsed = [row(null, 'Dragon  Fruit', 4), row('Z', 'Zucchini', null)]

    const result = mergePhotoRows(current, parsed)

    expect(result.rows.map((r) => r.official_name)).toEqual(['Apple', 'Dragon  Fruit', 'Zucchini'])
    expect(result.filled).toBe(1)
  })

  it('never clears a typed count when the photo has the item blank', () => {
    const result = mergePhotoRows([row('A', 'Apple', 5)], [row('A', 'Apple', null)])
    expect(result.rows[0].quantity).toBe(5)
    expect(result).toMatchObject({ filled: 0, kept: 0 })
  })

  it('matches free-typed items by name, ignoring case and spacing', () => {
    const result = mergePhotoRows([row(null, 'Dragon fruit', null)], [row(null, ' dragon  FRUIT ', 6)])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].quantity).toBe(6)
  })

  it('uses the photo as is on an empty sheet', () => {
    const parsed = [row('A', 'Apple', 1), row('B', 'Banana', null)]
    expect(mergePhotoRows([], parsed)).toEqual({ rows: parsed, filled: 1, kept: 0 })
  })
})
