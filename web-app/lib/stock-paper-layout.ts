import { normalizeInsideSectionLabel } from './stock-paper-utils'

/**
 * Pure layout logic for the "stock paper" sheet, shared by the Check Stock panel and
 * the Daily Report preview so both always group, sort and split rows identically.
 */

export type PaperRow = {
  code: string | null
  location: string
  sub_location: string
  category: string
  product: string
  official_name: string
  stocklist_name: string
  row_position: 'left' | 'right' | 'single'
  source: 'catalog' | 'unknown'
}

export type IndexedPaperRow<T extends PaperRow = PaperRow> = {
  row: T
  index: number
}

export type PaperRowColumns<T extends PaperRow = PaperRow> = {
  left: IndexedPaperRow<T>[]
  right: IndexedPaperRow<T>[]
  single: IndexedPaperRow<T>[]
}

export type PaperSection<T extends PaperRow = PaperRow> = {
  id: string
  title: string
  rows: PaperRowColumns<T>
}

export const OUTSIDE_SECTION_ID = 'outside-coolroom'
export const VEGIES_LOCATION = 'Vegies'
export const UNKNOWN_SECTION_ID = 'unclassified-staff-inspection'

export function toSectionId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function buildInsideSectionId(title: string) {
  return `inside-${toSectionId(title)}`
}

export function splitRows<T extends PaperRow>(items: IndexedPaperRow<T>[]): PaperRowColumns<T> {
  const singles = items.filter((x) => x.row.row_position === 'single')
  const paired = items.filter((x) => x.row.row_position !== 'single')
  const left: IndexedPaperRow<T>[] = []
  const right: IndexedPaperRow<T>[] = []

  // Keep visual reading order alphabetical by alternating sorted rows across columns.
  paired.forEach((row, index) => {
    if (index % 2 === 0) {
      left.push(row)
    } else {
      right.push(row)
    }
  })

  return {
    left,
    right,
    single: singles,
  }
}

export function getRowDisplayNameForSort(row: PaperRow) {
  return (row.official_name || row.stocklist_name || row.product || '').trim()
}

export function sortIndexedRowsByName<T extends PaperRow>(rows: IndexedPaperRow<T>[]) {
  return [...rows].sort((a, b) => {
    const nameCompare = getRowDisplayNameForSort(a.row).localeCompare(getRowDisplayNameForSort(b.row), undefined, {
      sensitivity: 'base',
      numeric: true,
    })

    if (nameCompare !== 0) return nameCompare

    const codeCompare = (a.row.code || '').localeCompare(b.row.code || '', undefined, {
      sensitivity: 'base',
      numeric: true,
    })

    if (codeCompare !== 0) return codeCompare

    return a.index - b.index
  })
}

export function buildPaperSections<T extends PaperRow>(displayedIndexedRows: IndexedPaperRow<T>[]) {
  const insideRows = displayedIndexedRows.filter(
    (x) => x.row.location === 'Inside Coolroom' && x.row.source !== 'unknown',
  )

  const insideRowsByCategory = new Map<string, IndexedPaperRow<T>[]>()

  insideRows.forEach((entry) => {
    const sectionLabel = normalizeInsideSectionLabel(entry.row.category, entry.row.sub_location)
    const existing = insideRowsByCategory.get(sectionLabel)
    if (existing) {
      existing.push(entry)
      return
    }
    insideRowsByCategory.set(sectionLabel, [entry])
  })

  const insideSections: PaperSection<T>[] = Array.from(insideRowsByCategory.entries())
    .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel, undefined, {
      sensitivity: 'base',
      numeric: true,
    }))
    .map(([label, sectionRows]) => ({
      id: buildInsideSectionId(label),
      title: label.toUpperCase(),
      rows: splitRows(sortIndexedRowsByName(sectionRows)),
    }))

  const midpoint = Math.ceil(insideSections.length / 2)

  const outsideRows = sortIndexedRowsByName(displayedIndexedRows.filter((x) => x.row.location === 'Outside Coolroom'))
  const unknownRows = sortIndexedRowsByName(displayedIndexedRows.filter((x) => x.row.source === 'unknown'))
  const vegieRows = sortIndexedRowsByName(
    displayedIndexedRows.filter((x) => x.row.location === VEGIES_LOCATION && x.row.source !== 'unknown'),
  )

  return {
    leftColumn: insideSections.slice(0, midpoint),
    rightColumn: insideSections.slice(midpoint),
    outsideRows: splitRows(outsideRows),
    unknownRows: splitRows(unknownRows),
    vegieRows: splitRows(vegieRows),
  }
}

export function buildOutsideDisplayColumns<T extends PaperRow>(outsideRows: PaperRowColumns<T>) {
  const combinedOutside = [...outsideRows.left, ...outsideRows.right, ...outsideRows.single]

  return {
    left: combinedOutside.slice(0, 6),
    middle: combinedOutside.slice(6, 12),
    right: combinedOutside.slice(12),
  }
}
