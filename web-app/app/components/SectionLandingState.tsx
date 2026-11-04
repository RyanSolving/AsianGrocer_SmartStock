'use client'
import { ChevronRight, FileClock, History, Plus, Trash2 } from 'lucide-react'

import { useConfirm } from './ConfirmDialog'

type LandingAction = 'new' | 'continue' | 'history' | 'discard'

type SectionLandingStateProps = {
  sectionLabel: string // "Receive Stock" or "Count Stock"
  hasDraft: boolean // from hasOfflineDraft('stock-in')
  draftAge?: string | null // e.g. "2h ago"
  draftItemCount?: number // count of items with non-null qty in the draft
  historyCount: number // how many history records exist
  onAction: (action: LandingAction) => void
  /** One line under the title, e.g. "Count what arrived this morning." */
  subtitle?: string
}

function todayLabel() {
  return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Start screen for Stock In and Check Stock: one large primary action,
 * the saved draft as a resumable card, and history as a quiet row.
 */
export function SectionLandingState({
  sectionLabel,
  hasDraft,
  draftAge,
  draftItemCount,
  historyCount,
  onAction,
  subtitle,
}: SectionLandingStateProps) {
  const [confirm, confirmElement] = useConfirm()

  async function discardDraft() {
    if (await confirm({
      title: `Remove ${sectionLabel.toLowerCase()} draft?`,
      message: 'This clears the unfinished sheet from this device. Saved history is kept.',
      confirmLabel: 'Remove draft',
      variant: 'danger',
    })) onAction('discard')
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 py-2 sm:py-6">
      <div>
        <p className="text-[14px] text-muted">{todayLabel()}</p>
        <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink">{sectionLabel}</h1>
        {subtitle ? <p className="mt-1 text-[15px] text-muted">{subtitle}</p> : null}
      </div>

      {hasDraft ? (
        <button
          type="button"
          onClick={() => onAction('continue')}
          className="group flex w-full items-center gap-4 rounded-card bg-forest p-5 text-left text-white transition-colors duration-150 hover:bg-forest-800 active:bg-forest-950"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-white/10">
            <FileClock className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-semibold">Continue draft</span>
            <span className="mt-0.5 block text-[14px] text-white/75 tabular">
              {draftItemCount || 0} {draftItemCount === 1 ? 'item' : 'items'} counted · {draftAge || 'recently'}
            </span>
          </span>
          <ChevronRight className="h-6 w-6 text-white/60 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      ) : null}

      {hasDraft && (
        <button type="button" onClick={discardDraft} className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-danger hover:bg-danger-soft">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Remove draft
        </button>
      )}
      {confirmElement}

      <button
        type="button"
        onClick={() => onAction('new')}
        className={`group flex w-full items-center gap-4 rounded-card p-5 text-left transition-colors duration-150 ${
          hasDraft
            ? 'border border-line bg-surface text-ink hover:bg-slate-50 active:bg-slate-100'
            : 'bg-forest text-white hover:bg-forest-800 active:bg-forest-950'
        }`}
      >
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control ${hasDraft ? 'bg-forest-50 text-forest-800' : 'bg-white/10'}`}>
          <Plus className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-semibold">Start new</span>
          <span className={`mt-0.5 block text-[14px] ${hasDraft ? 'text-muted' : 'text-white/75'}`}>
            {hasDraft ? 'Replaces the draft with an empty sheet' : 'Empty sheet for today'}
          </span>
        </span>
        <ChevronRight className={`h-6 w-6 transition-transform duration-150 group-hover:translate-x-0.5 ${hasDraft ? 'text-slate-400' : 'text-white/60'}`} aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => onAction('history')}
        className="flex min-h-14 w-full items-center gap-3 rounded-card border border-line bg-surface px-5 text-left text-ink transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
      >
        <History className="h-5 w-5 text-muted" aria-hidden="true" />
        <span className="flex-1 text-[16px]">History</span>
        <span className="text-[14px] text-muted tabular">{historyCount > 0 ? `${historyCount} records` : 'None yet'}</span>
        <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
      </button>
    </div>
  )
}
