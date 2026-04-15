'use client'

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Database,
  Download,
  Eye,
  EyeOff,
  FileImage,
  Loader2,
  Save,
  Search,
  Settings,
  X,
  Plus
} from 'lucide-react'

import { CatalogManagementView } from './catalog/CatalogManagementView'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './components/CreateCatalogItemModal'
import { EmbeddedStockCheckPanel } from './components/EmbeddedStockCheckPanel'
import { EntryMethodToggle } from './components/EntryMethodToggle'
import { StockPaperCardSection, StockPaperSectionTable, StockPaperThreeColumnTable } from './components/StockPaperTables'
import type { SelectedStockCheckHistoryRecord } from './components/EmbeddedStockCheckPanel'
import { TranscriptionHistoryDialog } from './components/TranscriptionHistoryDialog'
import { filterVisibleCatalogItems } from '../lib/catalog-visibility'
import { formatSheetDate, normalizeInsideSectionLabel } from '../lib/stock-paper-utils'

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
  is_visible?: boolean
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

type HistoryCardBadge = {
  label: string
  className: string
}

type SidebarHistoryCardProps = {
  title: string
  timestamp: string
  badges: HistoryCardBadge[]
  selected?: boolean
  onClick: () => void
}

function formatSidebarHistoryDate(timestamp: string) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function SidebarHistoryCard({ title, timestamp, badges, selected = false, onClick }: SidebarHistoryCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${selected
          ? 'border-brand-500 bg-brand-50'
          : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
        }`}
    >
      <p className="truncate text-xs font-semibold text-slate-700">{title}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-slate-500">{formatSidebarHistoryDate(timestamp)}</p>
        <div className="flex items-center gap-1.5">
          {badges.map((badge) => (
            <span key={badge.label} className={badge.className}>
              {badge.label}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}

type IndexedItem = {
  item: StockItem
  index: number
  source: 'parsed' | 'missing' | 'unknown'
}

type HubSection = 'data-entry' | 'stock-check' | 'catalog'
type DataEntryMode = 'manual' | 'photo'
const DATA_ENTRY_MOBILE_VIEW_KEY = 'smartstock:data-entry-mobile-view'
const DATA_ENTRY_EXPANDED_SECTIONS_KEY = 'smartstock:data-entry-expanded-sections'
const OUTSIDE_SECTION_ID = 'outside-coolroom'
const UNKNOWN_SECTION_ID = 'unclassified-staff-inspection'

function toSectionId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function buildInsideSectionId(title: string) {
  return `inside-${toSectionId(title)}`
}

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

function buildManualParsedPayload(
  catalogItems: CatalogItem[] | null,
  stockMode: StockMode,
  stockDate: string,
): ParsedPayload {
  const items = (catalogItems ?? []).map((item) => ({
    catalog_code: item.code,
    product_raw: item.stocklist_name || item.official_name,
    location: item.location,
    sub_location: item.sub_location,
    category: item.category,
    product: item.product,
    attribute: item.attribute,
    official_name: item.official_name,
    stocklist_name: item.stocklist_name,
    navigation_guide: item.navigation_guide,
    quantity_raw: null,
    quantity: null,
    quantity_conflict_flag: false,
    row_position: item.row_position ?? 'single',
    confidence: 'high' as const,
    catalog_match_status: 'exact' as const,
    notes: null,
  }))

  return {
    photo_id: `manual-${crypto.randomUUID()}`,
    mode: stockMode,
    upload_date: new Date().toISOString(),
    stock_date: stockDate,
    photo_url: null,
    total_items: items.length,
    confidence_overall: 'high',
    items,
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
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const stockMode: StockMode = 'stock-in'
  const [activeSection, setActiveSection] = useState<HubSection>('data-entry')
  const [dataEntryMode, setDataEntryMode] = useState<DataEntryMode>('manual')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
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
  const [dataEntryNewItemName, setDataEntryNewItemName] = useState('')
  const [dataEntryCreatePrefillName, setDataEntryCreatePrefillName] = useState('')
  const [showCreateDataEntryItemModal, setShowCreateDataEntryItemModal] = useState(false)
  const [isDataEntryMobileViewport, setIsDataEntryMobileViewport] = useState(false)
  const [dataEntryMobileView, setDataEntryMobileView] = useState<'card' | 'paper'>('card')
  const [dataEntryExpandedSections, setDataEntryExpandedSections] = useState<Set<string>>(new Set())
  const [highlightedDataEntryIndex, setHighlightedDataEntryIndex] = useState<number | null>(null)
  const [stockCheckHistory, setStockCheckHistory] = useState<StockCheckHistoryEntry[]>([])
  const [isStockCheckHistoryLoading, setIsStockCheckHistoryLoading] = useState(false)
  const [stockCheckSearchTerm, setStockCheckSearchTerm] = useState('')
  const [stockCheckStatusFilter, setStockCheckStatusFilter] = useState<'all' | 'validated' | 'unvalidated'>('all')
  const [selectedStockCheckHistoryRecord, setSelectedStockCheckHistoryRecord] = useState<SelectedStockCheckHistoryRecord | null>(null)
  const [hasSavedToSupabase, setHasSavedToSupabase] = useState(false)
  const [hasLoadedToDb, setHasLoadedToDb] = useState(false)
  const [isValidatedByStaff, setIsValidatedByStaff] = useState(false)
  const dataEntryPaperRef = useRef<HTMLDivElement | null>(null)
  const dataEntryFindContainerRef = useRef<HTMLDivElement | null>(null)
  const dataEntryHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isManualEntryMode = dataEntryMode === 'manual'
  const visibleCatalog = useMemo(() => filterVisibleCatalogItems(activeCatalog), [activeCatalog])
  const visibleCatalogCodes = useMemo(
    () => new Set(visibleCatalog.map((item) => item.code.trim().toUpperCase())),
    [visibleCatalog]
  )
  const catalogVisibilityByCode = useMemo(() => {
    const map = new Map<string, boolean>()

    ;(activeCatalog ?? []).forEach((item) => {
      map.set(item.code.trim().toUpperCase(), item.is_visible !== false)
    })

    return map
  }, [activeCatalog])
  const dataEntryCreateCategories = useMemo(() => {
    const uniqueCategories = new Set(visibleCatalog.map((item) => item.category).filter((item) => item && item.trim().length > 0))
    return Array.from(uniqueCategories).sort()
  }, [visibleCatalog])

  const toggleCatalogItemVisibility = useCallback(async (code: string, nextVisible: boolean) => {
    const normalizedCode = code.trim().toUpperCase()
    const target = (activeCatalog ?? []).find((item) => item.code.trim().toUpperCase() === normalizedCode)

    if (!target) {
      return false
    }

    if (!nextVisible) {
      const confirmed = window.confirm(`Hide "${target.official_name}" from Stock In and Stock Check views?`)
      if (!confirmed) {
        return false
      }
    }

    const previousVisible = target.is_visible !== false

    setActiveCatalog((current) => {
      if (!current) return current

      return current.map((item) => {
        if (item.code.trim().toUpperCase() !== normalizedCode) {
          return item
        }

        return {
          ...item,
          is_visible: nextVisible,
        }
      })
    })

    try {
      const response = await fetch('/api/catalog/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...target,
          is_visible: nextVisible,
          row_position: target.row_position ?? 'single',
        }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to update item visibility.')
      }

      return true
    } catch (error) {
      setActiveCatalog((current) => {
        if (!current) return current

        return current.map((item) => {
          if (item.code.trim().toUpperCase() !== normalizedCode) {
            return item
          }

          return {
            ...item,
            is_visible: previousVisible,
          }
        })
      })

      throw error
    }
  }, [activeCatalog])

  async function loadCatalogFromApi() {
    const response = await fetch('/api/catalog')
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.error ?? 'Failed to load catalog data.')
    }

    const catalog = Array.isArray(data?.catalog) ? data.catalog : []
    setActiveCatalog(catalog.map((item: CatalogItem) => ({
      ...item,
      is_visible: item.is_visible ?? true,
    })))
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
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateMobileState = () => {
      const isMobile = mediaQuery.matches
      setIsDataEntryMobileViewport(isMobile)
      if (isMobile) {
        try {
          const stored = window.localStorage.getItem(DATA_ENTRY_MOBILE_VIEW_KEY)
          if (stored === 'card' || stored === 'paper') {
            setDataEntryMobileView(stored)
            return
          }
        } catch {
          // Ignore storage availability errors and use default.
        }

        setDataEntryMobileView('card')
      }
    }

    updateMobileState()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMobileState)
      return () => mediaQuery.removeEventListener('change', updateMobileState)
    }

    mediaQuery.addListener(updateMobileState)
    return () => mediaQuery.removeListener(updateMobileState)
  }, [])

  useEffect(() => {
    if (!isDataEntryMobileViewport || typeof window === 'undefined') return

    try {
      window.localStorage.setItem(DATA_ENTRY_MOBILE_VIEW_KEY, dataEntryMobileView)
    } catch {
      // Ignore storage availability errors.
    }
  }, [dataEntryMobileView, isDataEntryMobileViewport])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = window.localStorage.getItem(DATA_ENTRY_EXPANDED_SECTIONS_KEY)
      if (!stored) return

      const parsed = JSON.parse(stored)
      if (!Array.isArray(parsed)) return

      const keys = parsed.filter((entry): entry is string => typeof entry === 'string')
      setDataEntryExpandedSections(new Set(keys))
    } catch {
      // Ignore malformed local storage.
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(DATA_ENTRY_EXPANDED_SECTIONS_KEY, JSON.stringify(Array.from(dataEntryExpandedSections)))
    } catch {
      // Ignore storage availability errors.
    }
  }, [dataEntryExpandedSections])

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

      setActiveCatalog((Array.isArray(data.catalog) ? data.catalog : []).map((item: CatalogItem) => ({
        ...item,
        is_visible: item.is_visible ?? true,
      })))
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
      if (visibleCatalog.length === 0) return []

      return visibleCatalog.map((c_item, index) => ({
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
    const allItems = parsedData.items
      .filter((item) => {
        if (!item.catalog_code) return true
        return visibleCatalogCodes.has(item.catalog_code.trim().toUpperCase())
      })
      .map((item, index) => ({ item, index, source: 'parsed' as const }))

    // Inject Missing Catalog Items into their designated locations (amber text)
    // Use negative indices starting at -1000 to avoid collision with parsed items
    const missingItems = missingCatalogItems
      .filter((c_item) => visibleCatalogCodes.has(c_item.code.trim().toUpperCase()))
      .map((c_item, pos) => ({
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
  }, [missingCatalogItems, parsedData, unknownItems, visibleCatalog, visibleCatalogCodes])

  const paperSections = useMemo(() => {
    const insideRows = indexedItems.filter((row) => row.item.location === 'Inside Coolroom' && row.source !== 'unknown')

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
        id: buildInsideSectionId(label),
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

  const dataEntryCardSections = useMemo(() => {
    const sections = [
      ...paperSections.leftColumn.map((section) => ({
        id: section.id,
        title: section.title,
        items: [...section.rows.left, ...section.rows.right, ...section.rows.single],
      })),
      ...paperSections.rightColumn.map((section) => ({
        id: section.id,
        title: section.title,
        items: [...section.rows.left, ...section.rows.right, ...section.rows.single],
      })),
      {
        id: OUTSIDE_SECTION_ID,
        title: 'OUTSIDE COOLROOM',
        items: [...outsideDisplayColumns.left, ...outsideDisplayColumns.middle, ...outsideDisplayColumns.right],
      },
    ]

    const unknownItemsForCard = [
      ...paperSections.unknownRows.left,
      ...paperSections.unknownRows.right,
      ...paperSections.unknownRows.single,
    ]

    if (unknownItemsForCard.length > 0) {
      sections.push({
        id: UNKNOWN_SECTION_ID,
        title: 'UNCLASSIFIED / STAFF INSPECTION',
        items: unknownItemsForCard,
      })
    }

    return sections.filter((section) => section.items.length > 0)
  }, [outsideDisplayColumns.left, outsideDisplayColumns.middle, outsideDisplayColumns.right, paperSections.leftColumn, paperSections.rightColumn, paperSections.unknownRows.left, paperSections.unknownRows.right, paperSections.unknownRows.single])

  const dataEntryIndexToSectionId = useMemo(() => {
    const map = new Map<number, string>()

    paperSections.leftColumn.forEach((section) => {
      section.rows.left.forEach((item) => map.set(item.index, section.id))
      section.rows.right.forEach((item) => map.set(item.index, section.id))
      section.rows.single.forEach((item) => map.set(item.index, section.id))
    })

    paperSections.rightColumn.forEach((section) => {
      section.rows.left.forEach((item) => map.set(item.index, section.id))
      section.rows.right.forEach((item) => map.set(item.index, section.id))
      section.rows.single.forEach((item) => map.set(item.index, section.id))
    })

    outsideDisplayColumns.left.forEach((item) => map.set(item.index, OUTSIDE_SECTION_ID))
    outsideDisplayColumns.middle.forEach((item) => map.set(item.index, OUTSIDE_SECTION_ID))
    outsideDisplayColumns.right.forEach((item) => map.set(item.index, OUTSIDE_SECTION_ID))

    paperSections.unknownRows.left.forEach((item) => map.set(item.index, UNKNOWN_SECTION_ID))
    paperSections.unknownRows.right.forEach((item) => map.set(item.index, UNKNOWN_SECTION_ID))
    paperSections.unknownRows.single.forEach((item) => map.set(item.index, UNKNOWN_SECTION_ID))

    return map
  }, [outsideDisplayColumns.left, outsideDisplayColumns.middle, outsideDisplayColumns.right, paperSections.leftColumn, paperSections.rightColumn, paperSections.unknownRows.left, paperSections.unknownRows.right, paperSections.unknownRows.single])

  const isDataEntrySectionCollapsed = useCallback((sectionId: string) => {
    return !dataEntryExpandedSections.has(sectionId)
  }, [dataEntryExpandedSections])

  const dataEntrySectionIds = useMemo(() => {
    const ids = new Set<string>()

    paperSections.leftColumn.forEach((section) => ids.add(section.id))
    paperSections.rightColumn.forEach((section) => ids.add(section.id))
    ids.add(OUTSIDE_SECTION_ID)

    if (
      paperSections.unknownRows.left.length > 0
      || paperSections.unknownRows.right.length > 0
      || paperSections.unknownRows.single.length > 0
    ) {
      ids.add(UNKNOWN_SECTION_ID)
    }

    return Array.from(ids)
  }, [paperSections.leftColumn, paperSections.rightColumn, paperSections.unknownRows.left.length, paperSections.unknownRows.right.length, paperSections.unknownRows.single.length])

  const toggleDataEntrySection = useCallback((sectionId: string) => {
    setDataEntryExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }, [])

  const expandAllDataEntrySections = useCallback(() => {
    setDataEntryExpandedSections(new Set(dataEntrySectionIds))
  }, [dataEntrySectionIds])

  const collapseAllDataEntrySections = useCallback(() => {
    setDataEntryExpandedSections(new Set())
  }, [])

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

  const existingKnownCodes = useMemo(() => {
    const codes = new Set<string>()

    parsedData?.items.forEach((item) => {
      if (item.catalog_code) {
        codes.add(item.catalog_code.trim().toUpperCase())
      }
    })

    missingCatalogItems.forEach((item) => {
      codes.add(item.code.trim().toUpperCase())
    })

    return codes
  }, [missingCatalogItems, parsedData])

  const dataEntryAddSuggestions = useMemo(() => {
    const term = dataEntryNewItemName.trim().toLowerCase()
    if (!term) return []

    return visibleCatalog
      .filter((item) => {
        const code = item.code.trim().toUpperCase()
        if (existingKnownCodes.has(code)) return false

        return (
          item.official_name.toLowerCase().includes(term)
          || item.stocklist_name.toLowerCase().includes(term)
          || item.product.toLowerCase().includes(term)
        )
      })
      .slice(0, 6)
  }, [dataEntryNewItemName, existingKnownCodes, visibleCatalog])

  const updateParsedStockDate = useCallback((value: string) => {
    if (!isIsoDate(value)) return

    setParsedData((current) => {
      if (!current) return current
      return {
        ...current,
        stock_date: value,
      }
    })

    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
  }, [])

  const addKnownDataEntryItem = useCallback((catalogItem: CatalogItem) => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before adding items.')
      return
    }

    const codeKey = catalogItem.code.trim().toUpperCase()
    if (existingKnownCodes.has(codeKey)) {
      setApiStatus(`${catalogItem.official_name} is already in the table.`)
      setApiError(null)
      setDataEntryNewItemName('')
      return
    }

    setParsedData((current) => {
      if (!current) return current

      return {
        ...current,
        items: [
          ...current.items,
          {
            catalog_code: catalogItem.code,
            product_raw: catalogItem.stocklist_name || catalogItem.official_name,
            location: catalogItem.location,
            sub_location: catalogItem.sub_location,
            category: catalogItem.category,
            product: catalogItem.product,
            attribute: catalogItem.attribute,
            official_name: catalogItem.official_name,
            stocklist_name: catalogItem.stocklist_name,
            navigation_guide: catalogItem.navigation_guide,
            quantity_raw: null,
            quantity: null,
            quantity_conflict_flag: false,
            row_position: catalogItem.row_position ?? 'single',
            confidence: 'high',
            catalog_match_status: 'exact',
            notes: null,
          },
        ],
        total_items: current.items.length + 1,
      }
    })

    setDataEntryNewItemName('')
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus(`Added ${catalogItem.official_name} from catalog.`)
  }, [existingKnownCodes, parsedData])

  const openDataEntryCreateItemModal = useCallback(() => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before adding items.')
      return
    }

    const trimmed = dataEntryNewItemName.trim()
    if (!trimmed) {
      setApiError('Enter item name first, then click Create new Item.')
      return
    }

    setDataEntryCreatePrefillName(trimmed)
    setShowCreateDataEntryItemModal(true)
    setApiError(null)
  }, [dataEntryNewItemName, parsedData])

  const addCreatedDataEntryItem = useCallback((created: CreateCatalogItemPayload) => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before creating items.')
      return
    }

    const codeKey = created.code.trim().toUpperCase()
    if (existingKnownCodes.has(codeKey)) {
      setApiStatus(`${created.official_name} is already in the table.`)
      setApiError(null)
      setShowCreateDataEntryItemModal(false)
      return
    }

    const createdCatalogItem: CatalogItem = {
      id: Date.now(),
      code: created.code,
      location: created.location,
      sub_location: created.sub_location,
      category: created.category,
      product: created.product,
      attribute: created.attribute,
      official_name: created.official_name,
      stocklist_name: created.stocklist_name,
      navigation_guide: created.navigation_guide,
      row_position: created.row_position,
      is_visible: created.is_visible,
    }

    setActiveCatalog((current) => {
      if (!current) return [createdCatalogItem]

      const exists = current.some((item) => item.code.trim().toUpperCase() === codeKey)
      if (exists) return current

      return [...current, createdCatalogItem]
    })

    setParsedData((current) => {
      if (!current) return current

      return {
        ...current,
        items: [
          ...current.items,
          {
            catalog_code: created.code,
            product_raw: created.stocklist_name || created.official_name,
            location: created.location,
            sub_location: created.sub_location,
            category: created.category,
            product: created.product,
            attribute: created.attribute,
            official_name: created.official_name,
            stocklist_name: created.stocklist_name,
            navigation_guide: created.navigation_guide,
            quantity_raw: null,
            quantity: null,
            quantity_conflict_flag: false,
            row_position: created.row_position ?? 'single',
            confidence: 'high',
            catalog_match_status: 'exact',
            notes: null,
          },
        ],
        total_items: current.items.length + 1,
      }
    })

    setShowCreateDataEntryItemModal(false)
    setDataEntryCreatePrefillName('')
    setDataEntryNewItemName('')
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus(`Created and added ${created.official_name} immediately.`)
  }, [existingKnownCodes, parsedData])

  const startManualEntry = useCallback(() => {
    const manualDraft = buildManualParsedPayload(visibleCatalog, stockMode, today)

    setDataEntryMode('manual')
    setPhotoFile(null)
    setParsedData(manualDraft)
    setUnknownItems([])
    setMissingCatalogItems([])
    setLatestGenerateUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus('Manual entry is ready. Enter quantities directly, then save to Supabase.')
  }, [visibleCatalog, today])

  const startPhotoEntry = useCallback(() => {
    setDataEntryMode('photo')
    setPhotoFile(null)
    setParsedData(null)
    setUnknownItems([])
    setMissingCatalogItems([])
    setLatestGenerateUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus('Photo parsing mode selected. Upload an image to generate stock-in lines.')
  }, [])

  useEffect(() => {
    if (!isManualEntryMode || visibleCatalog.length === 0) return

    setParsedData((current) => {
      if (!current) {
        return buildManualParsedPayload(visibleCatalog, stockMode, today)
      }

      return current
    })
  }, [visibleCatalog, isManualEntryMode, stockMode, today])

  const focusAndHighlightDataEntry = useCallback((index: number) => {
    setActiveSection('data-entry')

    const sectionId = dataEntryIndexToSectionId.get(index)
    if (sectionId) {
      setDataEntryExpandedSections((current) => {
        if (current.has(sectionId)) return current
        const next = new Set(current)
        next.add(sectionId)
        return next
      })
    }

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
  }, [dataEntryIndexToSectionId])

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

    setDataEntryMode('photo')
    setIsParsing(true)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus(null)

    try {
      const formData = new FormData()
      formData.append('photo', photoFile)
      formData.append('mode', stockMode)
      if (visibleCatalog.length > 0) {
        formData.append('catalog', JSON.stringify(visibleCatalog))
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
      setHasSavedToSupabase(false)

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
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)

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

  function getCardClasses(row: IndexedItem | undefined) {
    if (!row) return ''
    if (row.index === highlightedDataEntryIndex) return 'ring-2 ring-emerald-400 bg-emerald-50'
    if (row.source === 'missing') return 'border-amber-300 bg-amber-50'
    if (row.source === 'unknown') return 'border-red-300 bg-red-50'
    return ''
  }

  function renderDataEntryLabelCell(row: IndexedItem, className: string) {
    const code = row.item.catalog_code?.trim().toUpperCase() ?? ''
    const canToggleVisibility = code.length > 0 && catalogVisibilityByCode.has(code)
    const isVisible = canToggleVisibility ? (catalogVisibilityByCode.get(code) ?? true) : true

    return (
      <div className="flex items-center gap-1">
        <input
          data-entry-row-index={row.index}
          className={getClasses(row, className)}
          value={row.item.official_name ?? row.item.product_raw}
          readOnly
          onChange={(event) =>
            updateItem(row.index, { official_name: event.target.value })
          }
        />
        {canToggleVisibility && (
          <button
            type="button"
            aria-label={isVisible ? 'Hide item' : 'Show item'}
            title={isVisible ? 'Hide item' : 'Show item'}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700"
            onClick={(event) => {
              event.stopPropagation()
              void toggleCatalogItemVisibility(code, !isVisible).catch((error) => {
                setApiError(error instanceof Error ? error.message : 'Failed to update visibility.')
              })
            }}
          >
            {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    )
  }

  function renderDataEntryQuantityCell(row: IndexedItem) {
    return (
      <input
        type="number"
        data-entry-row-index={row.index}
        className={getClasses(row, 'stock-qty-input')}
        aria-label={`Quantity for ${row.item.official_name}`}
        value={row.item.quantity ?? ''}
        onChange={(event) =>
          updateItem(row.index, toQuantityPatch(event.target.value))
        }
      />
    )
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
      const filteredItems = parsedData.items.filter((item) => {
        if (!item.catalog_code) return true
        return visibleCatalogCodes.has(item.catalog_code.trim().toUpperCase())
      })
      const filteredMissingCatalogItems = missingCatalogItems.filter((item) => visibleCatalogCodes.has(item.code.trim().toUpperCase()))

      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsedData,
          items: filteredItems,
          unknown_items: unknownItems,
          missing_catalog_items: filteredMissingCatalogItems,
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

  async function saveToSupabase() {
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
          validated: isValidatedByStaff ? 'yes' : 'no',
          unknown_items: unknownItems,
          missing_catalog_items: missingCatalogItems,
          uid_generate: latestGenerateUid ?? undefined,
          persist_only: true,
        }),
      })

      const payload = await response.json()

      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before saving to Supabase.')
      }

      if (!response.ok) {
        const details = payload?.details
        const detailsText = typeof details === 'string' ? details : details ? JSON.stringify(details) : ''
        throw new Error(
          detailsText
            ? `${payload?.error ?? 'Supabase save failed.'} Details: ${detailsText}`
            : payload?.error ?? 'Supabase save failed.'
        )
      }

      setApiStatus(
        `${payload?.message ?? 'Saved to Supabase.'} ${payload?.uid_generate ? `UID: ${payload.uid_generate}.` : ''}`.trim()
      )
      if (typeof payload?.uid_generate === 'string' && payload.uid_generate.length > 0) {
        setLatestGenerateUid(payload.uid_generate)
      }
      setHasSavedToSupabase(true)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected Supabase save error.')
    } finally {
      setIsSaving(false)
    }
  }

  async function loadToSnowflake() {
    if (!parsedData) {
      setApiError('No parsed data to load yet. Parse a stock photo first.')
      return
    }

    if (!latestGenerateUid) {
      setApiError('No transcription record is available yet. Parse a stock photo first.')
      return
    }

    if (!hasSavedToSupabase) {
      setApiError('Please save to Supabase first, then load the latest draft to Snowflake.')
      return
    }

    if (!isValidatedByStaff) {
      setApiError('Please click Validate first. Load to Snowflake is only enabled after staff validation.')
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
  const isStockCheckTab = activeSection === 'stock-check'
  const showSidebarHistory = activeSection !== 'catalog'

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
      setApiStatus(`Validated by staff. Blank known quantities were normalized to 0. ${conflictCount} known item(s) are still marked as conflict, but Export CSV and Load to Snowflake are enabled.`)
    } else {
      setApiStatus('Validated by staff. Blank known quantities were normalized to 0. Export CSV and Load to Snowflake are now enabled.')
    }
    setIsValidatedByStaff(true)
  }

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
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${activeSection === 'data-entry'
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
                }`}
            >
              <FileImage className="h-4 w-4" />
              Stock In
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('stock-check')}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${activeSection === 'stock-check'
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
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${activeSection === 'catalog'
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                <Database className="h-4 w-4" />
                Catalog
              </button>
            </div>
          </nav>

          {showSidebarHistory && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 md:mt-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {isStockCheckTab ? 'Stock Check Record' : 'Stock In History'}
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
                      const modeLabel = entry.mode === 'closing_check' ? 'Closing' : entry.mode || 'Unknown'

                      return (
                        <SidebarHistoryCard
                          key={entry.uid_stock_check}
                          title={`${entry.stock_date} (${entry.item_count} items)`}
                          timestamp={entry.timestamp}
                          selected={isSelected}
                          onClick={() => {
                            setSelectedStockCheckHistoryRecord(entry)
                          }}
                          badges={[
                            {
                              label: modeLabel,
                              className: 'rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700',
                            },
                            {
                              label: entry.validated ? 'Validated' : 'Unvalidated',
                              className: `rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.validated
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-amber-100 text-amber-700'
                                }`,
                            },
                          ]}
                        />
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
                  {sidebarDataEntryHistory.map((entry) => {
                    const modeLabel = entry.stockMode === 'stock-closing' ? 'Closing' : 'Arrival'

                    return (
                      <SidebarHistoryCard
                        key={entry.uid_generate}
                        title={entry.filename}
                        timestamp={entry.timestamp}
                        selected={selectedHistoryUid === entry.uid_generate}
                        onClick={() => {
                          void openHistory(entry.uid_generate)
                        }}
                        badges={[
                          {
                            label: modeLabel,
                            className: 'rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700',
                          },
                          {
                            label: entry.isPushed ? 'Pushed' : 'Pending',
                            className: `rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.isPushed
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                              }`,
                          },
                        ]}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </aside>

        <div className="flex-1">
          {activeSection === 'catalog' ? (
            <CatalogManagementView embedded />
          ) : activeSection === 'stock-check' ? (
            <EmbeddedStockCheckPanel
              catalogItems={visibleCatalog}
              selectedHistoryRecord={selectedStockCheckHistoryRecord}
              historyRecords={stockCheckHistory}
              onToggleCatalogVisibility={toggleCatalogItemVisibility}
            />
          ) : (
            <div className="space-y-4">
              <section className="card-surface rounded-2xl p-6 pb-24 md:p-8 md:pb-8">
                <div className="mb-4">
                  <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Stock In</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Stock In is for stock-in input. For stock-closing (manual or parse from photo), use Check Stock.
                  </p>
                </div>

                <div className="grid gap-4">
                  <EntryMethodToggle
                    value={isManualEntryMode ? 'manual' : 'photo'}
                    onManual={startManualEntry}
                    onPhoto={startPhotoEntry}
                    manualHelpText="Manual entry is active. Adjust stock-in quantities directly in the paper view."
                    photoHelpText="Photo entry is active. Choose a stock-in photo and parse it into the same paper layout."
                  />

                  {!isManualEntryMode && (
                    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-center transition hover:border-brand-500 md:p-5">
                      <p className="text-sm text-slate-500">JPEG / PNG, max 5MB</p>

                      <p className="mt-3 text-xs text-slate-500">Parse photo, review quantities in the table, then Validate, Save, and Load.</p>

                      <>
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
                          className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 md:w-auto"
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
                          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 md:w-auto md:min-w-[170px]"
                        >
                          {isParsing && <Loader2 className="h-4 w-4 animate-spin" />}
                          {isParsing ? 'Parsing...' : 'Parse'}
                        </button>
                      </>
                    </div>
                  )}
                </div>
              </section>

              <section className="card-surface rounded-2xl p-6 md:p-8">
                <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <h2 className="text-xl font-semibold text-slate-900">Editable Stocklist Layout</h2>
                  <div className="flex w-full flex-col gap-1 sm:w-auto">
                    <label htmlFor="paper-stock-date" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paper Date</label>
                    <input
                      id="paper-stock-date"
                      type="date"
                      value={parsedData?.stock_date ?? ''}
                      onChange={(event) => updateParsedStockDate(event.target.value)}
                      disabled={!parsedData}
                      className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 sm:w-[190px]"
                    />
                  </div>
                </div>

                <div className="mobile-sticky-add mb-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <div className="relative">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Add Data</label>
                      <input
                        type="text"
                        value={dataEntryNewItemName}
                        onChange={(event) => setDataEntryNewItemName(event.target.value)}
                        placeholder="Type to match catalog or add as new"
                        disabled={!parsedData}
                        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                      />

                      {dataEntryNewItemName.trim().length > 0 && dataEntryAddSuggestions.length > 0 && parsedData && (
                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                          {dataEntryAddSuggestions.map((item) => (
                            <button
                              key={item.code}
                              type="button"
                              onClick={() => addKnownDataEntryItem(item)}
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
                      onClick={openDataEntryCreateItemModal}
                      disabled={!parsedData || dataEntryNewItemName.trim().length === 0}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus className="h-4 w-4" />
                      Create new Item
                    </button>
                  </div>

                  <div ref={dataEntryFindContainerRef} className="relative">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Find In Stocklist</label>
                    <Search className="pointer-events-none absolute left-3 top-8 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={dataEntryFindTerm}
                      onChange={(event) => setDataEntryFindTerm(event.target.value)}
                      placeholder="Search official or stocklist name"
                      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                    />

                    {dataEntryFindTerm.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDataEntryFindTerm('')}
                        aria-label="Clear stocklist search"
                        className="absolute right-2 top-8 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {dataEntryFindTerm.trim().length > 0 && (
                      <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
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

                <div className="space-y-6">
                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-[1fr_auto] md:items-start">
                    <p>
                      <span className="font-semibold text-slate-700">Mode:</span>{' '}
                      {parsedData ? 'Stock-in' : 'Catalog preview'}
                    </p>
                    <details className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
                      <summary className="cursor-pointer select-none font-semibold text-slate-700">Details</summary>
                      <p className="mt-1.5">
                        <span className="font-semibold">UID_generate:</span> {latestGenerateUid ?? 'Not generated yet'}
                      </p>
                    </details>
                  </div>

                  {isDataEntryMobileViewport && (
                    <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 md:hidden">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Mobile View</span>
                      <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                        <button
                          type="button"
                          onClick={() => setDataEntryMobileView('card')}
                          className={`rounded px-3 py-1.5 text-xs font-semibold ${dataEntryMobileView === 'card' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}
                        >
                          Card
                        </button>
                        <button
                          type="button"
                          onClick={() => setDataEntryMobileView('paper')}
                          className={`rounded px-3 py-1.5 text-xs font-semibold ${dataEntryMobileView === 'paper' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}
                        >
                          Paper
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mb-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={expandAllDataEntrySections}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={collapseAllDataEntrySections}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Collapse all
                    </button>
                  </div>

                  <div className="stock-paper-wrap overflow-x-auto" ref={dataEntryPaperRef}>

                    {isDataEntryMobileViewport && dataEntryMobileView === 'card' ? (
                      <div className="space-y-3 md:hidden">
                        {dataEntryCardSections.map((section) => (
                          <StockPaperCardSection
                            key={`data-entry-card-${section.id}`}
                            title={section.title}
                            items={section.items}
                            keyPrefix="data-entry-mobile"
                            isCollapsed={isDataEntrySectionCollapsed(section.id)}
                            onToggleCollapse={() => toggleDataEntrySection(section.id)}
                            getCardClass={(index) => getCardClasses(indexedItems.find((item) => item.index === index))}
                            onPressRow={(item) => focusAndHighlightDataEntry(item.index)}
                            renderLabelCell={renderDataEntryLabelCell}
                            renderQuantityCell={renderDataEntryQuantityCell}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="stock-paper min-w-[820px]">
                        <div className="stock-date-row">
                          <span>DATE:</span>
                          <span className="stock-date-hand">{formatSheetDate(parsedData?.stock_date)}</span>
                        </div>

                        <div className="stock-sec-hdr">INSIDE COOLROOM</div>
                        <div className="stock-inside-grid">
                          <div className="stock-col stock-col-left">
                            {paperSections.leftColumn.map((section) => (
                              <StockPaperSectionTable
                                key={section.id}
                                section={section}
                                keyPrefix="data-entry-left"
                                isCollapsed={isDataEntrySectionCollapsed(section.id)}
                                onToggleCollapse={() => toggleDataEntrySection(section.id)}
                                renderLabelCell={renderDataEntryLabelCell}
                                renderQuantityCell={renderDataEntryQuantityCell}
                              />
                            ))}
                          </div>

                          <div className="stock-col">
                            {paperSections.rightColumn.map((section) => (
                              <StockPaperSectionTable
                                key={section.id}
                                section={section}
                                keyPrefix="data-entry-right"
                                isCollapsed={isDataEntrySectionCollapsed(section.id)}
                                onToggleCollapse={() => toggleDataEntrySection(section.id)}
                                renderLabelCell={renderDataEntryLabelCell}
                                renderQuantityCell={renderDataEntryQuantityCell}
                              />
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="stock-sec-hdr stock-sec-hdr-btn"
                          onClick={() => toggleDataEntrySection(OUTSIDE_SECTION_ID)}
                          aria-expanded={!isDataEntrySectionCollapsed(OUTSIDE_SECTION_ID)}
                        >
                          <span>OUTSIDE COOLROOM</span>
                          <span className="stock-collapse-indicator" aria-hidden="true">{isDataEntrySectionCollapsed(OUTSIDE_SECTION_ID) ? '+' : '-'}</span>
                        </button>
                        {!isDataEntrySectionCollapsed(OUTSIDE_SECTION_ID) && (
                          <StockPaperThreeColumnTable
                            columns={outsideDisplayColumns}
                            keyPrefix="data-entry-outside"
                            renderLabelCell={renderDataEntryLabelCell}
                            renderQuantityCell={renderDataEntryQuantityCell}
                          />
                        )}

                        {(paperSections.unknownRows.left.length > 0
                          || paperSections.unknownRows.right.length > 0
                          || paperSections.unknownRows.single.length > 0) && (
                            <>
                              <button
                                type="button"
                                className="stock-sec-hdr stock-sec-hdr-btn !bg-red-900 !text-white"
                                onClick={() => toggleDataEntrySection(UNKNOWN_SECTION_ID)}
                                aria-expanded={!isDataEntrySectionCollapsed(UNKNOWN_SECTION_ID)}
                              >
                                <span>UNCLASSIFIED / STAFF INSPECTION</span>
                                <span className="stock-collapse-indicator" aria-hidden="true">{isDataEntrySectionCollapsed(UNKNOWN_SECTION_ID) ? '+' : '-'}</span>
                              </button>
                              {!isDataEntrySectionCollapsed(UNKNOWN_SECTION_ID) && (
                                <StockPaperThreeColumnTable
                                  columns={{
                                    left: paperSections.unknownRows.left,
                                    middle: paperSections.unknownRows.right,
                                    right: paperSections.unknownRows.single,
                                  }}
                                  keyPrefix="data-entry-unknown"
                                  renderLabelCell={renderDataEntryLabelCell}
                                  renderQuantityCell={renderDataEntryQuantityCell}
                                />
                              )}
                            </>
                          )}
                      </div>
                    )}
                  </div>
                </div>

                {apiError && (
                  <FeedbackBanner
                    tone="error"
                    title="Stock update did not complete"
                    message={apiError}
                    detail="Check the current record, save again if needed, and then retry the Snowflake load."
                  />
                )}

                {apiStatus && (
                  <FeedbackBanner
                    tone="success"
                    title="Stock record updated"
                    message={apiStatus}
                    detail="The current draft was saved and can still be edited before the final Snowflake load."
                  />
                )}

                <div className="mobile-sticky-actions mt-5 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={validateReviewedData}
                    disabled={!parsedData || isSaving || isExporting}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto"
                  >
                    {isValidatedByStaff ? 'Validated' : 'Validate'}
                  </button>
                  <button
                    type="button"
                    onClick={saveToSupabase}
                    disabled={!parsedData || !isValidatedByStaff || isSaving || isExporting}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSaving ? 'Saving...' : hasSavedToSupabase ? 'Saved to Supabase' : 'Save to Supabase'}
                  </button>
                  <button
                    type="button"
                    onClick={exportCsv}
                    disabled={!parsedData || !isValidatedByStaff || isExporting || isSaving}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 sm:w-auto"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {isExporting ? 'Exporting...' : 'Export CSV'}
                  </button>
                  <button
                    type="button"
                    onClick={loadToSnowflake}
                    disabled={!parsedData || !isValidatedByStaff || !hasSavedToSupabase || isSaving || isExporting}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300 sm:w-auto"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                    {isSaving ? 'Loading to Snowflake...' : 'Load to Snowflake'}
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
                    <th className="pb-2 font-medium pl-2">Visible</th>
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
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={item.is_visible !== false}
                            onChange={(e) => { const c = [...activeCatalog]; c[index].is_visible = e.target.checked; setActiveCatalog(c); setCatalogSource('edited') }}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span>{item.is_visible !== false ? 'Visible' : 'Hidden'}</span>
                        </label>
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
                const newRow = { id: 0, code: newCode, location: '', sub_location: '', category: '', product: '', attribute: '', official_name: '', stocklist_name: '', navigation_guide: '', row_position: 'single' as const, is_visible: true }
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

      <CreateCatalogItemModal
        isOpen={showCreateDataEntryItemModal}
        initialName={dataEntryCreatePrefillName}
        categories={dataEntryCreateCategories}
        existingCodes={visibleCatalogCodes}
        onClose={() => {
          setShowCreateDataEntryItemModal(false)
          setDataEntryCreatePrefillName('')
        }}
        onCreated={addCreatedDataEntryItem}
      />

      <TranscriptionHistoryDialog
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={historyData}
        isLoading={isHistoryLoading}
        onRepush={reopushToSnowflake}
        isRepushing={isRepushing}
        selectedUid={selectedHistoryUid}
        visibleCatalogCodes={visibleCatalogCodes}
      />
    </main>
  )
}
