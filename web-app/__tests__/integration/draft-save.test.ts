/**
 * Debounced draft saves (lib/offline/queue scheduleDraftSave). Stock In's Save empties the sheet
 * so the pending save is cancelled; these tests pin down that cancel really stops the write.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

type Listener = () => void

function installBrowserStubs() {
  const windowListeners = new Map<string, Set<Listener>>()
  const documentListeners = new Map<string, Set<Listener>>()
  const add = (map: Map<string, Set<Listener>>) => (type: string, listener: Listener) => {
    if (!map.has(type)) map.set(type, new Set())
    map.get(type)!.add(listener)
  }
  const remove = (map: Map<string, Set<Listener>>) => (type: string, listener: Listener) => {
    map.get(type)?.delete(listener)
  }
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: add(documentListeners),
    removeEventListener: remove(documentListeners),
  }
  const fakeWindow = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    addEventListener: add(windowListeners),
    removeEventListener: remove(windowListeners),
  }
  Object.assign(globalThis, { window: fakeWindow, document: fakeDocument })
  return {
    fire: (type: string) => windowListeners.get(type)?.forEach((listener) => listener()),
    listenerCount: () => Array.from(windowListeners.values()).concat(Array.from(documentListeners.values())).reduce((n, set) => n + set.size, 0),
  }
}

describe('scheduleDraftSave', () => {
  let browser: ReturnType<typeof installBrowserStubs>

  beforeEach(() => {
    jest.useFakeTimers()
    browser = installBrowserStubs()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { document?: unknown }).document
  })

  async function load() {
    return (await import('../../lib/offline/queue')).scheduleDraftSave
  }

  it('saves once after the delay', async () => {
    const scheduleDraftSave = await load()
    const save = jest.fn()
    scheduleDraftSave(save, 400)

    jest.advanceTimersByTime(399)
    expect(save).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('never saves when cancelled first, and removes its listeners', async () => {
    const scheduleDraftSave = await load()
    const save = jest.fn()
    const cancel = scheduleDraftSave(save, 400)

    cancel()
    jest.advanceTimersByTime(1000)
    browser.fire('pagehide')

    expect(save).not.toHaveBeenCalled()
    expect(browser.listenerCount()).toBe(0)
  })

  it('saves at once when the page is left', async () => {
    const scheduleDraftSave = await load()
    const save = jest.fn()
    scheduleDraftSave(save, 400)

    browser.fire('pagehide')
    expect(save).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
