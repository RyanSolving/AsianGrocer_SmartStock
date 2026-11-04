'use client'

import { useState, useSyncExternalStore } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

import { toast as toastStore, type Toast } from '../../../lib/toast-store'

const EMPTY: Toast[] = []

function ToneIcon({ tone }: { tone: Toast['tone'] }) {
  if (tone === 'success') return <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
  if (tone === 'error') return <AlertCircle className="h-5 w-5 shrink-0 text-[#ff8a80]" aria-hidden="true" />
  if (tone === 'progress') return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-white/80" aria-hidden="true" />
  return <Info className="h-5 w-5 shrink-0 text-white/80" aria-hidden="true" />
}

function ToastItem({ item }: { item: Toast }) {
  const [showDetails, setShowDetails] = useState(false)
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto animate-sheet-in rounded-card bg-forest-950 px-4 py-3 text-white shadow-raised"
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={item.tone} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug">{item.message}</p>
          {item.details ? (
            <button
              type="button"
              onClick={() => setShowDetails((value) => !value)}
              className="mt-1 text-[13px] text-white/65 underline-offset-2 hover:underline"
            >
              {showDetails ? 'Hide details' : 'Details'}
            </button>
          ) : null}
          {showDetails && item.details ? (
            <p className="mt-1 max-h-24 overflow-y-auto break-words text-[12px] text-white/65">{item.details}</p>
          ) : null}
        </div>
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick()
              toastStore.dismiss(item.id)
            }}
            className="-my-1 shrink-0 rounded-control px-2.5 py-1.5 text-[14px] font-semibold text-accent hover:bg-white/10"
          >
            {item.action.label}
          </button>
        ) : null}
        {item.tone !== 'progress' ? (
          <button
            type="button"
            onClick={() => toastStore.dismiss(item.id)}
            aria-label="Dismiss"
            className="-m-1.5 shrink-0 rounded-control p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Toasts sit at the bottom, above the tab bar on phones (thumb zone). */
export function ToastViewport() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => EMPTY)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[80] mx-auto flex w-[min(94vw,420px)] flex-col gap-2 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] md:bottom-6 md:left-auto md:right-6 md:mx-0"
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  )
}
