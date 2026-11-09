/**
 * Selling prices (BUSINESS_RULES.md §1d).
 *
 * A price is *sold by* a unit (Each, KG, Pack, ...) with a normal price ("1 for $4.99") and
 * optional combo deals ("2 for $9.00"). The catalog holds the current price; a Stock In row
 * starts from it. A row whose price differs from the catalog price it started from is a price
 * change: highlighted, saved with the price it replaced, and made the catalog price on Save.
 */

export const priceUnits = ['ea', 'kg', 'pack', 'bunch', 'punnet'] as const
export type PriceUnit = typeof priceUnits[number]

export const priceUnitNames: Record<PriceUnit, string> = { ea: 'Each', kg: 'KG', pack: 'Pack', bunch: 'Bunch', punnet: 'Punnet' }
const unitSuffix: Record<PriceUnit, string> = { ea: 'ea', kg: '/kg', pack: '/pack', bunch: '/bunch', punnet: '/punnet' }

export const MAX_DEALS = 5
/** The biggest price a box takes: 9 digits, 9,999,999.99. */
export const MAX_PRICE = 9999999.99

/** "qty for $total", e.g. 2 for $9.00. */
export type PriceDeal = { qty: number; total: number }

export type SellPrice = {
  /** The normal price of one unit; null when there is none. */
  price: number | null
  unit: PriceUnit
  deals: PriceDeal[]
  /** Weight of one pack in grams, only for unit 'pack'; null when not chosen. */
  pack_g: number | null
}

export const emptySellPrice: SellPrice = { price: null, unit: 'ea', deals: [], pack_g: null }

/** Weights offered for a pack, in grams. */
export const PACK_WEIGHTS_G = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000] as const
export const MAX_PACK_G = 99999

/** 250 -> "250g", 1000 -> "1kg", 1500 -> "1.5kg". */
export function formatWeight(grams: number) {
  return grams >= 1000 ? `${Number((grams / 1000).toFixed(3))}kg` : `${grams}g`
}

/** A pack weight from loose data: a whole number of grams, or null. */
export function normalizePackG(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 && value <= MAX_PACK_G ? value : null
}

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
  let cleaned = text.replace(/[$\s]/g, '')
  // "1,234.50" has a thousands comma; "12,50" is a decimal comma.
  cleaned = cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.')
  if (cleaned === '') return { ok: true, value: null }
  if (!/^\d*\.?\d{0,4}$/.test(cleaned) || cleaned === '.') return { ok: false }
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value > MAX_PRICE) return { ok: false }
  return { ok: true, value: roundPrice(value) }
}

function isUnit(value: unknown): value is PriceUnit {
  return typeof value === 'string' && (priceUnits as readonly string[]).includes(value)
}

/** Valid deals only (2 or more for a positive total), one per quantity, smallest quantity first. */
export function normalizeDeals(raw: unknown): PriceDeal[] {
  if (!Array.isArray(raw)) return []
  const byQty = new Map<number, PriceDeal>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const qty = Number((entry as { qty?: unknown }).qty)
    const total = Number((entry as { total?: unknown }).total)
    if (!Number.isInteger(qty) || qty < 2 || qty > 99 || !Number.isFinite(total) || total <= 0 || total > MAX_PRICE) continue
    byQty.set(qty, { qty, total: roundPrice(total) })
  }
  return Array.from(byQty.values()).sort((a, b) => a.qty - b.qty).slice(0, MAX_DEALS)
}

/** A sell price from loose data (a catalog row, saved JSON): bad parts fall back to empty. */
export function normalizeSellPrice(raw: { price?: unknown; unit?: unknown; deals?: unknown; pack_g?: unknown } | null | undefined): SellPrice {
  if (!raw) return emptySellPrice
  const price = raw.price === null || raw.price === undefined || raw.price === '' ? null : Number(raw.price)
  const unit: PriceUnit = isUnit(raw.unit) ? raw.unit : 'ea'
  return {
    price: price !== null && Number.isFinite(price) && price >= 0 ? roundPrice(price) : null,
    unit,
    deals: normalizeDeals(raw.deals),
    pack_g: unit === 'pack' ? normalizePackG(raw.pack_g) : null,
  }
}

export function isEmptySellPrice(value: SellPrice | null | undefined) {
  return !value || (value.price === null && value.deals.length === 0)
}

export function sameSellPrice(a: SellPrice | null | undefined, b: SellPrice | null | undefined) {
  const left = a ?? emptySellPrice
  const right = b ?? emptySellPrice
  if ((left.price === null) !== (right.price === null)) return false
  if (left.price !== null && right.price !== null && roundPrice(left.price) !== roundPrice(right.price)) return false
  if (left.unit !== right.unit && !(isEmptySellPrice(left) && isEmptySellPrice(right))) return false
  if ((left.pack_g ?? null) !== (right.pack_g ?? null) && !(isEmptySellPrice(left) && isEmptySellPrice(right))) return false
  if (left.deals.length !== right.deals.length) return false
  return left.deals.every((deal, index) => deal.qty === right.deals[index].qty && roundPrice(deal.total) === roundPrice(right.deals[index].total))
}

/** "$4.99 ea", "$9.99 /kg"; empty when there is no normal price. */
export function formatMainPrice(value: SellPrice | null | undefined) {
  if (!value || value.price === null) return ''
  // A pack shows its weight: "$3.99 /250g-pack" would split badly, so it reads "/250g pack".
  const suffix = value.unit === 'pack' && value.pack_g ? `/${formatWeight(value.pack_g)} pack` : unitSuffix[value.unit]
  return `${formatPrice(value.price)} ${suffix}`
}

/** "2 for $9.00 · 3 for $12.00"; empty when there are no deals. */
export function formatDeals(value: SellPrice | null | undefined) {
  if (!value || value.deals.length === 0) return ''
  return value.deals.map((deal) => `${deal.qty} for ${formatPrice(deal.total)}`).join(' · ')
}

/** The whole price on one line: "$4.99 ea · 2 for $9.00". */
export function formatSellPrice(value: SellPrice | null | undefined) {
  return [formatMainPrice(value), formatDeals(value)].filter(Boolean).join(' · ')
}

/** What one item costs inside a deal: 2 for $9.00 -> $4.50. */
export function dealEach(deal: PriceDeal) {
  return roundPrice(deal.total / deal.qty)
}

export type PriceChange = {
  /** The catalog price this one replaces; null when the item had none. */
  from: SellPrice | null
  to: SellPrice
  direction: 'up' | 'down' | 'new' | 'changed'
}

/**
 * The change a row's price makes against `reference` (the catalog price it started from).
 * Null when there is no price, the item is not in the catalog (nothing to compare with), or
 * the price is the same. Up/down only when the normal price moved and the unit did not.
 */
export function priceChangeOf(current: SellPrice | null | undefined, reference: SellPrice | null | undefined, inCatalog: boolean): PriceChange | null {
  if (!inCatalog || !current || isEmptySellPrice(current)) return null
  if (isEmptySellPrice(reference)) return { from: null, to: current, direction: 'new' }
  if (sameSellPrice(current, reference)) return null
  const from = reference as SellPrice
  const moved = current.unit === from.unit && (current.pack_g ?? null) === (from.pack_g ?? null) && current.price !== null && from.price !== null && roundPrice(current.price) !== roundPrice(from.price)
  return { from, to: current, direction: moved ? (current.price! > from.price! ? 'up' : 'down') : 'changed' }
}

/** One line for a change: "Up from $4.99 ea", "Down from ...", "Changed from ...", or "New price". */
export function describePriceChange(change: PriceChange) {
  if (change.direction === 'new' || !change.from) return 'New price'
  const was = formatSellPrice(change.from)
  return `${change.direction === 'up' ? 'Up from' : change.direction === 'down' ? 'Down from' : 'Changed from'} ${was}`
}

/** "Each", "KG", "Pack 250g": what the price is sold by, in words. */
export function describeUnit(value: SellPrice) {
  return value.unit === 'pack' && value.pack_g ? `Pack ${formatWeight(value.pack_g)}` : priceUnitNames[value.unit]
}
