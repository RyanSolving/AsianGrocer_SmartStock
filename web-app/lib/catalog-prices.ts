import { isEmptySellPrice, roundPrice, sameSellPrice, type SellPrice } from './stock-price'

/** What a Stock In line needs for a catalog price update. */
export type PricedLine = {
  catalog_code?: string | null
  sell?: SellPrice | null
  catalog_sell?: SellPrice | null
}

export type CatalogPriceChange = {
  code: string
  /** The catalog price the line started from; null when the item had none. */
  from: SellPrice | null
  to: SellPrice
}

/**
 * The catalog prices a saved Stock In changes: lines of catalog items whose price differs from
 * the catalog price they started from. Lines without a starting price (`catalog_sell` absent)
 * are not catalog items or were never stamped, and a cleared price never clears the catalog.
 * One change per item; if an item appears twice the later line wins.
 */
export function collectPriceChanges(lines: PricedLine[]): CatalogPriceChange[] {
  const byCode = new Map<string, CatalogPriceChange>()
  for (const line of lines) {
    const code = line.catalog_code?.trim()
    if (!code || line.catalog_sell === undefined) continue
    if (!line.sell || isEmptySellPrice(line.sell)) continue

    const from = isEmptySellPrice(line.catalog_sell) ? null : line.catalog_sell ?? null
    if (sameSellPrice(line.sell, from)) {
      byCode.delete(code)
      continue
    }
    byCode.set(code, { code, from, to: line.sell })
  }
  return Array.from(byCode.values())
}

type CatalogWriter = {
  from: (table: string) => any
}

/**
 * Sets each changed item's catalog price. A price is only replaced while the catalog still holds
 * the price (and unit) the line started from, so an old Stock In re-saved later never puts back
 * an older price, and two phones changing the same item do not overwrite each other silently.
 * Returns the changes that were applied. A failure here never fails the save.
 */
export async function applyCatalogPriceChanges(supabase: CatalogWriter, changes: CatalogPriceChange[]): Promise<CatalogPriceChange[]> {
  const applied: CatalogPriceChange[] = []
  for (const change of changes) {
    try {
      let query = supabase.from('catalog_items')
        .update({ price: change.to.price === null ? null : roundPrice(change.to.price), price_unit: change.to.unit, price_deals: change.to.deals })
        .eq('code', change.code)
      if (change.from === null || change.from.price === null) query = query.is('price', null)
      else query = query.eq('price', roundPrice(change.from.price))
      if (change.from) query = query.eq('price_unit', change.from.unit)
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
