'use client'

import { useEffect, useState } from 'react'
import { X, RefreshCw, Clock, FileImage } from 'lucide-react'

type HistoryEntry = {
  uid_generate: string
  timestamp: string
  filename: string
  transcriptionData: unknown
  stockMode: string
  isPushed: boolean
}

type TranscriptionHistoryDialogProps = {
  isOpen: boolean
  onClose: () => void
  history: HistoryEntry[]
  isLoading: boolean
  onLoadToEdit: (uid: string) => void
  onRepush: (uid: string) => void
  isRepushing: boolean
  selectedUid?: string | null
  visibleCatalogCodes?: Set<string>
}

export function TranscriptionHistoryDialog({
  isOpen,
  onClose,
  history,
  isLoading,
  onLoadToEdit,
  onRepush,
  isRepushing,
  selectedUid,
  visibleCatalogCodes,
}: TranscriptionHistoryDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (selectedUid) {
      setExpandedId(selectedUid)
      return
    }

    setExpandedId((current) => current ?? history[0]?.uid_generate ?? null)
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

  const getTranscriptionText = (data: unknown) => {
    if (!data || typeof data !== 'object') return 'No data'
    const items = (data as { items?: unknown[] }).items
    if (Array.isArray(items) && items.length > 0) {
      return `${items.length} items transcribed`
    }
    return 'No items extracted'
  }

  const getPaperGroups = (data: unknown) => {
    if (!data) return []
    if (typeof data !== 'object') return []

    const items = (data as { items?: unknown[] }).items
    if (!Array.isArray(items)) return []

    const groups: Record<string, Array<{ name: string; quantity: string }>> = {}

    items.forEach((item) => {
      if (!item || typeof item !== 'object') return

      const row = item as {
        catalog_code?: string | null
        location?: string
        sub_location?: string
        official_name?: string
        product_raw?: string
        quantity?: number | null
        quantity_raw?: string | null
      }

      const catalogCode = row.catalog_code?.trim().toUpperCase() ?? ''
      if (catalogCode && visibleCatalogCodes && !visibleCatalogCodes.has(catalogCode)) {
        return
      }

      const location = row.location?.trim() || 'Unknown'
      const subLocation = row.sub_location?.trim() || 'General'
      const groupKey = `${location} / ${subLocation}`
      const name = row.official_name?.trim() || row.product_raw?.trim() || 'Unnamed item'
      const quantity =
        typeof row.quantity === 'number'
          ? String(row.quantity)
          : row.quantity_raw?.trim() || '-'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }

      groups[groupKey].push({ name, quantity })
    })

    return Object.entries(groups)
  }

  const getStockDate = (data: unknown) => {
    if (!data || typeof data !== 'object') return '-'
    return (data as { stock_date?: string }).stock_date ?? '-'
  }

  const getModeLabel = (mode: string) => {
    if (mode === 'stock-closing') return 'Stock-closing'
    if (mode === 'stock-in') return 'Stock-in'
    return mode || '-'
  }

  const renderPaperDetails = (data: unknown, mode: string) => {
    const groups = getPaperGroups(data)

    if (groups.length === 0) {
      return <p className="mt-2 text-xs text-slate-500">No item rows found for this transcription.</p>
    }

    return (
      <div className="mt-3 space-y-3">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Date:</span> {getStockDate(data)}
          <span className="mx-2 text-slate-300">|</span>
          <span className="font-semibold text-slate-700">Mode:</span> {getModeLabel(mode)}
        </div>

        {groups.map(([groupName, rows]) => (
          <div key={groupName} className="rounded-md border border-slate-200 bg-white">
            <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {groupName}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${groupName}-${idx}`} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2 text-right font-semibold">{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="card-surface relative max-h-[90vh] w-full max-w-2xl rounded-2xl p-6 shadow-xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100">
              <Clock className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Transcription History</h2>
              <p className="text-xs text-slate-500">View and manage previous transcriptions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-150px)] space-y-3 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileImage className="mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No transcriptions yet</p>
              <p className="mt-1 text-xs text-slate-500">Start by uploading a stocklist photo</p>
            </div>
          ) : (
            history.map((entry) => (
              <div
                key={entry.uid_generate}
                className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{entry.filename}</p>
                      <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-700">
                        {entry.stockMode === 'stock-closing' ? 'Closing' : 'Arrival'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          entry.isPushed
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {entry.isPushed ? 'Pushed' : 'Pending'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(entry.timestamp)}</p>
                    <p className="mt-2 text-sm text-slate-600">
                      {getTranscriptionText(entry.transcriptionData)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => onLoadToEdit(entry.uid_generate)}
                      className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
                    >
                      Load to Edit
                    </button>
                    <button
                      onClick={() => onRepush(entry.uid_generate)}
                      disabled={isRepushing}
                      className="flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Re-push
                    </button>
                  </div>
                </div>

                {/* Expandable Details */}
                {expandedId === entry.uid_generate && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="rounded-md bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Paper Format
                      </p>
                      {renderPaperDetails(entry.transcriptionData, entry.stockMode)}
                    </div>
                  </div>
                )}

                {/* Expand/Collapse */}
                <button
                  onClick={() =>
                    setExpandedId(expandedId === entry.uid_generate ? null : entry.uid_generate)
                  }
                  className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  {expandedId === entry.uid_generate ? 'Show less' : 'Show details'}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
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
