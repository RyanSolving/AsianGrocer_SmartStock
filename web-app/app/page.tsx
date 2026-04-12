'use client'

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Database,
  FileImage,
  Loader2,
  Search,
  Settings,
  X,
  Plus
} from 'lucide-react'

import { CatalogManagementView } from './catalog/CatalogManagementView'
import { EmbeddedStockCheckPanel } from './components/EmbeddedStockCheckPanel'
import type { SelectedStockCheckHistoryRecord } from './components/EmbeddedStockCheckPanel'
import { TranscriptionHistoryDialog } from './components/TranscriptionHistoryDialog'

type StockItem = {
  catalog_code: string | null
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
  catalog_code: null
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
  quantity_raw?: string | null
  quantity?: number | null
  quantity_conflict_flag?: boolean
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

type HistoryEntry = {
  uid_generate: string
  timestamp: string
  filename: string
  transcriptionData: unknown
  stockMode: string
  isPushed: boolean
}

type StockCheckHistoryEntry = {
  uid_stock_check: string
  timestamp: string
  stock_date: string
  mode: string
  validated: boolean
  item_count: number
  unknown_count: number
  record_data?: SelectedStockCheckHistoryRecord['record_data']
}

type IndexedItem = {
  item: StockItem
  index: number
  source: 'parsed' | 'missing' | 'unknown'
}

type HubSection = 'data-entry' | 'stock-check' | 'catalog'

function splitRows(items: IndexedItem[]) {
  const singles = items.filter((row) => row.item.row_position === 'single')
  const paired = items.filter((row) => row.item.row_position !== 'single')
  const left: IndexedItem[] = []
  const right: IndexedItem[] = []

  // Keep visual reading order alphabetical by alternating sorted rows across columns.
  paired.forEach((row, index) => {
    if (index % 2 === 0) {
      left.push(row)
    } else {
      right.push(row)
    }
  })

  return {
    left,
    right,
    single: singles,
  }
}

function getItemDisplayNameForSort(item: StockItem) {
  return (item.official_name || item.product_raw || '').trim()
}

function sortIndexedItemsByName(items: IndexedItem[]) {
  return [...items].sort((a, b) => {
    const nameCompare = getItemDisplayNameForSort(a.item).localeCompare(getItemDisplayNameForSort(b.item), undefined, {
      sensitivity: 'base',
      numeric: true,
    })

    if (nameCompare !== 0) return nameCompare

    const codeCompare = (a.item.catalog_code || '').localeCompare(b.item.catalog_code || '', undefined, {
      sensitivity: 'base',
      numeric: true,
    })

    if (codeCompare !== 0) return codeCompare

    return a.index - b.index
  })
}

function normalizeSubLocation(value: string) {
  if (value.toLowerCase() === 'all year') return 'All Year'
  return value
}

function normalizeInsideSectionLabel(category: string, subLocation: string) {
  const raw = (category || subLocation || 'Unknown').trim()
  if (!raw) return 'Unknown'
  return normalizeSubLocation(raw)
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

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
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
  const [activeSection, setActiveSection] = useState<HubSection>('data-entry')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [stockMode, setStockMode] = useState<StockMode>('stock-in')
  const [activeCatalog, setActiveCatalog] = useState<CatalogItem[] | null>(null)
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [historyData, setHistoryData] = useState<HistoryEntry[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isRepushing, setIsRepushing] = useState(false)
  const [selectedHistoryUid, setSelectedHistoryUid] = useState<string | null>(null)
  const [dataEntrySearchTerm, setDataEntrySearchTerm] = useState('')
  const [dataEntryStatusFilter, setDataEntryStatusFilter] = useState<'all' | 'pending' | 'pushed'>('all')
  const [dataEntryFindTerm, setDataEntryFindTerm] = useState('')
  const [highlightedDataEntryIndex, setHighlightedDataEntryIndex] = useState<number | null>(null)
  const [stockCheckHistory, setStockCheckHistory] = useState<StockCheckHistoryEntry[]>([])
  const [isStockCheckHistoryLoading, setIsStockCheckHistoryLoading] = useState(false)
  const [stockCheckSearchTerm, setStockCheckSearchTerm] = useState('')
  const [stockCheckStatusFilter, setStockCheckStatusFilter] = useState<'all' | 'validated' | 'unvalidated'>('all')
  const [selectedStockCheckHistoryRecord, setSelectedStockCheckHistoryRecord] = useState<SelectedStockCheckHistoryRecord | null>(null)
  const [hasLoadedToDb, setHasLoadedToDb] = useState(false)
  const [isValidatedByStaff, setIsValidatedByStaff] = useState(false)
  const dataEntryPaperRef = useRef<HTMLDivElement | null>(null)
  const dataEntryFindContainerRef = useRef<HTMLDivElement | null>(null)
  const dataEntryHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function loadCatalogFromApi() {
    const response = await fetch('/api/catalog')
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.error ?? 'Failed to load catalog data.')
    }

    const catalog = Array.isArray(data?.catalog) ? data.catalog : []
    setActiveCatalog(catalog)
    setCatalogItemCount(catalog.length)
    setCatalogSource(data?.source === 'database' ? 'uploaded' : 'master')
  }

  const loadTranscriptionHistory = useCallback(async () => {
    setIsHistoryLoading(true)
    setApiError(null)

    try {
      const response = await fetch('/api/transcription-history')

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load transcription history.')
      }

      setHistoryData(Array.isArray(payload.history) ? payload.history : [])
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to load history.')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [])

  const loadStockCheckHistory = useCallback(async () => {
    setIsStockCheckHistoryLoading(true)
    setApiError(null)

    try {
      const response = await fetch('/api/stock-check/history')
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load stock check history.')
      }

      setStockCheckHistory(Array.isArray(payload.history) ? payload.history : [])
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to load stock check history.')
    } finally {
      setIsStockCheckHistoryLoading(false)
    }
  }, [])

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
          await loadTranscriptionHistory()
          await loadStockCheckHistory()
        } catch (catalogError) {
          console.error('Failed to load catalog', catalogError)
          setApiError(catalogError instanceof Error ? catalogError.message : 'Failed to load catalog.')
        }
      })
      .catch(() => setSession(null))
      .finally(() => setIsAuthLoading(false))
  }, [loadStockCheckHistory, loadTranscriptionHistory])

  useEffect(() => {
    if (activeSection === 'stock-check') {
      void loadStockCheckHistory()
    }
  }, [activeSection, loadStockCheckHistory])

  useEffect(() => {
    setDataEntryFindTerm('')
    setHighlightedDataEntryIndex(null)

    if (dataEntryHighlightTimeoutRef.current) {
      clearTimeout(dataEntryHighlightTimeoutRef.current)
      dataEntryHighlightTimeoutRef.current = null
    }
  }, [activeSection])

  useEffect(() => {
    const handleOutsideFindClick = (event: MouseEvent | TouchEvent) => {
      if (!dataEntryFindTerm.trim()) return

      const targetNode = event.target as Node | null
      if (!targetNode) return

      if (dataEntryFindContainerRef.current?.contains(targetNode)) return
      setDataEntryFindTerm('')
    }

    document.addEventListener('mousedown', handleOutsideFindClick)
    document.addEventListener('touchstart', handleOutsideFindClick)

    return () => {
      document.removeEventListener('mousedown', handleOutsideFindClick)
      document.removeEventListener('touchstart', handleOutsideFindClick)
    }
  }, [dataEntryFindTerm])

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
    if (!parsedData) {
      if (!activeCatalog) return []

      return activeCatalog.map((c_item, index) => ({
        item: {
          catalog_code: c_item.code,
          product_raw: c_item.stocklist_name || c_item.official_name,
          category: c_item.category,
          location: c_item.location as StockItem['location'],
          sub_location: c_item.sub_location,
          product: c_item.product,
          attribute: c_item.attribute,
          official_name: c_item.official_name,
          quantity_raw: c_item.quantity_raw ?? null,
          quantity: typeof c_item.quantity === 'number' ? c_item.quantity : null,
          quantity_conflict_flag: Boolean(c_item.quantity_conflict_flag),
          row_position: c_item.row_position || 'single',
          confidence: 'high' as const,
          notes: null,
        },
        index,
        source: 'parsed' as const,
      }))
    }

    // Extracted items (matched)
    const allItems = parsedData.items.map((item, index) => ({ item, index, source: 'parsed' as const }))

    // Inject Missing Catalog Items into their designated locations (amber text)
    // Use negative indices starting at -1000 to avoid collision with parsed items
    const missingItems = missingCatalogItems.map((c_item, pos) => ({
      item: {
        catalog_code: c_item.code,
        product_raw: c_item.stocklist_name || c_item.official_name,
        category: c_item.category,
        location: c_item.location as StockItem['location'],
        sub_location: c_item.sub_location,
        product: c_item.product,
        attribute: c_item.attribute,
        official_name: c_item.official_name,
        quantity_raw: c_item.quantity_raw ?? null,
        quantity: typeof c_item.quantity === 'number' ? c_item.quantity : null,
        quantity_conflict_flag: Boolean(c_item.quantity_conflict_flag),
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
  }, [parsedData, missingCatalogItems, unknownItems, activeCatalog])

  const paperSections = useMemo(() => {
    const insideRows = indexedItems.filter(
      (row) => row.item.location === 'Inside Coolroom' && row.source !== 'unknown'
    )

    const insideRowsByCategory = new Map<string, IndexedItem[]>()

    insideRows.forEach((entry) => {
      const sectionLabel = normalizeInsideSectionLabel(entry.item.category, entry.item.sub_location)
      const existing = insideRowsByCategory.get(sectionLabel)
      if (existing) {
        existing.push(entry)
        return
      }
      insideRowsByCategory.set(sectionLabel, [entry])
    })

    const insideSections = Array.from(insideRowsByCategory.entries())
      .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel, undefined, {
        sensitivity: 'base',
        numeric: true,
      }))
      .map(([label, sectionRows]) => ({
        title: label.toUpperCase(),
        rows: splitRows(sortIndexedItemsByName(sectionRows)),
      }))

    const midpoint = Math.ceil(insideSections.length / 2)
    
    // Everything outside coolroom
    const outside = sortIndexedItemsByName(indexedItems.filter((row) => row.item.location === 'Outside Coolroom'))
    const unknown = sortIndexedItemsByName(indexedItems.filter((row) => row.source === 'unknown'))

    return {
      leftColumn: insideSections.slice(0, midpoint),
      rightColumn: insideSections.slice(midpoint),
      outsideRows: splitRows(outside),
      unknownRows: splitRows(unknown),
    }
  }, [indexedItems])

  const outsideDisplayColumns = useMemo(() => {
    const combinedOutside = [
      ...paperSections.outsideRows.left,
      ...paperSections.outsideRows.right,
      ...paperSections.outsideRows.single,
    ]

    return {
      left: combinedOutside.slice(0, 6),
      middle: combinedOutside.slice(6, 12),
      right: combinedOutside.slice(12),
    }
  }, [paperSections.outsideRows.left, paperSections.outsideRows.right, paperSections.outsideRows.single])

  const dataEntryFindSuggestions = useMemo(() => {
    const term = dataEntryFindTerm.trim().toLowerCase()
    if (!term) return []

    return indexedItems
      .filter(({ item }) => {
        const official = item.official_name.toLowerCase()
        const stocklist =
          'stocklist_name' in item && typeof item.stocklist_name === 'string'
            ? item.stocklist_name.toLowerCase()
            : ''
        return official.includes(term) || stocklist.includes(term)
      })
      .slice(0, 8)
  }, [dataEntryFindTerm, indexedItems])

  const updateParsedStockDate = useCallback((value: string) => {
    if (!isIsoDate(value)) return

    setParsedData((current) => {
      if (!current) return current
      return {
        ...current,
        stock_date: value,
      }
    })

    setIsValidatedByStaff(false)
  }, [])

  const focusAndHighlightDataEntry = useCallback((index: number) => {
    setActiveSection('data-entry')

    window.setTimeout(() => {
      const target = dataEntryPaperRef.current?.querySelector(`[data-entry-row-index="${index}"]`) as HTMLElement | null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }

      setHighlightedDataEntryIndex(index)
      if (dataEntryHighlightTimeoutRef.current) {
        clearTimeout(dataEntryHighlightTimeoutRef.current)
      }
      dataEntryHighlightTimeoutRef.current = setTimeout(() => {
        setHighlightedDataEntryIndex(null)
        dataEntryHighlightTimeoutRef.current = null
      }, 3000)
    }, 0)
  }, [])

  useEffect(() => {
    return () => {
      if (dataEntryHighlightTimeoutRef.current) {
        clearTimeout(dataEntryHighlightTimeoutRef.current)
      }
    }
  }, [])

  async function parsePhoto() {
    if (!photoFile) {
      setApiError('Please select a stocklist photo first.')
      return
    }

    setIsParsing(true)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
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
      setMissingCatalogItems(
        (json.missing_catalog_items ?? []).map((item: CatalogItem) => ({
          ...item,
          quantity_raw: item.quantity_raw ?? null,
          quantity: typeof item.quantity === 'number' ? item.quantity : null,
          quantity_conflict_flag: Boolean(item.quantity_conflict_flag),
        }))
      )
      setReviewRequiredCount(json.review_required_count ?? 0)
      setCatalogSource(json.catalog_source ?? null)
      setCatalogItemCount(typeof json.catalog_item_count === 'number' ? json.catalog_item_count : null)

      // Keep sidebar history in sync without requiring a page reload.
      await loadTranscriptionHistory()
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
    setIsValidatedByStaff(false)

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
        if (patch.quantity !== undefined) item.quantity = patch.quantity
        if (patch.quantity_raw !== undefined) item.quantity_raw = patch.quantity_raw
        if (patch.quantity_conflict_flag !== undefined) item.quantity_conflict_flag = patch.quantity_conflict_flag
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
    if (row.index === highlightedDataEntryIndex) return `${baseCls} !bg-emerald-100 transition-colors duration-700`
    if (row.source === 'missing') return `${baseCls} !text-amber-600`
    if (row.source === 'unknown') return `${baseCls} !text-red-600 font-semibold`
    return baseCls
  }

  async function exportCsv() {
    if (!parsedData) {
      setApiError('No parsed data to export yet.')
      return
    }

    if (!isValidatedByStaff) {
      setApiError('Please click Validate first. Export is only enabled after staff validation.')
      return
    }

    setIsExporting(true)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsedData,
          unknown_items: unknownItems,
          missing_catalog_items: missingCatalogItems,
          validated: isValidatedByStaff ? 'yes' : 'no',
        }),
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

    if (!isValidatedByStaff) {
      setApiError('Please click Validate first. Load to DB is only enabled after staff validation.')
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
          validated: isValidatedByStaff ? 'yes' : 'no',
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
      setHasLoadedToDb(true)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected Snowflake save error.')
    } finally {
      setIsSaving(false)
    }
  }

  async function reopushToSnowflake(uid: string) {
    setIsRepushing(true)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid_generate: uid,
          reprocess: true,
        }),
      })

      const payload = await response.json()

      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before pushing to Snowflake.')
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to repush to Snowflake.')
      }

      setApiStatus(`Entry repushed to Snowflake successfully.`)
      // Reload history to refresh push status
      await loadTranscriptionHistory()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected repush error.')
    } finally {
      setIsRepushing(false)
    }
  }

  const openHistory = async (uid?: string) => {
    setSelectedHistoryUid(uid ?? null)
    setIsHistoryOpen(true)

    if (historyData.length === 0) {
      await loadTranscriptionHistory()
    }
  }

  const sidebarDataEntryHistory = historyData.filter((entry) => {
    const statusMatches =
      dataEntryStatusFilter === 'all'
      || (dataEntryStatusFilter === 'pushed' && entry.isPushed)
      || (dataEntryStatusFilter === 'pending' && !entry.isPushed)

    const term = dataEntrySearchTerm.trim().toLowerCase()
    const searchMatches =
      term.length === 0
      || entry.filename.toLowerCase().includes(term)
      || new Date(entry.timestamp).toLocaleDateString('en-US').toLowerCase().includes(term)

    return statusMatches && searchMatches
  })

  const sidebarStockCheckHistory = stockCheckHistory.filter((entry) => {
    const statusMatches =
      stockCheckStatusFilter === 'all'
      || (stockCheckStatusFilter === 'validated' && entry.validated)
      || (stockCheckStatusFilter === 'unvalidated' && !entry.validated)

    const term = stockCheckSearchTerm.trim().toLowerCase()
    const searchMatches =
      term.length === 0
      || entry.uid_stock_check.toLowerCase().includes(term)
      || entry.stock_date.toLowerCase().includes(term)

    return statusMatches && searchMatches
  })
  const hasUploadedPhoto = Boolean(photoFile)
  const hasParsedPhoto = Boolean(parsedData)
  const hasValidated = hasParsedPhoto && isValidatedByStaff
  const isStockCheckTab = activeSection === 'stock-check'

  const validateReviewedData = () => {
    if (!parsedData) {
      setApiError('No parsed data to validate yet.')
      return
    }

    // Business rule: blank known quantities are treated as zero at validation time.
    const normalizedParsedItems = parsedData.items.map((item) => {
      if (item.quantity === null && !item.quantity_conflict_flag) {
        return {
          ...item,
          quantity: 0,
          quantity_raw: '0',
        }
      }

      return item
    })

    const normalizedMissingItems = missingCatalogItems.map((item) => {
      const hasConflict = Boolean(item.quantity_conflict_flag)
      const hasBlankQuantity = item.quantity === null || item.quantity === undefined

      if (hasBlankQuantity && !hasConflict) {
        return {
          ...item,
          quantity: 0,
          quantity_raw: '0',
        }
      }

      return item
    })

    const conflictCount = normalizedParsedItems.filter((item) => item.quantity_conflict_flag).length
      + normalizedMissingItems.filter((item) => Boolean(item.quantity_conflict_flag)).length

    setParsedData((current) => {
      if (!current) return current
      return {
        ...current,
        items: normalizedParsedItems,
      }
    })

    setMissingCatalogItems(normalizedMissingItems)

    setApiError(null)
    if (conflictCount > 0) {
      setApiStatus(`Validated by staff. Blank known quantities were normalized to 0. ${conflictCount} known item(s) are still marked as conflict, but Export CSV and Load to DB are enabled.`)
    } else {
      setApiStatus('Validated by staff. Blank known quantities were normalized to 0. Export CSV and Load to DB are now enabled.')
    }
    setIsValidatedByStaff(true)
  }

  const workflowSteps = [
    { id: 'upload', label: 'Upload Photo', shortLabel: 'Upload', done: hasUploadedPhoto },
    { id: 'ocr', label: 'OCR Parse', shortLabel: 'OCR', done: hasParsedPhoto },
    { id: 'validate', label: 'Validate', shortLabel: 'Validate', done: hasValidated },
    { id: 'load', label: 'Load to DB', shortLabel: 'Load', done: hasLoadedToDb },
  ]

  return (
    <main className="min-h-screen px-2 py-2 sm:px-3 sm:py-3 md:px-8 md:py-7">
      <div className="mx-auto mb-3 flex w-full max-w-7xl flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="w-full truncate sm:w-auto">
          {isAuthLoading
            ? 'Checking sign-in session...'
            : session
            ? `Signed in as ${session.user.email ?? session.user.id} (${session.roles.join(', ') || 'no role'})`
            : 'Not signed in'}
        </p>
        <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
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
      <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:gap-4">
        <aside className="card-surface rounded-2xl p-3 sm:p-4 md:min-h-[85vh] md:w-72 md:p-6">
          <div className="mb-5 md:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Smart Stock</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Operations Hub</h2>
          </div>

          <nav className="space-y-2">
            <button
              type="button"
              onClick={() => setActiveSection('data-entry')}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${
                activeSection === 'data-entry'
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileImage className="h-4 w-4" />
              Data Entry
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('stock-check')}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${
                activeSection === 'stock-check'
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Search className="h-4 w-4" />
              Check Stock
            </button>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-100">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </button>

            <div className="pt-3">
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Management
              </p>
              <button
                type="button"
                onClick={() => setActiveSection('catalog')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${
                  activeSection === 'catalog'
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Database className="h-4 w-4" />
                Catalog
              </button>
            </div>
          </nav>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 md:mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {isStockCheckTab ? 'Stock Check Record' : 'Data Entry History'}
              </p>
              {!isStockCheckTab && (
                <button
                  type="button"
                  onClick={() => {
                    void openHistory()
                  }}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  View all
                </button>
              )}
            </div>

            <div className="mb-2 space-y-2">
              <input
                type="text"
                value={isStockCheckTab ? stockCheckSearchTerm : dataEntrySearchTerm}
                onChange={(event) => {
                  if (isStockCheckTab) {
                    setStockCheckSearchTerm(event.target.value)
                  } else {
                    setDataEntrySearchTerm(event.target.value)
                  }
                }}
                placeholder={isStockCheckTab ? 'Filter by date/UID' : 'Filter by file/date'}
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
              />
              <select
                value={isStockCheckTab ? stockCheckStatusFilter : dataEntryStatusFilter}
                onChange={(event) => {
                  if (isStockCheckTab) {
                    setStockCheckStatusFilter(event.target.value as 'all' | 'validated' | 'unvalidated')
                  } else {
                    setDataEntryStatusFilter(event.target.value as 'all' | 'pending' | 'pushed')
                  }
                }}
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none"
              >
                <option value="all">All status</option>
                {isStockCheckTab ? (
                  <>
                    <option value="validated">Validated</option>
                    <option value="unvalidated">Unvalidated</option>
                  </>
                ) : (
                  <>
                    <option value="pending">Pending</option>
                    <option value="pushed">Pushed</option>
                  </>
                )}
              </select>
            </div>

            {isStockCheckTab ? (
              isStockCheckHistoryLoading ? (
                <p className="text-xs text-slate-500">Loading history...</p>
              ) : sidebarStockCheckHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No records yet.</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1 md:max-h-72">
                  {sidebarStockCheckHistory.map((entry) => {
                    const isSelected = selectedStockCheckHistoryRecord?.uid_stock_check === entry.uid_stock_check

                    return (
                      <button
                        key={entry.uid_stock_check}
                        type="button"
                        onClick={() => {
                          setSelectedStockCheckHistoryRecord(entry)
                        }}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                          isSelected
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <p className="truncate text-xs font-semibold text-slate-700">
                          {entry.stock_date} ({entry.item_count} items)
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="truncate text-[11px] text-slate-500">
                            {new Date(entry.timestamp).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              entry.validated
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {entry.validated ? 'Validated' : 'Unvalidated'}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            ) : isHistoryLoading ? (
              <p className="text-xs text-slate-500">Loading history...</p>
            ) : sidebarDataEntryHistory.length === 0 ? (
              <p className="text-xs text-slate-500">No records yet.</p>
            ) : (
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1 md:max-h-72">
                {sidebarDataEntryHistory.map((entry) => (
                  <button
                    key={entry.uid_generate}
                    type="button"
                    onClick={() => {
                      void openHistory(entry.uid_generate)
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left transition hover:bg-slate-100"
                  >
                    <p className="truncate text-xs font-semibold text-slate-700">{entry.filename}</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="truncate text-[11px] text-slate-500">
                        {new Date(entry.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          entry.isPushed
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {entry.isPushed ? 'Pushed' : 'Pending'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="flex-1">
          {activeSection === 'catalog' ? (
            <CatalogManagementView embedded />
          ) : activeSection === 'stock-check' ? (
            <EmbeddedStockCheckPanel
              catalogItems={activeCatalog}
              selectedHistoryRecord={selectedStockCheckHistoryRecord}
              historyRecords={stockCheckHistory}
            />
          ) : (
            <div className="space-y-4">
              <section className="card-surface rounded-2xl p-6 md:p-8">
            <div className="mb-4">
              <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Data Entry</h1>
            </div>

            <div className="grid gap-4">
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-center transition hover:border-brand-500 md:p-5">
                <p className="text-sm text-slate-500">JPEG / PNG, max 5MB</p>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-left">
                  <p className="text-xs font-medium text-slate-500">Timeline</p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                      {workflowSteps.map((step, index) => {
                        const isLast = index === workflowSteps.length - 1
                        return (
                          <div key={step.id} className="relative flex flex-col items-start pr-1 md:pr-4">
                            {!isLast && (
                              <span
                                className={`absolute left-7 top-[10px] h-px w-[calc(100%-1.6rem)] md:left-8 md:w-[calc(100%-2rem)] ${
                                  step.done ? 'bg-emerald-400' : 'bg-slate-300'
                                }`}
                              />
                            )}
                            <div className="relative z-10 flex w-6 shrink-0 justify-center bg-white">
                              <span
                                className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${
                                  step.done
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-slate-300 bg-white text-slate-500'
                                }`}
                              >
                                {step.done ? '✓' : index + 1}
                              </span>
                            </div>
                            <div className="pb-1 pt-2">
                              <p className={`text-[11px] font-semibold leading-4 md:text-sm ${step.done ? 'text-emerald-700' : 'text-slate-700'}`}>
                                <span className="md:hidden">{step.shortLabel}</span>
                                <span className="hidden md:inline">{step.label}</span>
                              </p>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-left">
                  <p className="text-xs font-medium text-slate-500">Mode</p>
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
                  className="mt-3 inline-flex w-full cursor-pointer items-center justify-center rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 md:w-auto"
                >
                  Choose File
                </label>

                <p className="mt-3 text-sm text-slate-600">
                  {photoFile ? `Photo: ${photoFile.name}` : 'No photo selected'}
                </p>

                <button
                  type="button"
                  onClick={parsePhoto}
                  disabled={isParsing || !photoFile}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 md:w-auto md:min-w-[170px]"
                >
                  {isParsing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isParsing ? 'Parsing...' : 'Parse'}
                </button>

              </div>
            </div>
          </section>

              <section className="card-surface rounded-2xl p-6 md:p-8">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Editable Stocklist Layout</h2>
              <div className="flex w-full flex-col gap-1 sm:w-auto">
                <label htmlFor="paper-stock-date" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paper Date</label>
                <input
                  id="paper-stock-date"
                  type="date"
                  value={parsedData?.stock_date ?? ''}
                  onChange={(event) => updateParsedStockDate(event.target.value)}
                  disabled={!parsedData}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 sm:w-[190px]"
                />
              </div>
            </div>

            {!parsedData && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 mb-4">
                Showing the stocklist template from the active catalog before parsing.
              </div>
            )}

            <div className="space-y-6">
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-3">
                  <p>
                    <span className="font-semibold text-slate-700">Known items:</span> {parsedData?.total_items ?? indexedItems.length}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Unknown items:</span> {unknownItems.length}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Review required:</span> {reviewRequiredCount}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Mode:</span>{' '}
                    {parsedData ? (parsedData.mode === 'stock-closing' ? 'Stock-closing' : 'Stock-in') : 'Catalog preview'}
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

                <div className="stock-paper-wrap overflow-x-auto" ref={dataEntryPaperRef}>
                  <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Find In Stocklist</label>
                    <div ref={dataEntryFindContainerRef} className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={dataEntryFindTerm}
                        onChange={(event) => setDataEntryFindTerm(event.target.value)}
                        placeholder="Search official or stocklist name"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                      />

                      {dataEntryFindTerm.trim().length > 0 && (
                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                          {dataEntryFindSuggestions.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-slate-500">No matching items.</p>
                          ) : (
                            dataEntryFindSuggestions.map((entry) => (
                              <button
                                key={`entry-find-${entry.index}`}
                                type="button"
                                onClick={() => {
                                  focusAndHighlightDataEntry(entry.index)
                                  setDataEntryFindTerm('')
                                }}
                                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 last:border-b-0"
                              >
                                <p className="truncate font-medium">{entry.item.official_name}</p>
                                <p className="truncate text-xs text-slate-500">
                                  {'stocklist_name' in entry.item && entry.item.stocklist_name
                                    ? entry.item.stocklist_name
                                    : entry.item.product_raw}
                                </p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="stock-paper min-w-[820px]">
                    <div className="stock-date-row">
                      <span>DATE:</span>
                      <span className="stock-date-hand">{formatSheetDate(parsedData?.stock_date)}</span>
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
                                              data-entry-row-index={left.index}
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
                                              data-entry-row-index={left.index}
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
                                              data-entry-row-index={right.index}
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
                                              data-entry-row-index={right.index}
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
                                          data-entry-row-index={single.index}
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
                                          data-entry-row-index={single.index}
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
                                              data-entry-row-index={left.index}
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
                                              data-entry-row-index={left.index}
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
                                              data-entry-row-index={right.index}
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
                                              data-entry-row-index={right.index}
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
                                          data-entry-row-index={single.index}
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
                                          data-entry-row-index={single.index}
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
                            {outsideDisplayColumns.left.map((row) => (
                              <tr key={`outside-left-${row.index}`}>
                                <td className="stock-lbl">
                                  <input
                                    data-entry-row-index={row.index}
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
                                    data-entry-row-index={row.index}
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
                            {outsideDisplayColumns.middle.map((row) => (
                              <tr key={`outside-right-${row.index}`}>
                                <td className="stock-lbl">
                                  <input
                                    data-entry-row-index={row.index}
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
                                    data-entry-row-index={row.index}
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
                            {outsideDisplayColumns.right.map((row) => (
                              <tr key={`outside-single-${row.index}`}>
                                <td className="stock-lbl">
                                  <input
                                    data-entry-row-index={row.index}
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
                                    data-entry-row-index={row.index}
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
                                        data-entry-row-index={row.index}
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
                                        data-entry-row-index={row.index}
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
                                        data-entry-row-index={row.index}
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
                                        data-entry-row-index={row.index}
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
                                        data-entry-row-index={row.index}
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
                                        data-entry-row-index={row.index}
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

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={validateReviewedData}
                disabled={!parsedData || isSaving || isExporting}
                className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto"
              >
                {isValidatedByStaff ? 'Validated' : 'Validate'}
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!parsedData || !isValidatedByStaff || isExporting || isSaving}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 sm:w-auto"
              >
                {isExporting ? 'Exporting...' : 'Export CSV'}
              </button>
              <button
                type="button"
                onClick={saveToSnowflake}
                disabled={!parsedData || !isValidatedByStaff || isSaving || isExporting}
                className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300 sm:w-auto"
              >
                {isSaving ? 'Loading to DB...' : 'Load to DB'}
              </button>
            </div>
              </section>
            </div>
          )}
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
                const cat3 = 'XXX'
                const prod3 = 'NEW'
                const attr3 = 'STD'
                const newCode = `${cat3}-${prod3}-${attr3}`
                const newRow = { id: 0, code: newCode, location: '', sub_location: '', category: '', product: '', attribute: '', official_name: '', stocklist_name: '', navigation_guide: '', row_position: 'single' as const }
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

      <TranscriptionHistoryDialog
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={historyData}
        isLoading={isHistoryLoading}
        onRepush={reopushToSnowflake}
        isRepushing={isRepushing}
        selectedUid={selectedHistoryUid}
      />
    </main>
  )
}
