import { createToastStore, friendlyError, MAX_VISIBLE } from '../../lib/toast-store'

describe('toast store', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('gives each toast its own timer, so a burst clears together', () => {
    const store = createToastStore()
    store.success('a')
    store.success('b')
    store.success('c')
    expect(store.getSnapshot()).toHaveLength(3)
    jest.advanceTimersByTime(2500)
    expect(store.getSnapshot()).toHaveLength(0)
  })

  it(`keeps at most ${MAX_VISIBLE} toasts and drops the oldest first`, () => {
    const store = createToastStore()
    ;['1', '2', '3', '4', '5'].forEach((message) => store.info(message))
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['3', '4', '5'])
  })

  it('never drops a progress toast to make room', () => {
    const store = createToastStore()
    store.progress('syncing')
    ;['a', 'b', 'c', 'd'].forEach((message) => store.success(message))
    const messages = store.getSnapshot().map((t) => t.message)
    expect(messages).toContain('syncing')
    expect(messages).toHaveLength(MAX_VISIBLE)
  })

  it('keeps a progress toast until it is updated, then times it out', () => {
    const store = createToastStore()
    const id = store.progress('Syncing…')
    jest.advanceTimersByTime(60_000)
    expect(store.getSnapshot()).toHaveLength(1)
    store.update(id, { tone: 'success', message: 'Synced' })
    expect(store.getSnapshot()[0]).toMatchObject({ tone: 'success', message: 'Synced' })
    jest.advanceTimersByTime(2500)
    expect(store.getSnapshot()).toHaveLength(0)
  })

  it('notifies subscribers and supports dismiss', () => {
    const store = createToastStore()
    const listener = jest.fn()
    const unsubscribe = store.subscribe(listener)
    const id = store.error('nope')
    store.dismiss(id)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toHaveLength(0)
    unsubscribe()
    store.info('x')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('friendlyError', () => {
  it('maps network failures to a plain sentence', () => {
    expect(friendlyError('TypeError: Failed to fetch').message).toBe('No connection. Check the internet and try again.')
  })

  it('keeps the short head and moves the technical tail to details', () => {
    const result = friendlyError('Save failed: {"code":"23505","message":"duplicate key"}')
    expect(result.message).toBe('Save failed.')
    expect(result.details).toContain('23505')
  })

  it('passes short messages through', () => {
    expect(friendlyError('Choose a date first.')).toEqual({ message: 'Choose a date first.', details: undefined })
  })

  it('hides very long messages behind details', () => {
    const long = 'x'.repeat(300)
    const result = friendlyError(long)
    expect(result.details).toBe(long)
    expect(result.message).toMatch(/try again/)
  })
})
