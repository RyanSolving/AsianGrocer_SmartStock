'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'

import { SellPriceEditor } from '../components/SellPriceEditor'
import { fieldClass } from '../components/ui/Input'
import type { CatalogItem } from '../../lib/stock-schema'
import { isEmptySellPrice, normalizeSellPrice, sameSellPrice, type SellPrice } from '../../lib/stock-price'

type RowState = 'idle' | 'saving' | 'saved' | 'error'

type PriceChange = { code: string; price: number | null; price_unit: SellPrice['unit']; price_deals: SellPrice['deals']; price_pack_g: number | null }

const sellOf = (item: CatalogItem) => normalizeSellPrice({ price: item.price, unit: item.price_unit, deals: item.price_deals, pack_g: item.price_pack_g })

/**
 * Quick price entry: every catalog item in one list with its selling price: the price, what it
 * is sold by (Each, KG, ...) and combo deals (2 for $9). Type a price and press Enter to save
 * it and jump to the next box; a price is saved when you leave its box. "Missing" shows only
 * items with no price yet, so the list shrinks as you go.
 */
export function QuickPriceEntry({ items, onPricesSaved }: { items: CatalogItem[]; onPricesSaved: (changes: PriceChange[]) => void }) {
  const [query, setQuery] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(true)
  // Prices being typed or just saved, by code; the catalog's own price applies until typed over.
  const [drafts, setDrafts] = useState<Record<string, SellPrice>>({})
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [error, setError] = useState<string | null>(null)
  // The prices already stored, so only real changes are sent.
  const stored = useRef<Record<string, SellPrice>>({})
  // Items that were missing when "Missing" was switched on stay listed while you type them.
  const [keepListed, setKeepListed] = useState<Set<string>>(() => new Set())
  const listRef = useRef<HTMLDivElement | null>(null)

  const sellFor = useCallback((item: CatalogItem) => drafts[item.code] ?? sellOf(item), [drafts])
  const total = items.length
  const priced = useMemo(() => items.filter((item) => !isEmptySellPrice(sellFor(item))).length, [items, sellFor])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items
      .filter((item) => item.is_visible !== false)
      .filter((item) => {
        if (term && !`${item.official_name} ${item.stocklist_name} ${item.code} ${item.category}`.toLowerCase().includes(term)) return false
        if (!onlyMissing) return true
        return isEmptySellPrice(sellOf(item)) || keepListed.has(item.code)
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.official_name.localeCompare(b.official_name))
  }, [items, query, onlyMissing, keepListed])

  const save = useCallback(async (item: CatalogItem, sell: SellPrice) => {
    const before = stored.current[item.code] ?? sellOf(item)
    if (sameSellPrice(before, sell) && before.unit === sell.unit) return
    setRowState((current) => ({ ...current, [item.code]: 'saving' }))
    setError(null)
    try {
      const response = await fetch('/api/catalog/prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: [{ code: item.code, price: sell.price, unit: sell.unit, deals: sell.deals, pack_g: sell.pack_g }] }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || (body?.failed?.length ?? 0) > 0) {
        throw new Error(body?.failed?.[0]?.error ?? body?.error ?? 'Could not save the price.')
      }
      stored.current[item.code] = sell
      setRowState((current) => ({ ...current, [item.code]: 'saved' }))
      onPricesSaved([{ code: item.code, price: sell.price, price_unit: sell.unit, price_deals: sell.deals, price_pack_g: sell.pack_g }])
    } catch (failure) {
      setRowState((current) => ({ ...current, [item.code]: 'error' }))
      setError(`${item.official_name}: ${failure instanceof Error ? failure.message : 'Could not save the price.'}`)
    }
  }, [onPricesSaved])

  function focusNext(from: number) {
    const boxes = listRef.current?.querySelectorAll<HTMLInputElement>('input[data-price-row-index]')
    const next = boxes ? Array.from(boxes).find((box) => Number(box.dataset.priceRowIndex) > from) : null
    if (next) next.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  let lastCategory = ''
  return (
    <section className="space-y-3" aria-label="Quick price entry">
      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-ground px-1 pb-2 pt-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[18px] font-semibold text-ink">Quick prices</h2>
          <p className="tabular text-[14px] text-muted" aria-live="polite">{priced} of {total} priced</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full rounded-full bg-forest transition-all duration-200" style={{ width: `${total === 0 ? 0 : Math.round((priced / total) * 100)}%` }} />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or code" aria-label="Search items" className={`${fieldClass} pl-10`} />
        </div>
        <div className="flex gap-2" role="group" aria-label="Which items">
          {([['Missing price', true], ['All items', false]] as const).map(([label, value]) => (
            <button
              key={label}
              type="button"
              aria-pressed={onlyMissing === value}
              onClick={() => { setOnlyMissing(value); setKeepListed(new Set()) }}
              className={`min-h-10 rounded-full border px-4 text-[14px] font-medium ${onlyMissing === value ? 'border-forest bg-forest text-white' : 'border-line bg-surface text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {error ? <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-[14px] text-danger">{error}</p> : null}
      </div>

      <div ref={listRef} className="overflow-hidden rounded-card border border-line bg-surface">
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[15px] text-muted">
            {onlyMissing && !query ? 'Every item has a price.' : 'No items match.'}
          </p>
        ) : visible.map((item, index) => {
          const showHeading = item.category !== lastCategory
          lastCategory = item.category
          const state = rowState[item.code] ?? 'idle'
          return (
            <div key={item.code}>
              {showHeading ? <p className="bg-forest-100 px-4 py-2 text-[13px] font-bold uppercase tracking-wide text-forest">{item.category}</p> : null}
              <div className="space-y-2 border-b border-line px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-5 text-ink">{item.official_name}</p>
                    <p className="text-[12px] text-muted">{item.inner_quantity == null ? item.code : `${item.code} · ${item.inner_quantity} ${item.inner_unit}`}</p>
                  </div>
                  <span className="w-5 shrink-0 pt-0.5 text-center" aria-hidden="true">
                    {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : state === 'saved' ? <Check className="h-4 w-4 text-success" /> : state === 'error' ? <span className="text-danger">!</span> : null}
                  </span>
                </div>
                <SellPriceEditor
                  name={item.official_name}
                  value={sellFor(item)}
                  rowIndex={index}
                  onChange={(next) => {
                    setDrafts((current) => ({ ...current, [item.code]: next }))
                    setKeepListed((current) => (current.has(item.code) ? current : new Set(current).add(item.code)))
                    setRowState((current) => (!current[item.code] || current[item.code] === 'idle' ? current : { ...current, [item.code]: 'idle' }))
                  }}
                  onCommit={(next) => void save(item, next)}
                  onEnter={() => focusNext(index)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
