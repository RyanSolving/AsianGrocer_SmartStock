/**
 * Photo entry for the vegies sheet: the prompt, how counts are read back, duplicate reads, and
 * the draft catalog the photo reader matches against.
 */

import fs from 'fs'
import path from 'path'

import { describe, expect, it } from '@jest/globals'
import Papa from 'papaparse'

import { buildCatalogPrompt } from '../../lib/fruit-catalog'
import { dedupeReadItems, parseNullableQuantity } from '../../lib/photo-quantity'
import { catalogSubLocationVegiesOptions } from '../../lib/stock-schema'
import type { CatalogEntry } from '../../lib/stock-schema'

const entry = (code: string, name: string, guide: string): CatalogEntry => ({
  id: 0, code, location: 'Vegies', sub_location: 'Root & Starchy', category: 'Potato', product: 'Potato', attribute: '',
  origin: '', inner_quantity: null, inner_unit: 'box', official_name: name, stocklist_name: name,
  navigation_guide: guide, row_position: 'single', is_visible: true,
})

describe('vegies photo prompt', () => {
  const catalog = [entry('POT-POT-WAS', 'Wash Pot 15kg', 'Roots block, LEFT half, row 1: [WASH POT 5KG] | [15KG], cell 2 of 2: printed "15KG"')]
  const vegies = buildCatalogPrompt(catalog, 'stock-closing', 'vegies')

  it('is written for the vegetable sheet and lists the catalog with each item\'s position', () => {
    expect(vegies).toContain('vegetable store stocklist')
    expect(vegies).toContain('[CODE: POT-POT-WAS] "Wash Pot 15kg"')
    expect(vegies).toContain('cell 2 of 2: printed "15KG"')
  })

  it('tells the reader how this sheet is written', () => {
    expect(vegies).toContain('Qualifier cells')
    expect(vegies).toContain('a 2 often looks like a "Z"')
    expect(vegies).toContain('An empty oval or an O written in the count place IS zero')
    expect(vegies).toContain('Only a RED circle or loop is the buyer')
    expect(vegies).toContain('crossed out')
    expect(vegies).toContain('"2+6"')
    expect(vegies).toContain('9/11/26 is 9 November 2026')
    expect(vegies).toContain('Each CODE may be used ONCE')
  })

  it('leaves the fruit prompt as it was', () => {
    const fruit = buildCatalogPrompt(catalog, 'stock-closing')
    expect(fruit).toBe(buildCatalogPrompt(catalog, 'stock-closing', 'fruit'))
    expect(fruit).toContain('fruit store stocklist form')
    expect(fruit).toContain('DO NOT TREAT A RED CIRCLE AS A "0"')
    expect(fruit).not.toContain('vegetable store')
  })
})

describe('reading counts back', () => {
  it('reads plain numbers and keeps zero', () => {
    expect(parseNullableQuantity(46)).toBe(46)
    expect(parseNullableQuantity('42')).toBe(42)
    expect(parseNullableQuantity(0)).toBe(0)
    expect(parseNullableQuantity('0')).toBe(0)
    expect(parseNullableQuantity(null)).toBeNull()
    expect(parseNullableQuantity('')).toBeNull()
  })

  it('adds a sum written on the sheet, instead of taking the first number', () => {
    expect(parseNullableQuantity('2+6')).toBe(8)
    expect(parseNullableQuantity('2 + 6 + 1')).toBe(9)
    expect(parseNullableQuantity(8)).toBe(8)
  })

  it('takes the number from an entry with a letter, like 1P', () => {
    expect(parseNullableQuantity('1P')).toBe(1)
  })
})

describe('the same item read twice', () => {
  const read = (code: string, quantity: number | null, confidence: 'high' | 'medium' | 'low' = 'high') =>
    ({ catalog_code: code, quantity, quantity_conflict_flag: false, confidence, notes: null as string | null })

  it('leaves single reads alone', () => {
    const items = [read('A', 1), read('B', 2)]
    expect(dedupeReadItems(items)).toEqual({ items, disagreements: 0 })
  })

  it('keeps a count over a blank', () => {
    const out = dedupeReadItems([read('A', null), read('A', 5)])
    expect(out.items).toHaveLength(1)
    expect(out.items[0].quantity).toBe(5)
    expect(out.disagreements).toBe(0)
  })

  it('flags the item when the two reads disagree, keeping the more confident one', () => {
    const out = dedupeReadItems([read('A', 5, 'low'), read('A', 6, 'high')])
    expect(out.items).toHaveLength(1)
    expect(out.items[0].quantity).toBe(6)
    expect(out.items[0].quantity_conflict_flag).toBe(true)
    expect(out.items[0].notes).toBe('check: read twice (5 and 6)')
    expect(out.disagreements).toBe(1)
  })

  it('keeps the order of first appearance', () => {
    expect(dedupeReadItems([read('B', 1), read('A', 2), read('B', 1)]).items.map((item) => item.catalog_code)).toEqual(['B', 'A'])
  })
})

describe('the draft vegie catalog the reader matches against', () => {
  const csv = fs.readFileSync(path.join(__dirname, '../../../catalog_vegies_draft.csv'), 'utf8')
  const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data

  it('has every item once, in a known big category', () => {
    expect(rows).toHaveLength(133)
    expect(new Set(rows.map((row) => row.Code)).size).toBe(133)
    for (const row of rows) {
      expect(row.Location).toBe('Vegies')
      expect(catalogSubLocationVegiesOptions as readonly string[]).toContain(row['Sub-location'])
    }
  })

  it('says where each item is on the paper sheet, so the reader can tell the 15KG cells apart', () => {
    for (const row of rows) {
      expect(row['Nagivation Guide']).toMatch(/^Vegies - (Fresh veg|Roots & onions|ORDERS) block/)
    }
    const guides = rows.filter((row) => row['Name on Stocklist'].includes('15kg')).map((row) => row['Nagivation Guide'])
    expect(new Set(guides).size).toBe(guides.length)
    expect(rows.find((row) => row['Name on Stocklist'] === 'Wash Pot 15kg')!['Nagivation Guide']).toContain('[WASH POT 5KG] | [15KG]')
    expect(rows.find((row) => row['Name on Stocklist'] === 'Dez Pot 15kg')!['Nagivation Guide']).toContain('[DEZ POT 5KG] | [15KG]')
  })
})
