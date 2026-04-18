'use client'

import { useEffect, useState } from 'react'
import { Clock, Search, Trash2, X } from 'lucide-react'

type StockCheckHistoryEntry = {
  uid_stock_check: string
  timestamp: string
  stock_date: string
  record_name?: string | null
  mode: string
  validated: boolean
  item_count: number
  unknown_count: number
}

type StockCheckHistoryDialogProps = {
  isOpen: boolean
  onClose: () => void
  history: StockCheckHistoryEntry[]
  isLoading: boolean
  deletingUid?: string | null
  selectedUid?: string | null
  onLoadToEdit: (uid: string) => void
  onDeleteHistory: (uid: string) => void
}

export function StockCheckHistoryDialog({
  isOpen,
  onClose,
  history,
  isLoading,
  deletingUid,
  selectedUid,
  onLoadToEdit,
  onDeleteHistory,
}: StockCheckHistoryDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    if (selectedUid) {
      setExpandedId(selectedUid)
      return
    }

    setExpandedId((current) => current ?? history[0]?.uid_stock_check ?? null)
  }, [history, isOpen, selectedUid])

  if (!isOpen) return null

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getModeLabel = (mode: string) => {
    if (mode === 'closing_check') return 'Closing'
    if (mode === 'arrival_entry') return 'Arrival'
    return mode || 'Unknown'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="card-surface relative max-h-[90vh] w-full max-w-2xl rounded-2xl p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100">
              <Clock className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Stock Check History</h2>
              <p className="text-xs text-slate-500">View and manage previous stock-check records</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-150px)] space-y-3 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No stock-check records yet</p>
              <p className="mt-1 text-xs text-slate-500">Create and save a stock-check to build history</p>
            </div>
          ) : (
            history.map((entry) => {
              const isExpanded = expandedId === entry.uid_stock_check
              return (
                <div
                  key={entry.uid_stock_check}
                  className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {entry.record_name || `${entry.stock_date} (${entry.item_count} items)`}
                        </p>
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-700">
                          {getModeLabel(entry.mode)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            entry.validated
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {entry.validated ? 'Validated' : 'Unvalidated'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(entry.timestamp)}</p>
                      <p className="mt-2 text-sm text-slate-600">
                        {entry.item_count} known item(s) · {entry.unknown_count} unknown item(s)
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => onLoadToEdit(entry.uid_stock_check)}
                        className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
                      >
                        Load to Edit
                      </button>
                      <button
                        onClick={() => onDeleteHistory(entry.uid_stock_check)}
                        disabled={Boolean(deletingUid)}
                        className="flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingUid === entry.uid_stock_check ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-600">
                      <p><span className="font-semibold text-slate-700">Stock date:</span> {entry.stock_date}</p>
                      <p><span className="font-semibold text-slate-700">UID:</span> {entry.uid_stock_check}</p>
                    </div>
                  )}

                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.uid_stock_check)}
                    className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    {isExpanded ? 'Show less' : 'Show details'}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
