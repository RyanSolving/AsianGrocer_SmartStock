'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Database,
  RefreshCw,
} from 'lucide-react'

import { Button, IconButton } from '../components/ui/Button'
import { fieldClass, inputClass } from '../components/ui/Input'
import { ScreenHeader } from '../components/ui/Primitives'
import { Sheet } from '../components/ui/Sheet'
import {
  catalogItemSchema,
  catalogInnerUnitOptions,
  catalogLocationOptions,
  catalogRowPositionOptions,
  catalogSubLocationInsideOptions,
  catalogSubLocationOutsideOptions,
  type CatalogItem,
} from '../../lib/stock-schema'
import { formatDeals, formatMainPrice, normalizeSellPrice } from '../../lib/stock-price'
import { SellPriceEditor } from '../components/SellPriceEditor'
import { QuickPriceEntry } from './QuickPriceEntry'

function getApiErrorMessage(payload: any, fallback: string) {
  const details = typeof payload?.details === 'string'
    ? payload.details
    : payload?.details
      ? JSON.stringify(payload.details)
      : ''

  const hint = typeof payload?.hint === 'string' ? payload.hint : ''
  const warning = typeof payload?.warning === 'string' ? payload.warning : ''
  const base = typeof payload?.error === 'string' ? payload.error : fallback

  return [base, details, hint, warning]
    .map((part) => part.trim().replace(/\.+$/, ''))
    .filter((part, index, parts) => part.length > 0 && parts.indexOf(part) === index)
    .join('. ') + '.'
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

const emptyItem = (defaultCategory: string = 'Apples'): CatalogItem => ({
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
  official_name: '',
  stocklist_name: '',
  navigation_guide: '',
  row_position: 'single',
  is_visible: true,
})

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

function StatusBanner({
  tone,
  title,
  message,
}: {
  tone: 'success' | 'error'
  title: string
  message: string
}) {
  const isSuccess = tone === 'success'
  const classes = isSuccess
    ? 'border-success/30 bg-success-soft text-success'
    : 'border-red-200 bg-red-50 text-red-900'

  return (
    <div role={isSuccess ? 'status' : 'alert'} className={`rounded-card border px-4 py-4 ${classes}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isSuccess ? 'bg-success text-white' : 'bg-red-600 text-white'}`}>
          {isSuccess ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{message}</p>
        </div>
      </div>
    </div>
  )
}

function ItemModal({
  isOpen,
  onClose,
  onSave,
  item,
  isEdit,
  isSaving,
  categories = [],
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (item: CatalogItem) => void
  item: CatalogItem | null
  isEdit: boolean
  isSaving: boolean
  categories?: string[]
}) {
  const defaultCategory = categories.length > 0 ? categories[0] : 'Apples'
  const [form, setForm] = useState<CatalogItem>(emptyItem(defaultCategory))
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen) {
      setForm(item ?? emptyItem(defaultCategory))
      setErrors({})
    }
  }, [isOpen, item, defaultCategory])

  if (!isOpen) return null

  const updateField = (field: keyof CatalogItem, value: string | boolean | number | null) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }

      if (field === 'location' && typeof value === 'string') {
        next.sub_location = getSubLocationOptions(value)[0]
      }

      if (['category', 'product', 'attribute'].includes(field) && !isEdit && typeof value === 'string') {
        next.code = generateItemCode(
          field === 'category' ? value : next.category,
          field === 'product' ? value : next.product,
          field === 'attribute' ? value : next.attribute
        )
      }

      return next
    })
  }

  const handleSubmit = () => {
    const result = catalogItemSchema.safeParse({
      ...form,
      code: form.code.trim(),
    })

    if (!result.success) {
      setErrors(buildFieldErrors(result.error))
      return
    }

    onSave(result.data)
  }

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit item' : 'New item'}
      size="md"
      dismissible={!isSaving}
      footer={
        <>
          <Button variant="secondary" size="lg" className="sm:min-h-11" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="lg" className="sm:min-h-11" icon={<Save className="h-4 w-4" aria-hidden="true" />} loading={isSaving} loadingLabel="Saving…" onClick={handleSubmit}>
            {isEdit ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
        <div className="space-y-4">
          {/* Item Code (auto-generated) */}
          <div>
            <label className="block text-[14px] font-medium text-ink">Item Code</label>
            <input
              readOnly={isEdit}
              className={`mt-1 w-full rounded-lg border min-h-11 px-3 text-[16px] font-mono text-slate-700 ${errors.code ? 'border-red-400' : 'border-slate-300'} ${isEdit ? 'bg-slate-100 text-slate-500' : 'bg-white'}`}
              value={form.code}
              onChange={(e) => updateField('code', e.target.value)}
              placeholder="XXX-NEW-STD"
            />
            {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code}</p>}
            {!isEdit && <p className="mt-1 text-xs text-slate-400">Auto-generated from category-product-attribute</p>}
          </div>

          {/* Location & Sub-location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Location</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.location}
                onChange={(e) => {
                  updateField('location', e.target.value)
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
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.sub_location}
                onChange={(e) => updateField('sub_location', e.target.value)}
              >
                {getSubLocationOptions(form.location).map((sub) => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category & Product */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Category</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.category}
                onChange={(e) => updateField('category', e.target.value)}
              >
                {categories.length > 0 ? (
                  categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))
                ) : (
                  <option disabled>Loading categories...</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Product</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.product}
                onChange={(e) => updateField('product', e.target.value)}
                placeholder="e.g. Fuji, Royal Gala"
              />
            </div>
          </div>

          {/* Attribute */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Attribute</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.attribute}
                onChange={(e) => updateField('attribute', e.target.value)}
                placeholder="e.g. Medium, Large, 12kg"
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Origin</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
                value={form.origin}
                onChange={(e) => updateField('origin', e.target.value)}
                placeholder="e.g. Australia, Vietnam"
              />
            </div>
          </div>

          {/* Inner pack */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Inner Quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                className={`mt-1 w-full rounded-lg border ${errors.inner_quantity ? 'border-red-400' : 'border-slate-300'} min-h-11 px-3 text-[16px]`}
                value={form.inner_quantity ?? ''}
                onChange={(e) => updateField('inner_quantity', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="e.g. 8"
              />
              {errors.inner_quantity && <p className="mt-1 text-xs text-red-500">{errors.inner_quantity}</p>}
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Inner Unit</label>
              <select
                className={`mt-1 w-full rounded-lg border ${errors.inner_unit ? 'border-red-400' : 'border-slate-300'} min-h-11 px-3 text-[16px]`}
                value={form.inner_unit}
                onChange={(e) => updateField('inner_unit', e.target.value)}
              >
                {catalogInnerUnitOptions.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
              {errors.inner_unit && <p className="mt-1 text-xs text-red-500">{errors.inner_unit}</p>}
            </div>
          </div>

          {/* Selling price */}
          <div>
            <p className="block text-[14px] font-medium text-ink">Selling price</p>
            <div className="mt-1">
              <SellPriceEditor
                name={form.official_name || 'item'}
                value={{ price: form.price ?? null, unit: form.price_unit ?? 'ea', deals: form.price_deals ?? [] }}
                onChange={(next) => setForm((prev) => ({ ...prev, price: next.price, price_unit: next.unit, price_deals: next.deals }))}
              />
            </div>
            {errors.price ? <p className="mt-1 text-xs text-red-500">{errors.price}</p> : <p className="mt-1 text-xs text-slate-400">Sold by Each, KG, ... with an optional combo such as 2 for $9. Stock In starts from this price.</p>}
          </div>

          {/* Official Name & Stocklist Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink">Official Name *</label>
              <input
                className={`mt-1 w-full rounded-lg border ${errors.official_name ? 'border-red-400' : 'border-slate-300'} min-h-11 px-3 text-[16px]`}
                value={form.official_name}
                onChange={(e) => updateField('official_name', e.target.value)}
                placeholder="e.g. Fuji Small"
              />
              {errors.official_name && <p className="mt-1 text-xs text-red-500">{errors.official_name}</p>}
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink">Name on Stocklist *</label>
              <input
                className={`mt-1 w-full rounded-lg border ${errors.stocklist_name ? 'border-red-400' : 'border-slate-300'} min-h-11 px-3 text-[16px]`}
                value={form.stocklist_name}
                onChange={(e) => updateField('stocklist_name', e.target.value)}
                placeholder="e.g. Fuji Med (12kg)"
              />
              {errors.stocklist_name && <p className="mt-1 text-xs text-red-500">{errors.stocklist_name}</p>}
            </div>
          </div>

          {/* Navigation Guide */}
          <div>
            <label className="block text-[14px] font-medium text-ink">Navigation Guide</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 min-h-11 px-3 text-[16px]"
              value={form.navigation_guide}
              onChange={(e) => updateField('navigation_guide', e.target.value)}
              placeholder="e.g. Apples section - Left - Printed"
            />
          </div>

          {/* Row Position */}
          <div>
            <label className="block text-[14px] font-medium text-ink">Row Position</label>
            <div className="mt-1 flex gap-3">
              {catalogRowPositionOptions.map((pos) => (
                <label key={pos} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="row_position"
                    value={pos}
                    checked={form.row_position === pos}
                    onChange={() => updateField('row_position', pos)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="text-sm capitalize text-slate-600">{pos}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-[14px] font-medium text-ink">Visibility</label>
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_visible !== false}
                onChange={(e) => updateField('is_visible', e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Visible in stock paper
            </label>
          </div>
        </div>

    </Sheet>
  )
}

export function CatalogManagementView({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showQuickPrices, setShowQuickPrices] = useState(false)
  const [visibilitySavingByCode, setVisibilitySavingByCode] = useState<Record<string, boolean>>({})
  const [deleteConfirmCode, setDeleteConfirmCode] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    setIsLoading(true)
    setApiError(null)
    try {
      const res = await fetch('/api/catalog')
      const data = await res.json()
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to load catalog'))
      }

      if (typeof data?.warning === 'string' && data.warning.trim().length > 0) {
        setApiStatus(data.warning)
      }

      const catalog = Array.isArray(data.catalog)
        ? data.catalog.map((entry: any) => ({
            ...emptyItem(),
            ...entry,
            code: String(entry?.code ?? ''),
            location: entry?.location ?? 'Inside Coolroom',
            sub_location: entry?.sub_location ?? catalogSubLocationInsideOptions[0],
            category: entry?.category ?? 'Apples',
            product: entry?.product ?? '',
            attribute: entry?.attribute ?? '',
            origin: entry?.origin ?? '',
            inner_quantity: entry?.inner_quantity == null ? null : Number(entry.inner_quantity),
            inner_unit: entry?.inner_unit ?? 'box',
            price: entry?.price == null ? null : Number(entry.price),
            price_unit: normalizeSellPrice({ unit: entry?.price_unit }).unit,
            price_deals: normalizeSellPrice({ deals: entry?.price_deals }).deals,
            official_name: entry?.official_name ?? '',
            stocklist_name: entry?.stocklist_name ?? '',
            navigation_guide: entry?.navigation_guide ?? '',
            row_position: entry?.row_position ?? 'single',
            is_visible: entry?.is_visible ?? true,
          }))
        : []

      setItems(catalog)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to load catalog')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true)
    try {
      const res = await fetch('/api/categories')
      if (!res.ok) throw new Error('Failed to fetch categories')
      const data = await res.json()
      const uniqueCategories: string[] = Array.from(new Set<string>(
        (Array.isArray(data.categories) ? data.categories : [])
          .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      )).sort((a, b) => a.localeCompare(b))
      setCategories(uniqueCategories)
    } catch (err) {
      console.error('Failed to load categories:', err)
      setCategories([])
    } finally {
      setCategoriesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase()

    return items.filter((item) => {
      const matchesSearch =
        term === '' ||
        item.code.toLowerCase().includes(term) ||
        item.official_name.toLowerCase().includes(term) ||
        item.stocklist_name.toLowerCase().includes(term) ||
        item.product.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term) ||
        item.origin.toLowerCase().includes(term) ||
        item.inner_unit.toLowerCase().includes(term)

      const matchesLocation = locationFilter === 'all' || item.location === locationFilter

      return matchesSearch && matchesLocation
    })
  }, [items, locationFilter, searchTerm])

  const handleSaveItem = async (item: CatalogItem) => {
    setIsSaving(true)
    setApiError(null)
    setApiStatus(null)
    try {
      const res = await fetch('/api/catalog/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(getApiErrorMessage(data, 'Failed to save item'))
      }
      setApiStatus(editingItem ? `Item "${item.code}" updated successfully.` : `Item "${item.code}" added successfully.`)
      setIsModalOpen(false)
      setEditingItem(null)
      await loadCatalog()
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to save item')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteItem = async (code: string) => {
    setApiError(null)
    setApiStatus(null)
    try {
      const res = await fetch(`/api/catalog/item?code=${encodeURIComponent(code)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(getApiErrorMessage(data, 'Failed to delete item'))
      }
      setApiStatus(`Item "${code}" deleted successfully.`)
      setDeleteConfirmCode(null)
      await loadCatalog()
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to delete item')
    }
  }

  const handleVisibilityToggle = async (item: CatalogItem, nextVisible: boolean) => {
    setApiError(null)
    setApiStatus(null)

    // Optimistic update: reflect checkbox change immediately without reloading full catalog.
    setItems((prev) => prev.map((entry) => (
      entry.code === item.code ? { ...entry, is_visible: nextVisible } : entry
    )))
    setVisibilitySavingByCode((prev) => ({ ...prev, [item.code]: true }))

    try {
      const res = await fetch('/api/catalog/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, is_visible: nextVisible }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(getApiErrorMessage(data, 'Failed to update visibility'))
      }

      setApiStatus(`Visibility for "${item.code}" updated.`)
    } catch (err) {
      // Rollback optimistic state when persistence fails.
      setItems((prev) => prev.map((entry) => (
        entry.code === item.code ? { ...entry, is_visible: item.is_visible } : entry
      )))
      setApiError(err instanceof Error ? err.message : 'Failed to update visibility')
    } finally {
      setVisibilitySavingByCode((prev) => ({ ...prev, [item.code]: false }))
    }
  }

  const openEdit = (item: CatalogItem) => {
    setEditingItem(item)
    setDeleteConfirmCode(null)
    setIsModalOpen(true)
  }

  const openAdd = () => {
    setEditingItem(null)
    setDeleteConfirmCode(null)
    setIsModalOpen(true)
  }

  const content = (
    <div className={embedded ? 'space-y-4' : 'mx-auto w-full max-w-7xl space-y-4'}>
      {showQuickPrices ? (
        <>
          <Button variant="secondary" onClick={() => setShowQuickPrices(false)}>← Back to catalog</Button>
          <QuickPriceEntry
            items={items}
            onPricesSaved={(changes) => setItems((current) => current.map((item) => {
              const change = changes.find((entry) => entry.code === item.code)
              return change ? { ...item, price: change.price, price_unit: change.price_unit, price_deals: change.price_deals } : item
            }))}
          />
        </>
      ) : (<>
        <section className="space-y-4">
          <ScreenHeader
            title="Catalog"
            subtitle={`${filteredItems.length} of ${items.length} items${locationFilter === 'all' ? '' : ` · ${locationFilter}`}`}
            actions={
              <>
                <IconButton label="Refresh" onClick={() => void loadCatalog()} disabled={isLoading} className="border border-line bg-surface">
                  <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                </IconButton>
                <Button variant="secondary" onClick={() => setShowQuickPrices(true)}>
                  Quick prices
                </Button>
                <Button icon={<Plus className="h-5 w-5" aria-hidden="true" />} onClick={openAdd}>
                  Add item
                </Button>
              </>
            }
          />

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, code or category"
                aria-label="Search catalog"
                className={`${fieldClass} pl-10`}
              />
            </div>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              aria-label="Location"
              className={`${inputClass} w-full sm:w-auto`}
            >
              <option value="all">All locations</option>
              {catalogLocationOptions.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-3">
            {apiError && (
              <StatusBanner
                tone="error"
                title="Something went wrong with the catalog"
                message={apiError}
              />
            )}
            {apiStatus && (
              <StatusBanner
                tone="success"
                title="Catalog updated"
                message={apiStatus}
              />
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
            <p className="font-medium text-slate-700">Catalog items</p>
            <span>
              Showing {filteredItems.length} of {items.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Official Name</th>
                  <th className="px-4 py-3 font-semibold">Stocklist Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Origin</th>
                  <th className="px-4 py-3 font-semibold">Inner Pack</th>
                  <th className="px-4 py-3 text-right font-semibold">Price</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Row</th>
                  <th className="px-4 py-3 font-semibold">Visibility</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                      <RefreshCw className="mx-auto h-5 w-5 animate-spin" />
                      <p className="mt-2 text-xs">Loading catalog...</p>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                      {searchTerm || locationFilter !== 'all'
                        ? 'No items match your filters.'
                        : 'No catalog items yet. Click "Add Item" to get started.'}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.code} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-700">{item.code}</td>
                      <td className="px-4 py-3 text-slate-700">{item.official_name}</td>
                      <td className="px-4 py-3 text-slate-600">{item.stocklist_name}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{item.origin || '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.inner_quantity == null ? '-' : `${item.inner_quantity} ${item.inner_unit}`}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-xs text-slate-700">
                        {(() => {
                          const sell = normalizeSellPrice({ price: item.price, unit: item.price_unit, deals: item.price_deals })
                          const main = formatMainPrice(sell)
                          const deals = formatDeals(sell)
                          return main || deals ? <>{main}{deals ? <span className="block text-slate-500">{deals}</span> : null}</> : <span className="text-slate-400">-</span>
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.location} / {item.sub_location}
                      </td>
                      <td className="px-4 py-3 text-xs capitalize text-slate-500">{item.row_position}</td>
                      <td className="px-4 py-3">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={item.is_visible !== false}
                            disabled={!!visibilitySavingByCode[item.code]}
                            onChange={(event) => void handleVisibilityToggle(item, event.target.checked)}
                            className="h-4 w-4 accent-brand-600 disabled:cursor-not-allowed"
                          />
                          <span className={item.is_visible === false ? 'text-slate-500' : 'text-success'}>
                            {item.is_visible === false ? 'Hidden' : 'Visible'}
                          </span>
                        </label>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="rounded p-1.5 text-slate-400 hover:bg-forest-50 hover:text-forest-800"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {deleteConfirmCode === item.code ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDeleteItem(item.code)}
                                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteConfirmCode(null)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmCode(item.code)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!isLoading && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>Showing {filteredItems.length} of {items.length} items</span>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="text-brand-600 hover:text-brand-700"
                >
                  Clear search
                </button>
              )}
            </div>
          )}
        </section>
      </>)}
    </div>
  )

  return (
    <>
      {embedded ? content : <main className="min-h-screen px-3 py-3 md:px-8 md:py-7">{content}</main>}
      <ItemModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingItem(null)
        }}
        onSave={handleSaveItem}
        item={editingItem}
        isEdit={!!editingItem}
        isSaving={isSaving}
        categories={categories}
      />
    </>
  )
}

export default function CatalogManagePage() {
  return <CatalogManagementView />
}
