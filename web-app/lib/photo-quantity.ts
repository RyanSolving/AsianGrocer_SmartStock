/**
 * Reads the count the photo model returned. Counts are whole numbers; a sum written on the sheet
 * ("2+6", 2 sacks and 6 sacks) is added up. Anything else takes the first number in the text.
 */
export function parseNullableQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  const text = String(value).trim()
  if (!text) return null

  const sum = text.match(/^(\d+(?:\s*\+\s*\d+)+)$/)
  if (sum) return sum[1].split('+').reduce((total, part) => total + Number.parseInt(part, 10), 0)

  const match = text.match(/-?\d+/)
  return match ? Number.parseInt(match[0], 10) : null
}

type ReadItem = {
  catalog_code: string
  quantity: number | null
  quantity_conflict_flag: boolean
  confidence: 'high' | 'medium' | 'low'
  notes: string | null
}

const confidenceRank = { high: 2, medium: 1, low: 0 } as const

/**
 * One row per catalog item. If the model read the same item twice, the better read wins (a count
 * over blank, then higher confidence, then the first), and when the two reads disagree the item is
 * flagged for review with a note, instead of the later read silently replacing the earlier one.
 */
export function dedupeReadItems<T extends ReadItem>(items: T[]): { items: T[]; disagreements: number } {
  const best = new Map<string, T>()
  const order: string[] = []
  const seen = new Map<string, T[]>()

  for (const item of items) {
    const key = item.catalog_code.trim().toUpperCase()
    if (!seen.has(key)) {
      seen.set(key, [])
      order.push(key)
    }
    seen.get(key)!.push(item)
  }

  let disagreements = 0
  for (const key of order) {
    const reads = seen.get(key)!
    if (reads.length === 1) {
      best.set(key, reads[0])
      continue
    }
    const ranked = [...reads].sort((a, b) =>
      Number(b.quantity !== null) - Number(a.quantity !== null)
      || confidenceRank[b.confidence] - confidenceRank[a.confidence])
    const winner = ranked[0]
    const counts = new Set(reads.filter((read) => read.quantity !== null).map((read) => read.quantity))
    if (counts.size > 1) {
      disagreements += 1
      const note = `check: read twice (${Array.from(counts).join(' and ')})`
      best.set(key, { ...winner, quantity_conflict_flag: true, notes: winner.notes ? `${winner.notes} | ${note}` : note })
    } else {
      best.set(key, winner)
    }
  }

  return { items: order.map((key) => best.get(key)!), disagreements }
}
