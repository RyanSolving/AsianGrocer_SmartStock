import { describe, expect, it } from '@jest/globals'

import { normalizeBlankStockCheckQuantities } from '../../lib/stock-check-utils'

describe('Stock check validate normalization', () => {
  it('replaces blank quantity cells with zero on validate', () => {
    const input = [
      {
        id: 'row-1',
        code: 'APP-GRN-STD',
        location: 'Inside Coolroom',
        sub_location: 'Apples',
        category: 'Apples',
        product: 'Apple',
        attribute: '',
        official_name: 'Granny Smith Apples',
        stocklist_name: 'Granny Smith Apples',
        navigation_guide: '',
        row_position: 'single' as const,
        quantity: null,
        red_marked: false,
        notes: '',
        source: 'catalog' as const,
      },
      {
        id: 'row-2',
        code: 'CIT-LEM-STD',
        location: 'Inside Coolroom',
        sub_location: 'Citrus',
        category: 'Citrus',
        product: 'Lemon',
        attribute: '',
        official_name: 'Lemons',
        stocklist_name: 'Lemons',
        navigation_guide: '',
        row_position: 'single' as const,
        quantity: 12,
        red_marked: false,
        notes: '',
        source: 'catalog' as const,
      },
    ]

    const output = normalizeBlankStockCheckQuantities(input)

    expect(output[0].quantity).toBe(0)
    expect(output[1].quantity).toBe(12)
    expect(output[0]).not.toBe(input[0])
    expect(output[1]).toBe(input[1])
  })
})
