import { useEffect, useRef } from 'react'

import { createSupabaseBrowserClient } from '../supabase/client'

/**
 * Realtime subscription for Stock In / Stock Close history.
 *
 * Subscribes to postgres_changes on the event tables and calls the matching refresh callback, debounced so that a save which writes
 * several rows (e.g. event_generate + event_push) triggers a single refresh.
 */

export type HistoryRealtimeHandlers = {
  /** event_generate or event_push changed -> Stock In history */
  onStockInChange: () => void
  /** event_stock_check changed -> Stock Close history */
  onStockCheckChange: () => void
}

type ChannelLike = {
  on: (type: 'postgres_changes', filter: Record<string, unknown>, callback: () => void) => ChannelLike
  subscribe: (callback?: (status: string) => void) => ChannelLike
}

export type RealtimeClientLike = {
  channel: (name: string) => ChannelLike
  removeChannel: (channel: ChannelLike) => unknown
}

export type HistoryRealtimeOptions = {
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 300

export function startHistoryRealtime(
  client: RealtimeClientLike,
  userId: string,
  handlers: HistoryRealtimeHandlers,
  options: HistoryRealtimeOptions = {},
) {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const timers: Record<'stockIn' | 'stockCheck', ReturnType<typeof setTimeout> | null> = {
    stockIn: null,
    stockCheck: null,
  }
  let stopped = false
  let hasSubscribedBefore = false

  const schedule = (key: 'stockIn' | 'stockCheck', run: () => void) => {
    if (stopped) return
    const existing = timers[key]
    if (existing) clearTimeout(existing)
    timers[key] = setTimeout(() => {
      timers[key] = null
      if (!stopped) run()
    }, debounceMs)
  }

  const refreshStockIn = () => schedule('stockIn', handlers.onStockInChange)
  const refreshStockCheck = () => schedule('stockCheck', handlers.onStockCheckChange)

  // No user filter: the store's records are shared, and row-level security already
  // limits each account to what it may read (every row for admin/staff accounts).
  const table = (name: string) => ({ event: '*', schema: 'public', table: name })

  const channel = client
    .channel(`history-realtime:${userId}`)
    .on('postgres_changes', table('event_generate'), refreshStockIn)
    .on('postgres_changes', table('event_push'), refreshStockIn)
    .on('postgres_changes', table('event_stock_check'), refreshStockCheck)
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // After a reconnect, events may have been missed: refresh everything once.
      if (hasSubscribedBefore) {
        refreshStockIn()
        refreshStockCheck()
      }
      hasSubscribedBefore = true
    })

  return () => {
    stopped = true
    for (const key of Object.keys(timers) as Array<keyof typeof timers>) {
      const timer = timers[key]
      if (timer) clearTimeout(timer)
      timers[key] = null
    }
    void client.removeChannel(channel)
  }
}

/**
 * React hook wrapper. Pass the signed-in user's id (or null/undefined to disable).
 * Handlers are kept in a ref so changing them never resubscribes.
 */
export function useHistoryRealtime(userId: string | null | undefined, handlers: HistoryRealtimeHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!userId) return

    let stop: (() => void) | null = null

    try {
      const client = createSupabaseBrowserClient() as unknown as RealtimeClientLike
      stop = startHistoryRealtime(client, userId, {
        onStockInChange: () => handlersRef.current.onStockInChange(),
        onStockCheckChange: () => handlersRef.current.onStockCheckChange(),
      })
    } catch (error) {
      // Realtime is an enhancement; the manual loaders remain as a fallback.
      console.warn('History realtime unavailable', error)
    }

    // Catch up on anything that changed while the tab was hidden or offline.
    const refreshAll = () => {
      handlersRef.current.onStockInChange()
      handlersRef.current.onStockCheckChange()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refreshAll)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refreshAll)
      stop?.()
    }
  }, [userId])
}
