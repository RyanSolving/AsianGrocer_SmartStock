/**
 * Pure grouping for the phone list (Check Stock and Stock In): sections into the report's areas.
 */

export type LedgerGroup<T> = { id: string; title?: string; items: T[] }
export type LedgerArea<T> = { id: string; title: string; groups: LedgerGroup<T>[]; tone?: 'alert' }

type CardSection<T> = { id: string; title: string; items: T[] }

/**
 * Groups the phone sections into the Daily Report's areas: the coolroom categories under
 * "Inside coolroom", then "Outside coolroom", then unclassified items.
 */
export function toLedgerAreas<T>(sections: CardSection<T>[], ids: { outside: string; unknown: string; vegiesPrefix?: string }): LedgerArea<T>[] {
  const isVegies = (section: CardSection<T>) => ids.vegiesPrefix !== undefined && section.id.startsWith(ids.vegiesPrefix)
  const inside = sections.filter((section) => section.id !== ids.outside && section.id !== ids.unknown && !isVegies(section))
  const vegies = sections.filter(isVegies)
  const outside = sections.find((section) => section.id === ids.outside)
  const unknown = sections.find((section) => section.id === ids.unknown)
  const areas: LedgerArea<T>[] = []

  if (inside.length > 0) {
    areas.push({ id: 'inside', title: 'Inside coolroom', groups: inside.map((section) => ({ id: section.id, title: section.title, items: section.items })) })
  }
  if (outside && outside.items.length > 0) {
    areas.push({ id: outside.id, title: 'Outside coolroom', groups: [{ id: outside.id, items: outside.items }] })
  }
  if (unknown && unknown.items.length > 0) {
    areas.push({ id: unknown.id, title: 'Unclassified / staff inspection', tone: 'alert', groups: [{ id: unknown.id, items: unknown.items }] })
  }
  if (vegies.length > 0) {
    areas.push({ id: 'vegies', title: 'Vegies', groups: vegies.map((section) => ({ id: section.id, title: section.title, items: section.items })) })
  }
  return areas
}
