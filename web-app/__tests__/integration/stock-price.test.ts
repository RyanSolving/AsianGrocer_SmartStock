import { describe, expect, it, jest } from '@jest/globals'

import { applyCatalogPriceChanges, collectPriceChanges } from '../../lib/catalog-prices'
import { catalogItemSchema, itemSchema, sellPriceOfCatalogItem } from '../../lib/stock-schema'
import {
  describePriceChange,
  formatDeals,
  formatMainPrice,
  formatPrice,
  formatSellPrice,
  normalizeDeals,
  normalizeSellPrice,
  parsePriceInput,
  priceChangeOf,
  priceToInput,
  sameSellPrice,
  type SellPrice,
} from '../../lib/stock-price'

const sell = (price: number | null, unit: SellPrice['unit'] = 'ea', deals: SellPrice['deals'] = []): SellPrice => ({ price, unit, deals })

describe('formatPrice / priceToInput', () => {
  it('shows dollars and cents, and nothing when there is no price', () => {
    expect(formatPrice(24.5)).toBe('$24.50')
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(null)).toBe('')
  })

  it('writes the box text without the dollar sign or trailing zeros', () => {
    expect(priceToInput(24.5)).toBe('24.5')
    expect(priceToInput(20)).toBe('20')
    expect(priceToInput(null)).toBe('')
  })
})

describe('parsePriceInput', () => {
  it('reads typed amounts', () => {
    expect(parsePriceInput('24.5')).toEqual({ ok: true, value: 24.5 })
    expect(parsePriceInput('$24.50')).toEqual({ ok: true, value: 24.5 })
    expect(parsePriceInput('24,5')).toEqual({ ok: true, value: 24.5 })
    expect(parsePriceInput('24.')).toEqual({ ok: true, value: 24 })
  })

  it('treats an empty box as no price, rounds to the cent and rejects what is not an amount', () => {
    expect(parsePriceInput('')).toEqual({ ok: true, value: null })
    expect(parsePriceInput('1.005')).toEqual({ ok: true, value: 1.01 })
    for (const bad of ['-3', 'abc', '.', '1.2.3', '99999999']) expect(parsePriceInput(bad)).toEqual({ ok: false })
  })
})

describe('selling price text', () => {
  it('shows the unit with the price', () => {
    expect(formatMainPrice(sell(9.99, 'kg'))).toBe('$9.99 /kg')
    expect(formatMainPrice(sell(9.99, 'ea'))).toBe('$9.99 ea')
    expect(formatMainPrice(sell(3.5, 'bunch'))).toBe('$3.50 /bunch')
    expect(formatMainPrice(sell(null))).toBe('')
  })

  it('lists combo deals and puts the whole price on one line', () => {
    const price = sell(4.99, 'ea', [{ qty: 2, total: 9 }, { qty: 3, total: 12 }])
    expect(formatDeals(price)).toBe('2 for $9.00 · 3 for $12.00')
    expect(formatSellPrice(price)).toBe('$4.99 ea · 2 for $9.00 · 3 for $12.00')
    expect(formatSellPrice(sell(null))).toBe('')
  })
})

describe('normalizing a sell price', () => {
  it('keeps valid deals, one per quantity, smallest first, and drops bad ones', () => {
    expect(normalizeDeals([
      { qty: 3, total: 12 }, { qty: 2, total: 9 }, { qty: 2, total: 8.5 },
      { qty: 1, total: 4 }, { qty: 2.5, total: 7 }, { qty: 4, total: 0 }, { qty: 'x', total: 5 }, null,
    ])).toEqual([{ qty: 2, total: 8.5 }, { qty: 3, total: 12 }])
    expect(normalizeDeals('nope')).toEqual([])
  })

  it('falls back to empty / Each for bad data', () => {
    expect(normalizeSellPrice({ price: 'abc', unit: 'box', deals: 5 })).toEqual(sell(null, 'ea', []))
    expect(normalizeSellPrice({ price: '9.999', unit: 'kg' })).toEqual(sell(10, 'kg', []))
    expect(normalizeSellPrice(null)).toEqual(sell(null))
  })

  it('compares prices by value, ignoring the unit when both are empty', () => {
    expect(sameSellPrice(sell(9, 'kg'), sell(9.001, 'kg'))).toBe(true)
    expect(sameSellPrice(sell(9, 'kg'), sell(9, 'ea'))).toBe(false)
    expect(sameSellPrice(sell(9, 'ea', [{ qty: 2, total: 16 }]), sell(9, 'ea'))).toBe(false)
    expect(sameSellPrice(sell(null, 'kg'), sell(null, 'ea'))).toBe(true)
  })
})

describe('priceChangeOf', () => {
  it('is no change when the price matches the catalog price', () => {
    expect(priceChangeOf(sell(20), sell(20), true)).toBeNull()
  })

  it('reports a rise and a fall of the normal price', () => {
    expect(priceChangeOf(sell(5), sell(4.99), true)?.direction).toBe('up')
    expect(priceChangeOf(sell(4), sell(4.99), true)?.direction).toBe('down')
  })

  it('reports a changed unit or deal as changed, and a first price as new', () => {
    expect(priceChangeOf(sell(4.99, 'kg'), sell(4.99, 'ea'), true)?.direction).toBe('changed')
    expect(priceChangeOf(sell(4.99, 'ea', [{ qty: 2, total: 9 }]), sell(4.99), true)?.direction).toBe('changed')
    expect(priceChangeOf(sell(4.99), sell(null), true)).toEqual({ from: null, to: sell(4.99), direction: 'new' })
    expect(priceChangeOf(sell(4.99), undefined, true)?.direction).toBe('new')
  })

  it('ignores rows with no price or no catalog item to compare with', () => {
    expect(priceChangeOf(sell(null), sell(20), true)).toBeNull()
    expect(priceChangeOf(sell(22), sell(20), false)).toBeNull()
  })

  it('describes the change in one line', () => {
    expect(describePriceChange(priceChangeOf(sell(5), sell(4.99), true)!)).toBe('Up from $4.99 ea')
    expect(describePriceChange(priceChangeOf(sell(4), sell(4.99), true)!)).toBe('Down from $4.99 ea')
    expect(describePriceChange(priceChangeOf(sell(9.99, 'kg'), sell(4.99, 'ea', [{ qty: 2, total: 9 }]), true)!)).toBe('Changed from $4.99 ea · 2 for $9.00')
    expect(describePriceChange(priceChangeOf(sell(4.99), sell(null), true)!)).toBe('New price')
  })
})

describe('catalog item schema price', () => {
  const base = { code: 'APP-FUJ-STD', location: 'Inside Coolroom', sub_location: 'Apples', category: 'Apples', official_name: 'Fuji', stocklist_name: 'Fuji' }

  it('leaves price, unit and deals out when the request has none, so editing other fields never clears them', () => {
    const parsed = catalogItemSchema.parse(base)
    expect(parsed.price).toBeUndefined()
    expect(parsed.price_unit).toBeUndefined()
    expect(parsed.price_deals).toBeUndefined()
  })

  it('clears the price on null or an empty box and reads typed amounts', () => {
    expect(catalogItemSchema.parse({ ...base, price: null }).price).toBeNull()
    expect(catalogItemSchema.parse({ ...base, price: '' }).price).toBeNull()
    expect(catalogItemSchema.parse({ ...base, price: '$24.505' }).price).toBe(24.51)
  })

  it('reads the unit and tidies the deals', () => {
    const parsed = catalogItemSchema.parse({ ...base, price: 9.99, price_unit: 'kg', price_deals: [{ qty: '3', total: '12' }, { qty: 2, total: 9 }, { qty: 1, total: 1 }] })
    expect(parsed.price_unit).toBe('kg')
    expect(parsed.price_deals).toEqual([{ qty: 2, total: 9 }, { qty: 3, total: 12 }])
  })

  it('rejects a negative or non-numeric price and an unknown unit', () => {
    expect(catalogItemSchema.safeParse({ ...base, price: -1 }).success).toBe(false)
    expect(catalogItemSchema.safeParse({ ...base, price: 'abc' }).success).toBe(false)
    expect(catalogItemSchema.safeParse({ ...base, price_unit: 'box' }).success).toBe(false)
  })

  it('reads a catalog item as a sell price', () => {
    expect(sellPriceOfCatalogItem({ price: 4.99, price_unit: 'ea', price_deals: [{ qty: 2, total: 9 }] })).toEqual(sell(4.99, 'ea', [{ qty: 2, total: 9 }]))
    expect(sellPriceOfCatalogItem({})).toEqual(sell(null))
  })
})

describe('saved Stock In lines keep their price', () => {
  it('keeps the selling price and the catalog price it started from', () => {
    const line = itemSchema.parse({ product_raw: 'Fuji', sell: sell(5, 'ea', [{ qty: 2, total: 9 }]), catalog_sell: sell(4.99) })
    expect(line.sell).toEqual(sell(5, 'ea', [{ qty: 2, total: 9 }]))
    expect(line.catalog_sell).toEqual(sell(4.99))
  })

  it('accepts lines without prices', () => {
    expect(itemSchema.parse({ product_raw: 'Fuji' }).sell).toBeUndefined()
  })
})

describe('collectPriceChanges', () => {
  it('lists the lines whose price differs from the catalog price they started from', () => {
    expect(collectPriceChanges([
      { catalog_code: 'A', quantity: 1, sell: sell(22), catalog_sell: sell(20) },
      { catalog_code: 'B', quantity: 1, sell: sell(10), catalog_sell: sell(10) },
      { catalog_code: 'C', quantity: 1, sell: sell(5, 'kg'), catalog_sell: sell(null) },
      { catalog_code: 'D', quantity: 1, sell: sell(4.99, 'ea', [{ qty: 2, total: 9 }]), catalog_sell: sell(4.99) },
    ])).toEqual([
      { code: 'A', from: sell(20), to: sell(22) },
      { code: 'C', from: null, to: sell(5, 'kg') },
      { code: 'D', from: sell(4.99), to: sell(4.99, 'ea', [{ qty: 2, total: 9 }]) },
    ])
  })

  it('skips unknown items, unpriced lines and lines that were never stamped', () => {
    expect(collectPriceChanges([
      { catalog_code: null, quantity: 1, sell: sell(5), catalog_sell: sell(4) },
      { catalog_code: 'A', quantity: 1, sell: sell(null), catalog_sell: sell(4) },
      { catalog_code: 'B', quantity: 1, sell: sell(9) },
      { catalog_code: '  ', quantity: 1, sell: sell(9), catalog_sell: sell(8) },
    ])).toEqual([])
  })

  it('keeps one change per item, the later line winning, and drops it when the later line is back to the catalog price', () => {
    expect(collectPriceChanges([
      { catalog_code: 'A', quantity: 1, sell: sell(22), catalog_sell: sell(20) },
      { catalog_code: 'A', quantity: 1, sell: sell(23), catalog_sell: sell(20) },
    ])).toEqual([{ code: 'A', from: sell(20), to: sell(23) }])
    expect(collectPriceChanges([
      { catalog_code: 'A', quantity: 1, sell: sell(22), catalog_sell: sell(20) },
      { catalog_code: 'A', quantity: 1, sell: sell(20), catalog_sell: sell(20) },
    ])).toEqual([])
  })
})

describe('applyCatalogPriceChanges', () => {
  type Row = { price: number | null; unit: string; deals: unknown }
  function fakeCatalog(rows: Record<string, Row>) {
    const supabase = {
      from: jest.fn(() => ({
        update: (values: { price: number | null; price_unit: string; price_deals: unknown }) => {
          const state: { code?: string; price?: number | null; unit?: string } = {}
          const chain: any = {
            eq: (column: string, value: unknown) => {
              if (column === 'code') state.code = String(value)
              if (column === 'price') state.price = Number(value)
              if (column === 'price_unit') state.unit = String(value)
              return chain
            },
            is: () => { state.price = null; return chain },
            select: () => {
              const row = rows[state.code as string]
              const matches = row !== undefined && row.price === state.price && (state.unit === undefined || row.unit === state.unit)
              if (matches) rows[state.code as string] = { price: values.price, unit: values.price_unit, deals: values.price_deals }
              return Promise.resolve({ data: matches ? [{ code: state.code }] : [], error: null })
            },
          }
          return chain
        },
      })),
    }
    return { supabase, rows }
  }

  it('sets the price, unit and deals only while the catalog still holds the price the line started from', async () => {
    const { supabase, rows } = fakeCatalog({ A: { price: 20, unit: 'ea', deals: [] }, B: { price: 25, unit: 'ea', deals: [] }, C: { price: null, unit: 'ea', deals: [] } })
    const applied = await applyCatalogPriceChanges(supabase, [
      { code: 'A', from: sell(20), to: sell(22, 'kg', [{ qty: 2, total: 40 }]) },
      { code: 'B', from: sell(20), to: sell(21) },
      { code: 'C', from: null, to: sell(5) },
    ])
    expect(applied.map((change) => change.code)).toEqual(['A', 'C'])
    expect(rows.A).toEqual({ price: 22, unit: 'kg', deals: [{ qty: 2, total: 40 }] })
    expect(rows.B.price).toBe(25)
    expect(rows.C.price).toBe(5)
  })

  it('does not fail the save when the update throws', async () => {
    const supabase = { from: () => { throw new Error('boom') } }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(applyCatalogPriceChanges(supabase, [{ code: 'A', from: sell(1), to: sell(2) }])).resolves.toEqual([])
    errorSpy.mockRestore()
  })
})

describe('price save rules (review fixes)', () => {
  const s = (price: number) => ({ price, unit: 'ea' as const, deals: [] })

  it('ignores rows that were not counted', () => {
    expect(collectPriceChanges([{ catalog_code: 'A', quantity: null, sell: s(5), catalog_sell: s(4) }])).toEqual([])
  })

  it('accepts a corrected re-save when the catalog holds the price this record set before', async () => {
    const calls: Array<{ price: unknown }> = []
    const catalogPrice = 40 // the typo price, already in the catalog
    const supabase = {
      from: () => {
        const filters: Record<string, unknown> = {}
        const q: any = {
          update: () => q,
          eq: (k: string, v: unknown) => { filters[k] = v; return q },
          is: (k: string, v: unknown) => { filters[k] = v; return q },
          select: async () => { calls.push({ price: filters.price }); return { data: filters.price === catalogPrice ? [{ code: 'A' }] : [], error: null } },
        }
        return q
      },
    }
    const changes = collectPriceChanges([{ catalog_code: 'A', quantity: 2, sell: s(4), catalog_sell: s(20) }])
    const applied = await applyCatalogPriceChanges(supabase, changes, new Map([['A', s(40)]]))
    expect(applied).toHaveLength(1)
    expect(calls.map((c) => c.price)).toEqual([20, 40])
  })

  it('reads a thousands comma', () => {
    expect(parsePriceInput('1,234.50')).toEqual({ ok: true, value: 1234.5 })
    expect(parsePriceInput('12,50')).toEqual({ ok: true, value: 12.5 })
  })
})
