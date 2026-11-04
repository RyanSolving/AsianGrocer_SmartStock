/**
 * Puts a parsed closing photo onto the sheet without losing work (BUSINESS_RULES.md §8b):
 * - a count that is still blank is filled from the photo;
 * - a count already on the sheet is kept, and counted in `kept` when the photo read differently;
 * - an item only the photo has is added.
 * Rows match by catalog code, or by name for free-typed items.
 */

export type MergeableRow = {
  code: string | null
  official_name: string
  stocklist_name: string
  product: string
  quantity: number | null
  notes: string
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function photoRowKey(row: MergeableRow) {
  return row.code
    ? `code:${row.code.trim().toUpperCase()}`
    : `name:${normalizeName(row.official_name || row.stocklist_name || row.product)}`
}

export function mergePhotoRows<T extends MergeableRow>(current: T[], parsed: T[]) {
  if (current.length === 0) {
    return { rows: parsed, filled: parsed.filter((row) => row.quantity !== null).length, kept: 0 }
  }

  const rows = [...current]
  const indexByKey = new Map(rows.map((row, index) => [photoRowKey(row), index]))
  let filled = 0
  let kept = 0

  for (const photoRow of parsed) {
    const key = photoRowKey(photoRow)
    const index = indexByKey.get(key)
    if (index === undefined) {
      indexByKey.set(key, rows.length)
      rows.push(photoRow)
      if (photoRow.quantity !== null) filled += 1
      continue
    }

    const existing = rows[index]
    if (photoRow.quantity === null) continue
    if (existing.quantity === null) {
      rows[index] = { ...existing, quantity: photoRow.quantity, notes: existing.notes || photoRow.notes }
      filled += 1
    } else if (existing.quantity !== photoRow.quantity) {
      kept += 1
    }
  }

  return { rows, filled, kept }
}
