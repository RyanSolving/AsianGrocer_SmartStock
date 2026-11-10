/**
 * Fruit and Vegies are two sections of one store. Every catalog item belongs to exactly one:
 * items with location `Vegies` are vegies, everything else is fruit. Stock Close and Stock In
 * records are saved per section, so two people can count them separately.
 */

export const sections = ['fruit', 'vegies'] as const
export type Section = (typeof sections)[number]
/** What a screen shows: one section, or both together. */
export type SectionChoice = Section | 'both'

export const VEGIES_LOCATION = 'Vegies'

export const sectionLabel: Record<SectionChoice, string> = {
  fruit: 'Fruit',
  vegies: 'Vegies',
  both: 'Both',
}

export function parseSection(value: unknown): Section | null {
  return value === 'fruit' || value === 'vegies' ? value : null
}

export function parseSectionChoice(value: unknown): SectionChoice | null {
  return value === 'both' ? 'both' : parseSection(value)
}

export function sectionOfLocation(location: string | null | undefined): Section {
  return (location ?? '').trim().toLowerCase() === VEGIES_LOCATION.toLowerCase() ? 'vegies' : 'fruit'
}

/** The sections a choice covers: ['fruit'], ['vegies'] or both, fruit first. */
export function sectionsOf(choice: SectionChoice): Section[] {
  return choice === 'both' ? [...sections] : [choice]
}

export function isInSection(item: { location: string }, choice: SectionChoice) {
  return choice === 'both' || sectionOfLocation(item.location) === choice
}

export function filterBySection<T extends { location: string }>(items: T[] | null | undefined, choice: SectionChoice): T[] | null {
  if (!items) return null
  return choice === 'both' ? items : items.filter((item) => isInSection(item, choice))
}

/**
 * The section a saved record belongs to: the one most of its catalog items are in
 * (a record holds one section, so this only matters for records without a stored section).
 */
export function sectionOfItems(items: Array<{ location: string }>): Section {
  const vegies = items.filter((item) => sectionOfLocation(item.location) === 'vegies').length
  return vegies > items.length - vegies ? 'vegies' : 'fruit'
}
