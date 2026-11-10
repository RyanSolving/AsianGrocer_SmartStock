'use client'

import { useEffect, useMemo, useState } from 'react'
import { Save } from 'lucide-react'

import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'
import { SellPriceEditor } from './SellPriceEditor'
import type { PriceDeal, PriceUnit } from '../../lib/stock-price'

import {
  catalogItemSchema,
  catalogInnerUnitOptions,
  catalogLocationOptions,
  catalogRowPositionOptions,
  catalogSubLocationInsideOptions,
  catalogSubLocationOutsideOptions,
  catalogSubLocationVegiesOptions,
} from '../../lib/stock-schema'

export type CreateCatalogItemPayload = {
  code: string
  location: 'Inside Coolroom' | 'Outside Coolroom' | 'Vegies'
  sub_location: string
  category: string
  product: string
  attribute: string
  origin: string
  inner_quantity: number | null
  inner_unit: 'box' | 'bag' | 'punnet' | 'piece' | 'tray' | 'bunch' | 'pack' | 'kg' | 'g'
  /** Normal selling price; null when not set. */
  price?: number | null
  price_unit?: PriceUnit
  price_deals?: PriceDeal[]
  price_pack_g?: number | null
  official_name: string
  stocklist_name: string
  navigation_guide: string
  row_position: 'left' | 'right' | 'single'
  is_visible: boolean
}

type CreateCatalogItemModalProps = {
  isOpen: boolean
  initialName: string
  categories: string[]
  existingCodes?: Set<string>
  onClose: () => void
  onCreated: (item: CreateCatalogItemPayload) => void
}

function generateItemCode(category: string, product: string, attribute: string) {
  const cat3 = (category || 'OTH').toUpperCase().slice(0, 3)
  const prod3 = (product || 'NEW').toUpperCase().slice(0, 3)
  const attr3 = attribute ? attribute.toUpperCase().slice(0, 3) : 'STD'
  return `${cat3}-${prod3}-${attr3}`
}

function getSubLocationOptions(location: string) {
  if (location === 'Outside Coolroom') return catalogSubLocationOutsideOptions
  if (location === 'Vegies') return catalogSubLocationVegiesOptions
  return catalogSubLocationInsideOptions
}

function buildFieldErrors(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  const nextErrors: Record<string, string> = {}

  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !nextErrors[field]) {
      nextErrors[field] = issue.message
    }
  }

  return nextErrors
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload !== 'object' || payload === null) return fallback

  const data = payload as {
    error?: unknown
    details?: unknown
    hint?: unknown
    warning?: unknown
  }

  const details = typeof data.details === 'string'
    ? data.details
    : data.details
      ? JSON.stringify(data.details)
      : ''

  const hint = typeof data.hint === 'string' ? data.hint : ''
  const warning = typeof data.warning === 'string' ? data.warning : ''
  const base = typeof data.error === 'string' ? data.error : fallback

  return [base, details, hint, warning].filter((part) => part && part.trim().length > 0).join(' | ')
}

export function CreateCatalogItemModal({
  isOpen,
  initialName,
  categories,
  existingCodes,
  onClose,
  onCreated,
}: CreateCatalogItemModalProps) {
  const defaultCategory = useMemo(() => (categories.length > 0 ? categories[0] : 'Apples'), [categories])
  const [form, setForm] = useState<CreateCatalogItemPayload>({
    code: '',
    location: 'Inside Coolroom',
    sub_location: catalogSubLocationInsideOptions[0],
    category: defaultCategory,
    product: '',
    attribute: '',
    origin: '',
    inner_quantity: null,
    inner_unit: 'box',
    price: null,
    price_unit: 'ea',
    price_deals: [],
    price_pack_g: null,
    official_name: '',
    stocklist_name: '',
    navigation_guide: '',
    row_position: 'single',
    is_visible: true,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const trimmedName = initialName.trim()
    const initialProduct = trimmedName
    const initialOfficialName = trimmedName
    const initialStocklistName = trimmedName

    setForm({
      code: generateItemCode(defaultCategory, initialProduct, ''),
      location: 'Inside Coolroom',
      sub_location: catalogSubLocationInsideOptions[0],
      category: defaultCategory,
      product: initialProduct,
      attribute: '',
      origin: '',
      inner_quantity: null,
      inner_unit: 'box',
      price: null,
      price_unit: 'ea',
      price_deals: [],
      price_pack_g: null,
      official_name: initialOfficialName,
      stocklist_name: initialStocklistName,
      navigation_guide: '',
      row_position: 'single',
      is_visible: true,
    })
    setErrors({})
    setApiError(null)
  }, [defaultCategory, initialName, isOpen])

  if (!isOpen) return null

  const updateField = (field: keyof CreateCatalogItemPayload, value: string | boolean | number | null) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }

      if (field === 'location' && typeof value === 'string') {
        next.sub_location = getSubLocationOptions(value)[0]
      }

      if (field === 'category' || field === 'product' || field === 'attribute') {
        next.code = generateItemCode(
          field === 'category' && typeof value === 'string' ? value : next.category,
          field === 'product' && typeof value === 'string' ? value : next.product,
          field === 'attribute' && typeof value === 'string' ? value : next.attribute,
        )
      }

      return next
    })
  }

  const handleSubmit = async () => {
    const parsed = catalogItemSchema.safeParse({
      ...form,
      code: form.code.trim(),
    })

    if (!parsed.success) {
      setErrors(buildFieldErrors(parsed.error))
      setApiError(null)
      return
    }

    const normalizedCode = parsed.data.code.trim().toUpperCase()
    if (existingCodes?.has(normalizedCode)) {
      setErrors({ code: 'Item code already exists.' })
      setApiError(null)
      return
    }

    const normalizedPayload: CreateCatalogItemPayload = {
      code: parsed.data.code,
      location: parsed.data.location,
      sub_location: parsed.data.sub_location,
      category: parsed.data.category,
      product: parsed.data.product,
      attribute: parsed.data.attribute,
      origin: parsed.data.origin,
      inner_quantity: parsed.data.inner_quantity,
      inner_unit: parsed.data.inner_unit,
      price: parsed.data.price ?? null,
      price_unit: parsed.data.price_unit ?? 'ea',
      price_deals: parsed.data.price_deals ?? [],
      price_pack_g: parsed.data.price_pack_g ?? null,
      official_name: parsed.data.official_name,
      stocklist_name: parsed.data.stocklist_name,
      navigation_guide: parsed.data.navigation_guide,
      row_position: parsed.data.row_position ?? 'single',
      is_visible: parsed.data.is_visible ?? true,
    }

    setIsSaving(true)
    setApiError(null)

    try {
      const response = await fetch('/api/catalog/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedPayload),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to create catalog item.'))
      }

      onCreated(normalizedPayload)
      onClose()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to create catalog item.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title="New catalog item"
      description="Add it once here; it then shows up in search for Stock In and Stock Close."
      size="md"
      dismissible={!isSaving}
      footer={
        <>
          <Button variant="secondary" size="lg" className="sm:min-h-11" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="lg" className="sm:min-h-11" icon={<Save className="h-4 w-4" aria-hidden="true" />} loading={isSaving} loadingLabel="Saving…" onClick={handleSubmit}>
            Save to catalog
          </Button>
        </>
      }
    >
        <div className="space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-ink">Item Code</label>
            <input
              className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] font-mono text-slate-700 ${errors.code ? 'border-red-400' : 'border-slate-300'}`}
              value={form.code}
              onChange={(event) => updateField('code', event.target.value)}
              placeholder="XXX-NEW-STD"
            />
            {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Location</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.location}
                onChange={(event) => {
                  updateField('location', event.target.value)
                }}
              >
                {catalogLocationOptions.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Sub-location</label>
              <select
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.sub_location ? 'border-red-400' : 'border-slate-300'}`}
                value={form.sub_location}
                onChange={(event) => updateField('sub_location', event.target.value)}
              >
                {getSubLocationOptions(form.location).map((sub) => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
              {errors.sub_location && <p className="mt-1 text-xs text-red-500">{errors.sub_location}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Category</label>
              <select
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.category ? 'border-red-400' : 'border-slate-300'}`}
                value={form.category}
                onChange={(event) => updateField('category', event.target.value)}
              >
                {categories.length > 0 ? (
                  categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))
                ) : (
                  <option disabled>No categories available</option>
                )}
              </select>
              {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category}</p>}
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Product</label>
              <input
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.product ? 'border-red-400' : 'border-slate-300'}`}
                value={form.product}
                onChange={(event) => updateField('product', event.target.value)}
              />
              {errors.product && <p className="mt-1 text-xs text-red-500">{errors.product}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Attribute</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.attribute}
                onChange={(event) => updateField('attribute', event.target.value)}
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Origin</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.origin}
                onChange={(event) => updateField('origin', event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Inner Quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.inner_quantity ? 'border-red-400' : 'border-slate-300'}`}
                value={form.inner_quantity ?? ''}
                onChange={(event) => updateField('inner_quantity', event.target.value === '' ? null : Number(event.target.value))}
              />
              {errors.inner_quantity && <p className="mt-1 text-xs text-red-500">{errors.inner_quantity}</p>}
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Inner Unit</label>
              <select
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.inner_unit ? 'border-red-400' : 'border-slate-300'}`}
                value={form.inner_unit}
                onChange={(event) => updateField('inner_unit', event.target.value)}
              >
                {catalogInnerUnitOptions.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
              {errors.inner_unit && <p className="mt-1 text-xs text-red-500">{errors.inner_unit}</p>}
            </div>
          </div>

          <div>
            <p className="block text-[14px] font-medium text-ink">Selling price <span className="font-normal text-slate-400">(optional)</span></p>
            <div className="mt-1">
              <SellPriceEditor
                name={form.official_name || 'new item'}
                value={{ price: form.price, unit: form.price_unit, deals: form.price_deals, pack_g: form.price_pack_g ?? null }}
                onChange={(next) => setForm((prev) => ({ ...prev, price: next.price, price_unit: next.unit, price_deals: next.deals, price_pack_g: next.pack_g }))}
              />
            </div>
            {errors.price ? <p className="mt-1 text-xs text-red-500">{errors.price}</p> : null}
          </div>

          <div>
              <label className="block text-[14px] font-medium text-ink">Row Position</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.row_position}
                onChange={(event) => updateField('row_position', event.target.value)}
              >
                {catalogRowPositionOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Official Name</label>
              <input
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.official_name ? 'border-red-400' : 'border-slate-300'}`}
                value={form.official_name}
                onChange={(event) => updateField('official_name', event.target.value)}
              />
              {errors.official_name && <p className="mt-1 text-xs text-red-500">{errors.official_name}</p>}
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Name On Stocklist</label>
              <input
                className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] ${errors.stocklist_name ? 'border-red-400' : 'border-slate-300'}`}
                value={form.stocklist_name}
                onChange={(event) => updateField('stocklist_name', event.target.value)}
              />
              {errors.stocklist_name && <p className="mt-1 text-xs text-red-500">{errors.stocklist_name}</p>}
            </div>
          </div>

          <div>
            <label className="block text-[14px] font-medium text-ink">Navigation Guide</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
              value={form.navigation_guide}
              onChange={(event) => updateField('navigation_guide', event.target.value)}
            />
          </div>

          {apiError && (
            <p className="rounded-md border border-red-200 bg-red-50 min-h-11 px-3 text-[16px] text-red-700">
              {apiError}
            </p>
          )}
        </div>
    </Sheet>
  )
}
