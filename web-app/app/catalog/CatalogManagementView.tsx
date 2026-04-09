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

import {
  catalogCategoryOptions,
  catalogItemSchema,
  catalogLocationOptions,
  catalogRowPositionOptions,
  catalogSubLocationInsideOptions,
  catalogSubLocationOutsideOptions,
  type CatalogItem,
} from '../../lib/stock-schema'

function getApiErrorMessage(payload: any, fallback: string) {
  const details = typeof payload?.details === 'string'
    ? payload.details
    : payload?.details
      ? JSON.stringify(payload.details)
      : ''

  const hint = typeof payload?.hint === 'string' ? payload.hint : ''
  const warning = typeof payload?.warning === 'string' ? payload.warning : ''
  const base = typeof payload?.error === 'string' ? payload.error : fallback

  return [base, details, hint, warning].filter((part) => part && part.trim().length > 0).join(' | ')
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

const emptyItem = (): CatalogItem => ({
  code: '',
  location: 'Inside Coolroom',
  sub_location: catalogSubLocationInsideOptions[0],
  category: catalogCategoryOptions[0],
  product: '',
  attribute: '',
  official_name: '',
  stocklist_name: '',
  navigation_guide: '',
  row_position: 'single',
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
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : 'border-red-200 bg-red-50 text-red-900'

  return (
    <div className={`rounded-2xl border px-4 py-4 shadow-sm ${classes}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isSuccess ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {isSuccess ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isSuccess ? 'text-emerald-700' : 'text-red-700'}`}>
            {isSuccess ? 'Saved' : 'Action failed'}
          </p>
          <h3 className="mt-1 text-base font-semibold">{title}</h3>
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
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (item: CatalogItem) => void
  item: CatalogItem | null
  isEdit: boolean
  isSaving: boolean
}) {
  const [form, setForm] = useState<CatalogItem>(emptyItem())
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen) {
      setForm(item ?? emptyItem())
      setErrors({})
    }
  }, [isOpen, item])

  if (!isOpen) return null

  const updateField = (field: keyof CatalogItem, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }

      if (field === 'location') {
        next.sub_location = getSubLocationOptions(value)[0]
      }

      if (['category', 'product', 'attribute'].includes(field) && !isEdit) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card-surface w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {isEdit ? 'Edit Item' : 'Add New Item'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-4">
          {/* Item Code (auto-generated) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500">Item Code</label>
            <input
              readOnly={isEdit}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono text-slate-700 ${errors.code ? 'border-red-400' : 'border-slate-300'} ${isEdit ? 'bg-slate-100 text-slate-500' : 'bg-white'}`}
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
              <label className="block text-xs font-semibold text-slate-500">Location</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
              <label className="block text-xs font-semibold text-slate-500">Sub-location</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
              <label className="block text-xs font-semibold text-slate-500">Category</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.category}
                onChange={(e) => updateField('category', e.target.value)}
              >
                {catalogCategoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500">Product</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.product}
                onChange={(e) => updateField('product', e.target.value)}
                placeholder="e.g. Fuji, Royal Gala"
              />
            </div>
          </div>

          {/* Attribute */}
          <div>
            <label className="block text-xs font-semibold text-slate-500">Attribute</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.attribute}
              onChange={(e) => updateField('attribute', e.target.value)}
              placeholder="e.g. Medium, Large, 12kg"
            />
          </div>

          {/* Official Name & Stocklist Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500">Official Name *</label>
              <input
                className={`mt-1 w-full rounded-lg border ${errors.official_name ? 'border-red-400' : 'border-slate-300'} px-3 py-2 text-sm`}
                value={form.official_name}
                onChange={(e) => updateField('official_name', e.target.value)}
                placeholder="e.g. Fuji Small"
              />
              {errors.official_name && <p className="mt-1 text-xs text-red-500">{errors.official_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500">Name on Stocklist *</label>
              <input
                className={`mt-1 w-full rounded-lg border ${errors.stocklist_name ? 'border-red-400' : 'border-slate-300'} px-3 py-2 text-sm`}
                value={form.stocklist_name}
                onChange={(e) => updateField('stocklist_name', e.target.value)}
                placeholder="e.g. Fuji Med (12kg)"
              />
              {errors.stocklist_name && <p className="mt-1 text-xs text-red-500">{errors.stocklist_name}</p>}
            </div>
          </div>

          {/* Navigation Guide */}
          <div>
            <label className="block text-xs font-semibold text-slate-500">Navigation Guide</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.navigation_guide}
              onChange={(e) => updateField('navigation_guide', e.target.value)}
              placeholder="e.g. Apples section - Left - Printed"
            />
          </div>

          {/* Row Position */}
          <div>
            <label className="block text-xs font-semibold text-slate-500">Row Position</label>
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
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Save className="mr-2 inline h-4 w-4" />
            {isSaving ? 'Saving...' : isEdit ? 'Update Item' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CatalogManagementView({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)
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
            category: entry?.category ?? catalogCategoryOptions[0],
            product: entry?.product ?? '',
            attribute: entry?.attribute ?? '',
            official_name: entry?.official_name ?? '',
            stocklist_name: entry?.stocklist_name ?? '',
            navigation_guide: entry?.navigation_guide ?? '',
            row_position: entry?.row_position ?? 'single',
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

  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase()

    return items.filter((item) => {
      const matchesSearch =
        term === '' ||
        item.code.toLowerCase().includes(term) ||
        item.official_name.toLowerCase().includes(term) ||
        item.stocklist_name.toLowerCase().includes(term) ||
        item.product.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term)

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
        <section className="card-surface rounded-2xl px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Catalog</p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">Catalog management</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Add, edit, or delete catalog items using the same visual language as the rest of the app.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs sm:text-sm">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2 text-slate-500">
                  <Database className="h-4 w-4" />
                  <span className="font-semibold uppercase tracking-wide">Total</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-slate-900">{items.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2 text-slate-500">
                  <Search className="h-4 w-4" />
                  <span className="font-semibold uppercase tracking-wide">Shown</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-slate-900">{filteredItems.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2 text-slate-500">
                  <RefreshCw className="h-4 w-4" />
                  <span className="font-semibold uppercase tracking-wide">Scope</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {locationFilter === 'all' ? 'All locations' : locationFilter}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by code, official name, stocklist name, product, or category..."
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-brand-500"
              />
            </div>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-500"
            >
              <option value="all">All Locations</option>
              {catalogLocationOptions.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
            <div className="flex gap-2 lg:ml-auto">
              <button
                onClick={() => void loadCatalog()}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                disabled={isLoading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={openAdd}
                className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {apiError && (
              <StatusBanner
                tone="error"
                title="Catalog action failed"
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

        <section className="card-surface overflow-hidden rounded-2xl">
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
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Row</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      <RefreshCw className="mx-auto h-5 w-5 animate-spin" />
                      <p className="mt-2 text-xs">Loading catalog...</p>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
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
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.location} / {item.sub_location}
                      </td>
                      <td className="px-4 py-3 text-xs capitalize text-slate-500">{item.row_position}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
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
      />
    </>
  )
}

export default function CatalogManagePage() {
  return <CatalogManagementView />
}
