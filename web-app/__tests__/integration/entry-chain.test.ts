import { isRowListed, parseTypedQuantity, rankSuggestions, SUGGESTION_LIMIT } from '../../lib/entry-chain'

const item = (code: string, official_name: string, stocklist_name = official_name, product = '') => ({ code, official_name, stocklist_name, product })

describe('rankSuggestions', () => {
  const catalog = [
    item('FRU-PAP-STD', 'Papaya'),
    item('FRU-APP-FUJ', 'Fuji Apple'),
    item('FRU-APP-YEL', 'Yellow Apple'),
    item('FRU-APP-PNK', 'Pink Lady', 'Pink Lady', 'Apple'),
    item('FRU-APR-STD', 'Apricot'),
    item('APP', 'Apple Juice'),
  ]

  it('puts exact code matches first, then names that start with the term, then word starts', () => {
    expect(rankSuggestions(catalog, 'app').map((i) => i.code)).toEqual([
      'APP', // exact code
      'FRU-APP-FUJ', // a word in the name starts with "app"
      'FRU-APP-YEL',
      'FRU-APP-PNK', // only the product / code contain it
    ])
  })

  it('ranks a name that starts with the term above a name that only contains it', () => {
    expect(rankSuggestions(catalog, 'ap').map((i) => i.official_name).slice(0, 2)).toEqual(['Apricot', 'Apple Juice'])
  })

  it('ignores case and surrounding spaces and returns nothing for an empty term', () => {
    expect(rankSuggestions(catalog, '  PAPAYA ')).toHaveLength(1)
    expect(rankSuggestions(catalog, '   ')).toEqual([])
  })

  it(`limits the list to ${SUGGESTION_LIMIT} by default`, () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`C${i}`, `Melon ${i}`))
    expect(rankSuggestions(many, 'melon')).toHaveLength(SUGGESTION_LIMIT)
  })
})

describe('isRowListed', () => {
  it('keeps a touched row even after its quantity is cleared', () => {
    expect(isRowListed({ quantity: null, quantity_raw: '' }, true)).toBe(true)
    expect(isRowListed({ quantity: null, quantity_raw: '' }, false)).toBe(false)
  })

  it('lists rows with a quantity, a conflict or raw text', () => {
    expect(isRowListed({ quantity: 0 }, false)).toBe(true)
    expect(isRowListed({ quantity: null, quantity_conflict_flag: true }, false)).toBe(true)
    expect(isRowListed({ quantity: null, quantity_raw: ' 3? ' }, false)).toBe(true)
  })
})

describe('parseTypedQuantity', () => {
  it('reads whole numbers, decimals and comma decimals', () => {
    expect(parseTypedQuantity('12')).toBe(12)
    expect(parseTypedQuantity('12.5')).toBe(12.5)
    expect(parseTypedQuantity('12,5')).toBe(12.5)
  })

  it('rejects empty and non-numeric input', () => {
    expect(parseTypedQuantity('')).toBeNull()
    expect(parseTypedQuantity('abc')).toBeNull()
    expect(parseTypedQuantity('-3')).toBeNull()
  })
})
