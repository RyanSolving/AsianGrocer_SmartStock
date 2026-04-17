type OfflineQueueFeature = 'stock-in' | 'stock-check'

type OfflineDraftFeature = OfflineQueueFeature

type OfflineQueueItem = {
  id: string
  feature: OfflineQueueFeature
  endpoint: string
  payload: Record<string, unknown>
  createdAt: string
  retryCount: number
}

type SyncOfflineQueueResult = {
  processed: number
  remaining: number
  authError: boolean
  failed: number
}

const OFFLINE_QUEUE_STORAGE_KEY = 'smartstock:offline-queue'
const OFFLINE_QUEUE_EVENT = 'smartstock-offline-queue-updated'
const OFFLINE_DRAFT_STORAGE_KEY_PREFIX = 'smartstock:offline-draft:'
const OFFLINE_DRAFT_EVENT = 'smartstock-offline-draft-updated'

function isBrowser() {
  return typeof window !== 'undefined'
}

function readQueue(): OfflineQueueItem[] {
  if (!isBrowser()) return []

  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((entry): entry is OfflineQueueItem => {
      if (!entry || typeof entry !== 'object') return false
      const row = entry as Partial<OfflineQueueItem>
      return typeof row.id === 'string'
        && typeof row.feature === 'string'
        && typeof row.endpoint === 'string'
        && typeof row.createdAt === 'string'
        && typeof row.retryCount === 'number'
        && row.payload !== null
        && typeof row.payload === 'object'
    })
  } catch {
    return []
  }
}

function writeQueue(queue: OfflineQueueItem[]) {
  if (!isBrowser()) return

  try {
    window.localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Ignore storage errors.
  }

  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT))
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getDraftStorageKey(feature: OfflineDraftFeature) {
  return `${OFFLINE_DRAFT_STORAGE_KEY_PREFIX}${feature}`
}

export function enqueueOfflineRequest(input: {
  feature: OfflineQueueFeature
  endpoint: string
  payload: Record<string, unknown>
}) {
  const queue = readQueue()

  queue.push({
    id: makeId(),
    feature: input.feature,
    endpoint: input.endpoint,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  })

  writeQueue(queue)
}

export function getPendingOfflineCount() {
  return readQueue().length
}

export function getPendingOfflineCountByFeature(feature: OfflineQueueFeature) {
  return readQueue().filter((item) => item.feature === feature).length
}

export function subscribeOfflineQueueUpdates(callback: () => void) {
  if (!isBrowser()) {
    return () => {}
  }

  const handler = () => callback()
  window.addEventListener(OFFLINE_QUEUE_EVENT, handler)

  return () => {
    window.removeEventListener(OFFLINE_QUEUE_EVENT, handler)
  }
}

export function saveOfflineDraft(feature: OfflineDraftFeature, payload: Record<string, unknown>) {
  if (!isBrowser()) return

  try {
    window.localStorage.setItem(getDraftStorageKey(feature), JSON.stringify(payload))
  } catch {
    // Ignore storage errors.
  }

  window.dispatchEvent(new CustomEvent(OFFLINE_DRAFT_EVENT, { detail: { feature } }))
}

export function loadOfflineDraft<T>(feature: OfflineDraftFeature): T | null {
  if (!isBrowser()) return null

  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(feature))
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    return parsed as T
  } catch {
    return null
  }
}

export function clearOfflineDraft(feature: OfflineDraftFeature) {
  if (!isBrowser()) return

  try {
    window.localStorage.removeItem(getDraftStorageKey(feature))
  } catch {
    // Ignore storage errors.
  }

  window.dispatchEvent(new CustomEvent(OFFLINE_DRAFT_EVENT, { detail: { feature } }))
}

export function hasOfflineDraft(feature: OfflineDraftFeature) {
  if (!isBrowser()) return false

  return window.localStorage.getItem(getDraftStorageKey(feature)) !== null
}

export function subscribeOfflineDraftUpdates(callback: () => void) {
  if (!isBrowser()) {
    return () => {}
  }

  const handler = () => callback()
  window.addEventListener(OFFLINE_DRAFT_EVENT, handler)

  return () => {
    window.removeEventListener(OFFLINE_DRAFT_EVENT, handler)
  }
}

export function isNetworkRequestError(error: unknown) {
  if (!(error instanceof Error)) return false

  return /failed to fetch|networkerror|network request failed|load failed/i.test(error.message)
}

export async function syncOfflineQueue(): Promise<SyncOfflineQueueResult> {
  const queue = readQueue()

  if (queue.length === 0) {
    return {
      processed: 0,
      remaining: 0,
      authError: false,
      failed: 0,
    }
  }

  if (!isBrowser() || !window.navigator.onLine) {
    return {
      processed: 0,
      remaining: queue.length,
      authError: false,
      failed: 0,
    }
  }

  const nextQueue: OfflineQueueItem[] = []
  let processed = 0
  let failed = 0
  let authError = false

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index]

    try {
      const response = await fetch(item.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      })

      if (response.status === 401) {
        authError = true
        nextQueue.push({
          ...item,
          retryCount: item.retryCount + 1,
        })

        for (let rest = index + 1; rest < queue.length; rest += 1) {
          nextQueue.push(queue[rest])
        }

        break
      }

      if (!response.ok) {
        failed += 1
        nextQueue.push({
          ...item,
          retryCount: item.retryCount + 1,
        })
        continue
      }

      processed += 1
    } catch {
      failed += 1
      nextQueue.push({
        ...item,
        retryCount: item.retryCount + 1,
      })
    }
  }

  writeQueue(nextQueue)

  return {
    processed,
    remaining: nextQueue.length,
    authError,
    failed,
  }
}
