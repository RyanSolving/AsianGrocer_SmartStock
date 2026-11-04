/**
 * Integration test: Stock In / Stock Close history realtime subscription.
 *
 * Verifies that table changes trigger the right (debounced) refresh callback,
 * that reconnects refresh everything, and that teardown stops further refreshes.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { startHistoryRealtime, type RealtimeClientLike } from '../../lib/realtime/history-realtime'

type Listener = () => void

function createFakeClient() {
  const listeners = new Map<string, Listener>()
  const filters = new Map<string, string>()
  let statusCallback: ((status: string) => void) | undefined
  const removeChannel = jest.fn()

  const channel: any = {
    on(_type: string, filter: { table: string; filter: string }, callback: Listener) {
      listeners.set(filter.table, callback)
      filters.set(filter.table, filter.filter)
      return channel
    },
    subscribe(callback?: (status: string) => void) {
      statusCallback = callback
      return channel
    },
  }

  const client: RealtimeClientLike = {
    channel: () => channel,
    removeChannel: removeChannel as unknown as RealtimeClientLike['removeChannel'],
  }

  return {
    client,
    filters,
    removeChannel,
    emit: (table: string) => listeners.get(table)?.(),
    setStatus: (status: string) => statusCallback?.(status),
  }
}

describe('startHistoryRealtime', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('filters every table to the current user', () => {
    const fake = createFakeClient()
    startHistoryRealtime(fake.client, 'user-1', { onStockInChange: jest.fn(), onStockCheckChange: jest.fn() })

    expect(fake.filters.get('event_generate')).toBe('user_id=eq.user-1')
    expect(fake.filters.get('event_push')).toBe('user_id=eq.user-1')
    expect(fake.filters.get('event_stock_check')).toBe('user_id=eq.user-1')
  })

  it('routes event_generate and event_push to Stock In, event_stock_check to Stock Close', () => {
    const fake = createFakeClient()
    const onStockInChange = jest.fn()
    const onStockCheckChange = jest.fn()
    startHistoryRealtime(fake.client, 'user-1', { onStockInChange, onStockCheckChange })

    fake.emit('event_stock_check')
    jest.advanceTimersByTime(300)
    expect(onStockCheckChange).toHaveBeenCalledTimes(1)
    expect(onStockInChange).not.toHaveBeenCalled()

    fake.emit('event_push')
    jest.advanceTimersByTime(300)
    expect(onStockInChange).toHaveBeenCalledTimes(1)
  })

  it('debounces a burst of changes into one refresh', () => {
    const fake = createFakeClient()
    const onStockInChange = jest.fn()
    startHistoryRealtime(fake.client, 'user-1', { onStockInChange, onStockCheckChange: jest.fn() })

    fake.emit('event_generate')
    fake.emit('event_push')
    fake.emit('event_generate')
    jest.advanceTimersByTime(299)
    expect(onStockInChange).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    expect(onStockInChange).toHaveBeenCalledTimes(1)
  })

  it('refreshes everything after a reconnect but not on the first subscribe', () => {
    const fake = createFakeClient()
    const onStockInChange = jest.fn()
    const onStockCheckChange = jest.fn()
    startHistoryRealtime(fake.client, 'user-1', { onStockInChange, onStockCheckChange })

    fake.setStatus('SUBSCRIBED')
    jest.advanceTimersByTime(300)
    expect(onStockInChange).not.toHaveBeenCalled()
    expect(onStockCheckChange).not.toHaveBeenCalled()

    fake.setStatus('CHANNEL_ERROR')
    fake.setStatus('SUBSCRIBED')
    jest.advanceTimersByTime(300)
    expect(onStockInChange).toHaveBeenCalledTimes(1)
    expect(onStockCheckChange).toHaveBeenCalledTimes(1)
  })

  it('stops refreshing and removes the channel on teardown', () => {
    const fake = createFakeClient()
    const onStockInChange = jest.fn()
    const stop = startHistoryRealtime(fake.client, 'user-1', { onStockInChange, onStockCheckChange: jest.fn() })

    fake.emit('event_generate')
    stop()
    jest.advanceTimersByTime(1000)
    fake.emit('event_generate')
    jest.advanceTimersByTime(1000)

    expect(onStockInChange).not.toHaveBeenCalled()
    expect(fake.removeChannel).toHaveBeenCalledTimes(1)
  })
})
