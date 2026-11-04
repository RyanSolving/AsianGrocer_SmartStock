/**
 * Before a closing is saved: items that should have been counted but weren't.
 *
 * An item is expected on today's closing when it had stock at the previous closing, or
 * stock arrived today (BUSINESS_RULES.md §8). If such an item is blank or 0 on the sheet,
 * staff are asked to count it again before saving. A 0 can be a real sell-out, so it is asked
 * about, not blocked.
 */

export type SheetCount = {
  code: string
  label: string
  section: string
  quantity: number | null
}

export type CatalogLabel = {
  code: string
  label: string
  section: string
}

export type UncountedItem = {
  code: string
  label: string
  section: string
  previousClosing: number
  stockIn: number
  /** Null when the item is blank or not on the sheet at all. */
  current: number | null
  reason: 'blank' | 'zero'
}

type QuantityByCode = Record<string, number | null | undefined>

function positive(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

export function findUncountedItems(input: {
  sheet: SheetCount[]
  catalog: CatalogLabel[]
  prevClosingByCode: QuantityByCode
  stockInByCode: QuantityByCode
}): UncountedItem[] {
  // The same code can sit on more than one row: any number on any row counts as counted.
  const sheetByCode = new Map<string, { label: string; section: string; total: number | null }>()
  for (const row of input.sheet) {
    const code = normalizeCode(row.code)
    if (!code) continue
    const existing = sheetByCode.get(code)
    const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : null
    const total = existing?.total ?? null
    sheetByCode.set(code, {
      label: existing?.label ?? row.label,
      section: existing?.section ?? row.section,
      total: quantity === null ? total : (total ?? 0) + quantity,
    })
  }

  const catalogByCode = new Map(input.catalog.map((item) => [normalizeCode(item.code), item]))
  const previousByCode = new Map<string, number>()
  const stockInByCode = new Map<string, number>()
  for (const [code, value] of Object.entries(input.prevClosingByCode)) previousByCode.set(normalizeCode(code), positive(value))
  for (const [code, value] of Object.entries(input.stockInByCode)) stockInByCode.set(normalizeCode(code), positive(value))

  const expected = new Set<string>()
  previousByCode.forEach((value, code) => { if (value > 0) expected.add(code) })
  stockInByCode.forEach((value, code) => { if (value > 0) expected.add(code) })

  const result: UncountedItem[] = []
  for (const code of Array.from(expected)) {
    const onSheet = sheetByCode.get(code)
    const inCatalog = catalogByCode.get(code)
    // An item removed from the catalog can't be counted any more, so it isn't asked about.
    if (!onSheet && !inCatalog) continue

    const current = onSheet?.total ?? null
    if (current !== null && current > 0) continue

    result.push({
      code,
      label: onSheet?.label || inCatalog?.label || code,
      section: onSheet?.section || inCatalog?.section || '',
      previousClosing: previousByCode.get(code) ?? 0,
      stockIn: stockInByCode.get(code) ?? 0,
      current,
      reason: current === null ? 'blank' : 'zero',
    })
  }

  // Blanks first (most likely missed), then zeros; each by area, then name.
  return result.sort((a, b) =>
    Number(a.reason === 'zero') - Number(b.reason === 'zero')
    || a.section.localeCompare(b.section)
    || a.label.localeCompare(b.label),
  )
}
