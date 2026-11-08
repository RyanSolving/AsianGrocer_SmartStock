'use client'

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, FileImage } from 'lucide-react'
import { Sheet } from './ui/Sheet'
import { HistoryCard, HistoryDay, buildGroups, formatTime, groupByDay, type HistoryGroup } from './HistoryParts'

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
  /** Omit to hide Re-push (while the warehouse sync is paused). */
  onRepush?: (uid: string) => void
  onDeleteHistory: (uid: string) => void
  deletingUid?: string | null
  isRepushing: boolean
  selectedUid?: string | null
  visibleCatalogCodes?: Set<string>
}

type RawItem = {
  catalog_code?: string | null
  location?: string
  sub_location?: string
  official_name?: string
  product_raw?: string
  quantity?: number | null
  special?: boolean
  notes?: string | null
}

export function TranscriptionHistoryDialog({
  isOpen,
  onClose,
  history,
  isLoading,
  onLoadToEdit,
  onRepush,
  onDeleteHistory,
  deletingUid,
  isRepushing,
  selectedUid,
  visibleCatalogCodes,
}: TranscriptionHistoryDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    if (selectedUid) {
      setExpandedId(selectedUid)
      return
    }

    setExpandedId((current) => current ?? null)
  }, [isOpen, selectedUid])

  // Only counted items are listed; a record's blank rows would bury what actually arrived.
  const summaries = useMemo(() => {
    const map = new Map<string, { groups: HistoryGroup[]; items: number; units: number; notes: number }>()
    for (const entry of history) {
      const items = (entry.transcriptionData as { items?: unknown[] } | null)?.items
      const rows: Array<{ area: string; name: string; quantity: number; special?: boolean; note?: string }> = []
      for (const raw of Array.isArray(items) ? items : []) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as RawItem
        const code = row.catalog_code?.trim().toUpperCase() ?? ''
        if (code && visibleCatalogCodes && !visibleCatalogCodes.has(code)) continue
        if (typeof row.quantity !== 'number' || row.quantity <= 0) continue
        rows.push({
          area: `${row.location?.trim() || 'Unknown'} · ${row.sub_location?.trim() || 'General'}`,
          name: row.official_name?.trim() || row.product_raw?.trim() || 'Unnamed item',
          quantity: row.quantity,
          special: row.special === true,
          note: row.notes?.trim() || undefined,
        })
      }
      map.set(entry.uid_generate, {
        groups: buildGroups(rows),
        items: rows.length,
        units: rows.reduce((sum, row) => sum + row.quantity, 0),
        notes: rows.filter((row) => row.note).length,
      })
    }
    return map
  }, [history, visibleCatalogCodes])

  const days = useMemo(() => groupByDay(history, (entry) => entry.timestamp), [history])

  if (!isOpen) return null

  return (
    <Sheet open={isOpen} onClose={onClose} title="Stock in history" description="Open a saved stock in to edit it or delete it." size="lg">
      <div className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600"></div>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileImage className="mb-3 h-12 w-12 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No stock in saved yet</p>
            <p className="mt-1 text-xs text-slate-500">Saved deliveries will show up here.</p>
          </div>
        ) : (
          days.map((day) => (
            <HistoryDay key={day.key} heading={day.heading} count={day.entries.length}>
              {day.entries.map((entry) => {
                const summary = summaries.get(entry.uid_generate)
                const time = formatTime(new Date(entry.timestamp))
                const isExpanded = expandedId === entry.uid_generate
                const summaryText = summary && summary.items > 0
                  ? `${summary.items} ${summary.items === 1 ? 'item' : 'items'} · ${summary.units} units${summary.notes > 0 ? ` · ${summary.notes} ${summary.notes === 1 ? 'note' : 'notes'}` : ''}`
                  : 'Nothing counted'
                return (
                  <HistoryCard
                    key={entry.uid_generate}
                    title={`${entry.stockMode === 'stock-closing' ? 'Closing' : 'Stock in'} · ${time}`}
                    subtitle={`Stock date ${(entry.transcriptionData as { stock_date?: string } | null)?.stock_date ?? '-'}`}
                    badge={onRepush ? { label: entry.isPushed ? 'Synced' : 'Not synced', tone: entry.isPushed ? 'success' : 'warning' } : undefined}
                    summary={summaryText}
                    groups={summary?.groups ?? []}
                    expanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : entry.uid_generate)}
                    onLoadToEdit={() => onLoadToEdit(entry.uid_generate)}
                    onDelete={() => onDeleteHistory(entry.uid_generate)}
                    isDeleting={deletingUid === entry.uid_generate}
                    deleteDisabled={Boolean(deletingUid)}
                    extraActions={onRepush ? (
                      <button
                        type="button"
                        onClick={() => onRepush(entry.uid_generate)}
                        disabled={isRepushing}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-forest-200 bg-forest-50 px-3 text-[15px] font-medium text-forest-800 transition hover:bg-forest-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Re-sync
                      </button>
                    ) : null}
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
