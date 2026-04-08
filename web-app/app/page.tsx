'use client'

import { useMemo, useState, useEffect } from 'react'
import {
  BarChart3,
  CheckCircle2,
  Database,
  AlertTriangle,
  FileImage,
  Loader2,
  ListChecks,
  Search,
  Upload,
  Settings,
  X,
  Plus
} from 'lucide-react'

type StockItem = {
  catalog_id: number | null
  product_raw: string
  category: string
  location: string
  sub_location: string
  product: string
  attribute: string
  official_name: string
  stocklist_name?: string
  navigation_guide?: string
  quantity_raw: string | null
  quantity: number | null
  quantity_conflict_flag: boolean
  row_position: 'left' | 'right' | 'single'
  confidence: 'high' | 'medium' | 'low'
  catalog_match_status?: 'exact' | 'fuzzy' | 'unknown'
  notes: string | null
}

type UnknownItem = {
  catalog_id: null
  product_raw: string
  category: string
  location: string
  sub_location: string
  product: string
  attribute: string
  official_name: string
  quantity_raw: string | null
  quantity: number | null
  quantity_conflict_flag: boolean
  row_position: 'left' | 'right' | 'single'
  confidence: 'high' | 'medium' | 'low'
  catalog_match_status: 'unknown'
}

type CatalogItem = {
  id: number
  code?: string
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

type CatalogVersion = {
  id: string
  version_name: string
  uploaded_at: string
  item_count: number
  is_active: boolean
}

type StockMode = 'stock-in' | 'stock-closing'

type ParsedPayload = {
  photo_id: string
  mode: StockMode
  upload_date: string
  stock_date: string
  photo_url: string | null
  total_items: number
  confidence_overall: 'high' | 'medium' | 'low'
  items: StockItem[]
}

type SessionPayload = {
  user: {
    id: string
    email: string | null
  }
  roles: string[]
}

type IndexedItem = {
  item: StockItem
  index: number
  source: 'parsed' | 'missing' | 'unknown'
}

function splitRows(items: IndexedItem[]) {
  return {
    left: items.filter((row) => row.item.row_position === 'left'),
    right: items.filter((row) => row.item.row_position === 'right'),
    single: items.filter((row) => row.item.row_position === 'single'),
  }
}

function formatSheetDate(value?: string) {
  if (!value) return '-'
  const parts = value.split('-')
  if (parts.length !== 3) return value
  const [y, m, d] = parts
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][
    Number(m) - 1
  ]
  return `${d} ${month ?? m} ${y.slice(-2)}`
}

function FeedbackBanner({
  tone,
  title,
  message,
  detail,
}: {
  tone: 'success' | 'error'
  title: string
  message: string
  detail: string
}) {
  const isSuccess = tone === 'success'
  const wrapperClass = isSuccess
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : 'border-red-200 bg-red-50 text-red-900'
  const badgeClass = isSuccess ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'

  return (
    <div className={`mt-4 rounded-2xl border px-4 py-4 shadow-sm ${wrapperClass}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${badgeClass}`}>
          {isSuccess ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isSuccess ? 'text-emerald-700' : 'text-red-700'}`}>
            {isSuccess ? 'Load successful' : 'Load error'}
          </p>
          <h3 className="mt-1 text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{message}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [stockMode, setStockMode] = useState<StockMode>('stock-in')
  const [activeCatalog, setActiveCatalog] = useState<CatalogItem[] | null>(null)
  const [catalogVersions, setCatalogVersions] = useState<CatalogVersion[]>([])
  const [selectedCatalogVersionId, setSelectedCatalogVersionId] = useState<string | null>(null)
  const [isCatalogOpen, setIsCatalogOpen] = useState(false)
  const [parsedData, setParsedData] = useState<ParsedPayload | null>(null)
  const [unknownItems, setUnknownItems] = useState<UnknownItem[]>([])
  const [missingCatalogItems, setMissingCatalogItems] = useState<CatalogItem[]>([])
  const [reviewRequiredCount, setReviewRequiredCount] = useState(0)
  const [catalogSource, setCatalogSource] = useState<'master' | 'uploaded' | 'edited' | null>(null)
  const [catalogItemCount, setCatalogItemCount] = useState<number | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCatalogUploading, setIsCatalogUploading] = useState(false)
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [latestGenerateUid, setLatestGenerateUid] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<string | null>(null)

  async function loadCatalogFromApi(versionId?: string) {
    const query = versionId ? `?version_id=${encodeURIComponent(versionId)}` : ''
    const response = await fetch(`/api/catalog${query}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.error ?? 'Failed to load catalog data.')
    }

    const catalog = Array.isArray(data?.catalog) ? data.catalog : []
    const versions = Array.isArray(data?.versions) ? data.versions : []

    setActiveCatalog(catalog)
    setCatalogVersions(versions)
    setSelectedCatalogVersionId(data?.active_version_id ?? versions[0]?.id ?? null)
    setCatalogItemCount(catalog.length)
    setCatalogSource(data?.source === 'database' ? 'uploaded' : 'master')
  }

  useEffect(() => {
    fetch('/api/auth/session')
      .then(async (res) => {
        if (!res.ok) {
          setSession(null)
          return
        }

        const data = await res.json()
        setSession(data)

        try {
          await loadCatalogFromApi()
        } catch (catalogError) {
          console.error('Failed to load catalog', catalogError)
          setApiError(catalogError instanceof Error ? catalogError.message : 'Failed to load catalog.')
        }
      })
      .catch(() => setSession(null))
      .finally(() => setIsAuthLoading(false))
  }, [])

  async function uploadCatalogToDatabase(file: File) {
    setIsCatalogUploading(true)
    setApiError(null)

    try {
      const formData = new FormData()
      formData.append('csv_file', file)
      const baseName = file.name.replace(/\.csv$/i, '')
      const versionName = `${baseName}-${new Date().toISOString().slice(0, 10)}`
      formData.append('version_name', versionName)

      const response = await fetch('/api/catalog', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to upload catalog.')
      }

      setActiveCatalog(data.catalog ?? [])
      setCatalogVersions(data.versions ?? [])
      setSelectedCatalogVersionId(data.active_version_id ?? null)
      setCatalogItemCount(Array.isArray(data.catalog) ? data.catalog.length : 0)
      setCatalogSource('uploaded')
      setIsCatalogOpen(true)
      setApiStatus('Catalog uploaded and saved to database.')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected catalog upload error.')
    } finally {
      setIsCatalogUploading(false)
    }
  }

  const indexedItems = useMemo(() => {
    if (!parsedData) return []

    // Extracted items (matched)
    const allItems = parsedData.items.map((item, index) => ({ item, index, source: 'parsed' as const }))

    // Inject Missing Catalog Items into their designated locations (amber text)
    // Use negative indices starting at -1000 to avoid collision with parsed items
    const missingItems = missingCatalogItems.map((c_item, pos) => ({
      item: {
        catalog_id: c_item.id,
        product_raw: c_item.stocklist_name || c_item.official_name,
        category: c_item.category,
        location: c_item.location as StockItem['location'],
        sub_location: c_item.sub_location,
        product: c_item.product,
        attribute: c_item.attribute,
        official_name: c_item.official_name,
        quantity_raw: null,
        quantity: null,
        quantity_conflict_flag: false,
        row_position: c_item.row_position || 'single',
        confidence: 'high' as const,
        notes: null
      },
      index: -1000 - pos,  // Unique index for each missing item
      source: 'missing' as const
    }))

    // Inject Unknown items (red text, "Unknown" location)
    // Use negative indices starting at -2000 to distinguish from missing items
    const unknownMapped = unknownItems.map((u_item, pos) => ({
      item: (u_item as unknown) as StockItem,
      index: -2000 - pos,  // Unique index for each unknown item
      source: 'unknown' as const
    }))

    return [...allItems, ...missingItems, ...unknownMapped]
  }, [parsedData, missingCatalogItems, unknownItems])

  const paperSections = useMemo(() => {
    const apples = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.item.sub_location === 'Apples')
    const citrus = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.item.sub_location === 'Citrus')
    const asian = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.item.sub_location === 'Asian')

    const melons = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.item.sub_location === 'Melon')
    const allYear = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && (row.item.sub_location === 'All year' || row.item.sub_location === 'All Year'))
    const seasonal = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.item.sub_location === 'Seasonal')
    const stonefruit = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.item.sub_location === 'Stonefruit')
    
    // Everything outside coolroom
    const outside = indexedItems.filter((row) => row.item.location === 'Outside Coolroom')
    const unknown = indexedItems.filter((row) => row.source === 'unknown')

    return {
      leftColumn: [
        { title: 'APPLES', rows: splitRows(apples) },
        { title: 'CITRUS', rows: splitRows(citrus) },
        { title: 'ASIAN', rows: splitRows(asian) },
      ],
      rightColumn: [
        { title: 'MELON', rows: splitRows(melons) },
        { title: 'ALL YEAR', rows: splitRows(allYear) },
        { title: 'SEASONAL', rows: splitRows(seasonal) },
        { title: 'STONEFRUIT', rows: splitRows(stonefruit) },
      ],
      outsideRows: splitRows(outside),
      unknownRows: splitRows(unknown),
    }
  }, [indexedItems])

  async function parsePhoto() {
    if (!photoFile) {
      setApiError('Please select a stocklist photo first.')
      return
    }

    setIsParsing(true)
    setApiError(null)
    setApiStatus(null)

    try {
      const formData = new FormData()
      formData.append('photo', photoFile)
      formData.append('mode', stockMode)
      if (activeCatalog) {
        formData.append('catalog', JSON.stringify(activeCatalog))
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 300000)

      let response: Response
      try {
        response = await fetch('/api/parse-photo', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      const json = await response.json()
      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before parsing photos.')
      }
      if (!response.ok) {
        let detailsStr = '';
        if (json?.details) {
          detailsStr = typeof json.details === 'object' ? JSON.stringify(json.details) : String(json.details);
        }
        throw new Error(detailsStr ? `${json.error} Details: ${detailsStr}` : (json?.error ?? 'Parse request failed.'))
      }

      setParsedData(json.data)
      setLatestGenerateUid(typeof json.uid_generate === 'string' ? json.uid_generate : null)
      setUnknownItems(json.unknown_items ?? [])
      setMissingCatalogItems(json.missing_catalog_items ?? [])
      setReviewRequiredCount(json.review_required_count ?? 0)
      if (selectedCatalogVersionId) {
        setCatalogSource('uploaded')
      } else {
        setCatalogSource(json.catalog_source ?? null)
      }
      setCatalogItemCount(typeof json.catalog_item_count === 'number' ? json.catalog_item_count : null)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setApiError('Parsing timed out after 5 minutes. The AI is taking longer than expected to process all items.')
      } else if (error instanceof Error && /failed to fetch|networkerror/i.test(error.message)) {
        setApiError('Could not reach the parser API. Check that the dev server is running and try a smaller image if the file is large.')
      } else {
        setApiError(error instanceof Error ? error.message : 'Unexpected parse error.')
      }
    } finally {
      setIsParsing(false)
    }
  }

  function updateItem(index: number, patch: Partial<StockItem>) {
    // Handle missing items (index: -1000, -1001, -1002, ...)
    if (index <= -1000 && index > -2000) {
      const pos = -1000 - index
      setMissingCatalogItems((current) => {
        if (pos < 0 || pos >= current.length) return current
        const next = [...current]
        const item = next[pos]
        // Update applicable fields from the patch
        if (patch.official_name !== undefined) item.official_name = patch.official_name
        if (patch.product !== undefined) item.product = patch.product
        if (patch.attribute !== undefined) item.attribute = patch.attribute
        return next
      })
      return
    }

    // Handle unknown items (index: -2000, -2001, -2002, ...)
    if (index <= -2000) {
      const pos = -2000 - index
      setUnknownItems((current) => {
        if (pos < 0 || pos >= current.length) return current
        const next = [...current]
        const item = next[pos]
        // Update applicable fields from the patch
        if (patch.official_name !== undefined) item.official_name = patch.official_name
        if (patch.product_raw !== undefined) item.product_raw = patch.product_raw
        if (patch.quantity !== undefined) item.quantity = patch.quantity
        if (patch.quantity_raw !== undefined) item.quantity_raw = patch.quantity_raw
        if (patch.quantity_conflict_flag !== undefined) item.quantity_conflict_flag = patch.quantity_conflict_flag
        return next
      })
      return
    }

    // Handle regular parsed items (index >= 0)
    setParsedData((current) => {
      if (!current) return current
      const next = [...current.items]
      next[index] = { ...next[index], ...patch }
      return {
        ...current,
        items: next,
        total_items: next.length,
      }
    })
  }

  function toQuantityPatch(val: string): Partial<StockItem> {
    const trimmed = val.trim()
    if (!trimmed) {
      return { quantity: null, quantity_raw: null, quantity_conflict_flag: false }
    }
    const num = parseInt(trimmed, 10)
    if (isNaN(num)) {
      return { quantity: null, quantity_raw: trimmed, quantity_conflict_flag: true }
    }
    return { quantity: num, quantity_raw: trimmed, quantity_conflict_flag: false }
  }

  function getClasses(row: IndexedItem | undefined, baseCls: string) {
    if (!row) return baseCls
    if (row.source === 'missing') return `${baseCls} !text-amber-600`
    if (row.source === 'unknown') return `${baseCls} !text-red-600 font-semibold`
    return baseCls
  }

  async function exportCsv() {
    if (!parsedData) {
      setApiError('No parsed data to export yet.')
      return
    }

    setIsExporting(true)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData),
      })

      if (!response.ok) {
        const payload = await response.json()
        throw new Error(payload?.error ?? 'CSV export failed.')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `stock-${parsedData.photo_id}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected export error.')
    } finally {
      setIsExporting(false)
    }
  }

  async function saveToSnowflake() {
    if (!parsedData) {
      setApiError('No parsed data to save yet. Parse a stock photo first.')
      return
    }

    setIsSaving(true)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: parsedData,
          unknown_items: unknownItems,
          missing_catalog_items: missingCatalogItems,
          uid_generate: latestGenerateUid,
        }),
      })

      const payload = await response.json()

      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before saving to Snowflake.')
      }

      if (!response.ok) {
        const details = payload?.details
        const detailsText = typeof details === 'string' ? details : details ? JSON.stringify(details) : ''
        throw new Error(
          detailsText
            ? `${payload?.error ?? 'Snowflake save failed.'} Details: ${detailsText}`
            : payload?.error ?? 'Snowflake save failed.'
        )
      }

      setApiStatus(
        `${payload?.message ?? 'Saved to Snowflake staging.'} ${payload?.query_id ? `Query ID: ${payload.query_id}.` : ''}`.trim()
      )
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected Snowflake save error.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-8 md:py-7">
      <div className="mx-auto mb-3 flex w-full max-w-7xl items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <p>
          {isAuthLoading
            ? 'Checking sign-in session...'
            : session
            ? `Signed in as ${session.user.email ?? session.user.id} (${session.roles.join(', ') || 'no role'})`
            : 'Not signed in'}
        </p>
        <div className="flex items-center gap-2">
          {!session ? (
            <a href="/login" className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
              Sign in
            </a>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                window.location.href = '/login'
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row">
        <aside className="card-surface rounded-2xl p-4 md:min-h-[85vh] md:w-72 md:p-6">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Smart Stock</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Operations Hub</h2>
          </div>

          <nav className="space-y-2">
            <button className="flex w-full items-center gap-3 rounded-lg bg-brand-50 px-3 py-2 text-left text-sm font-semibold text-brand-700">
              <FileImage className="h-4 w-4" />
              Data Entry
            </button>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">
              <Search className="h-4 w-4" />
              Check Stock
            </button>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </button>
          </nav>

          <div className="mt-8 rounded-xl bg-slate-900 p-4 text-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-300">Today</p>
            <p className="mt-2 text-2xl font-semibold">7 uploads</p>
            <p className="mt-1 text-xs text-slate-300">2 need manual review</p>
          </div>
        </aside>

        <div className="flex-1 space-y-4">
          <section className="card-surface rounded-2xl p-6 md:p-8">
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
                  Data Entry Pipeline
                </p>
                <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">
                  Upload, Parse, Validate, Save
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
                  Turn stocklist photos into structured data with AI OCR, then review and load into
                  Snowflake staging in one flow.
                </p>
              </div>
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
                Confidence checks enabled
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-brand-500">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
                  <Upload className="h-6 w-6 text-brand-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">Drop stocklist photo</h2>
                <p className="mt-1 text-sm text-slate-500">JPEG / PNG up to 5MB + optional catalog JSON</p>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Mode</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {([
                      ['stock-in', 'Stock-in'],
                      ['stock-closing', 'Stock-closing'],
                    ] as const).map(([value, label]) => {
                      const active = stockMode === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setStockMode(value)}
                          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                            active
                              ? 'bg-brand-600 text-white shadow-sm'
                              : 'border border-slate-300 bg-slate-50 text-slate-700 hover:bg-white'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {stockMode === 'stock-in'
                      ? 'Use this for incoming stock counts.'
                      : 'Use this for end-of-day closing stock counts.'}
                  </p>
                </div>

                <input
                  id="photo-upload"
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    setPhotoFile(file ?? null)
                  }}
                />

                <label
                  htmlFor="photo-upload"
                  className="mt-4 inline-flex cursor-pointer items-center rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
                >
                  Choose File
                </label>

                <p className="mt-3 text-sm text-slate-600">
                  {photoFile ? `Photo: ${photoFile.name}` : 'No photo selected'}
                </p>

                <div className="mt-4 border-t border-slate-200 pt-4 flex flex-col gap-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-left">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Catalog Version</p>
                    <select
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      value={selectedCatalogVersionId ?? ''}
                      onChange={async (event) => {
                        const versionId = event.target.value
                        setSelectedCatalogVersionId(versionId || null)
                        if (!versionId) return
                        try {
                          await loadCatalogFromApi(versionId)
                        } catch (error) {
                          setApiError(error instanceof Error ? error.message : 'Failed to switch catalog version.')
                        }
                      }}
                    >
                      {catalogVersions.length === 0 ? (
                        <option value="">No DB catalog yet</option>
                      ) : (
                        catalogVersions.map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.version_name} ({version.item_count} items)
                          </option>
                        ))
                      )}
                    </select>
                    <p className="mt-2 text-xs text-slate-500">
                      Upload a CSV once, then choose any version stored in Supabase.
                    </p>
                  </div>
                  <input
                    id="catalog-upload"
                    type="file"
                    className="hidden"
                    accept=".csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      void uploadCatalogToDatabase(file)
                    }}
                  />
                  <div className="flex items-center justify-center gap-2">
                    <label
                      htmlFor="catalog-upload"
                      className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <Database className="mr-2 h-4 w-4" />
                      {isCatalogUploading ? 'Uploading Catalog...' : 'Upload CSV Catalog to DB'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCatalogOpen(true)}
                      className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      View Catalog UI
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Source: {catalogSource === 'master' ? 'Default Catalog' : catalogSource === 'uploaded' ? 'Uploaded CSV' : 'Edited Catalog'} 
                    {catalogItemCount !== null ? ` (${catalogItemCount} items)` : ''}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={parsePhoto}
                  disabled={isParsing || !photoFile}
                  className="mt-4 inline-flex min-w-[170px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  {isParsing ? 'Parsing...' : 'Parse Stocklist'}
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pipeline</h3>
                <ul className="mt-3 space-y-3 text-sm">
                  <li className="flex items-center gap-2 text-slate-700">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Upload photo
                  </li>
                  <li className="flex items-center gap-2 text-slate-700">
                    <ListChecks className="h-4 w-4 text-brand-600" />
                    OCR parse to JSON
                  </li>
                  <li className="flex items-center gap-2 text-slate-700">
                    <ListChecks className="h-4 w-4 text-brand-600" />
                    Review confidence flags
                  </li>
                  <li className="flex items-center gap-2 text-slate-700">
                    <Database className="h-4 w-4 text-brand-600" />
                    Save to Snowflake
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section className="card-surface rounded-2xl p-6 md:p-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Editable Stocklist Layout</h2>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                Date: {parsedData?.stock_date ?? '-'}
              </span>
            </div>

            {!parsedData && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                Parse a photo to render an editable stocklist layout grouped by location and left/right columns.
              </div>
            )}

            {parsedData && (
              <div className="space-y-6">
                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-3">
                  <p>
                    <span className="font-semibold text-slate-700">Known items:</span> {parsedData.total_items}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Unknown items:</span> {unknownItems.length}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Review required:</span> {reviewRequiredCount}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Mode:</span>{' '}
                    {parsedData.mode === 'stock-closing' ? 'Stock-closing' : 'Stock-in'}
                  </p>
                  <p className="md:col-span-3">
                    <span className="font-semibold text-slate-700">Catalog source:</span>{' '}
                    {catalogSource === 'uploaded' ? 'Uploaded file' : 'Project master catalog'}
                    {catalogItemCount !== null ? ` (${catalogItemCount} items)` : ''}
                  </p>
                  <p className="md:col-span-3">
                    <span className="font-semibold text-slate-700">UID_generate:</span> {latestGenerateUid ?? '-'}
                  </p>
                </div>

                <div className="stock-paper-wrap overflow-x-auto">
                  <div className="stock-paper min-w-[820px]">
                    <div className="stock-date-row">
                      <span>DATE:</span>
                      <span className="stock-date-hand">{formatSheetDate(parsedData.stock_date)}</span>
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
                                        <td className="stock-lbl">
                                          {left ? (
                                            <input
                                              className={getClasses(left, "stock-input")}
                                              value={left.item.official_name ?? left.item.product_raw}
                                              onChange={(event) =>
                                                updateItem(left.index, { official_name: event.target.value })
                                              }
                                            />
                                          ) : null}
                                        </td>
                                        <td className="stock-qty">
                                          {left ? (
                                            <input
                                              type="number"
                                              className={getClasses(left, "stock-qty-input")}
                                              value={left.item.quantity ?? ''}
                                              onChange={(event) =>
                                                updateItem(left.index, toQuantityPatch(event.target.value))
                                              }
                                            />
                                          ) : null}
                                        </td>
                                        <td className="stock-lbl">
                                          {right ? (
                                            <input
                                              className={getClasses(right, "stock-input")}
                                              value={right.item.official_name ?? right.item.product_raw}
                                              onChange={(event) =>
                                                updateItem(right.index, { official_name: event.target.value })
                                              }
                                            />
                                          ) : null}
                                        </td>
                                        <td className="stock-qty">
                                          {right ? (
                                            <input
                                              type="number"
                                              className={getClasses(right, "stock-qty-input")}
                                              value={right.item.quantity ?? ''}
                                              onChange={(event) =>
                                                updateItem(right.index, toQuantityPatch(event.target.value))
                                              }
                                            />
                                          ) : null}
                                        </td>
                                      </tr>
                                    )
                                  })}

                                  {section.rows.single.map((single, i) => (
                                    <tr key={`${section.title}-single-${i}`} className="stock-hw-row">
                                      <td className="stock-lbl" colSpan={3}>
                                        <input
                                          className={getClasses(single, "stock-input stock-input-hw")}
                                          value={single.item.official_name ?? single.item.product_raw}
                                          onChange={(event) =>
                                            updateItem(single.index, { official_name: event.target.value })
                                          }
                                        />
                                      </td>
                                      <td className="stock-qty">
                                        <input
                                          type="number"
                                          className={getClasses(single, "stock-qty-input")}
                                          value={single.item.quantity ?? ''}
                                          onChange={(event) =>
                                            updateItem(single.index, toQuantityPatch(event.target.value))
                                          }
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
                                        <td className="stock-lbl">
                                          {left ? (
                                            <input
                                              className={getClasses(left, "stock-input")}
                                              value={left.item.official_name ?? left.item.product_raw}
                                              onChange={(event) =>
                                                updateItem(left.index, { official_name: event.target.value })
                                              }
                                            />
                                          ) : null}
                                        </td>
                                        <td className="stock-qty">
                                          {left ? (
                                            <input
                                              type="number"
                                              className={getClasses(left, "stock-qty-input")}
                                              value={left.item.quantity ?? ''}
                                              onChange={(event) =>
                                                updateItem(left.index, toQuantityPatch(event.target.value))
                                              }
                                            />
                                          ) : null}
                                        </td>
                                        <td className="stock-lbl">
                                          {right ? (
                                            <input
                                              className={getClasses(right, "stock-input")}
                                              value={right.item.official_name ?? right.item.product_raw}
                                              onChange={(event) =>
                                                updateItem(right.index, { official_name: event.target.value })
                                              }
                                            />
                                          ) : null}
                                        </td>
                                        <td className="stock-qty">
                                          {right ? (
                                            <input
                                              type="number"
                                              className={getClasses(right, "stock-qty-input")}
                                              value={right.item.quantity ?? ''}
                                              onChange={(event) =>
                                                updateItem(right.index, toQuantityPatch(event.target.value))
                                              }
                                            />
                                          ) : null}
                                        </td>
                                      </tr>
                                    )
                                  })}

                                  {section.rows.single.map((single, i) => (
                                    <tr key={`${section.title}-single-${i}`} className="stock-hw-row">
                                      <td className="stock-lbl" colSpan={3}>
                                        <input
                                          className={getClasses(single, "stock-input stock-input-hw")}
                                          value={single.item.official_name ?? single.item.product_raw}
                                          onChange={(event) =>
                                            updateItem(single.index, { official_name: event.target.value })
                                          }
                                        />
                                      </td>
                                      <td className="stock-qty">
                                        <input
                                          type="number"
                                          className={getClasses(single, "stock-qty-input")}
                                          value={single.item.quantity ?? ''}
                                          onChange={(event) =>
                                            updateItem(single.index, toQuantityPatch(event.target.value))
                                          }
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
                            {paperSections.outsideRows.left.map((row) => (
                              <tr key={`outside-left-${row.index}`}>
                                <td className="stock-lbl">
                                  <input
                                    className={getClasses(row, "stock-input")}
                                    value={row.item.official_name ?? row.item.product_raw}
                                    onChange={(event) =>
                                      updateItem(row.index, { official_name: event.target.value })
                                    }
                                  />
                                </td>
                                <td className="stock-qty">
                                  <input
                                    type="number"
                                    className={getClasses(row, "stock-qty-input")}
                                    value={row.item.quantity ?? ''}
                                    onChange={(event) =>
                                      updateItem(row.index, toQuantityPatch(event.target.value))
                                    }
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
                            {paperSections.outsideRows.right.map((row) => (
                              <tr key={`outside-right-${row.index}`}>
                                <td className="stock-lbl">
                                  <input
                                    className={getClasses(row, "stock-input")}
                                    value={row.item.official_name ?? row.item.product_raw}
                                    onChange={(event) =>
                                      updateItem(row.index, { official_name: event.target.value })
                                    }
                                  />
                                </td>
                                <td className="stock-qty">
                                  <input
                                    type="number"
                                    className={getClasses(row, "stock-qty-input")}
                                    value={row.item.quantity ?? ''}
                                    onChange={(event) =>
                                      updateItem(row.index, toQuantityPatch(event.target.value))
                                    }
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
                            {paperSections.outsideRows.single.map((row) => (
                              <tr key={`outside-single-${row.index}`}>
                                <td className="stock-lbl">
                                  <input
                                    className={getClasses(row, "stock-input")}
                                    value={row.item.official_name ?? row.item.product_raw}
                                    onChange={(event) =>
                                      updateItem(row.index, { official_name: event.target.value })
                                    }
                                  />
                                </td>
                                <td className="stock-qty">
                                  <input
                                    type="number"
                                    className={getClasses(row, "stock-qty-input")}
                                    value={row.item.quantity ?? ''}
                                    onChange={(event) =>
                                      updateItem(row.index, toQuantityPatch(event.target.value))
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {paperSections.unknownRows.left.length > 0 && (
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
                                {paperSections.unknownRows.left.map((row) => (
                                  <tr key={`unknown-left-${row.index}`}>
                                    <td className="stock-lbl">
                                      <input
                                        className={getClasses(row, "stock-input")}
                                        value={row.item.official_name ?? row.item.product_raw}
                                        onChange={(event) =>
                                          updateItem(row.index, { official_name: event.target.value })
                                        }
                                      />
                                    </td>
                                    <td className="stock-qty">
                                      <input
                                        type="number"
                                        className={getClasses(row, "stock-qty-input")}
                                        value={row.item.quantity ?? ''}
                                        onChange={(event) =>
                                          updateItem(row.index, toQuantityPatch(event.target.value))
                                        }
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
                                {paperSections.unknownRows.right.map((row) => (
                                  <tr key={`unknown-right-${row.index}`}>
                                    <td className="stock-lbl">
                                      <input
                                        className={getClasses(row, "stock-input")}
                                        value={row.item.official_name ?? row.item.product_raw}
                                        onChange={(event) =>
                                          updateItem(row.index, { official_name: event.target.value })
                                        }
                                      />
                                    </td>
                                    <td className="stock-qty">
                                      <input
                                        type="number"
                                        className={getClasses(row, "stock-qty-input")}
                                        value={row.item.quantity ?? ''}
                                        onChange={(event) =>
                                          updateItem(row.index, toQuantityPatch(event.target.value))
                                        }
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
                                {paperSections.unknownRows.single.map((row) => (
                                  <tr key={`unknown-single-${row.index}`}>
                                    <td className="stock-lbl">
                                      <input
                                        className={getClasses(row, "stock-input")}
                                        value={row.item.official_name ?? row.item.product_raw}
                                        onChange={(event) =>
                                          updateItem(row.index, { official_name: event.target.value })
                                        }
                                      />
                                    </td>
                                    <td className="stock-qty">
                                      <input
                                        type="number"
                                        className={getClasses(row, "stock-qty-input")}
                                        value={row.item.quantity ?? ''}
                                        onChange={(event) =>
                                          updateItem(row.index, toQuantityPatch(event.target.value))
                                        }
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {apiError && (
              <FeedbackBanner
                tone="error"
                title="Snowflake load did not complete"
                message={apiError}
                detail="Check the staging table name, credentials, and whether the Snowflake warehouse is running, then try again."
              />
            )}

            {apiStatus && (
              <FeedbackBanner
                tone="success"
                title="Row written to Snowflake staging"
                message={apiStatus}
                detail="The reviewed payload was accepted as one JSON staging record. You can export CSV or continue with the next photo."
              />
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportCsv}
                disabled={!parsedData || isExporting || isSaving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {isExporting ? 'Exporting...' : 'Export CSV'}
              </button>
              <button
                type="button"
                onClick={saveToSnowflake}
                disabled={!parsedData || isSaving || isExporting}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
              >
                {isSaving ? 'Saving to Snowflake...' : 'Validate & Save to Snowflake'}
              </button>
            </div>
          </section>
        </div>
      </div>

      {isCatalogOpen && activeCatalog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex h-[90vh] w-full max-w-7xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Catalog Viewer & Editor</h2>
                <p className="text-sm text-slate-500">Edit items before parsing to fine-tune AI extraction.</p>
              </div>
              <button onClick={() => setIsCatalogOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-2 font-medium">ID</th>
                    <th className="pb-2 font-medium pl-2">Code</th>
                    <th className="pb-2 font-medium">Location</th>
                    <th className="pb-2 font-medium pl-2">Sub-location</th>
                    <th className="pb-2 font-medium pl-2">Category</th>
                    <th className="pb-2 font-medium pl-2">Product</th>
                    <th className="pb-2 font-medium pl-2">Attribute</th>
                    <th className="pb-2 font-medium pl-2">Official Name</th>
                    <th className="pb-2 font-medium pl-2">Name on Stocklist</th>
                    <th className="pb-2 font-medium pl-2">Navigation Guide</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeCatalog.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50">
                      <td className="py-2 pr-2 text-slate-500">{item.id}</td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[90px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.code ?? ''} onChange={(e) => { const c = [...activeCatalog]; c[index].code = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[130px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.location} onChange={(e) => { const c = [...activeCatalog]; c[index].location = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.sub_location} onChange={(e) => { const c = [...activeCatalog]; c[index].sub_location = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.category} onChange={(e) => { const c = [...activeCatalog]; c[index].category = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[110px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.product} onChange={(e) => { const c = [...activeCatalog]; c[index].product = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[110px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.attribute} onChange={(e) => { const c = [...activeCatalog]; c[index].attribute = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[130px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.official_name} onChange={(e) => { const c = [...activeCatalog]; c[index].official_name = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[140px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.stocklist_name} onChange={(e) => { const c = [...activeCatalog]; c[index].stocklist_name = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input className="w-full min-w-[200px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.navigation_guide} onChange={(e) => { const c = [...activeCatalog]; c[index].navigation_guide = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="border-t border-slate-200 px-6 py-4 flex justify-between gap-3 bg-slate-50 rounded-b-2xl">
              <button onClick={() => {
                const newRow = { id: activeCatalog.length ? Math.max(...activeCatalog.map(c => c.id)) + 1 : 1, code: '', location: '', sub_location: '', category: '', product: '', attribute: '', official_name: '', stocklist_name: '', navigation_guide: '', row_position: 'single' as const }
                setActiveCatalog([...activeCatalog, newRow])
                setCatalogSource('edited')
              }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Plus className="h-4 w-4" /> Add Row
              </button>
              <button onClick={() => setIsCatalogOpen(false)} className="rounded-lg bg-brand-600 px-8 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Done ({activeCatalog.length} items)
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
