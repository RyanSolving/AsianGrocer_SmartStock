'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Database,
  RefreshCw,
} from 'lucide-react'

type CatalogItem = {
  code: string
  location: string
  sub_location: string
  category: string
  product: string
  attribute: string
  official_name: string
  stocklist_name: string
  navigation_guide: string
  row_position: 'left' | 'right' | 'single'
}

const LOCATIONS = ['Inside Coolroom', 'Outside Coolroom']
const SUB_LOCATIONS_INSIDE = ['Apples', 'Citrus', 'Asian', 'Melon', 'All Year', 'Seasonal', 'Stonefruit']
const SUB_LOCATIONS_OUTSIDE = ['Outside Coolroom']
const CATEGORIES = ['Apples', 'Citrus', 'Asian', 'Melon', 'All Year', 'Seasonal', 'Stonefruit', 'Banana', 'Papaya', 'Mango', 'Watermelon', 'Pineapple', 'Tropical', 'Coconut', 'Pears', 'Grape', 'Nut', 'Berries', 'Kiwi', 'Avocado', 'Persimmon', 'Other']
const ROW_POSITIONS = ['left', 'right', 'single']

function generateItemCode(category: string, product: string, attribute: string) {
  const cat3 = (category || 'OTH').toUpperCase().slice(0, 3)
  const prod3 = (product || 'NEW').toUpperCase().slice(0, 3)
  const attr3 = attribute ? attribute.toUpperCase().slice(0, 3) : 'STD'
  return `${cat3}-${prod3}-${attr3}`
}

function getSubLocationOptions(location: string) {
  if (location === 'Outside Coolroom') return SUB_LOCATIONS_OUTSIDE
  return SUB_LOCATIONS_INSIDE
}

const emptyItem = (): CatalogItem => ({
  code: '',
  location: 'Inside Coolroom',
  sub_location: 'Apples',
  category: 'Apples',
  product: '',
  attribute: '',
  official_name: '',
  stocklist_name: '',
  navigation_guide: '',
  row_position: 'single',
})

function ItemModal({
  isOpen,
  onClose,
  onSave,
  item,
  isEdit,
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (item: CatalogItem) => void
  item: CatalogItem | null
  isEdit: boolean
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

      // Auto-update code when category, product, or attribute changes
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
    const newErrors: Record<string, string> = {}
    if (!form.code.trim()) newErrors.code = 'Item code is required'
    if (!form.official_name.trim()) newErrors.official_name = 'Official name is required'
    if (!form.stocklist_name.trim()) newErrors.stocklist_name = 'Name on stocklist is required'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
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
              className={`mt-1 w-full rounded-lg border ${errors.code ? 'border-red-400' : 'border-slate-300'} px-3 py-2 text-sm font-mono text-slate-700`}
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
                  // Reset sub_location when location changes
                  const newSubs = getSubLocationOptions(e.target.value)
                  setForm((prev) => ({ ...prev, location: e.target.value, sub_location: newSubs[0] }))
                }}
              >
                {LOCATIONS.map((loc) => (
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
                {CATEGORIES.map((cat) => (
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
              {ROW_POSITIONS.map((pos) => (
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
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Save className="mr-2 inline h-4 w-4" />
            {isEdit ? 'Update Item' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CatalogManagePage() {
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
      if (!res.ok) throw new Error('Failed to load catalog')
      const data = await res.json()
      setItems(data.catalog ?? [])
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to load catalog')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const filteredItems = items.filter((item) => {
    const term = searchTerm.toLowerCase()
    const matchesSearch =
      term === '' ||
      item.code.toLowerCase().includes(term) ||
      item.official_name.toLowerCase().includes(term) ||
      item.stocklist_name.toLowerCase().includes(term) ||
      item.product.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term)

    const matchesLocation =
      locationFilter === 'all' || item.location === locationFilter

    return matchesSearch && matchesLocation
  })

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
        throw new Error(data?.error ?? 'Failed to save item')
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
        throw new Error(data?.error ?? 'Failed to delete item')
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
    setIsModalOpen(true)
  }

  const openAdd = () => {
    setEditingItem(null)
    setIsModalOpen(true)
  }

  return (
    <main className="min-h-screen px-3 py-3 md:px-8 md:py-7">
      {/* Header */}
      <div className="mx-auto mb-4 flex w-full max-w-7xl items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <p>
          {isLoading
            ? 'Loading catalog...'
            : `${items.length} items in catalog`}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadCatalog()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Catalog Management</h1>
            <p className="text-sm text-slate-500">Add, edit, or remove catalog items directly in the database.</p>
          </div>
          <button
            onClick={openAdd}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="mr-2 inline h-4 w-4" /> Add Item
          </button>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by code, name, product, or category..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="all">All Locations</option>
            <option value="Inside Coolroom">Inside Coolroom</option>
            <option value="Outside Coolroom">Outside Coolroom</option>
          </select>
        </div>

        {/* Status Messages */}
        {apiError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {apiError}
          </div>
        )}
        {apiStatus && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {apiStatus}
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
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
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      <RefreshCw className="mx-auto h-5 w-5 animate-spin" />
                      <p className="mt-2 text-xs">Loading catalog...</p>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
                      <td className="px-4 py-3 text-xs text-slate-500">{item.location} / {item.sub_location}</td>
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
              <span>
                Showing {filteredItems.length} of {items.length} items
              </span>
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
        </div>
      </div>

      {/* Item Modal */}
      <ItemModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingItem(null)
        }}
        onSave={handleSaveItem}
        item={editingItem}
        isEdit={!!editingItem}
      />
    </main>
  )
}
