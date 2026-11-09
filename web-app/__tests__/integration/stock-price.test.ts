import { describe, expect, it, jest } from '@jest/globals'

import { applyCatalogPriceChanges, collectPriceChanges } from '../../lib/catalog-prices'
import { catalogItemSchema, itemSchema } from '../../lib/stock-schema'
import { describePriceChange, formatPrice, parsePriceInput, priceChangeOf, priceToInput } from '../../lib/stock-price'

describe('formatPrice / priceToInput', () => {
  it('shows dollars and cents, and nothing when there is no price', () => {
    expect(formatPrice(24.5)).toBe('$24.50')
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(null)).toBe('')
    expect(formatPrice(undefined)).toBe('')
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
    expect(parsePriceInput(' 7 ')).toEqual({ ok: true, value: 7 })
  })

  it('treats an empty box as no price', () => {
    expect(parsePriceInput('')).toEqual({ ok: true, value: null })
    expect(parsePriceInput('  ')).toEqual({ ok: true, value: null })
  })

  it('rounds to the cent and rejects what is not an amount', () => {
    expect(parsePriceInput('1.005')).toEqual({ ok: true, value: 1.01 })
    expect(parsePriceInput('-3')).toEqual({ ok: false })
    expect(parsePriceInput('abc')).toEqual({ ok: false })
    expect(parsePriceInput('.')).toEqual({ ok: false })
    expect(parsePriceInput('1.2.3')).toEqual({ ok: false })
    expect(parsePriceInput('999999')).toEqual({ ok: false })
  })
})

describe('priceChangeOf', () => {
  it('is no change when the price matches the catalog price', () => {
    expect(priceChangeOf(20, 20, true)).toBeNull()
    expect(priceChangeOf(20.001, 20, true)).toBeNull()
  })

  it('reports a rise and a fall with the price it replaced', () => {
    expect(priceChangeOf(22, 20, true)).toEqual({ from: 20, to: 22, direction: 'up' })
    expect(priceChangeOf(18.5, 20, true)).toEqual({ from: 20, to: 18.5, direction: 'down' })
  })

  it('reports a price set on an item that had none', () => {
    expect(priceChangeOf(22, null, true)).toEqual({ from: null, to: 22, direction: 'new' })
    expect(priceChangeOf(22, undefined, true)).toEqual({ from: null, to: 22, direction: 'new' })
  })

  it('ignores rows with no price or no catalog item to compare with', () => {
    expect(priceChangeOf(null, 20, true)).toBeNull()
    expect(priceChangeOf(undefined, 20, true)).toBeNull()
    expect(priceChangeOf(22, 20, false)).toBeNull()
  })

  it('describes the change in one line', () => {
    expect(describePriceChange({ from: 20, to: 22, direction: 'up' })).toBe('Up from $20.00')
    expect(describePriceChange({ from: 20, to: 18.5, direction: 'down' })).toBe('Down from $20.00')
    expect(describePriceChange({ from: null, to: 22, direction: 'new' })).toBe('New price')
  })
})

describe('catalog item schema price', () => {
  const base = {
    code: 'APP-FUJ-STD',
    location: 'Inside Coolroom',
    sub_location: 'Apples',
    category: 'Apples',
    official_name: 'Fuji',
    stocklist_name: 'Fuji',
  }

  it('leaves the price out when the request has none, so editing other fields never clears it', () => {
    const parsed = catalogItemSchema.parse(base)
    expect(parsed.price).toBeUndefined()
  })

  it('clears the price on null or an empty box and reads typed amounts', () => {
    expect(catalogItemSchema.parse({ ...base, price: null }).price).toBeNull()
    expect(catalogItemSchema.parse({ ...base, price: '' }).price).toBeNull()
    expect(catalogItemSchema.parse({ ...base, price: '$24.505' }).price).toBe(24.51)
    expect(catalogItemSchema.parse({ ...base, price: 18 }).price).toBe(18)
  })

  it('rejects a negative or non-numeric price', () => {
    expect(catalogItemSchema.safeParse({ ...base, price: -1 }).success).toBe(false)
    expect(catalogItemSchema.safeParse({ ...base, price: 'abc' }).success).toBe(false)
  })
})

describe('saved Stock In lines keep their price', () => {
  it('keeps price and the catalog price it started from', () => {
    const line = itemSchema.parse({ product_raw: 'Fuji', price: 22, catalog_price: 20 })
    expect(line.price).toBe(22)
    expect(line.catalog_price).toBe(20)
  })

  it('accepts lines without prices', () => {
    const line = itemSchema.parse({ product_raw: 'Fuji' })
    expect(line.price).toBeUndefined()
  })
})

describe('collectPriceChanges', () => {
  it('lists the lines whose price differs from the catalog price they started from', () => {
    expect(collectPriceChanges([
      { catalog_code: 'A', price: 22, catalog_price: 20 },
      { catalog_code: 'B', price: 10, catalog_price: 10 },
      { catalog_code: 'C', price: 5, catalog_price: null },
    ])).toEqual([
      { code: 'A', from: 20, to: 22 },
      { code: 'C', from: null, to: 5 },
    ])
  })

  it('skips unknown items, unpriced lines and lines that were never stamped', () => {
    expect(collectPriceChanges([
      { catalog_code: null, price: 5, catalog_price: 4 },
      { catalog_code: 'A', price: null, catalog_price: 4 },
      { catalog_code: 'B', price: 9 },
      { catalog_code: '  ', price: 9, catalog_price: 8 },
    ])).toEqual([])
  })

  it('keeps one change per item, the later line winning, and drops it when the later line is back to the catalog price', () => {
    expect(collectPriceChanges([
      { catalog_code: 'A', price: 22, catalog_price: 20 },
      { catalog_code: 'A', price: 23, catalog_price: 20 },
    ])).toEqual([{ code: 'A', from: 20, to: 23 }])
    expect(collectPriceChanges([
      { catalog_code: 'A', price: 22, catalog_price: 20 },
      { catalog_code: 'A', price: 20, catalog_price: 20 },
    ])).toEqual([])
  })
})

describe('applyCatalogPriceChanges', () => {
  function fakeCatalog(rowsByCode: Record<string, number | null>) {
    const calls: Array<{ code: string; set: number; guard: string }> = []
    const supabase = {
      from: jest.fn(() => ({
        update: (values: { price: number }) => {
          const state: { code?: string; guard?: string; expected?: number | null } = {}
          const chain: any = {
            eq: (column: string, value: unknown) => {
              if (column === 'code') state.code = String(value)
              else { state.guard = `eq ${value}`; state.expected = Number(value) }
              return chain
            },
            is: () => { state.guard = 'is null'; state.expected = null; return chain },
            select: () => {
              const current = rowsByCode[state.code as string]
              const matches = current !== undefined && current === state.expected
              if (matches) rowsByCode[state.code as string] = values.price
              calls.push({ code: state.code as string, set: values.price, guard: state.guard as string })
              return Promise.resolve({ data: matches ? [{ code: state.code }] : [], error: null })
            },
          }
          return chain
        },
      })),
    }
    return { supabase, calls, rowsByCode }
  }

  it('sets the price only while the catalog still holds the price the line started from', async () => {
    const { supabase, rowsByCode } = fakeCatalog({ A: 20, B: 25, C: null })
    const applied = await applyCatalogPriceChanges(supabase, [
      { code: 'A', from: 20, to: 22 },
      { code: 'B', from: 20, to: 21 },
      { code: 'C', from: null, to: 5 },
    ])
    expect(applied.map((change) => change.code)).toEqual(['A', 'C'])
    expect(rowsByCode).toEqual({ A: 22, B: 25, C: 5 })
  })

  it('does not fail the save when the update throws', async () => {
    const supabase = { from: () => { throw new Error('boom') } }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(applyCatalogPriceChanges(supabase, [{ code: 'A', from: 1, to: 2 }])).resolves.toEqual([])
    errorSpy.mockRestore()
  })
})
