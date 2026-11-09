import { describe, expect, it } from '@jest/globals'

import { POST } from '../../app/api/export-csv/route'

const line = (overrides: Record<string, unknown>) => ({
  catalog_code: 'A1',
  product_raw: 'Fuji',
  location: 'Inside Coolroom',
  sub_location: 'Apples',
  category: 'Apples',
  product: 'Fuji',
  attribute: '',
  origin: '',
  inner_quantity: null,
  inner_unit: 'box',
  official_name: 'Fuji',
  row_position: 'single',
  quantity_raw: '4',
  quantity: 4,
  quantity_conflict_flag: false,
  confidence: 'high',
  notes: null,
  ...overrides,
})

async function exportCsv(items: unknown[], unknown_items: unknown[] = []) {
  const response = await POST(new Request('http://localhost/api/export-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photo_id: 'p1',
      mode: 'stock-in',
      upload_date: '2026-11-09T01:00:00.000Z',
      stock_date: '2026-11-09',
      photo_url: null,
      total_items: items.length,
      confidence_overall: 'high',
      items,
      unknown_items,
      validated: 'yes',
    }),
  }))
  expect(response.status).toBe(200)
  const [header, ...rows] = (await response.text()).split('\n')
  return { header: header.split(','), rows: rows.map((row) => row.split(',')) }
}

const sell = (price: number | null, unit = 'ea', deals: Array<{ qty: number; total: number }> = []) => ({ price, unit, deals })

describe('Stock In CSV prices', () => {
  it('ends with the price columns, after Special', async () => {
    const { header } = await exportCsv([line({})])
    expect(header.slice(-5)).toEqual(['Special', 'Price', 'Sold By', 'Deals', 'Catalog Price'])
  })

  it('writes the price, what it is sold by, the deals and the catalog price it started from', async () => {
    const { header, rows } = await exportCsv([
      line({ catalog_code: 'A1', sell: sell(4.99, 'ea', [{ qty: 2, total: 9 }, { qty: 3, total: 12 }]), catalog_sell: sell(4.5) }),
      line({ catalog_code: 'A2', sell: sell(9.99, 'kg'), catalog_sell: sell(9.99, 'kg') }),
      line({ catalog_code: 'A3', sell: sell(15.5), catalog_sell: sell(null) }),
    ])
    const cols = ['Price', 'Sold By', 'Deals', 'Catalog Price'].map((name) => header.indexOf(name))
    expect(rows.map((row) => cols.map((index) => row[index]))).toEqual([
      ['4.99', 'Each', '2 for 9.00; 3 for 12.00', '4.50'],
      ['9.99', 'KG', '', '9.99'],
      ['15.50', 'Each', '', ''],
    ])
  })

  it('leaves the price columns empty for rows without one, and keeps every row aligned', async () => {
    const { header, rows } = await exportCsv([line({})], [{ product_raw: 'Mystery', quantity: 2, sell: sell(9, 'pack') }])
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.length === header.length)).toBe(true)
    const price = header.indexOf('Price')
    expect(rows[0][price]).toBe('')
    expect(rows[1].slice(price, price + 4)).toEqual(['9.00', 'Pack', '', ''])
  })
})
