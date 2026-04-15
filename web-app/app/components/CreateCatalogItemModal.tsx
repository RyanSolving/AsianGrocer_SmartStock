'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, X } from 'lucide-react'

import {
  catalogItemSchema,
  catalogLocationOptions,
  catalogRowPositionOptions,
  catalogSubLocationInsideOptions,
  catalogSubLocationOutsideOptions,
} from '../../lib/stock-schema'

export type CreateCatalogItemPayload = {
  code: string
  location: 'Inside Coolroom' | 'Outside Coolroom'
  sub_location: string
  category: string
  product: string
  attribute: string
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

  const updateField = (field: keyof CreateCatalogItemPayload, value: string | boolean) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card-surface w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Create New Item</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500">Item Code</label>
            <input
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono text-slate-700 ${errors.code ? 'border-red-400' : 'border-slate-300'}`}
              value={form.code}
              onChange={(event) => updateField('code', event.target.value)}
              placeholder="XXX-NEW-STD"
            />
            {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500">Location</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
              <label className="block text-xs font-semibold text-slate-500">Sub-location</label>
              <select
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${errors.sub_location ? 'border-red-400' : 'border-slate-300'}`}
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
              <label className="block text-xs font-semibold text-slate-500">Category</label>
              <select
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${errors.category ? 'border-red-400' : 'border-slate-300'}`}
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
              <label className="block text-xs font-semibold text-slate-500">Product</label>
              <input
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${errors.product ? 'border-red-400' : 'border-slate-300'}`}
                value={form.product}
                onChange={(event) => updateField('product', event.target.value)}
              />
              {errors.product && <p className="mt-1 text-xs text-red-500">{errors.product}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500">Attribute</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.attribute}
                onChange={(event) => updateField('attribute', event.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500">Row Position</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.row_position}
                onChange={(event) => updateField('row_position', event.target.value)}
              >
                {catalogRowPositionOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500">Official Name</label>
              <input
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${errors.official_name ? 'border-red-400' : 'border-slate-300'}`}
                value={form.official_name}
                onChange={(event) => updateField('official_name', event.target.value)}
              />
              {errors.official_name && <p className="mt-1 text-xs text-red-500">{errors.official_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500">Name On Stocklist</label>
              <input
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${errors.stocklist_name ? 'border-red-400' : 'border-slate-300'}`}
                value={form.stocklist_name}
                onChange={(event) => updateField('stocklist_name', event.target.value)}
              />
              {errors.stocklist_name && <p className="mt-1 text-xs text-red-500">{errors.stocklist_name}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500">Navigation Guide</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.navigation_guide}
              onChange={(event) => updateField('navigation_guide', event.target.value)}
            />
          </div>

          {apiError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {apiError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save To Catalog
          </button>
        </div>
      </div>
    </div>
  )
}
