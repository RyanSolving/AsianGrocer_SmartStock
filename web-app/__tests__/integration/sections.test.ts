/**
 * Fruit / Vegies sections: which section an item or record belongs to, and how the
 * Stock Close save row carries it.
 */

import { describe, expect, it } from '@jest/globals'

import { buildSupabaseStockCheckUpsertRow, type SupabaseStockCheckRecordData } from '../../lib/stock-check-save'
import { filterBySection, parseSection, parseSectionChoice, sectionOfItems, sectionOfLocation, sectionsOf, splitBySection } from '../../lib/sections'
import { saveToWarehouseEnvelopeSchema } from '../../lib/stock-schema'

const item = (location: string) => ({ location })

describe('sections', () => {
  it('treats the Vegies location as vegies and everything else as fruit', () => {
    expect(sectionOfLocation('Vegies')).toBe('vegies')
    expect(sectionOfLocation(' vegies ')).toBe('vegies')
    expect(sectionOfLocation('Inside Coolroom')).toBe('fruit')
    expect(sectionOfLocation('Outside Coolroom')).toBe('fruit')
    expect(sectionOfLocation('Unknown')).toBe('fruit')
    expect(sectionOfLocation(undefined)).toBe('fruit')
  })

  it('expands a choice into sections, fruit first', () => {
    expect(sectionsOf('fruit')).toEqual(['fruit'])
    expect(sectionsOf('vegies')).toEqual(['vegies'])
    expect(sectionsOf('both')).toEqual(['fruit', 'vegies'])
  })

  it('filters items by choice', () => {
    const items = [item('Inside Coolroom'), item('Vegies'), item('Outside Coolroom')]
    expect(filterBySection(items, 'fruit')).toHaveLength(2)
    expect(filterBySection(items, 'vegies')).toEqual([item('Vegies')])
    expect(filterBySection(items, 'both')).toBe(items)
    expect(filterBySection(null, 'both')).toBeNull()
  })

  it('parses stored values and rejects anything else', () => {
    expect(parseSection('vegies')).toBe('vegies')
    expect(parseSection('both')).toBeNull()
    expect(parseSectionChoice('both')).toBe('both')
    expect(parseSectionChoice('veg')).toBeNull()
  })

  it('names the section a record belongs to by its items', () => {
    expect(sectionOfItems([item('Vegies'), item('Vegies'), item('Inside Coolroom')])).toBe('vegies')
    expect(sectionOfItems([item('Inside Coolroom')])).toBe('fruit')
    expect(sectionOfItems([])).toBe('fruit')
  })
})

describe('Stock Close save row', () => {
  const itemData = (location: string): SupabaseStockCheckRecordData => ({
    items: [{
      code: 'X', product: '', category: '', location, sub_location: '', origin: '', inner_quantity: null,
      inner_unit: 'box', official_name: 'X', stocklist_name: 'X', quantity: 1, red_marked: false, notes: '',
    }],
    unknown_items: [],
    validated: true,
  })

  it('uses the section it is given', () => {
    const row = buildSupabaseStockCheckUpsertRow({ userId: 'u', stockDate: '2026-11-12', itemData: itemData('Inside Coolroom'), section: 'vegies' })
    expect(row.section).toBe('vegies')
  })

  it('works the section out from the items when none is given', () => {
    expect(buildSupabaseStockCheckUpsertRow({ userId: 'u', stockDate: '2026-11-12', itemData: itemData('Vegies') }).section).toBe('vegies')
    expect(buildSupabaseStockCheckUpsertRow({ userId: 'u', stockDate: '2026-11-12', itemData: itemData('Inside Coolroom') }).section).toBe('fruit')
  })

  it('accepts a section on the save envelope and rejects an unknown one', () => {
    const base = {
      data: { photo_id: 'p', upload_date: '2026-11-12T00:00:00.000Z', stock_date: '2026-11-12', total_items: 0, items: [] },
    }
    expect(saveToWarehouseEnvelopeSchema.safeParse({ ...base, section: 'vegies' }).success).toBe(true)
    expect(saveToWarehouseEnvelopeSchema.safeParse(base).success).toBe(true)
    expect(saveToWarehouseEnvelopeSchema.safeParse({ ...base, section: 'both' }).success).toBe(false)
  })
})

describe('splitBySection (Stock In, one record per section)', () => {
  const line = (location: string, quantity: number | null) => ({ location, quantity })

  it('keeps one section as a single record whatever the item locations are', () => {
    const items = [line('Vegies', 2), line('Inside Coolroom', null)]
    expect(splitBySection(items, 'vegies')).toEqual([{ section: 'vegies', items }])
    expect(splitBySection(items, 'fruit')).toEqual([{ section: 'fruit', items }])
  })

  it('splits Both into fruit and vegies records when both have counts', () => {
    const fruit = line('Inside Coolroom', 3)
    const veg = line('Vegies', 5)
    expect(splitBySection([fruit, veg, line('Outside Coolroom', null)], 'both')).toEqual([
      { section: 'fruit', items: [fruit, line('Outside Coolroom', null)] },
      { section: 'vegies', items: [veg] },
    ])
  })

  it('does not create a record for a section with nothing counted', () => {
    const fruit = line('Inside Coolroom', 3)
    const groups = splitBySection([fruit, line('Vegies', null)], 'both')
    expect(groups.map((group) => group.section)).toEqual(['fruit'])
    expect(splitBySection([line('Vegies', 1), line('Inside Coolroom', null)], 'both').map((group) => group.section)).toEqual(['vegies'])
  })

  it('still returns one (empty) record when nothing is counted, so validation behaves as before', () => {
    expect(splitBySection([line('Vegies', null), line('Inside Coolroom', null)], 'both').map((group) => group.section)).toEqual(['fruit'])
  })
})
