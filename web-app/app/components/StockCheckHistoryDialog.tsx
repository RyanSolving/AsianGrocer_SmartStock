'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Sheet } from './ui/Sheet'
import { HistoryCard, HistoryDay, buildGroups, formatTime, groupByDay, type HistoryGroup } from './HistoryParts'

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
    if (selectedUid) setExpandedId(selectedUid)
  }, [isOpen, selectedUid])

  // Counted items only (0 counts too: a closing of 0 is information), grouped by area.
  const summaries = useMemo(() => {
    const map = new Map<string, { groups: HistoryGroup[]; items: number; units: number; unknown: number }>()
    for (const entry of history) {
      const rows: Array<{ area: string; name: string; quantity: number }> = []
      for (const row of entry.record_data?.items ?? []) {
        if (typeof row.quantity !== 'number') continue
        rows.push({
          area: `${row.location?.trim() || 'Unknown'} · ${row.sub_location?.trim() || 'General'}`,
          name: row.official_name?.trim() || row.product?.trim() || 'Unnamed item',
          quantity: row.quantity,
        })
      }
      let unknown = 0
      for (const row of entry.record_data?.unknown_items ?? []) {
        if (typeof row.quantity !== 'number') continue
        unknown += 1
        rows.push({ area: 'Unknown · Unclassified', name: row.user_input?.trim() || 'Unknown item', quantity: row.quantity })
      }
      map.set(entry.uid_stock_check, {
        groups: buildGroups(rows),
        items: rows.length,
        units: rows.reduce((sum, row) => sum + row.quantity, 0),
        unknown,
      })
    }
    return map
  }, [history])

  const days = useMemo(() => groupByDay(history, (entry) => entry.timestamp), [history])

  if (!isOpen) return null

  return (
    <Sheet open={isOpen} onClose={onClose} title="Stock close history" description="Open a saved stock close to edit it, or delete it." size="lg">
      <div className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600"></div>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="mb-3 h-12 w-12 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No stock close saved yet</p>
            <p className="mt-1 text-xs text-slate-500">Saved closing counts will show up here.</p>
          </div>
        ) : (
          days.map((day) => (
            <HistoryDay key={day.key} heading={day.heading} count={day.entries.length}>
              {day.entries.map((entry) => {
                const summary = summaries.get(entry.uid_stock_check)
                const time = formatTime(new Date(entry.timestamp))
                const isExpanded = expandedId === entry.uid_stock_check
                const summaryText = summary && summary.items > 0
                  ? `${summary.items} ${summary.items === 1 ? 'item' : 'items'} · ${summary.units} units${summary.unknown > 0 ? ` · ${summary.unknown} not in catalog` : ''}`
                  : 'Nothing counted'
                return (
                  <HistoryCard
                    key={entry.uid_stock_check}
                    title={`${entry.mode === 'arrival_entry' ? 'Arrival' : 'Closing'} · ${time}`}
                    subtitle={`Stock date ${entry.stock_date}`}
                    badge={{ label: entry.validated ? 'Checked' : 'Not checked', tone: entry.validated ? 'success' : 'warning' }}
                    summary={summaryText}
                    groups={summary?.groups ?? []}
                    expanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : entry.uid_stock_check)}
                    onLoadToEdit={() => onLoadToEdit(entry.uid_stock_check)}
                    onDelete={() => onDeleteHistory(entry.uid_stock_check)}
                    isDeleting={deletingUid === entry.uid_stock_check}
                    deleteDisabled={Boolean(deletingUid)}
                  />
                )
              })}
            </HistoryDay>
          ))
        )}
      </div>
    </Sheet>
  )
}
