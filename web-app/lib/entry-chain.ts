/**
 * Helpers for the fast "search -> qty -> Enter" entry chain used by Stock In and Check Stock.
 */

export const SUGGESTION_LIMIT = 8

type Searchable = {
  code: string
  official_name: string
  stocklist_name?: string | null
  product?: string | null
}

/**
 * Ranks catalog items for a search term:
 *   0  exact code or name
 *   1  name starts with the term
 *   2  a word in the name starts with the term
 *   3  name, stocklist name, product or code contains the term
 * Ties keep the catalog order; items that do not match are dropped.
 */
export function rankSuggestions<T extends Searchable>(items: T[], rawTerm: string, limit = SUGGESTION_LIMIT): T[] {
  const term = rawTerm.trim().toLowerCase()
  if (!term) return []

  const scored: Array<{ item: T; score: number; order: number }> = []
  items.forEach((item, order) => {
    const code = item.code.trim().toLowerCase()
    const name = item.official_name.trim().toLowerCase()
    const stocklist = (item.stocklist_name ?? '').trim().toLowerCase()
    const product = (item.product ?? '').trim().toLowerCase()

    let score = -1
    if (code === term || name === term || stocklist === term) score = 0
    else if (name.startsWith(term) || stocklist.startsWith(term)) score = 1
    else if (`${name} ${stocklist}`.split(/[\s()/,-]+/).some((word) => word.startsWith(term))) score = 2
    else if (name.includes(term) || stocklist.includes(term) || product.includes(term) || code.includes(term)) score = 3

    if (score >= 0) scored.push({ item, score, order })
  })

  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item)
}

/**
 * A row is listed when it has a quantity, a conflict, raw text, or was edited in this pass.
 * The last rule keeps a row on screen while its quantity is cleared and retyped.
 */
export function isRowListed(
  row: { quantity: number | null; quantity_conflict_flag?: boolean | null; quantity_raw?: string | null },
  touched: boolean,
) {
  if (touched) return true
  if (row.quantity !== null) return true
  if (row.quantity_conflict_flag) return true
  return (row.quantity_raw ?? '').trim().length > 0
}

/** Parses a quantity typed on a phone keypad ("12", "12.5", "12,5"). Empty -> null. */
export function parseTypedQuantity(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!text) return null
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * Enter on a quantity cell moves focus to the next quantity cell in the same sheet,
 * so a column of counts can be typed without tapping each box.
 */
export function focusNextQuantityInput(event: { key: string; currentTarget: HTMLInputElement; preventDefault: () => void }) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  const current = event.currentTarget
  const scope = current.closest('[data-qty-scope]') ?? current.ownerDocument
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input.stock-qty-input')).filter(
    (input) => !input.disabled && input.offsetParent !== null,
  )
  const index = inputs.indexOf(current)
  const next = index >= 0 ? inputs[index + 1] : undefined
  if (next) {
    next.focus()
    next.select?.()
  } else {
    current.blur()
  }
}
