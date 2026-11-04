'use client'

import { useEffect, useState } from 'react'
import { Clock, Search, Trash2, X } from 'lucide-react'
import { Sheet } from './ui/Sheet'

type StockCheckHistoryEntry = {
  uid_stock_check: string
  timestamp: string
  stock_date: string
  record_name?: string | null
  mode: string
  validated: boolean
  item_count: number
  unknown_count: number
  record_data?: {
    items: Array<{
      code: string
      product: string
      category: string
      location: string
      sub_location: string
      official_name: string
      stocklist_name: string
      quantity: number | null
      red_marked: boolean
      notes: string
    }>
    unknown_items: Array<{
      user_input: string
      quantity: number | null
      red_marked: boolean
      notes: string
    }>
    validated: boolean
  }
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
    return date.toLocaleString('en-AU', {
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

  const getPaperGroups = (data?: StockCheckHistoryEntry['record_data']) => {
    if (!data) return []

    const items = data.items || []
    const unknownItems = data.unknown_items || []
    
    const groups: Record<string, Array<{ name: string; quantity: string }>> = {}

    items.forEach((row) => {
      const location = row.location?.trim() || 'Unknown'
      const subLocation = row.sub_location?.trim() || 'General'
      const groupKey = `${location} / ${subLocation}`
      const name = row.official_name?.trim() || row.product?.trim() || 'Unnamed item'
      const quantity = typeof row.quantity === 'number' ? String(row.quantity) : '-'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push({ name, quantity })
    })
    
    unknownItems.forEach((row) => {
      const groupKey = `Unknown / Unclassified`
      const name = row.user_input?.trim() || 'Unknown item'
      const quantity = typeof row.quantity === 'number' ? String(row.quantity) : '-'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push({ name, quantity })
    })

    return Object.entries(groups)
  }

  const renderPaperDetails = (entry: StockCheckHistoryEntry) => {
    const groups = getPaperGroups(entry.record_data)

    if (groups.length === 0) {
      return <p className="mt-2 text-xs text-slate-500">No item rows found for this record.</p>
    }

    return (
      <div className="mt-3 space-y-3">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Date:</span> {entry.stock_date}
          <span className="mx-2 text-slate-300">|</span>
          <span className="font-semibold text-slate-700">Mode:</span> {getModeLabel(entry.mode)}
        </div>

        {groups.map(([groupName, rows]) => (
          <div key={groupName} className="rounded-md border border-slate-200 bg-white">
            <p className="border-b border-slate-200 px-3 py-2 text-[13px] font-semibold text-ink">
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
    <Sheet open={isOpen} onClose={onClose} title="Stock close history" description="Open a saved stock close to edit it, or delete it." size="lg">
        <div className="space-y-3">
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
                  className="rounded-card border border-line bg-surface p-4"
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
                              ? 'bg-success-soft text-success'
                              : 'bg-warning-soft text-warning'
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
                        className="inline-flex min-h-11 items-center justify-center rounded-control bg-forest px-4 text-[15px] font-semibold text-white transition-colors hover:bg-forest-700"
                      >
                        Load to Edit
                      </button>
                      <button
                        onClick={() => onDeleteHistory(entry.uid_stock_check)}
                        disabled={Boolean(deletingUid)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-3 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingUid === entry.uid_stock_check ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-[13px] font-medium text-muted">
                          Paper Format
                        </p>
                        {renderPaperDetails(entry)}
                      </div>
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
    </Sheet>
  )
}
