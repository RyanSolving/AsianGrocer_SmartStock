/**
 * Fruit / Vegies sections: which section an item or record belongs to, and how the
 * Stock Close save row carries it.
 */

import { describe, expect, it } from '@jest/globals'

import { buildSupabaseStockCheckUpsertRow, type SupabaseStockCheckRecordData } from '../../lib/stock-check-save'
import { filterBySection, parseSection, parseSectionChoice, sectionOfItems, sectionOfLocation, sectionsOf, splitBySection, stockInPhotoParts } from '../../lib/sections'
import { catalogItemSchema, saveToWarehouseEnvelopeSchema } from '../../lib/stock-schema'
import { toLedgerAreas } from '../../lib/ledger-areas'
import { sectionQuestion } from '../../lib/section-question'

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

describe('vegie categories on the sheets', () => {
  it('puts vegie sections in their own Vegies area, after the coolroom areas', () => {
    const sections = [
      { id: 'inside-apples', title: 'APPLES', items: [1] },
      { id: 'outside-coolroom', title: 'OUTSIDE COOLROOM', items: [2] },
      { id: 'vegies-leafy-salad', title: 'LEAFY & SALAD', items: [3] },
      { id: 'vegies-root-starchy', title: 'ROOT & STARCHY', items: [4] },
    ]
    const areas = toLedgerAreas(sections, { outside: 'outside-coolroom', unknown: 'unknown', vegiesPrefix: 'vegies-' })
    expect(areas.map((area) => area.title)).toEqual(['Inside coolroom', 'Outside coolroom', 'Vegies'])
    expect(areas[2].groups.map((group) => group.title)).toEqual(['LEAFY & SALAD', 'ROOT & STARCHY'])
    expect(areas[0].groups).toHaveLength(1)
  })

  it('accepts any big category for a Vegies catalog item, but still checks fruit sub-locations', () => {
    const base = { code: 'X', category: 'Carrot', official_name: 'Carrot', stocklist_name: 'Carrot' }
    expect(catalogItemSchema.safeParse({ ...base, location: 'Vegies', sub_location: 'Root & Starchy' }).success).toBe(true)
    expect(catalogItemSchema.safeParse({ ...base, location: 'Vegies', sub_location: 'A New Group' }).success).toBe(true)
    expect(catalogItemSchema.safeParse({ ...base, location: 'Inside Coolroom', sub_location: 'Root & Starchy' }).success).toBe(false)
  })
})

describe('the pop-up asked before entry', () => {
  it('Stock Close offers Fruit or Vegies, with the current one highlighted', () => {
    const question = sectionQuestion('count', 'vegies')
    expect(question.title).toBe('What are you counting?')
    expect(question.choices.map((choice) => choice.value)).toEqual(['fruit', 'vegies'])
    expect(question.choices.filter((choice) => choice.primary).map((choice) => choice.value)).toEqual(['vegies'])
  })

  it('Stock In also offers Both', () => {
    const question = sectionQuestion('receive', 'both')
    expect(question.title).toBe('What arrived?')
    expect(question.choices.map((choice) => choice.value)).toEqual(['fruit', 'vegies', 'both'])
    expect(question.choices.find((choice) => choice.value === 'both')?.primary).toBe(true)
  })

  it('never highlights Both for Stock Close, whatever the device remembers', () => {
    expect(sectionQuestion('count', 'both').choices.some((choice) => choice.primary)).toBe(false)
  })
})

describe('Stock In photos (one per team)', () => {
  it('makes one photo of everything for a single section', () => {
    expect(stockInPhotoParts('vegies', { fruit: false, vegies: true })).toEqual([{ section: 'vegies', everything: true, withUnknown: true }])
    expect(stockInPhotoParts('fruit', { fruit: true, vegies: false })).toEqual([{ section: 'fruit', everything: true, withUnknown: true }])
  })

  it('Both makes a fruit photo and a vegies photo when both have counts', () => {
    expect(stockInPhotoParts('both', { fruit: true, vegies: true })).toEqual([
      { section: 'fruit', everything: false, withUnknown: true },
      { section: 'vegies', everything: false, withUnknown: false },
    ])
  })

  it('Both with only one section counted makes only that photo, and typed-in items go on it', () => {
    expect(stockInPhotoParts('both', { fruit: true, vegies: false })).toEqual([{ section: 'fruit', everything: false, withUnknown: true }])
    expect(stockInPhotoParts('both', { fruit: false, vegies: true })).toEqual([{ section: 'vegies', everything: false, withUnknown: true }])
  })

  it('Both with nothing counted still returns one part', () => {
    expect(stockInPhotoParts('both', { fruit: false, vegies: false })).toHaveLength(1)
  })
})
