/**
 * Shared paper layout: grouping, ordering and column splitting must stay stable,
 * because both Check Stock and the Daily Report preview render from it.
 */

import { describe, expect, it } from '@jest/globals'

import {
  buildOutsideDisplayColumns,
  buildPaperSections,
  type IndexedPaperRow,
  type PaperRow,
} from '../../lib/stock-paper-layout'

function row(partial: Partial<PaperRow> & { official_name: string }): PaperRow {
  return {
    code: partial.official_name,
    location: 'Inside Coolroom',
    sub_location: '',
    category: 'Fruit',
    product: partial.official_name,
    stocklist_name: partial.official_name,
    row_position: 'left',
    source: 'catalog',
    ...partial,
  }
}

function indexed(rows: PaperRow[]): IndexedPaperRow[] {
  return rows.map((r, index) => ({ row: r, index }))
}

describe('buildPaperSections', () => {
  it('groups inside rows by category, sorts sections and items alphabetically', () => {
    const sections = buildPaperSections(indexed([
      row({ official_name: 'Pear', category: 'Fruit' }),
      row({ official_name: 'Apple', category: 'Fruit' }),
      row({ official_name: 'Carrot', category: 'Veg' }),
    ]))

    const all = [...sections.leftColumn, ...sections.rightColumn]
    expect(all.map((s) => s.title)).toEqual(['FRUIT', 'VEG'])

    const fruit = all[0]
    // Alphabetical order alternates across the left/right columns.
    expect(fruit.rows.left.map((r) => r.row.official_name)).toEqual(['Apple'])
    expect(fruit.rows.right.map((r) => r.row.official_name)).toEqual(['Pear'])
  })

  it('splits sections evenly between the left and right column', () => {
    const sections = buildPaperSections(indexed([
      row({ official_name: 'A', category: 'A' }),
      row({ official_name: 'B', category: 'B' }),
      row({ official_name: 'C', category: 'C' }),
    ]))

    expect(sections.leftColumn).toHaveLength(2)
    expect(sections.rightColumn).toHaveLength(1)
  })

  it('keeps single-position rows apart from paired rows', () => {
    const sections = buildPaperSections(indexed([
      row({ official_name: 'Apple', row_position: 'single' }),
      row({ official_name: 'Pear', row_position: 'left' }),
    ]))

    const section = sections.leftColumn[0]
    expect(section.rows.single.map((r) => r.row.official_name)).toEqual(['Apple'])
    expect(section.rows.left.map((r) => r.row.official_name)).toEqual(['Pear'])
  })

  it('separates outside coolroom and unknown rows from inside sections', () => {
    const sections = buildPaperSections(indexed([
      row({ official_name: 'Inside item' }),
      row({ official_name: 'Outside item', location: 'Outside Coolroom' }),
      row({ official_name: 'Mystery', source: 'unknown', location: '' }),
    ]))

    expect(sections.leftColumn.length + sections.rightColumn.length).toBe(1)
    expect(sections.outsideRows.left.map((r) => r.row.official_name)).toEqual(['Outside item'])
    expect(sections.unknownRows.left.map((r) => r.row.official_name)).toEqual(['Mystery'])
  })
})

describe('buildOutsideDisplayColumns', () => {
  it('chunks outside rows into 6 / 6 / rest', () => {
    const outside = indexed(
      Array.from({ length: 15 }, (_, i) =>
        row({ official_name: `Item ${String(i).padStart(2, '0')}`, location: 'Outside Coolroom' }),
      ),
    )

    const sections = buildPaperSections(outside)
    const columns = buildOutsideDisplayColumns(sections.outsideRows)

    expect(columns.left).toHaveLength(6)
    expect(columns.middle).toHaveLength(6)
    expect(columns.right).toHaveLength(3)
  })
})
