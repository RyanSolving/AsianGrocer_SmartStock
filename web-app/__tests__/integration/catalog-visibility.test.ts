import { filterVisibleCatalogItems } from '../../lib/catalog-visibility'
import { catalogItemSchema } from '../../lib/stock-schema'

describe('catalog visibility', () => {
  it('keeps visible items and removes hidden ones', () => {
    const items = [
      { code: 'A-1', is_visible: true },
      { code: 'A-2', is_visible: false },
      { code: 'A-3' },
    ]

    expect(filterVisibleCatalogItems(items)).toEqual([
      { code: 'A-1', is_visible: true },
      { code: 'A-3' },
    ])
  })

  it('defaults catalog schema visibility to true', () => {
    const parsed = catalogItemSchema.parse({
      code: 'ABC-001-STD',
      location: 'Inside Coolroom',
      sub_location: 'Apples',
      category: 'Apples',
      product: 'Apple',
      attribute: '',
      official_name: 'Apple',
      stocklist_name: 'Apple',
      navigation_guide: '',
      row_position: 'single',
    })

    expect(parsed.is_visible).toBe(true)
  })
})
