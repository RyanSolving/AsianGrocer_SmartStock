import { roundPrice } from './stock-price'

/** What a Stock In line needs for a catalog price update. */
export type PricedLine = {
  catalog_code?: string | null
  price?: number | null
  catalog_price?: number | null
}

export type CatalogPriceChange = {
  code: string
  /** The catalog price the line started from; null when the item had none. */
  from: number | null
  to: number
}

/**
 * The catalog prices a saved Stock In changes: lines of catalog items whose price differs from
 * the catalog price the line started from. Lines without a starting price (`catalog_price`
 * absent) are not catalog items or were never stamped, so they change nothing. One change per
 * item; if an item appears twice the later line wins.
 */
export function collectPriceChanges(lines: PricedLine[]): CatalogPriceChange[] {
  const byCode = new Map<string, CatalogPriceChange>()
  for (const line of lines) {
    const code = line.catalog_code?.trim()
    if (!code || line.catalog_price === undefined) continue
    if (typeof line.price !== 'number' || !Number.isFinite(line.price) || line.price < 0) continue

    const from = typeof line.catalog_price === 'number' && Number.isFinite(line.catalog_price) ? roundPrice(line.catalog_price) : null
    const to = roundPrice(line.price)
    if (from === to) {
      byCode.delete(code)
      continue
    }
    byCode.set(code, { code, from, to })
  }
  return Array.from(byCode.values())
}

type CatalogWriter = {
  from: (table: string) => any
}

/**
 * Sets each changed item's catalog price. A price is only replaced while the catalog still holds
 * the price the line started from, so an old Stock In re-saved later never puts back an older
 * price, and two phones changing the same item do not overwrite each other silently.
 * Returns the changes that were applied. A failure here never fails the save.
 */
export async function applyCatalogPriceChanges(supabase: CatalogWriter, changes: CatalogPriceChange[]): Promise<CatalogPriceChange[]> {
  const applied: CatalogPriceChange[] = []
  for (const change of changes) {
    try {
      let query = supabase.from('catalog_items').update({ price: change.to }).eq('code', change.code)
      query = change.from === null ? query.is('price', null) : query.eq('price', change.from)
      const { data, error } = await query.select('code')
      if (error) {
        console.error(`Catalog price update failed for ${change.code}:`, error.message)
        continue
      }
      if (Array.isArray(data) && data.length > 0) applied.push(change)
    } catch (error) {
      console.error(`Catalog price update failed for ${change.code}:`, error instanceof Error ? error.message : error)
    }
  }
  return applied
}
