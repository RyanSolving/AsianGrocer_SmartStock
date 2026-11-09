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

describe('Stock In CSV prices', () => {
  it('ends with Price and Catalog Price columns, after Special', async () => {
    const { header } = await exportCsv([line({})])
    expect(header.slice(-3)).toEqual(['Special', 'Price', 'Catalog Price'])
  })

  it('writes each row price in dollars and cents with the catalog price it started from', async () => {
    const { header, rows } = await exportCsv([
      line({ catalog_code: 'A1', price: 22, catalog_price: 20 }),
      line({ catalog_code: 'A2', price: 24.5, catalog_price: 24.5 }),
      line({ catalog_code: 'A3', price: 15.5, catalog_price: null }),
    ])
    const price = header.indexOf('Price')
    const catalogPrice = header.indexOf('Catalog Price')
    expect(rows.map((row) => [row[price], row[catalogPrice]])).toEqual([
      ['22.00', '20.00'],
      ['24.50', '24.50'],
      ['15.50', ''],
    ])
  })

  it('leaves the price columns empty for rows without one, and keeps the row aligned', async () => {
    const { header, rows } = await exportCsv([line({})], [{ product_raw: 'Mystery', quantity: 2, price: 9 }])
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.length === header.length)).toBe(true)
    const price = header.indexOf('Price')
    expect(rows[0][price]).toBe('')
    expect(rows[1][price]).toBe('9.00')
  })
})
