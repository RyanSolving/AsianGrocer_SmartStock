'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

import { PriceInput } from './PriceInput'
import {
  MAX_DEALS,
  dealEach,
  formatPrice,
  normalizeDeals,
  priceUnitNames,
  priceUnits,
  type PriceUnit,
  type SellPrice,
} from '../../lib/stock-price'

type SellPriceEditorProps = {
  value: SellPrice
  onChange: (next: SellPrice) => void
  /** Called when a change is complete (price box left, unit picked, deal added or removed). */
  onCommit?: (next: SellPrice) => void
  /** Index for Enter-to-next-row navigation (the price box only). */
  rowIndex?: number
  onEnter?: () => void
  /** Item name, for the boxes' accessible labels. */
  name: string
  /** Less space: Add deal is a text link and the deal chips are small. */
  compact?: boolean
}

/**
 * The selling price of one item: the normal price, what it is sold by (Each, KG, ...), and
 * combo deals such as "2 for $9.00". Used in the catalog form, Quick prices and Stock In.
 */
export function SellPriceEditor({ value, onChange, onCommit, rowIndex, onEnter, name, compact = false }: SellPriceEditorProps) {
  const [adding, setAdding] = useState(false)
  const [qty, setQty] = useState('2')
  const [total, setTotal] = useState<number | null>(null)
  const [dealError, setDealError] = useState<string | null>(null)

  function update(next: SellPrice, done: boolean) {
    onChange(next)
    if (done) onCommit?.(next)
  }

  function addDeal() {
    const count = Number(qty)
    if (!Number.isInteger(count) || count < 2 || count > 99 || total === null || total <= 0) {
      setDealError('Enter 2 or more items and the total price.')
      return
    }
    update({ ...value, deals: normalizeDeals([...value.deals, { qty: count, total }]) }, true)
    setAdding(false)
    setQty('2')
    setTotal(null)
    setDealError(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Sold by first, then the price. */}
        <select
          aria-label={`Sold by, ${name}`}
          value={value.unit}
          onChange={(event) => update({ ...value, unit: event.target.value as PriceUnit }, true)}
          className="min-h-10 shrink-0 rounded-lg border border-line bg-surface px-2 text-[16px] text-ink"
        >
          {priceUnits.map((unit) => <option key={unit} value={unit}>{priceUnitNames[unit]}</option>)}
        </select>
        <div className="w-36 min-w-0">
          <PriceInput
            value={value.price}
            rowIndex={rowIndex}
            aria-label={`Price for ${name}`}
            onChange={(price) => update({ ...value, price }, false)}
            onCommit={(price) => onCommit?.({ ...value, price })}
            onEnter={onEnter}
          />
        </div>
      </div>

      {value.deals.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Deals for ${name}`}>
          {value.deals.map((deal) => (
            <li key={deal.qty} className="inline-flex items-center gap-1 rounded-full bg-forest-50 py-1 pl-3 pr-1 text-[14px] text-forest-800">
              <span className="font-semibold">{deal.qty} for {formatPrice(deal.total)}</span>
              <span className="text-[12px] text-muted">{formatPrice(dealEach(deal))} ea</span>
              <button
                type="button"
                aria-label={`Remove ${deal.qty} for ${formatPrice(deal.total)}`}
                onClick={() => update({ ...value, deals: value.deals.filter((entry) => entry.qty !== deal.qty) }, true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={99}
              value={qty}
              aria-label={`Deal quantity, ${name}`}
              onChange={(event) => setQty(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-10 w-16 rounded-lg border border-line bg-surface px-2 text-center text-[16px] font-semibold"
            />
            <span className="text-[15px] text-muted">for</span>
            <div className="w-28">
              <PriceInput
                value={total}
                aria-label={`Deal total, ${name}`}
                onChange={setTotal}
                onEnter={addDeal}
              />
            </div>
            <button type="button" onClick={addDeal} className="min-h-10 rounded-lg bg-forest px-3 text-[14px] font-semibold text-white">Add</button>
            <button type="button" onClick={() => { setAdding(false); setDealError(null) }} className="min-h-10 px-2 text-[14px] text-muted">Cancel</button>
          </div>
          {dealError ? <p role="alert" className="text-[13px] text-danger">{dealError}</p> : null}
        </div>
      ) : value.deals.length < MAX_DEALS ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={compact
            ? 'inline-flex min-h-9 items-center gap-1 text-[14px] font-medium text-forest'
            : 'inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[14px] font-medium text-forest hover:bg-forest-50'}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add deal <span className="font-normal text-muted">(e.g. 2 for $9)</span>
        </button>
      ) : null}
    </div>
  )
}
