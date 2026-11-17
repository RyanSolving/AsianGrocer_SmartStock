/**
 * Phone copy of the data the Stock Close save check needs (BUSINESS_RULES.md §8):
 * the previous closing and the day's stock-in, per section and date.
 *
 * Fetched while the phone is online (opening Stock Close, coming back online, every few
 * minutes), so the check still sees deliveries when staff save inside the coolroom
 * without internet.
 */

export type SaveCheckData = {
  prevClosingByCode: Record<string, number>
  stockInByCode: Record<string, number>
}

export type CachedSaveCheck = SaveCheckData & {
  section: string
  date: string
  /** ISO time the copy was fetched; stock-in saved after this is not in it. */
  fetchedAt: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export const SAVE_CHECK_CACHE_PREFIX = 'smartstock:save-check:'
export const SAVE_CHECK_CACHE_EVENT = 'smartstock-save-check-cache-updated'
export const SAVE_CHECK_TIMEOUT_MS = 10000
/** How often the app refreshes the phone copy while it is open and online. */
export const SAVE_CHECK_PREFETCH_INTERVAL_MS = 5 * 60 * 1000
/** Dates kept per phone; older copies are removed when a new one is written. */
export const SAVE_CHECK_CACHE_KEEP = 6

function cacheKey(section: string, date: string) {
  return `${SAVE_CHECK_CACHE_PREFIX}${section}:${date}`
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function numberMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, number> = {}
  for (const [code, quantity] of Object.entries(value as Record<string, unknown>)) {
    if (typeof quantity === 'number' && Number.isFinite(quantity)) out[code] = quantity
  }
  return out
}

export function writeSaveCheckCache(
  section: string,
  date: string,
  data: SaveCheckData,
  now: Date = new Date(),
  storage: StorageLike | null = defaultStorage(),
): CachedSaveCheck | null {
  if (!storage) return null
  const entry: CachedSaveCheck = {
    section,
    date,
    fetchedAt: now.toISOString(),
    prevClosingByCode: data.prevClosingByCode,
    stockInByCode: data.stockInByCode,
  }
  try {
    storage.setItem(cacheKey(section, date), JSON.stringify(entry))
    pruneSaveCheckCache(storage)
  } catch {
    // Storage full or blocked: the save check falls back to history.
    return null
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SAVE_CHECK_CACHE_EVENT, { detail: { section, date } }))
  }
  return entry
}

export function readSaveCheckCache(
  section: string,
  date: string,
  storage: StorageLike | null = defaultStorage(),
): CachedSaveCheck | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(cacheKey(section, date))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedSaveCheck>
    const prevClosingByCode = numberMap(parsed.prevClosingByCode)
    const stockInByCode = numberMap(parsed.stockInByCode)
    if (!prevClosingByCode || !stockInByCode || typeof parsed.fetchedAt !== 'string') return null
    if (Number.isNaN(new Date(parsed.fetchedAt).getTime())) return null
    return { section, date, fetchedAt: parsed.fetchedAt, prevClosingByCode, stockInByCode }
  } catch {
    return null
  }
}

/** Keeps the newest SAVE_CHECK_CACHE_KEEP dates (per section) and drops the rest. */
export function pruneSaveCheckCache(storage: StorageLike | null = defaultStorage()) {
  if (!storage) return
  const bySection = new Map<string, Array<{ key: string; date: string }>>()
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || !key.startsWith(SAVE_CHECK_CACHE_PREFIX)) continue
    const rest = key.slice(SAVE_CHECK_CACHE_PREFIX.length)
    const split = rest.lastIndexOf(':')
    if (split < 0) continue
    const sectionKey = rest.slice(0, split)
    const list = bySection.get(sectionKey) ?? []
    list.push({ key, date: rest.slice(split + 1) })
    bySection.set(sectionKey, list)
  }
  for (const list of Array.from(bySection.values())) {
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    for (const stale of list.slice(SAVE_CHECK_CACHE_KEEP)) {
      try {
        storage.removeItem(stale.key)
      } catch {
        // ignore
      }
    }
  }
}

/** "9:12 am" today, otherwise "16 Nov, 9:12 am". */
export function formatFetchedAt(fetchedAt: string, now: Date = new Date()) {
  const at = new Date(fetchedAt)
  const time = at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  return `${at.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}, ${time}`
}

/**
 * Fetches the previous closing and the day's stock-in for one section from the daily report
 * API and keeps a copy on the phone. Returns null on any failure (offline, timeout, error).
 */
export async function fetchAndCacheSaveCheck(
  section: string,
  date: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CachedSaveCheck | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SAVE_CHECK_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`/api/daily-report?date=${encodeURIComponent(date)}&section=${encodeURIComponent(section)}`, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) return null
    const payload = await response.json()
    const data: SaveCheckData = {
      prevClosingByCode: numberMap(payload?.prevClosingByCode) ?? {},
      stockInByCode: numberMap(payload?.stockInByCode) ?? {},
    }
    return writeSaveCheckCache(section, date, data) ?? { ...data, section, date, fetchedAt: new Date().toISOString() }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function subscribeSaveCheckCache(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(SAVE_CHECK_CACHE_EVENT, callback)
  return () => window.removeEventListener(SAVE_CHECK_CACHE_EVENT, callback)
}
