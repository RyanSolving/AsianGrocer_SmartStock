'use client'
import { PlusCircle, FileText, History, ArrowRight } from 'lucide-react'

type LandingAction = 'new' | 'continue' | 'history'

type SectionLandingStateProps = {
  sectionLabel: string           // "Receive Stock" or "Count Stock"
  hasDraft: boolean              // from hasOfflineDraft('stock-in')
  draftAge?: string | null       // e.g. "2h ago"
  draftItemCount?: number        // count of items with non-null qty in the draft
  historyCount: number           // how many history records exist
  onAction: (action: LandingAction) => void
}

export function SectionLandingState({
  sectionLabel,
  hasDraft,
  draftAge,
  draftItemCount,
  historyCount,
  onAction,
}: SectionLandingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 max-w-2xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-900">{sectionLabel}</h1>
        <p className="mt-2 text-slate-500">Choose how you want to start your session.</p>
      </div>

      <div className="grid gap-4 w-full sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1">
        {/* Start New Card */}
        <button
          onClick={() => onAction('new')}
          className="group relative flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all hover:border-brand-500 hover:shadow-md active:scale-[0.98]"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
            <PlusCircle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-900">Start New</h3>
            <p className="text-sm text-slate-500">Fresh session with today's date.</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-500" />
        </button>

        {/* Continue Draft Card */}
        {hasDraft && (
          <button
            onClick={() => onAction('continue')}
            className="group relative flex items-center gap-4 rounded-2xl border-2 border-amber-200 bg-amber-50/30 p-5 text-left transition-all hover:border-amber-500 hover:shadow-md active:scale-[0.98]"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 transition-colors group-hover:bg-amber-200">
              <FileText className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-900">Continue Draft</h3>
              <p className="text-sm text-slate-500">
                Resumed {draftAge || 'recently'} · {draftItemCount || 0} items filled
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-amber-500" />
          </button>
        )}

        {/* Load History Card */}
        <button
          onClick={() => onAction('history')}
          className="group relative flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all hover:border-brand-500 hover:shadow-md active:scale-[0.98]"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200">
            <History className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-900">History</h3>
            <p className="text-sm text-slate-500">
              {historyCount > 0 ? `${historyCount} records available` : 'No past records found'}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-500" />
        </button>
      </div>
    </div>
  )
}
