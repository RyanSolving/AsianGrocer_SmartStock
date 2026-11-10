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

/**
 * Stock In with "Both" is one sheet but two records, one per section. A section nobody counted
 * anything in gets no record (so counting only fruit never creates an empty vegies record).
 * With one section chosen, the sheet is one record whatever the items' locations are.
 */
export function splitBySection<T extends { location: string; quantity?: number | null }>(
  items: T[],
  choice: SectionChoice,
): Array<{ section: Section; items: T[] }> {
  if (choice !== 'both') return [{ section: choice, items }]
  const groups = sections.map((section) => ({
    section,
    items: items.filter((item) => sectionOfLocation(item.location) === section),
  }))
  const counted = groups.filter((group) => group.items.some((item) => item.quantity !== null && item.quantity !== undefined))
  return counted.length > 0 ? counted : [groups[0]]
}

/** One exported Stock In photo. `everything`: a single-section sheet shows all its rows; `withUnknown`: items typed by name go on it. */
export type StockInPhotoPart = { section: Section; everything: boolean; withUnknown: boolean }

/**
 * The photos a Stock In save makes. Fruit and vegies go to different teams, so Both makes one
 * photo per section that has counts; one section makes one photo. Items typed in by name go on the
 * first photo, the same as they go with the first saved record.
 */
export function stockInPhotoParts(choice: SectionChoice, counted: { fruit: boolean; vegies: boolean }): StockInPhotoPart[] {
  if (choice !== 'both') return [{ section: choice, everything: true, withUnknown: true }]
  const parts: StockInPhotoPart[] = []
  if (counted.fruit) parts.push({ section: 'fruit', everything: false, withUnknown: true })
  if (counted.vegies) parts.push({ section: 'vegies', everything: false, withUnknown: !counted.fruit })
  return parts.length > 0 ? parts : [{ section: 'fruit', everything: false, withUnknown: true }]
}

/**
 * The photos a Daily Report export makes. Fruit and vegies go to different teams, so Both makes one
 * photo per section that has items; one section makes one photo.
 */
export function reportPhotoSections(choice: SectionChoice, counted: { fruit: boolean; vegies: boolean }): Section[] {
  if (choice !== 'both') return [choice]
  const found = sections.filter((section) => counted[section])
  return found.length > 0 ? found : ['fruit']
}
