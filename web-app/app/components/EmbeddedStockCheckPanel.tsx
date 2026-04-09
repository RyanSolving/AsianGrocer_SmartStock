'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileImage, FileText, Loader2, Plus, Save, X } from 'lucide-react'
import { toPng } from 'html-to-image'
import {
  catalogCategoryOptions,
  catalogLocationOptions,
  catalogRowPositionOptions,
  catalogSubLocationInsideOptions,
  catalogSubLocationOutsideOptions,
} from '../../lib/stock-schema'

type CatalogItem = {
  id?: number
  code: string
  location: string
  sub_location: string
  category: string
  product: string
  attribute: string
  official_name: string
  stocklist_name: string
  navigation_guide: string
  row_position?: 'left' | 'right' | 'single'
}

type StockCheckRow = {
  id: string
  code: string | null
  location: string
  sub_location: string
  category: string
  product: string
  attribute: string
  official_name: string
  stocklist_name: string
  navigation_guide: string
  row_position: 'left' | 'right' | 'single'
  quantity: number | null
  red_marked: boolean
  notes: string
  source: 'catalog' | 'unknown'
}

type IndexedRow = {
  row: StockCheckRow
  index: number
}

type RowColumns = {
  left: IndexedRow[]
  right: IndexedRow[]
  single: IndexedRow[]
}

type UnknownCreateForm = {
  unknownId: string
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
}

function formatSheetDate(value: string) {
  const parts = value.split('-')
  if (parts.length !== 3) return value
  const [y, m, d] = parts
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][
    Number(m) - 1
  ]
  return `${d} ${month ?? m} ${y.slice(-2)}`
}

function splitRows(items: IndexedRow[]): RowColumns {
  return {
    left: items.filter((x) => x.row.row_position === 'left'),
    right: items.filter((x) => x.row.row_position === 'right'),
    single: items.filter((x) => x.row.row_position === 'single'),
  }
}

function normalizeSubLocation(value: string) {
  if (value.toLowerCase() === 'all year') return 'All Year'
  return value
}

function generateItemCode(category: string, product: string, attribute: string) {
  const cat3 = (category || 'OTH').toUpperCase().slice(0, 3)
  const prod3 = (product || 'NEW').toUpperCase().slice(0, 3)
  const attr3 = attribute ? attribute.toUpperCase().slice(0, 3) : 'STD'
  return `${cat3}-${prod3}-${attr3}`
}

function getSubLocationOptions(location: 'Inside Coolroom' | 'Outside Coolroom') {
  return location === 'Outside Coolroom'
    ? [...catalogSubLocationOutsideOptions]
    : [...catalogSubLocationInsideOptions]
}

function bySection(rows: IndexedRow[], location: string, subLocation: string) {
  return rows.filter(
    (x) =>
      x.row.location === location
      && normalizeSubLocation(x.row.sub_location) === normalizeSubLocation(subLocation)
  )
}

function makeCatalogRow(item: CatalogItem): StockCheckRow {
  return {
    id: `catalog-${item.code}`,
    code: item.code,
    location: item.location,
    sub_location: item.sub_location,
    category: item.category,
    product: item.product,
    attribute: item.attribute,
    official_name: item.official_name,
    stocklist_name: item.stocklist_name,
    navigation_guide: item.navigation_guide,
    row_position: item.row_position ?? 'single',
    quantity: null,
    red_marked: false,
    notes: '',
    source: 'catalog',
  }
}

function isKnownRow(row: StockCheckRow) {
  return row.source === 'catalog' && Boolean(row.code)
}

export function EmbeddedStockCheckPanel({
  catalogItems,
}: {
  catalogItems: CatalogItem[] | null
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const stockPaperRef = useRef<HTMLDivElement | null>(null)
  const [rows, setRows] = useState<StockCheckRow[]>([])
  const [stockDate, setStockDate] = useState(today)
  const [isValidated, setIsValidated] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [showCreateUnknownModal, setShowCreateUnknownModal] = useState(false)
  const [createForms, setCreateForms] = useState<UnknownCreateForm[]>([])
  const [isCreatingUnknownItems, setIsCreatingUnknownItems] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!catalogItems || catalogItems.length === 0) return

    setRows((prev) => {
      if (prev.length > 0) return prev
      return catalogItems.map(makeCatalogRow)
    })
  }, [catalogItems])

  const suggestions = useMemo(() => {
    if (!newItemName.trim() || !catalogItems) return []
    const q = newItemName.toLowerCase()
    return catalogItems
      .filter((item) => {
        return (
          item.official_name.toLowerCase().includes(q)
          || item.stocklist_name.toLowerCase().includes(q)
          || item.product.toLowerCase().includes(q)
        )
      })
      .slice(0, 6)
  }, [newItemName, catalogItems])

  const indexedRows = useMemo(() => rows.map((row, index) => ({ row, index })), [rows])

  const paperSections = useMemo(() => {
    const apples = bySection(indexedRows, 'Inside Coolroom', 'Apples')
    const citrus = bySection(indexedRows, 'Inside Coolroom', 'Citrus')
    const asian = bySection(indexedRows, 'Inside Coolroom', 'Asian')

    const melon = bySection(indexedRows, 'Inside Coolroom', 'Melon')
    const allYear = bySection(indexedRows, 'Inside Coolroom', 'All Year')
    const seasonal = bySection(indexedRows, 'Inside Coolroom', 'Seasonal')
    const stonefruit = bySection(indexedRows, 'Inside Coolroom', 'Stonefruit')

    const outsideRows = indexedRows.filter((x) => x.row.location === 'Outside Coolroom')
    const unknownRows = indexedRows.filter((x) => x.row.source === 'unknown')

    return {
      leftColumn: [
        { title: 'APPLES', rows: splitRows(apples) },
        { title: 'CITRUS', rows: splitRows(citrus) },
        { title: 'ASIAN', rows: splitRows(asian) },
      ],
      rightColumn: [
        { title: 'MELON', rows: splitRows(melon) },
        { title: 'ALL YEAR', rows: splitRows(allYear) },
        { title: 'SEASONAL', rows: splitRows(seasonal) },
        { title: 'STONEFRUIT', rows: splitRows(stonefruit) },
      ],
      outsideRows: splitRows(outsideRows),
      unknownRows: splitRows(unknownRows),
    }
  }, [indexedRows])

  function updateRow(index: number, patch: Partial<StockCheckRow>) {
    setRows((prev) => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...patch }
      return copy
    })
  }

  function setQuantity(index: number, value: string) {
    const next = value.trim().length === 0 ? null : Number(value)
    updateRow(index, { quantity: Number.isNaN(next) ? null : next })
  }

  function toggleRed(index: number) {
    updateRow(index, { red_marked: !rows[index].red_marked })
  }

  function addKnownFromSuggestion(item: CatalogItem) {
    setRows((prev) => {
      const exists = prev.some((x) => x.code === item.code)
      if (exists) return prev
      return [...prev, makeCatalogRow(item)]
    })
    setNewItemName('')
    setStatus(`Added ${item.official_name} from catalog.`)
    setError(null)
  }

  function addUnknownItem() {
    const trimmed = newItemName.trim()
    if (!trimmed) return

    setRows((prev) => [
      ...prev,
      {
        id: `unknown-${Date.now()}-${trimmed}`,
        code: null,
        location: 'Unknown',
        sub_location: 'Unknown',
        category: 'Unknown',
        product: trimmed,
        attribute: '',
        official_name: trimmed,
        stocklist_name: trimmed,
        navigation_guide: '',
        row_position: 'single',
        quantity: null,
        red_marked: false,
        notes: 'New item (not in catalog)',
        source: 'unknown',
      },
    ])
    setNewItemName('')
    setStatus(`Added new item: ${trimmed}`)
    setError(null)
  }

  function openCreateUnknownModal() {
    const unknownRows = rows.filter((x) => x.source === 'unknown')
    if (unknownRows.length === 0) {
      setStatus('No unknown items to create.')
      return
    }

    const forms: UnknownCreateForm[] = unknownRows.map((x) => ({
      unknownId: x.id,
      code: generateItemCode('Other', x.product, x.attribute),
      location: 'Inside Coolroom',
      sub_location: catalogSubLocationInsideOptions[0],
      category: 'Other',
      product: x.product,
      attribute: x.attribute,
      official_name: x.official_name,
      stocklist_name: x.stocklist_name || x.official_name,
      navigation_guide: '',
      row_position: 'single',
    }))

    setCreateForms(forms)
    setShowCreateUnknownModal(true)
  }

  function updateCreateForm(unknownId: string, patch: Partial<UnknownCreateForm>) {
    setCreateForms((prev) => prev.map((form) => {
      if (form.unknownId !== unknownId) return form

      const next = { ...form, ...patch }

      if (patch.location) {
        const options = getSubLocationOptions(patch.location)
        next.sub_location = options[0]
      }

      if (patch.category !== undefined || patch.product !== undefined || patch.attribute !== undefined) {
        next.code = generateItemCode(next.category, next.product, next.attribute)
      }

      return next
    }))
  }

  async function createUnknownItemsInCatalog() {
    if (createForms.length === 0) return

    setIsCreatingUnknownItems(true)
    setError(null)
    setStatus(null)

    try {
      for (const form of createForms) {
        const response = await fetch('/api/catalog/item', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: form.code,
            location: form.location,
            sub_location: form.sub_location,
            category: form.category,
            product: form.product,
            attribute: form.attribute,
            official_name: form.official_name,
            stocklist_name: form.stocklist_name,
            navigation_guide: form.navigation_guide,
            row_position: form.row_position,
          }),
        })

        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload?.error ?? `Failed to create ${form.official_name}`)
        }
      }

      const formsById = new Map(createForms.map((x) => [x.unknownId, x]))
      setRows((prev) => {
        return prev.map((row) => {
          if (row.source !== 'unknown') return row

          const form = formsById.get(row.id)
          if (!form) return row

          return {
            ...row,
            source: 'catalog',
            id: `catalog-${form.code}`,
            code: form.code,
            location: form.location,
            sub_location: form.sub_location,
            category: form.category,
            product: form.product,
            attribute: form.attribute,
            official_name: form.official_name,
            stocklist_name: form.stocklist_name,
            navigation_guide: form.navigation_guide,
            row_position: form.row_position,
            notes: '',
          }
        })
      })

      setShowCreateUnknownModal(false)
      setCreateForms([])
      setStatus('Unknown items were created in catalog and converted to regular stock rows.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create unknown items.')
    } finally {
      setIsCreatingUnknownItems(false)
    }
  }

  function buildPayload(exportFormat?: 'csv' | 'pdf' | 'image') {
    const known = rows.filter((x) => isKnownRow(x))
    const unknown = rows.filter((x) => x.source === 'unknown')

    return {
      date: stockDate,
      items: known.map((x) => ({
        code: x.code as string,
        product: x.product,
        category: x.category,
        location: x.location,
        sub_location: x.sub_location,
        official_name: x.official_name,
        stocklist_name: x.stocklist_name,
        quantity: x.quantity,
        red_marked: x.red_marked,
        notes: x.notes,
      })),
      unknown_items: unknown.map((x) => ({
        user_input: x.official_name,
        quantity: x.quantity,
        red_marked: x.red_marked,
        notes: x.notes,
      })),
      validated: isValidated,
      export_format: exportFormat,
    }
  }

  async function exportCsv() {
    setIsExporting(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch('/api/stock-check/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('csv')),
      })

      if (!response.ok) {
        const payload = await response.json()
        throw new Error(payload?.error ?? 'CSV export failed.')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `stock-check-${stockDate}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      setStatus('CSV exported.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function exportPdf() {
    setIsExporting(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch('/api/stock-check/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('pdf')),
      })

      if (!response.ok) {
        const payload = await response.json()
        throw new Error(payload?.error ?? 'PDF export failed.')
      }

      const html = await response.text()
      const popup = window.open('', '_blank')
      if (!popup) {
        throw new Error('Popup blocked. Allow popups to print.')
      }

      popup.document.write(html)
      popup.document.close()
      popup.focus()
      popup.print()

      setStatus('Print dialog opened for PDF export.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function exportPhoto() {
    if (!stockPaperRef.current) {
      setError('Stocklist area is not ready for photo export.')
      return
    }

    setIsExporting(true)
    setStatus(null)
    setError(null)

    try {
      const dataUrl = await toPng(stockPaperRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#fefefe',
      })

      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `stocklist-${stockDate}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()

      setStatus('Stocklist photo exported as PNG.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function saveToDb() {
    setIsSaving(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch('/api/stock-check/save-to-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Load to DB failed.')
      }

      setStatus(`Saved to DB (UID: ${payload?.uid_stock_check ?? '-'})`)

      if (rows.some((x) => x.source === 'unknown')) {
        openCreateUnknownModal()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load to DB failed.')
    } finally {
      setIsSaving(false)
    }
  }

  function renderLabelCell(item: IndexedRow | undefined, className: string) {
    if (!item) return null

    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Toggle reorder mark"
          onClick={() => toggleRed(item.index)}
          className={`h-3.5 w-3.5 shrink-0 rounded-full border ${item.row.red_marked ? 'border-red-600 bg-red-600' : 'border-slate-400 bg-transparent'}`}
          title="Click to mark as selling fast"
        />
        <input
          className={`${className} ${item.row.red_marked ? 'text-red-600 font-semibold' : ''}`}
          value={item.row.official_name}
          onChange={(event) => updateRow(item.index, { official_name: event.target.value })}
        />
      </div>
    )
  }

  if (!catalogItems || catalogItems.length === 0) {
    return (
      <section className="card-surface rounded-2xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Stock Check</h1>
        <p className="mt-2 text-sm text-slate-600">Catalog is empty. Upload or manage catalog first, then return to stock check.</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="card-surface rounded-2xl p-6 md:p-8">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Stock Check</h1>
          <p className="mt-1 text-sm text-slate-600">Paper layout with fixed catalog rows, inline quantity checks, and red reorder markers.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="relative">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stock Date</label>
            <input
              type="date"
              value={stockDate}
              onChange={(event) => setStockDate(event.target.value || today)}
              className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
            />

            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Add Item</label>
            <input
              type="text"
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              placeholder="Type to match catalog or add as new"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
            />

            {newItemName.trim().length > 0 && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                {suggestions.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => addKnownFromSuggestion(item)}
                    className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 last:border-b-0"
                  >
                    {item.official_name} ({item.code})
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={addUnknownItem}
            disabled={newItemName.trim().length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add As New
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsValidated(true)
              setStatus('Validated by staff. Export and Load to DB are enabled.')
              setError(null)
            }}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          >
            {isValidated ? 'Validated' : 'Validate'}
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={!isValidated || isExporting || isSaving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>

          <button
            type="button"
            onClick={exportPdf}
            disabled={!isValidated || isExporting || isSaving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileText className="h-4 w-4" />
            PDF
          </button>

          <button
            type="button"
            onClick={exportPhoto}
            disabled={isExporting || isSaving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileImage className="h-4 w-4" />
            Photo
          </button>

          <button
            type="button"
            onClick={saveToDb}
            disabled={!isValidated || isExporting || isSaving}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Load to DB
          </button>

          <button
            type="button"
            onClick={openCreateUnknownModal}
            disabled={!rows.some((x) => x.source === 'unknown') || isCreatingUnknownItems}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreatingUnknownItems ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Create Unknown Items
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {status && <p className="mt-3 text-sm text-emerald-700">{status}</p>}

        <div className="mt-5 stock-paper-wrap overflow-x-auto">
          <div ref={stockPaperRef} className="stock-paper min-w-[820px]">
            <div className="stock-date-row">
              <span>DATE:</span>
              <span className="stock-date-hand">{formatSheetDate(stockDate)}</span>
            </div>

            <div className="stock-sec-hdr">INSIDE COOLROOM</div>
            <div className="stock-inside-grid">
              <div className="stock-col stock-col-left">
                {paperSections.leftColumn.map((section) => {
                  const maxRows = Math.max(section.rows.left.length, section.rows.right.length)
                  return (
                    <div key={section.title}>
                      <div className="stock-sub-hdr">{section.title}</div>
                      <table className="stock-pt">
                        <colgroup>
                          <col style={{ width: '42%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '42%' }} />
                          <col style={{ width: '8%' }} />
                        </colgroup>
                        <tbody>
                          {Array.from({ length: maxRows }).map((_, i) => {
                            const left = section.rows.left[i]
                            const right = section.rows.right[i]
                            return (
                              <tr key={`${section.title}-pair-${i}`}>
                                <td className="stock-lbl">{renderLabelCell(left, 'stock-input')}</td>
                                <td className="stock-qty">
                                  {left ? (
                                    <input
                                      type="number"
                                      className={`stock-qty-input ${left.row.red_marked ? 'text-red-600' : ''}`}
                                      value={left.row.quantity ?? ''}
                                      onChange={(event) => setQuantity(left.index, event.target.value)}
                                    />
                                  ) : null}
                                </td>
                                <td className="stock-lbl">{renderLabelCell(right, 'stock-input')}</td>
                                <td className="stock-qty">
                                  {right ? (
                                    <input
                                      type="number"
                                      className={`stock-qty-input ${right.row.red_marked ? 'text-red-600' : ''}`}
                                      value={right.row.quantity ?? ''}
                                      onChange={(event) => setQuantity(right.index, event.target.value)}
                                    />
                                  ) : null}
                                </td>
                              </tr>
                            )
                          })}

                          {section.rows.single.map((single, i) => (
                            <tr key={`${section.title}-single-${i}`} className="stock-hw-row">
                              <td className="stock-lbl" colSpan={3}>{renderLabelCell(single, 'stock-input stock-input-hw')}</td>
                              <td className="stock-qty">
                                <input
                                  type="number"
                                  className={`stock-qty-input ${single.row.red_marked ? 'text-red-600' : ''}`}
                                  value={single.row.quantity ?? ''}
                                  onChange={(event) => setQuantity(single.index, event.target.value)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>

              <div className="stock-col">
                {paperSections.rightColumn.map((section) => {
                  const maxRows = Math.max(section.rows.left.length, section.rows.right.length)
                  return (
                    <div key={section.title}>
                      <div className="stock-sub-hdr">{section.title}</div>
                      <table className="stock-pt">
                        <colgroup>
                          <col style={{ width: '42%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '42%' }} />
                          <col style={{ width: '8%' }} />
                        </colgroup>
                        <tbody>
                          {Array.from({ length: maxRows }).map((_, i) => {
                            const left = section.rows.left[i]
                            const right = section.rows.right[i]
                            return (
                              <tr key={`${section.title}-pair-${i}`}>
                                <td className="stock-lbl">{renderLabelCell(left, 'stock-input')}</td>
                                <td className="stock-qty">
                                  {left ? (
                                    <input
                                      type="number"
                                      className={`stock-qty-input ${left.row.red_marked ? 'text-red-600' : ''}`}
                                      value={left.row.quantity ?? ''}
                                      onChange={(event) => setQuantity(left.index, event.target.value)}
                                    />
                                  ) : null}
                                </td>
                                <td className="stock-lbl">{renderLabelCell(right, 'stock-input')}</td>
                                <td className="stock-qty">
                                  {right ? (
                                    <input
                                      type="number"
                                      className={`stock-qty-input ${right.row.red_marked ? 'text-red-600' : ''}`}
                                      value={right.row.quantity ?? ''}
                                      onChange={(event) => setQuantity(right.index, event.target.value)}
                                    />
                                  ) : null}
                                </td>
                              </tr>
                            )
                          })}

                          {section.rows.single.map((single, i) => (
                            <tr key={`${section.title}-single-${i}`} className="stock-hw-row">
                              <td className="stock-lbl" colSpan={3}>{renderLabelCell(single, 'stock-input stock-input-hw')}</td>
                              <td className="stock-qty">
                                <input
                                  type="number"
                                  className={`stock-qty-input ${single.row.red_marked ? 'text-red-600' : ''}`}
                                  value={single.row.quantity ?? ''}
                                  onChange={(event) => setQuantity(single.index, event.target.value)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="stock-sec-hdr">OUTSIDE COOLROOM</div>
            <div className="stock-outside-grid">
              <div className="stock-oc-col">
                <table className="stock-pt">
                  <colgroup>
                    <col style={{ width: '84%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  <tbody>
                    {paperSections.outsideRows.left.map((item, i) => (
                      <tr key={`outside-left-${i}`}>
                        <td className="stock-lbl">{renderLabelCell(item, 'stock-input')}</td>
                        <td className="stock-qty">
                          <input
                            type="number"
                            className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
                            value={item.row.quantity ?? ''}
                            onChange={(event) => setQuantity(item.index, event.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="stock-oc-col">
                <table className="stock-pt">
                  <colgroup>
                    <col style={{ width: '84%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  <tbody>
                    {paperSections.outsideRows.right.map((item, i) => (
                      <tr key={`outside-right-${i}`}>
                        <td className="stock-lbl">{renderLabelCell(item, 'stock-input')}</td>
                        <td className="stock-qty">
                          <input
                            type="number"
                            className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
                            value={item.row.quantity ?? ''}
                            onChange={(event) => setQuantity(item.index, event.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="stock-oc-col">
                <table className="stock-pt">
                  <colgroup>
                    <col style={{ width: '84%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  <tbody>
                    {paperSections.outsideRows.single.map((item, i) => (
                      <tr key={`outside-single-${i}`}>
                        <td className="stock-lbl">{renderLabelCell(item, 'stock-input')}</td>
                        <td className="stock-qty">
                          <input
                            type="number"
                            className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
                            value={item.row.quantity ?? ''}
                            onChange={(event) => setQuantity(item.index, event.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {paperSections.unknownRows.left.length > 0 || paperSections.unknownRows.right.length > 0 || paperSections.unknownRows.single.length > 0 ? (
              <>
                <div className="stock-sec-hdr !bg-red-900 !text-white">UNCLASSIFIED / STAFF INSPECTION</div>
                <div className="stock-outside-grid">
                  <div className="stock-oc-col">
                    <table className="stock-pt">
                      <colgroup>
                        <col style={{ width: '84%' }} />
                        <col style={{ width: '16%' }} />
                      </colgroup>
                      <tbody>
                        {paperSections.unknownRows.left.map((item, i) => (
                          <tr key={`unknown-left-${i}`}>
                            <td className="stock-lbl">{renderLabelCell(item, 'stock-input')}</td>
                            <td className="stock-qty">
                              <input
                                type="number"
                                className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
                                value={item.row.quantity ?? ''}
                                onChange={(event) => setQuantity(item.index, event.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="stock-oc-col">
                    <table className="stock-pt">
                      <colgroup>
                        <col style={{ width: '84%' }} />
                        <col style={{ width: '16%' }} />
                      </colgroup>
                      <tbody>
                        {paperSections.unknownRows.right.map((item, i) => (
                          <tr key={`unknown-right-${i}`}>
                            <td className="stock-lbl">{renderLabelCell(item, 'stock-input')}</td>
                            <td className="stock-qty">
                              <input
                                type="number"
                                className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
                                value={item.row.quantity ?? ''}
                                onChange={(event) => setQuantity(item.index, event.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="stock-oc-col">
                    <table className="stock-pt">
                      <colgroup>
                        <col style={{ width: '84%' }} />
                        <col style={{ width: '16%' }} />
                      </colgroup>
                      <tbody>
                        {paperSections.unknownRows.single.map((item, i) => (
                          <tr key={`unknown-single-${i}`}>
                            <td className="stock-lbl">{renderLabelCell(item, 'stock-input')}</td>
                            <td className="stock-qty">
                              <input
                                type="number"
                                className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
                                value={item.row.quantity ?? ''}
                                onChange={(event) => setQuantity(item.index, event.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {showCreateUnknownModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Create Unknown Items In Catalog</h3>
                <p className="text-sm text-slate-600">Complete details for new items found during stock check.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateUnknownModal(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {createForms.map((form) => (
                <div key={form.unknownId} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Code</label>
                      <input
                        value={form.code}
                        onChange={(event) => updateCreateForm(form.unknownId, { code: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Location</label>
                      <select
                        value={form.location}
                        onChange={(event) => updateCreateForm(form.unknownId, { location: event.target.value as 'Inside Coolroom' | 'Outside Coolroom' })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      >
                        {catalogLocationOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Sub-location</label>
                      <select
                        value={form.sub_location}
                        onChange={(event) => updateCreateForm(form.unknownId, { sub_location: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      >
                        {getSubLocationOptions(form.location).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mb-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
                      <select
                        value={form.category}
                        onChange={(event) => updateCreateForm(form.unknownId, { category: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      >
                        {catalogCategoryOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Product</label>
                      <input
                        value={form.product}
                        onChange={(event) => updateCreateForm(form.unknownId, { product: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Attribute</label>
                      <input
                        value={form.attribute}
                        onChange={(event) => updateCreateForm(form.unknownId, { attribute: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="mb-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Official Name</label>
                      <input
                        value={form.official_name}
                        onChange={(event) => updateCreateForm(form.unknownId, { official_name: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Name On Stocklist</label>
                      <input
                        value={form.stocklist_name}
                        onChange={(event) => updateCreateForm(form.unknownId, { stocklist_name: event.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Row Position</label>
                      <select
                        value={form.row_position}
                        onChange={(event) => updateCreateForm(form.unknownId, { row_position: event.target.value as 'left' | 'right' | 'single' })}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      >
                        {catalogRowPositionOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Navigation Guide</label>
                    <input
                      value={form.navigation_guide}
                      onChange={(event) => updateCreateForm(form.unknownId, { navigation_guide: event.target.value })}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateUnknownModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createUnknownItemsInCatalog}
                disabled={isCreatingUnknownItems}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingUnknownItems ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save To Catalog
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
