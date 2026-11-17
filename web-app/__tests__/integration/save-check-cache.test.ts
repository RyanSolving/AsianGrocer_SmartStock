import {
  fetchAndCacheSaveCheck,
  readSaveCheckCache,
  SAVE_CHECK_CACHE_KEEP,
  SAVE_CHECK_CACHE_PREFIX,
  writeSaveCheckCache,
} from '../../lib/offline/save-check-cache'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size
    },
    keys: () => Array.from(map.keys()),
  }
}

describe('save check phone copy', () => {
  it('stores and reads back the previous closing and stock-in per section and date', () => {
    const storage = memoryStorage()
    const now = new Date('2026-11-17T08:00:00Z')
    writeSaveCheckCache('fruit', '2026-11-17', { prevClosingByCode: { A1: 5 }, stockInByCode: { B2: 3 } }, now, storage)

    expect(readSaveCheckCache('fruit', '2026-11-17', storage)).toEqual({
      section: 'fruit',
      date: '2026-11-17',
      fetchedAt: now.toISOString(),
      prevClosingByCode: { A1: 5 },
      stockInByCode: { B2: 3 },
    })
    expect(readSaveCheckCache('vegies', '2026-11-17', storage)).toBeNull()
    expect(readSaveCheckCache('fruit', '2026-11-16', storage)).toBeNull()
  })

  it('ignores a damaged copy and non-numeric quantities', () => {
    const storage = memoryStorage()
    storage.setItem(`${SAVE_CHECK_CACHE_PREFIX}fruit:2026-11-17`, '{not json')
    expect(readSaveCheckCache('fruit', '2026-11-17', storage)).toBeNull()

    storage.setItem(
      `${SAVE_CHECK_CACHE_PREFIX}fruit:2026-11-17`,
      JSON.stringify({ fetchedAt: '2026-11-17T08:00:00Z', prevClosingByCode: { A1: 2, B2: 'x' }, stockInByCode: {} }),
    )
    expect(readSaveCheckCache('fruit', '2026-11-17', storage)?.prevClosingByCode).toEqual({ A1: 2 })
  })

  it('keeps only the newest dates per section', () => {
    const storage = memoryStorage()
    for (let day = 1; day <= SAVE_CHECK_CACHE_KEEP + 3; day += 1) {
      const date = `2026-11-${String(day).padStart(2, '0')}`
      writeSaveCheckCache('fruit', date, { prevClosingByCode: {}, stockInByCode: {} }, new Date(), storage)
      writeSaveCheckCache('vegies', date, { prevClosingByCode: {}, stockInByCode: {} }, new Date(), storage)
    }
    const fruit = storage.keys().filter((key) => key.includes(':fruit:'))
    expect(fruit).toHaveLength(SAVE_CHECK_CACHE_KEEP)
    expect(readSaveCheckCache('fruit', '2026-11-01', storage)).toBeNull()
    expect(readSaveCheckCache('fruit', `2026-11-${String(SAVE_CHECK_CACHE_KEEP + 3).padStart(2, '0')}`, storage)).not.toBeNull()
    expect(storage.keys().filter((key) => key.includes(':vegies:'))).toHaveLength(SAVE_CHECK_CACHE_KEEP)
  })

  it('fetchAndCacheSaveCheck returns the server data and null on failure', async () => {
    const ok = (async () => ({
      ok: true,
      json: async () => ({ prevClosingByCode: { A1: 4 }, stockInByCode: { A1: 2 }, other: 1 }),
    })) as unknown as typeof fetch
    const result = await fetchAndCacheSaveCheck('fruit', '2026-11-17', { fetchImpl: ok })
    expect(result?.prevClosingByCode).toEqual({ A1: 4 })
    expect(result?.stockInByCode).toEqual({ A1: 2 })

    const failing = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await fetchAndCacheSaveCheck('fruit', '2026-11-17', { fetchImpl: failing })).toBeNull()

    const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    expect(await fetchAndCacheSaveCheck('fruit', '2026-11-17', { fetchImpl: notOk })).toBeNull()
  })
})
