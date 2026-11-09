/**
 * Prices on Stock In (BUSINESS_RULES.md §1d).
 *
 * A price is dollars for one counted unit (one box, bag, ...), to the cent. The catalog holds
 * the normal price; a Stock In row starts from it. A row whose price differs from the catalog
 * price is a price change: it is highlighted, saved with the price it replaced, and becomes the
 * catalog price when the Stock In is saved.
 */

/** To the cent, halves going up (1.005 -> 1.01); toPrecision drops binary floating-point noise first. */
export function roundPrice(value: number) {
  return Math.round(Number((value * 100).toPrecision(12))) / 100
}

/** "$12.50", or an empty string when there is no price. */
export function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return `$${roundPrice(value).toFixed(2)}`
}

/** The text of a price box without the dollar sign: "12.5" -> "12.5", 12.50 -> "12.5". */
export function priceToInput(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return String(roundPrice(value))
}

export type ParsedPriceInput =
  | { ok: true; value: number | null }
  | { ok: false }

/** Reads what staff typed: empty clears the price, "$12.5" and "12,50" are fine, negatives are not. */
export function parsePriceInput(text: string): ParsedPriceInput {
  const cleaned = text.replace(/[$\s]/g, '').replace(',', '.')
  if (cleaned === '') return { ok: true, value: null }
  if (!/^\d*\.?\d{0,4}$/.test(cleaned) || cleaned === '.') return { ok: false }
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value > 100000) return { ok: false }
  return { ok: true, value: roundPrice(value) }
}

export type PriceChange = {
  /** The catalog price this one replaces; null when the item had no price yet. */
  from: number | null
  to: number
  direction: 'up' | 'down' | 'new'
}

/**
 * The change a row's price makes against `reference` (the catalog price it started from).
 * Null when there is no price, the item is not in the catalog (nothing to compare with), or
 * the price is the same.
 */
export function priceChangeOf(price: number | null | undefined, reference: number | null | undefined, inCatalog: boolean): PriceChange | null {
  if (!inCatalog || price === null || price === undefined || !Number.isFinite(price)) return null
  const from = reference === undefined || reference === null || !Number.isFinite(reference) ? null : reference
  if (from !== null && roundPrice(from) === roundPrice(price)) return null
  return { from, to: roundPrice(price), direction: from === null ? 'new' : price > from ? 'up' : 'down' }
}

/** One line for a change: "Up from $20.00", "Down from $20.00", or "New price" when there was none. */
export function describePriceChange(change: PriceChange) {
  if (change.from === null) return 'New price'
  return `${change.direction === 'up' ? 'Up' : 'Down'} from ${formatPrice(change.from)}`
}
