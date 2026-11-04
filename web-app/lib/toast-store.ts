/**
 * App-wide toast store (no React dependency, so it is unit-testable).
 *
 * - Each toast has its own timer, so a burst of toasts clears together instead of one by one.
 * - At most MAX_VISIBLE toasts are kept; the oldest finished one is dropped first.
 * - A `progress` toast has no timer and is updated in place (e.g. "Syncing…" -> "Synced").
 */

export type ToastTone = 'success' | 'error' | 'info' | 'progress'

export type ToastAction = { label: string; onClick: () => void }

export type Toast = {
  id: number
  tone: ToastTone
  message: string
  details?: string
  action?: ToastAction
}

export type ToastOptions = {
  details?: string
  action?: ToastAction
  /** Milliseconds; 0 or Infinity keeps the toast until dismissed. */
  duration?: number
}

export const MAX_VISIBLE = 3

export const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 2500,
  info: 3000,
  error: 6000,
  progress: Infinity,
}

type Listener = () => void

export function createToastStore() {
  let toasts: Toast[] = []
  let nextId = 1
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const listeners = new Set<Listener>()

  const emit = () => {
    listeners.forEach((listener) => listener())
  }

  const clearTimer = (id: number) => {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  const dismiss = (id: number) => {
    clearTimer(id)
    const next = toasts.filter((toast) => toast.id !== id)
    if (next.length !== toasts.length) {
      toasts = next
      emit()
    }
  }

  const schedule = (id: number, tone: ToastTone, duration?: number) => {
    clearTimer(id)
    const ms = duration ?? DEFAULT_DURATION[tone]
    if (!ms || !Number.isFinite(ms)) return
    timers.set(id, setTimeout(() => dismiss(id), ms))
  }

  const trim = () => {
    while (toasts.length > MAX_VISIBLE) {
      const dropIndex = toasts.findIndex((toast) => toast.tone !== 'progress')
      const index = dropIndex === -1 ? 0 : dropIndex
      clearTimer(toasts[index].id)
      toasts = toasts.filter((_, i) => i !== index)
    }
  }

  const show = (tone: ToastTone, message: string, options: ToastOptions = {}) => {
    const id = nextId++
    toasts = [...toasts, { id, tone, message, details: options.details, action: options.action }]
    trim()
    schedule(id, tone, options.duration)
    emit()
    return id
  }

  const update = (id: number, patch: Partial<Omit<Toast, 'id'>> & { duration?: number }) => {
    const current = toasts.find((toast) => toast.id === id)
    if (!current) return
    const { duration, ...fields } = patch
    const updated: Toast = { ...current, ...fields }
    toasts = toasts.map((toast) => (toast.id === id ? updated : toast))
    schedule(id, updated.tone, duration)
    emit()
  }

  return {
    getSnapshot: () => toasts,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    show,
    update,
    dismiss,
    success: (message: string, options?: ToastOptions) => show('success', message, options),
    error: (message: string, options?: ToastOptions) => show('error', message, options),
    info: (message: string, options?: ToastOptions) => show('info', message, options),
    progress: (message: string, options?: ToastOptions) => show('progress', message, options),
    clear: () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
      toasts = []
      emit()
    },
  }
}

export type ToastStore = ReturnType<typeof createToastStore>

/** The shared app instance. */
export const toast = createToastStore()

/**
 * Splits a technical error into a short sentence for staff and the raw detail.
 * "Save failed: {"code":"23505",...}" -> { message: 'Save failed.', details: '{"code":...}' }
 */
export function friendlyError(raw: string, fallback = 'Something went wrong. Please try again.') {
  const text = raw.trim()
  if (!text) return { message: fallback, details: undefined as string | undefined }
  const lower = text.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
    return { message: 'No connection. Check the internet and try again.', details: text }
  }
  if (lower.includes('unauthorized') || /\bjwt\b/.test(lower) || lower.includes('not signed in')) {
    return { message: 'Your sign-in expired. Please sign in again.', details: text }
  }
  const colon = text.indexOf(':')
  const head = colon > 0 && colon < 80 ? text.slice(0, colon) : text
  if (head.length <= 90 && head !== text) {
    return { message: `${head.replace(/\.$/, '')}.`, details: text.slice(colon + 1).trim() || undefined }
  }
  if (text.length <= 120) return { message: text, details: undefined }
  return { message: fallback, details: text }
}
