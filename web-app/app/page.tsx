'use client'

import { useMemo, useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import {
  BarChart3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileImage,
  History,
  Loader2,
  Save,
  Search,
  Settings,
  X,
  Plus
} from 'lucide-react'

import { DashboardPanel } from './components/DashboardPanel'
import { CatalogManagementView } from './catalog/CatalogManagementView'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './components/CreateCatalogItemModal'
import { EmbeddedStockCheckPanel } from './components/EmbeddedStockCheckPanel'
import { EntryMethodToggle } from './components/EntryMethodToggle'
import { StockPaperCardSection, StockPaperSectionTable, StockPaperThreeColumnTable } from './components/StockPaperTables'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SectionLandingState } from './components/SectionLandingState'
import type { SelectedStockCheckHistoryRecord } from './components/EmbeddedStockCheckPanel'
import { StockCheckHistoryDialog } from './components/StockCheckHistoryDialog'
import { TranscriptionHistoryDialog } from './components/TranscriptionHistoryDialog'
import { filterVisibleCatalogItems } from '../lib/catalog-visibility'
import {
  clearOfflineDraft,
  enqueueOfflineRequest,
  getOfflineDraftAge,
  getPendingOfflineCountByFeature,
  getPendingOfflineCount,
  hasOfflineDraft,
  isNetworkRequestError,
  loadOfflineDraft,
  saveOfflineDraft,
  subscribeOfflineDraftUpdates,
  subscribeOfflineQueueUpdates,
  syncOfflineQueue,
} from '../lib/offline/queue'
import { formatSheetDate, normalizeInsideSectionLabel } from '../lib/stock-paper-utils'
import { STATUS } from '../lib/status-messages'

function shouldSilenceOfflineNetworkError(error: unknown) {
  if (typeof window === 'undefined' || window.navigator.onLine) {
    return false
  }

  return isNetworkRequestError(error)
}

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
  record_name?: string | null
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

type AppToast = {
  id: number
  tone: 'success' | 'error'
  message: string
}

type StockInOfflineDraft = {
  dataEntryMode: DataEntryMode
  parsedData: ParsedPayload
  unknownItems: UnknownItem[]
  missingCatalogItems: CatalogItem[]
  latestGenerateUid: string | null
  editingHistoryUid: string | null
  isValidatedByStaff: boolean
  hasSavedToSupabase: boolean
  hasLoadedToDb: boolean
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
      className={`w-full min-h-11 rounded-lg border px-2.5 py-2 text-left transition ${selected
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

type HubSection = 'data-entry' | 'stock-check' | 'dashboard' | 'catalog'
type DataEntryMode = 'manual' | 'photo'
type InlineCreateItemForm = {
  official_name: string
  stocklist_name: string
  product: string
  category: string
  location: 'Inside Coolroom' | 'Outside Coolroom'
  sub_location: string
  attribute: string
}
const DATA_ENTRY_MOBILE_VIEW_KEY = 'smartstock:data-entry-mobile-view'
const DATA_ENTRY_EXPANDED_SECTIONS_KEY = 'smartstock:data-entry-expanded-sections'
const OUTSIDE_SECTION_ID = 'outside-coolroom'
const UNKNOWN_SECTION_ID = 'unclassified-staff-inspection'
const AUTO_EXPAND_SECTION_ROW_LIMIT = 20
const INSIDE_SUB_LOCATION_OPTIONS = ['Apples', 'Citrus', 'Asian', 'Melon', 'All Year', 'Seasonal', 'Stonefruit'] as const
const OUTSIDE_SUB_LOCATION_OPTIONS = ['Outside Coolroom'] as const

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

function generateCatalogCode(category: string, product: string, attribute: string) {
  const cat3 = (category || 'OTH').toUpperCase().slice(0, 3)
  const prod3 = (product || 'NEW').toUpperCase().slice(0, 3)
  const attr3 = attribute ? attribute.toUpperCase().slice(0, 3) : 'STD'
  return `${cat3}-${prod3}-${attr3}`
}

function parseWholeQuantity(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) return null
  return parsed
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

function mapHistoryEntryToEditablePayload(entry: HistoryEntry, fallbackDate: string): {
  parsedData: ParsedPayload
  unknownItems: UnknownItem[]
} | null {
  if (!entry.transcriptionData || typeof entry.transcriptionData !== 'object') {
    return null
  }

  const root = entry.transcriptionData as Record<string, unknown>
  const rawItems = Array.isArray(root.items) ? root.items : []

  const items: StockItem[] = []
  const unknownItems: UnknownItem[] = []

  rawItems.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return

    const row = raw as Record<string, unknown>
    const catalogCode = typeof row.catalog_code === 'string' && row.catalog_code.trim().length > 0
      ? row.catalog_code.trim()
      : null
    const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity)
      ? row.quantity
      : null
    const quantityRaw = typeof row.quantity_raw === 'string'
      ? row.quantity_raw
      : quantity === null
        ? null
        : String(quantity)

    const normalizedRow: StockItem = {
      catalog_code: catalogCode,
      product_raw: typeof row.product_raw === 'string' ? row.product_raw : (typeof row.official_name === 'string' ? row.official_name : ''),
      category: typeof row.category === 'string' ? row.category : 'Unknown',
      location: typeof row.location === 'string' ? row.location : 'Unknown',
      sub_location: typeof row.sub_location === 'string' ? row.sub_location : 'Unknown',
      product: typeof row.product === 'string' ? row.product : (typeof row.official_name === 'string' ? row.official_name : ''),
      attribute: typeof row.attribute === 'string' ? row.attribute : '',
      official_name: typeof row.official_name === 'string' ? row.official_name : (typeof row.product_raw === 'string' ? row.product_raw : ''),
      stocklist_name: typeof row.stocklist_name === 'string' ? row.stocklist_name : undefined,
      navigation_guide: typeof row.navigation_guide === 'string' ? row.navigation_guide : undefined,
      quantity_raw: quantityRaw,
      quantity,
      quantity_conflict_flag: Boolean(row.quantity_conflict_flag),
      row_position: row.row_position === 'left' || row.row_position === 'right' || row.row_position === 'single'
        ? row.row_position
        : 'single',
      confidence: row.confidence === 'high' || row.confidence === 'medium' || row.confidence === 'low'
        ? row.confidence
        : 'high',
      catalog_match_status: row.catalog_match_status === 'exact' || row.catalog_match_status === 'fuzzy' || row.catalog_match_status === 'unknown'
        ? row.catalog_match_status
        : undefined,
      notes: typeof row.notes === 'string' ? row.notes : null,
    }

    items.push(normalizedRow)

    if (!catalogCode) {
      unknownItems.push({
        catalog_code: null,
        product_raw: normalizedRow.product_raw,
        category: normalizedRow.category,
        location: normalizedRow.location,
        sub_location: normalizedRow.sub_location,
        product: normalizedRow.product,
        attribute: normalizedRow.attribute,
        official_name: normalizedRow.official_name,
        quantity_raw: normalizedRow.quantity_raw,
        quantity: normalizedRow.quantity,
        quantity_conflict_flag: normalizedRow.quantity_conflict_flag,
        row_position: normalizedRow.row_position,
        confidence: normalizedRow.confidence,
        catalog_match_status: 'unknown',
      })
    }
  })

  const stockDate = typeof root.stock_date === 'string' && isIsoDate(root.stock_date) ? root.stock_date : fallbackDate
  const uploadDate = typeof root.upload_date === 'string' ? root.upload_date : new Date().toISOString()
  const mode: StockMode = root.mode === 'stock-closing' ? 'stock-closing' : 'stock-in'

  return {
    parsedData: {
      photo_id: typeof root.photo_id === 'string' && root.photo_id.length > 0 ? root.photo_id : `history-${entry.uid_generate}`,
      mode,
      upload_date: uploadDate,
      stock_date: stockDate,
      photo_url: typeof root.photo_url === 'string' ? root.photo_url : null,
      total_items: items.length,
      confidence_overall: root.confidence_overall === 'high' || root.confidence_overall === 'medium' || root.confidence_overall === 'low'
        ? root.confidence_overall
        : 'high',
      items,
    },
    unknownItems,
  }
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: AppToast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div role="alert" aria-live="polite" className="pointer-events-none fixed left-1/2 top-4 z-[70] flex w-[min(92vw,360px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => {
        const toneClass = toast.tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-red-200 bg-red-50 text-red-900'
        const tagClass = toast.tone === 'success'
          ? 'bg-emerald-600 text-white'
          : 'bg-red-600 text-white'

        return (
          <div key={toast.id} className={`pointer-events-auto rounded-lg border px-3 py-2 shadow-lg ${toneClass}`}>
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tagClass}`}>
                {toast.tone}
              </span>
              <p className="flex-1 text-sm leading-5">{toast.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-slate-500 hover:bg-white/70 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Home() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const stockMode: StockMode = 'stock-in'
  const [activeSection, setActiveSection] = useState<HubSection>('data-entry')
  const [stockInPhase, setStockInPhase] = useState<'landing' | 'editing'>('landing')
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
  const [isSavingSupabase, setIsSavingSupabase] = useState(false)
  const [isLoadingSnowflake, setIsLoadingSnowflake] = useState(false)
  const [isCatalogUploading, setIsCatalogUploading] = useState(false)
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [latestGenerateUid, setLatestGenerateUid] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<string | null>(null)
  const [toasts, setToasts] = useState<AppToast[]>([])
  const toastIdRef = useRef(0)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isStockCheckHistoryOpen, setIsStockCheckHistoryOpen] = useState(false)
  const [historyData, setHistoryData] = useState<HistoryEntry[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isDeletingHistoryUid, setIsDeletingHistoryUid] = useState<string | null>(null)
  const [isDeletingStockCheckHistoryUid, setIsDeletingStockCheckHistoryUid] = useState<string | null>(null)
  const [isRepushing, setIsRepushing] = useState(false)
  const [selectedHistoryUid, setSelectedHistoryUid] = useState<string | null>(null)
  const [editingHistoryUid, setEditingHistoryUid] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [pendingModeSwitch, setPendingModeSwitch] = useState<'manual' | 'photo' | null>(null)
  const [pendingHistoryLoad, setPendingHistoryLoad] = useState<string | null>(null)
  const [pendingStockCheckHistoryLoad, setPendingStockCheckHistoryLoad] = useState<SelectedStockCheckHistoryRecord | null>(null)
  const [offlineQueueCount, setOfflineQueueCount] = useState(0)
  const [stockInQueueCount, setStockInQueueCount] = useState(0)
  const [isOfflineSyncing, setIsOfflineSyncing] = useState(false)
  const [hasStockInLocalDraft, setHasStockInLocalDraft] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const [dataEntrySearchTerm, setDataEntrySearchTerm] = useState('')
  const [dataEntryStatusFilter, setDataEntryStatusFilter] = useState<'all' | 'pending' | 'pushed'>('all')
  const [dataEntryFindTerm, setDataEntryFindTerm] = useState('')
  const [dataEntryNewItemName, setDataEntryNewItemName] = useState('')
  const [dataEntryAddHighlightIndex, setDataEntryAddHighlightIndex] = useState<number>(-1)
  const [dataEntrySelectedCatalogCode, setDataEntrySelectedCatalogCode] = useState<string | null>(null)
  const [manualEntryQuantity, setManualEntryQuantity] = useState('')
  const [dataEntryCreatePrefillName, setDataEntryCreatePrefillName] = useState('')
  const [showCreateDataEntryItemModal, setShowCreateDataEntryItemModal] = useState(false)
  const [isItemProfilesExpanded, setIsItemProfilesExpanded] = useState(false)
  const [inlineCreateForm, setInlineCreateForm] = useState<InlineCreateItemForm>({
    official_name: '',
    stocklist_name: '',
    product: '',
    category: '',
    location: 'Inside Coolroom',
    sub_location: 'Apples',
    attribute: '',
  })
  const [isInlineCreateSaving, setIsInlineCreateSaving] = useState(false)
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
  const dataEntryAddContainerRef = useRef<HTMLDivElement | null>(null)
  const dataEntryHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isManualEntryMode = dataEntryMode === 'manual'

  const addToast = useCallback((variant: 'success' | 'error', message: string) => {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, tone: variant, message }])
  }, [])

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

  useEffect(() => {
    setInlineCreateForm((current) => {
      if (current.category) return current
      if (dataEntryCreateCategories.length === 0) return current
      return {
        ...current,
        category: dataEntryCreateCategories[0],
      }
    })
  }, [dataEntryCreateCategories])

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
    try {
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
    } catch (error) {
      if (shouldSilenceOfflineNetworkError(error)) {
        return
      }

      throw error
    }
  }

  const loadTranscriptionHistory = useCallback(async () => {
    setIsHistoryLoading(true)
    setApiError(null)

    try {
      const response = await fetch('/api/transcription-history', { cache: 'no-store' })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load transcription history.')
      }

      setHistoryData(Array.isArray(payload.history) ? payload.history : [])
    } catch (error) {
      if (shouldSilenceOfflineNetworkError(error)) {
        return
      }

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
      if (shouldSilenceOfflineNetworkError(error)) {
        return
      }

      setApiError(error instanceof Error ? error.message : 'Failed to load stock check history.')
    } finally {
      setIsStockCheckHistoryLoading(false)
    }
  }, [])

  const refreshOfflineQueueState = useCallback(() => {
    if (typeof window === 'undefined') return

    setOfflineQueueCount(getPendingOfflineCount())
    setStockInQueueCount(getPendingOfflineCountByFeature('stock-in'))
    setHasStockInLocalDraft(hasOfflineDraft('stock-in'))
    setIsOnline(window.navigator.onLine)
  }, [])

  const runOfflineSync = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (isOfflineSyncing || !window.navigator.onLine) return

    setIsOfflineSyncing(true)

    try {
      const result = await syncOfflineQueue()
      setOfflineQueueCount(result.remaining)
      setStockInQueueCount(getPendingOfflineCountByFeature('stock-in'))

      if (result.authError) {
        setApiError('Session expired while syncing offline saves. Please sign in again to finish syncing queued records.')
        return
      }

      if (result.processed > 0) {
        setApiStatus(`Synced ${result.processed} offline save${result.processed > 1 ? 's' : ''}.`)
        await loadTranscriptionHistory()
        await loadStockCheckHistory()
      }
    } finally {
      setIsOfflineSyncing(false)
    }
  }, [isOfflineSyncing, loadStockCheckHistory, loadTranscriptionHistory])

  useEffect(() => {
    if (typeof window === 'undefined') return

    refreshOfflineQueueState()

    const unsubscribe = subscribeOfflineQueueUpdates(() => {
      refreshOfflineQueueState()
    })
    const unsubscribeDraft = subscribeOfflineDraftUpdates(() => {
      refreshOfflineQueueState()
    })

    const handleOnline = () => {
      setIsOnline(true)
      void runOfflineSync()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (window.navigator.onLine) {
      void runOfflineSync()
    }

    return () => {
      unsubscribe()
      unsubscribeDraft()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshOfflineQueueState, runOfflineSync])

  const restoreStockInDraft = useCallback(() => {
    if (typeof window === 'undefined') return

    const draft = loadOfflineDraft<StockInOfflineDraft>('stock-in')
    if (!draft || !draft.parsedData) return

    setDataEntryMode(draft.dataEntryMode)
    setParsedData(draft.parsedData)
    setUnknownItems(Array.isArray(draft.unknownItems) ? draft.unknownItems : [])
    setMissingCatalogItems(Array.isArray(draft.missingCatalogItems) ? draft.missingCatalogItems : [])
    setLatestGenerateUid(draft.latestGenerateUid ?? null)
    setEditingHistoryUid(draft.editingHistoryUid ?? null)
    setIsValidatedByStaff(Boolean(draft.isValidatedByStaff))
    setHasSavedToSupabase(Boolean(draft.hasSavedToSupabase))
    setHasLoadedToDb(Boolean(draft.hasLoadedToDb))
    setApiStatus(STATUS.DRAFT_RECOVERED)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!parsedData) {
      clearOfflineDraft('stock-in')
      setHasStockInLocalDraft(false)
      return
    }

    saveOfflineDraft('stock-in', {
      dataEntryMode,
      parsedData,
      unknownItems,
      missingCatalogItems,
      latestGenerateUid,
      editingHistoryUid,
      isValidatedByStaff,
      hasSavedToSupabase,
      hasLoadedToDb,
    })
    setHasStockInLocalDraft(true)
  }, [
    dataEntryMode,
    editingHistoryUid,
    hasLoadedToDb,
    hasSavedToSupabase,
    isValidatedByStaff,
    latestGenerateUid,
    missingCatalogItems,
    parsedData,
    unknownItems,
  ])

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
          if (shouldSilenceOfflineNetworkError(catalogError)) {
            return
          }

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
    setDataEntryAddHighlightIndex(-1)
    setHighlightedDataEntryIndex(null)

    if (dataEntryHighlightTimeoutRef.current) {
      clearTimeout(dataEntryHighlightTimeoutRef.current)
      dataEntryHighlightTimeoutRef.current = null
    }
  }, [activeSection])

  useEffect(() => {
    if (!apiError) return

    toastIdRef.current += 1
    const id = toastIdRef.current
    setToasts((current) => [...current, { id, tone: 'error', message: apiError }])
    setApiError(null)
  }, [apiError])

  useEffect(() => {
    if (!apiStatus) return

    toastIdRef.current += 1
    const id = toastIdRef.current
    setToasts((current) => [...current, { id, tone: 'success', message: apiStatus }])
    setApiStatus(null)
  }, [apiStatus])

  useEffect(() => {
    if (toasts.length === 0) return

    const timer = setTimeout(() => {
      setToasts((current) => current.slice(1))
    }, 3800)

    return () => clearTimeout(timer)
  }, [toasts])

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

  useEffect(() => {
    const handleOutsideAddClick = (event: MouseEvent | TouchEvent) => {
      if (dataEntryNewItemName.trim().length === 0) return

      const targetNode = event.target as Node | null
      if (!targetNode) return

      if (dataEntryAddContainerRef.current?.contains(targetNode)) return
      setDataEntryAddHighlightIndex(-1)
    }

    document.addEventListener('mousedown', handleOutsideAddClick)
    document.addEventListener('touchstart', handleOutsideAddClick)

    return () => {
      document.removeEventListener('mousedown', handleOutsideAddClick)
      document.removeEventListener('touchstart', handleOutsideAddClick)
    }
  }, [dataEntryNewItemName])

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
      return []
    }

    const activeCatalogCodes = new Set((activeCatalog ?? []).map((c) => c.code.trim().toUpperCase()))

    // Extracted items (matched)
    const allItems = parsedData.items
      .filter((item) => {
        if (!item.catalog_code) return true
        const code = item.catalog_code.trim().toUpperCase()
        
        // If it's a known catalog item but explicitly hidden, drop it
        if (activeCatalogCodes.has(code) && !visibleCatalogCodes.has(code)) {
          return false
        }
        
        // Otherwise keep it (it's either visible, or it's a custom/orphaned code)
        return true
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

    return [...allItems, ...missingItems, ...unknownMapped].filter((row) => {
      if (row.item.quantity !== null) return true
      if (row.item.quantity_conflict_flag) return true
      return (row.item.quantity_raw ?? '').trim().length > 0
    })
  }, [activeCatalog, missingCatalogItems, parsedData, unknownItems, visibleCatalogCodes])

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

  const filledItemCount = useMemo(
    () => indexedItems.filter(r => r.item.quantity !== null).length,
    [indexedItems]
  )

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

  const areAllDataEntrySectionsExpanded = useMemo(() => {
    if (dataEntrySectionIds.length === 0) return false
    return dataEntrySectionIds.every((sectionId) => dataEntryExpandedSections.has(sectionId))
  }, [dataEntryExpandedSections, dataEntrySectionIds])

  useEffect(() => {
    if (indexedItems.length === 0) {
      setDataEntryExpandedSections(new Set())
      return
    }

    if (indexedItems.length <= AUTO_EXPAND_SECTION_ROW_LIMIT) {
      setDataEntryExpandedSections(new Set(dataEntrySectionIds))
    }
  }, [dataEntrySectionIds, indexedItems.length])

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
        return (
          item.official_name.toLowerCase().includes(term)
          || item.stocklist_name.toLowerCase().includes(term)
          || item.product.toLowerCase().includes(term)
        )
      })
      .slice(0, 6)
  }, [dataEntryNewItemName, visibleCatalog])

  useEffect(() => {
    if (dataEntryNewItemName.trim().length === 0) {
      setDataEntryAddHighlightIndex(-1)
      return
    }

    if (dataEntryAddSuggestions.length === 0) {
      setDataEntryAddHighlightIndex(-1)
      return
    }

    setDataEntryAddHighlightIndex((current) => {
      if (current < dataEntryAddSuggestions.length) return current
      return -1
    })
  }, [dataEntryAddSuggestions, dataEntryNewItemName])

  const selectedDataEntryCatalogItem = useMemo(() => {
    if (!dataEntrySelectedCatalogCode) return null
    const normalized = dataEntrySelectedCatalogCode.trim().toUpperCase()
    return visibleCatalog.find((item) => item.code.trim().toUpperCase() === normalized) ?? null
  }, [dataEntrySelectedCatalogCode, visibleCatalog])

  const syncItemProfilesFromCatalogItem = useCallback((catalogItem: CatalogItem) => {
    setInlineCreateForm({
      official_name: catalogItem.official_name ?? '',
      stocklist_name: catalogItem.stocklist_name ?? catalogItem.official_name ?? '',
      product: catalogItem.product ?? '',
      category: catalogItem.category ?? '',
      location: catalogItem.location === 'Outside Coolroom' ? 'Outside Coolroom' : 'Inside Coolroom',
      sub_location: catalogItem.sub_location ?? (catalogItem.location === 'Outside Coolroom' ? OUTSIDE_SUB_LOCATION_OPTIONS[0] : INSIDE_SUB_LOCATION_OPTIONS[0]),
      attribute: catalogItem.attribute ?? '',
    })
  }, [])

  useEffect(() => {
    const term = dataEntryNewItemName.trim()
    if (!term) return
    if (dataEntrySelectedCatalogCode) return
    if (dataEntryAddSuggestions.length > 0) return

    setIsItemProfilesExpanded(true)
    setInlineCreateForm((current) => ({
      ...current,
      official_name: current.official_name.trim().length > 0 ? current.official_name : term,
      stocklist_name: current.stocklist_name.trim().length > 0 ? current.stocklist_name : term,
      product: current.product.trim().length > 0 ? current.product : term,
    }))
  }, [dataEntryAddSuggestions, dataEntryNewItemName, dataEntrySelectedCatalogCode])

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

  const addKnownDataEntryItem = useCallback((catalogItem: CatalogItem, quantityOverride: number | null = null) => {
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
            quantity_raw: quantityOverride === null ? null : String(quantityOverride),
            quantity: quantityOverride,
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
    setDataEntrySelectedCatalogCode(null)
    setManualEntryQuantity('')
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus(`${catalogItem.official_name} and its quantity were updated to the table below. Continue and recheck at the table below.`)
  }, [existingKnownCodes, parsedData])

  const selectDataEntryCatalogSuggestion = useCallback((catalogItem: CatalogItem) => {
    setDataEntrySelectedCatalogCode(catalogItem.code)
    setDataEntryNewItemName(catalogItem.official_name)
    syncItemProfilesFromCatalogItem(catalogItem)
    setDataEntryAddHighlightIndex(-1)
    setApiError(null)
  }, [syncItemProfilesFromCatalogItem])

  const handleItemInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (dataEntryAddSuggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setDataEntryAddHighlightIndex((current) => {
        const next = current + 1
        if (next >= dataEntryAddSuggestions.length) return 0
        return next
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setDataEntryAddHighlightIndex((current) => {
        if (current <= 0) return dataEntryAddSuggestions.length - 1
        return current - 1
      })
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDataEntryAddHighlightIndex(-1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const indexToUse = dataEntryAddHighlightIndex >= 0 ? dataEntryAddHighlightIndex : 0
      const selected = dataEntryAddSuggestions[indexToUse]
      if (selected) {
        selectDataEntryCatalogSuggestion(selected)
      }
    }
  }, [dataEntryAddHighlightIndex, dataEntryAddSuggestions, selectDataEntryCatalogSuggestion])

  const updateItem = useCallback((index: number, patch: Partial<StockItem>) => {
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
  }, [])

  const addManualKnownItem = useCallback(() => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before adding items.')
      return
    }

    if (!parsedData.stock_date || !isIsoDate(parsedData.stock_date)) {
      setApiError('Please set a valid stock date before adding items.')
      return
    }

    const itemName = dataEntryNewItemName.trim()
    if (!itemName) {
      setApiError('Enter an item name before adding.')
      return
    }

    const quantity = parseWholeQuantity(manualEntryQuantity)
    if (quantity === null) {
      setApiError('Enter a whole-number quantity before adding.')
      return
    }

    const chosen = selectedDataEntryCatalogItem
      ?? dataEntryAddSuggestions.find((item) => item.official_name.toLowerCase() === itemName.toLowerCase())
      ?? visibleCatalog.find((item) => item.official_name.toLowerCase() === itemName.toLowerCase())

    if (!chosen) {
      setUnknownItems((current) => [
        ...current,
        {
          catalog_code: null,
          product_raw: itemName,
          category: 'Unknown',
          location: 'Unknown',
          sub_location: 'Unknown',
          product: itemName,
          attribute: '',
          official_name: itemName,
          quantity_raw: String(quantity),
          quantity,
          quantity_conflict_flag: false,
          row_position: 'single',
          confidence: 'high',
          catalog_match_status: 'unknown',
        },
      ])
      setDataEntryNewItemName('')
      setDataEntrySelectedCatalogCode(null)
      setManualEntryQuantity('')
      setApiError(null)
      setApiStatus(`${itemName} was added as an offline review row. You can save when internet is available.`)
      return
    }

    const chosenCode = chosen.code.trim().toUpperCase()
    const existingParsedIndex = parsedData.items.findIndex((item) => (item.catalog_code ?? '').trim().toUpperCase() === chosenCode)
    if (existingParsedIndex >= 0) {
      syncItemProfilesFromCatalogItem(chosen)
      updateItem(existingParsedIndex, {
        quantity,
        quantity_raw: String(quantity),
        quantity_conflict_flag: false,
      })
      setDataEntryNewItemName('')
      setDataEntrySelectedCatalogCode(null)
      setManualEntryQuantity('')
      setApiError(null)
      setApiStatus(`${chosen.official_name} and its quantity were updated to the table below. Continue and recheck at the table below.`)
      return
    }

    const existingMissingIndex = missingCatalogItems.findIndex((item) => item.code.trim().toUpperCase() === chosenCode)
    if (existingMissingIndex >= 0) {
      const rowIndex = -1000 - existingMissingIndex
      syncItemProfilesFromCatalogItem(chosen)
      updateItem(rowIndex, {
        quantity,
        quantity_raw: String(quantity),
        quantity_conflict_flag: false,
      })
      setDataEntryNewItemName('')
      setDataEntrySelectedCatalogCode(null)
      setManualEntryQuantity('')
      setApiError(null)
      setApiStatus(`${chosen.official_name} and its quantity were updated to the table below. Continue and recheck at the table below.`)
      return
    }

    addKnownDataEntryItem(chosen, quantity)
  }, [
    addKnownDataEntryItem,
    dataEntryAddSuggestions,
    dataEntryNewItemName,
    manualEntryQuantity,
    missingCatalogItems,
    parsedData,
    selectedDataEntryCatalogItem,
    syncItemProfilesFromCatalogItem,
    updateItem,
    visibleCatalog,
  ])

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

  const submitInlineCreateItem = useCallback(async () => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before creating items.')
      return
    }

    const officialName = inlineCreateForm.official_name.trim()
    const stocklistName = inlineCreateForm.stocklist_name.trim() || officialName
    const product = inlineCreateForm.product.trim() || officialName
    const category = inlineCreateForm.category.trim()

    if (!officialName || !stocklistName || !product || !category) {
      setApiError('Items profile mini form requires Official Name, Stocklist Name, Product, and Category.')
      return
    }

    const payload: CreateCatalogItemPayload = {
      code: generateCatalogCode(category, product, inlineCreateForm.attribute.trim()),
      location: inlineCreateForm.location,
      sub_location: inlineCreateForm.sub_location,
      category,
      product,
      attribute: inlineCreateForm.attribute.trim(),
      official_name: officialName,
      stocklist_name: stocklistName,
      navigation_guide: '',
      row_position: 'single',
      is_visible: true,
    }

    setIsInlineCreateSaving(true)
    setApiError(null)

    try {
      const response = await fetch('/api/catalog/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const responsePayload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = typeof responsePayload?.error === 'string' ? responsePayload.error : 'Failed to create catalog item.'
        throw new Error(message)
      }

      addCreatedDataEntryItem(payload)
      setInlineCreateForm((current) => ({
        ...current,
        official_name: '',
        stocklist_name: '',
        product: '',
        attribute: '',
      }))
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to create catalog item.')
    } finally {
      setIsInlineCreateSaving(false)
    }
  }, [addCreatedDataEntryItem, inlineCreateForm, parsedData])

  const startManualEntry = useCallback(() => {
    const manualDraft = buildManualParsedPayload(visibleCatalog, stockMode, today)

    setDataEntryMode('manual')
    setPhotoFile(null)
    setParsedData(manualDraft)
    setUnknownItems([])
    setMissingCatalogItems([])
    setLatestGenerateUid(null)
    setEditingHistoryUid(null)
    setSelectedHistoryUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus(STATUS.READY_MANUAL)
  }, [visibleCatalog, today])

  const confirmStartManualEntry = useCallback(() => {
    if (parsedData && parsedData.items.some(i => i.quantity !== null)) {
      setPendingModeSwitch('manual')
    } else {
      startManualEntry()
    }
  }, [parsedData, startManualEntry])

  const startPhotoEntry = useCallback(() => {
    setDataEntryMode('photo')
    setPhotoFile(null)
    setParsedData(null)
    setUnknownItems([])
    setMissingCatalogItems([])
    setLatestGenerateUid(null)
    setEditingHistoryUid(null)
    setSelectedHistoryUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiError(null)
    setApiStatus('Photo parsing mode selected. Upload an image to generate stock-in lines.') // Still okay as is, or use constant
  }, [])

  const confirmStartPhotoEntry = useCallback(() => {
    if (parsedData && parsedData.items.some(i => i.quantity !== null)) {
      setPendingModeSwitch('photo')
    } else {
      startPhotoEntry()
    }
  }, [parsedData, startPhotoEntry])

  useEffect(() => {
    if (stockInPhase !== 'editing') return
    if (!isManualEntryMode || visibleCatalog.length === 0) return

    setParsedData((current) => {
      if (!current) {
        return buildManualParsedPayload(visibleCatalog, stockMode, today)
      }

      return current
    })
  }, [visibleCatalog, isManualEntryMode, stockMode, today, stockInPhase])

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
    setEditingHistoryUid(null)
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

  const normalizeAndMarkValidated = useCallback((announceStatus: boolean) => {
    if (!parsedData) {
      setApiError('No parsed data to validate yet.')
      return false
    }

    const conflictCount = parsedData.items.filter((item) => item.quantity_conflict_flag).length
      + missingCatalogItems.filter((item) => Boolean(item.quantity_conflict_flag)).length

    setApiError(null)
    setIsValidatedByStaff(true)

    if (announceStatus) {
      if (conflictCount > 0) {
        setApiStatus(`Validation complete. ${conflictCount} known item(s) are still marked as conflict.`)
      } else {
        setApiStatus('Validation complete.')
      }
    }

    return true
  }, [missingCatalogItems, parsedData])

  async function exportCsv() {
    if (!parsedData) {
      setApiError('No parsed data to export yet.')
      return
    }

    if (!isValidatedByStaff) {
      setApiError('Please Save first. Export is enabled after Save validation completes.')
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

    const isValidated = normalizeAndMarkValidated(false)
    if (!isValidated) {
      return
    }

    setIsSavingSupabase(true)
    setApiError(null)
    setApiStatus(null)

    const requestPayload: Record<string, unknown> = {
      data: parsedData,
      validated: 'yes',
      unknown_items: unknownItems,
      missing_catalog_items: missingCatalogItems,
      uid_generate: latestGenerateUid ?? undefined,
      persist_only: true,
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      enqueueOfflineRequest({
        feature: 'stock-in',
        endpoint: '/api/save-to-snowflake',
        payload: requestPayload,
      })
      setApiStatus(STATUS.OFFLINE_QUEUED)
      setHasSavedToSupabase(false)
      setIsSavingSupabase(false)
      return
    }

    try {
      const response = await fetch('/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
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

      // setApiStatus(STATUS.SAVED) // Removed to prevent double-toast with "All done!"
      if (typeof payload?.uid_generate === 'string' && payload.uid_generate.length > 0) {
        setLatestGenerateUid(payload.uid_generate)
        if (editingHistoryUid) {
          setEditingHistoryUid(payload.uid_generate)
        }
      }
      setHasSavedToSupabase(true)
      return (payload?.uid_generate as string) || true
    } catch (error) {
      if (isNetworkRequestError(error)) {
        enqueueOfflineRequest({
          feature: 'stock-in',
          endpoint: '/api/save-to-snowflake',
          payload: requestPayload,
        })
        setApiStatus(STATUS.OFFLINE_QUEUED)
        setHasSavedToSupabase(false)
        return true // counts as success for the flow
      }

      setApiError(error instanceof Error ? error.message : 'Unexpected Supabase save error.')
      return false
    } finally {
      setIsSavingSupabase(false)
    }
  }

  const handleStockInDone = useCallback(async () => {
    if (!parsedData) {
      setApiError('No data to save.')
      return
    }

    // Step 1: validate
    const valid = normalizeAndMarkValidated(false)
    if (!valid) return

    // Step 2: save to Supabase
    const saved = await saveToSupabase()
    if (!saved) return

    // Step 3: load to Snowflake (awaited so user sees "All done!" only after both saves complete)
    if (window.navigator.onLine) {
      try {
        await loadToSnowflake(saved)
      } catch {
        // Snowflake failure is non-fatal; record is safe in Supabase
      }
    }

    // Step 4: clear draft
    clearOfflineDraft('stock-in')
    setHasStockInLocalDraft(false)

    // Step 5: return to landing
    addToast('success', '✅ All done!')
    setStockInPhase('landing')
  }, [parsedData, normalizeAndMarkValidated, loadToSnowflake, addToast, saveToSupabase])

  async function loadToSnowflake(overrideUidOrSaved?: string | boolean) {
    if (!parsedData) {
      setApiError('No parsed data to load yet. Parse a stock photo first.')
      return
    }

    const targetUid = typeof overrideUidOrSaved === 'string' ? overrideUidOrSaved : latestGenerateUid

    if (!targetUid && overrideUidOrSaved !== true) {
      setApiError('No transcription record is available yet. Parse a stock photo first.')
      return
    }

    // Validation and Supabase save are guaranteed by handleStockInDone pipeline

    setIsLoadingSnowflake(true)
    setApiError(null)
    setApiStatus(null)

    try {
      // Use re-push mode: send only uid_generate so the API fetches
      // the authoritative data from the Supabase record we just saved.
      // This prevents stale closure data from overwriting the correct record.
      const response = await fetch('/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid_generate: targetUid,
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

      // Success, no extra toast needed since handleStockInDone fires "All done!"
      setHasLoadedToDb(true)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected Snowflake save error.')
    } finally {
      setIsLoadingSnowflake(false)
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

  async function deleteTranscriptionHistory(uid: string) {
    const confirmed = window.confirm('Delete this history record permanently from app history?')
    if (!confirmed) return

    setIsDeletingHistoryUid(uid)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/transcription-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid_generate: uid }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to delete history record.')
      }

      setHistoryData((prev) => prev.filter((entry) => entry.uid_generate !== uid))

      if (selectedHistoryUid === uid) {
        setSelectedHistoryUid(null)
        setParsedData(null)
        setUnknownItems([])
        setMissingCatalogItems([])
      }
      if (editingHistoryUid === uid) {
        setEditingHistoryUid(null)
        setLatestGenerateUid(null)
        setHasSavedToSupabase(false)
        setHasLoadedToDb(false)
        setParsedData(null)
        setUnknownItems([])
        setMissingCatalogItems([])
      }

      setApiStatus('History record deleted from app history.')
      await loadTranscriptionHistory()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to delete history record.')
    } finally {
      setIsDeletingHistoryUid(null)
    }
  }

  async function deleteStockCheckHistory(uid: string) {
    const confirmed = window.confirm('Delete this stock-check record permanently from app history?')
    if (!confirmed) return

    setIsDeletingStockCheckHistoryUid(uid)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/stock-check/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid_stock_check: uid }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to delete stock-check history record.')
      }

      if (selectedStockCheckHistoryRecord?.uid_stock_check === uid) {
        setSelectedStockCheckHistoryRecord(null)
      }

      setApiStatus('Stock-check history record deleted from app history.')
      await loadStockCheckHistory()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to delete stock-check history record.')
    } finally {
      setIsDeletingStockCheckHistoryUid(null)
    }
  }

  const startNewDraftFromCurrent = useCallback(() => {
    setEditingHistoryUid(null)
    setSelectedHistoryUid(null)
    setLatestGenerateUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setApiStatus('Switched to new draft mode. Next Save will create a new history record.')
  }, [])

  const loadDataEntryHistoryToEditor = useCallback(async (uid: string) => {
    const applyEntry = (entry: HistoryEntry) => {
      const mapped = mapHistoryEntryToEditablePayload(entry, today)
      if (!mapped) {
        setApiError('This history record could not be loaded into the editor.')
        return false
      }

      setActiveSection('data-entry')
      setDataEntryMode('manual')
      setParsedData(mapped.parsedData)
      setUnknownItems(mapped.unknownItems)
      setMissingCatalogItems([])
      setLatestGenerateUid(entry.uid_generate)
      setEditingHistoryUid(entry.uid_generate)
      setSelectedHistoryUid(entry.uid_generate)
      setHasSavedToSupabase(true)
      setHasLoadedToDb(false)
      setIsValidatedByStaff(true)
      setApiError(null)
      setApiStatus(`Loaded history record ${entry.uid_generate} for editing.`)
      setStockInPhase('editing')
      return true
    }

    // Always fetch fresh data from Supabase to avoid stale-cache issues
    // (e.g. user adds an item, saves, then re-opens the same record)
    try {
      const response = await fetch('/api/transcription-history', { cache: 'no-store' })
      const payload = await response.json()
      const freshHistory = Array.isArray(payload?.history) ? payload.history as HistoryEntry[] : []
      setHistoryData(freshHistory)

      const fresh = freshHistory.find((entry) => entry.uid_generate === uid)

      if (!fresh) {
        setApiError('Unable to find that history record. Please refresh history and try again.')
        return
      }

      applyEntry(fresh)
    } catch {
      setApiError('Unable to refresh history details. Please try again.')
    }
  }, [today])

  const openHistory = async (uid?: string) => {
    setSelectedHistoryUid(uid ?? null)
    setIsHistoryOpen(true)

    if (historyData.length === 0) {
      await loadTranscriptionHistory()
    }
  }

  const openStockCheckHistory = async () => {
    setIsStockCheckHistoryOpen(true)

    if (stockCheckHistory.length === 0) {
      await loadStockCheckHistory()
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
  const showSidebarHistory = activeSection === 'data-entry' || activeSection === 'stock-check'

  return (
    <main className="min-h-screen px-2 py-2 sm:px-3 sm:py-3 md:px-8 md:py-7">
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => {
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }}
      />
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
      <div className="mx-auto mb-3 flex w-full max-w-7xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:px-4">
        <span className={`rounded-full px-2 py-1 font-semibold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
        <span className="text-slate-600">
          Pending offline saves: <strong>{offlineQueueCount}</strong>
        </span>
        {isOfflineSyncing && (
          <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700">
            Syncing queued saves...
          </span>
        )}
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
            <button
              type="button"
              onClick={() => setActiveSection('dashboard')}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${activeSection === 'dashboard'
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
                }`}
            >
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
                {isStockCheckTab ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openStockCheckHistory()
                    }}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    View all
                  </button>
                ) : (
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
                            if (activeSection === 'stock-check' && selectedStockCheckHistoryRecord) {
                                setPendingStockCheckHistoryLoad(entry)
                            } else {
                                setSelectedStockCheckHistoryRecord(entry)
                            }
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
                          if (parsedData && parsedData.items.some(i => i.quantity !== null) && !editingHistoryUid) {
                            setPendingHistoryLoad(entry.uid_generate)
                          } else {
                            void loadDataEntryHistoryToEditor(entry.uid_generate)
                          }
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
          ) : activeSection === 'dashboard' ? (
            <DashboardPanel />
          ) : stockInPhase === 'landing' ? (
            <SectionLandingState
              sectionLabel="Receive Stock"
              hasDraft={hasStockInLocalDraft}
              draftAge={getOfflineDraftAge('stock-in')}
              draftItemCount={parsedData?.items.filter(i => i.quantity !== null).length || 0}
              historyCount={historyData.length}
              onAction={(action) => {
                if (action === 'new') {
                  startManualEntry()
                  setStockInPhase('editing')
                } else if (action === 'continue') {
                  restoreStockInDraft()
                  setStockInPhase('editing')
                } else if (action === 'history') {
                  setIsHistoryOpen(true)
                }
              }}
            />
          ) : (
            <div className="space-y-4">
              <section className="card-surface rounded-2xl p-6 pb-24 md:p-8 md:pb-8">
                <div className="mb-4 sticky top-0 z-20 flex items-center justify-between rounded-lg bg-slate-800 px-4 py-2 text-white shadow-lg">
                  <div className="flex items-center gap-2 text-sm">
                    {editingHistoryUid ? '📂' : '📝'}
                    <span className="font-medium">
                      {editingHistoryUid
                        ? `Editing ${formatSheetDate(parsedData?.stock_date)} record`
                        : `New · ${formatSheetDate(parsedData?.stock_date || today)}`}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-300">
                      {parsedData?.items.filter(i => i.quantity !== null).length || 0} items
                    </span>
                  </div>
                  <button 
                    onClick={() => setStockInPhase('landing')} 
                    className="text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    ✕ Back to Menu
                  </button>
                </div>

                <div className="mb-4 mt-4">
                  <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Stock In</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Stock In is for stock-in input. For stock-closing (manual or parse from photo), use Check Stock.
                  </p>
                </div>

                {editingHistoryUid && (
                  <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      Editing history record <strong>{editingHistoryUid}</strong>. Save will overwrite this record.
                    </p>
                    <button
                      type="button"
                      onClick={startNewDraftFromCurrent}
                      className="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                    >
                      New Draft
                    </button>
                  </div>
                )}

                <div className="grid gap-4">
                  <EntryMethodToggle
                    value={isManualEntryMode ? 'manual' : 'photo'}
                    onManual={confirmStartManualEntry}
                    onPhoto={confirmStartPhotoEntry}
                    manualLabel="Manual Entry"
                    photoLabel="Photo Entry"
                    manualHelpText="Enter stock values manually and review them in the stocklist viewer."
                    photoHelpText="Upload a photo, parse it, then review values in the stocklist viewer."
                  />

                  {isManualEntryMode ? (
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                      <div className="rounded-lg bg-white p-3">
                        <p className="text-sm font-semibold text-slate-800">Input</p>
                        <div className="mt-2 space-y-2">
                          <div className="flex w-full flex-col gap-1">
                            <label htmlFor="paper-stock-date" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Date</label>
                            <input
                              id="paper-stock-date"
                              type="date"
                              value={parsedData?.stock_date ?? ''}
                              onChange={(event) => updateParsedStockDate(event.target.value)}
                              disabled={!parsedData}
                              className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                            />
                          </div>

                          <div ref={dataEntryAddContainerRef} className="relative">
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Item</label>
                            <input
                              type="text"
                              value={dataEntryNewItemName}
                              onChange={(event) => {
                                setDataEntryNewItemName(event.target.value)
                                setDataEntrySelectedCatalogCode(null)
                              }}
                              onKeyDown={handleItemInputKeyDown}
                              placeholder="Search or type item name"
                              disabled={!parsedData}
                              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                            />

                            {dataEntryNewItemName.trim().length > 0 && dataEntryAddSuggestions.length > 0 && parsedData && !dataEntrySelectedCatalogCode && (
                              <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                                {dataEntryAddSuggestions.map((item) => (
                                  <button
                                    key={item.code}
                                    type="button"
                                    onClick={() => selectDataEntryCatalogSuggestion(item)}
                                    className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 last:border-b-0 ${dataEntryAddSuggestions[dataEntryAddHighlightIndex]?.code === item.code ? 'bg-brand-50 text-brand-700' : ''}`}
                                  >
                                    {item.official_name} ({item.code})
                                  </button>
                                ))}
                              </div>
                            )}
                            <p className="mt-1 text-[11px] text-slate-500">Use arrow keys + Enter to select a suggestion.</p>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Qty</label>
                            <input
                              type="number"
                              value={manualEntryQuantity}
                              onChange={(event) => setManualEntryQuantity(event.target.value)}
                              placeholder="e.g. 6"
                              disabled={!parsedData}
                              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={addManualKnownItem}
                            disabled={!parsedData || !parsedData.stock_date || dataEntryNewItemName.trim().length === 0 || parseWholeQuantity(manualEntryQuantity) === null}
                            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                          >
                            <Plus className="h-4 w-4" />
                            Add
                          </button>
                        </div>
                      </div>

                      <div className="rounded-lg bg-white p-3">
                        <button
                          type="button"
                          onClick={() => setIsItemProfilesExpanded((current) => !current)}
                          className="flex w-full items-center justify-between gap-3 rounded-md text-left"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Item Profiles</p>
                            <p className="mt-0.5 text-xs text-slate-500">Expand to edit or create item details.</p>
                          </div>
                          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                            {isItemProfilesExpanded ? 'Collapse' : 'Expand'}
                          </span>
                        </button>

                        {isItemProfilesExpanded && (
                          <>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <input
                                type="text"
                                value={inlineCreateForm.official_name}
                                onChange={(event) => setInlineCreateForm((current) => ({ ...current, official_name: event.target.value }))}
                                placeholder="Official Name"
                                className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={inlineCreateForm.stocklist_name}
                                onChange={(event) => setInlineCreateForm((current) => ({ ...current, stocklist_name: event.target.value }))}
                                placeholder="Name on Stocklist"
                                className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={inlineCreateForm.product}
                                onChange={(event) => setInlineCreateForm((current) => ({ ...current, product: event.target.value }))}
                                placeholder="Product"
                                className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              />
                              <select
                                value={inlineCreateForm.category}
                                onChange={(event) => setInlineCreateForm((current) => ({ ...current, category: event.target.value }))}
                                className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              >
                                <option value="">Select category</option>
                                {dataEntryCreateCategories.map((category) => (
                                  <option key={category} value={category}>{category}</option>
                                ))}
                              </select>
                              <select
                                value={inlineCreateForm.location}
                                onChange={(event) => {
                                  const nextLocation = event.target.value as 'Inside Coolroom' | 'Outside Coolroom'
                                  setInlineCreateForm((current) => ({
                                    ...current,
                                    location: nextLocation,
                                    sub_location: nextLocation === 'Outside Coolroom' ? OUTSIDE_SUB_LOCATION_OPTIONS[0] : INSIDE_SUB_LOCATION_OPTIONS[0],
                                  }))
                                }}
                                className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              >
                                <option value="Inside Coolroom">Inside Coolroom</option>
                                <option value="Outside Coolroom">Outside Coolroom</option>
                              </select>
                              <select
                                value={inlineCreateForm.sub_location}
                                onChange={(event) => setInlineCreateForm((current) => ({ ...current, sub_location: event.target.value }))}
                                className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              >
                                {(inlineCreateForm.location === 'Outside Coolroom' ? OUTSIDE_SUB_LOCATION_OPTIONS : INSIDE_SUB_LOCATION_OPTIONS).map((subLocation) => (
                                  <option key={subLocation} value={subLocation}>{subLocation}</option>
                                ))}
                              </select>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={inlineCreateForm.attribute}
                                onChange={(event) => setInlineCreateForm((current) => ({ ...current, attribute: event.target.value }))}
                                placeholder="Attribute (optional)"
                                className="min-h-10 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={submitInlineCreateItem}
                                disabled={isInlineCreateSaving || !parsedData}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                              >
                                {isInlineCreateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                {isInlineCreateSaving ? 'Adding...' : 'Add items if new'}
                              </button>
                              <button
                                type="button"
                                onClick={openDataEntryCreateItemModal}
                                disabled={!parsedData || dataEntryNewItemName.trim().length === 0}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Advanced Form
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:p-5">
                      <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                        <div className="flex w-full flex-col gap-1">
                          <label htmlFor="paper-stock-date" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Date</label>
                          <input
                            id="paper-stock-date"
                            type="date"
                            value={parsedData?.stock_date ?? ''}
                            onChange={(event) => updateParsedStockDate(event.target.value)}
                            disabled={!parsedData}
                            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                          />
                        </div>

                        <div>
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
                            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
                          >
                            Choose photo
                          </label>
                          <p className="mt-2 text-xs text-slate-500">{photoFile ? `Photo: ${photoFile.name}` : 'JPEG / PNG, max 5MB'}</p>
                        </div>

                        <button
                          type="button"
                          onClick={parsePhoto}
                          disabled={isParsing || !photoFile}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 md:w-auto md:min-w-[170px]"
                        >
                          {isParsing && <Loader2 className="h-4 w-4 animate-spin" />}
                          {isParsing ? 'Parsing...' : 'Parse'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="card-surface rounded-2xl p-6 md:p-8">
                <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Editable Stocklist Layout</h2>
                    <p className="mt-1 text-xs text-slate-600">
                      {stockInQueueCount > 0
                        ? `${stockInQueueCount} stock-in save${stockInQueueCount > 1 ? 's' : ''} queued for sync.`
                        : hasStockInLocalDraft
                          ? 'Local draft is active and visible in review table.'
                          : 'No local draft yet.'}
                    </p>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {!isOnline ? 'Offline mode active.' : isOfflineSyncing ? 'Syncing queued saves...' : 'Search items above the stocklist viewer.'}
                  </p>
                </div>

                <div className="mobile-sticky-add mb-4 space-y-3">
                  <div ref={dataEntryFindContainerRef} className="relative">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Search</label>
                    <Search className="pointer-events-none absolute left-3 top-8 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={dataEntryFindTerm}
                      onChange={(event) => setDataEntryFindTerm(event.target.value)}
                      placeholder="Search in stocklist viewer"
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
                  {isDataEntryMobileViewport && (
                    <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 md:hidden">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Mobile View</span>
                      <div className="flex items-center gap-2">
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
                        <button
                          type="button"
                          onClick={areAllDataEntrySectionsExpanded ? collapseAllDataEntrySections : expandAllDataEntrySections}
                          className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          aria-label={areAllDataEntrySectionsExpanded ? 'Collapse all review sections' : 'Expand all review sections'}
                          title={areAllDataEntrySectionsExpanded ? 'Collapse all review sections' : 'Expand all review sections'}
                        >
                          {areAllDataEntrySectionsExpanded ? 'Collapse all' : 'Expand all'}
                        </button>
                      </div>
                    </div>
                  )}

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

                <div className="mobile-sticky-actions mt-5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStockInDone}
                    disabled={!parsedData || isSavingSupabase || isLoadingSnowflake || isExporting}
                    className="flex-1 min-h-12 rounded-lg bg-emerald-600 px-6 py-3
                               text-base font-semibold text-white hover:bg-emerald-700
                               disabled:bg-slate-300 transition-colors shadow-md"
                  >
                    {isSavingSupabase ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Saving...</span>
                      </div>
                    ) : (
                      `✅ Done (${filledItemCount} items)`
                    )}
                  </button>

                  <div className="relative">
                    <button 
                      onClick={() => setShowOverflow(v => !v)}
                      className="min-h-12 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-600 hover:bg-slate-50 transition-colors"
                      aria-label="More actions"
                    >
                      <Settings className="h-5 w-5" />
                    </button>
                    {showOverflow && (
                      <div className="absolute bottom-14 right-0 z-30 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <button 
                          onClick={() => { exportCsv(); setShowOverflow(false); }} 
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Download className="h-4 w-4" />
                          <span>Export CSV</span>
                        </button>
                        <button 
                          onClick={() => { setIsHistoryOpen(true); setShowOverflow(false); }} 
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <History className="h-4 w-4" />
                          <span>View History</span>
                        </button>
                      </div>
                    )}
                  </div>
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
        onLoadToEdit={(uid) => {
          setIsHistoryOpen(false)
          void loadDataEntryHistoryToEditor(uid)
        }}
        onRepush={reopushToSnowflake}
        onDeleteHistory={deleteTranscriptionHistory}
        deletingUid={isDeletingHistoryUid}
        isRepushing={isRepushing}
        selectedUid={selectedHistoryUid}
        visibleCatalogCodes={visibleCatalogCodes}
      />

      <StockCheckHistoryDialog
        isOpen={isStockCheckHistoryOpen}
        onClose={() => setIsStockCheckHistoryOpen(false)}
        history={stockCheckHistory}
        isLoading={isStockCheckHistoryLoading}
        deletingUid={isDeletingStockCheckHistoryUid}
        selectedUid={selectedStockCheckHistoryRecord?.uid_stock_check ?? null}
        onLoadToEdit={(uid) => {
          const entry = stockCheckHistory.find((item) => item.uid_stock_check === uid)
          if (!entry) return
          setSelectedStockCheckHistoryRecord(entry)
          setActiveSection('stock-check')
          setIsStockCheckHistoryOpen(false)
        }}
        onDeleteHistory={deleteStockCheckHistory}
      />

      <ConfirmDialog
        isOpen={pendingModeSwitch !== null}
        title="Switch entry mode?"
        message="This will clear your current entries. You'll start with a blank form."
        variant="danger"
        confirmLabel="Clear and switch"
        onConfirm={() => {
          if (pendingModeSwitch === 'manual') startManualEntry()
          else startPhotoEntry()
          setPendingModeSwitch(null)
        }}
        onCancel={() => setPendingModeSwitch(null)}
      />

      <ConfirmDialog
        isOpen={pendingHistoryLoad !== null}
        title="Load history record?"
        message="Loading this record will replace your current work. Unsaved changes will be lost."
        variant="danger"
        confirmLabel="Load and replace"
        onConfirm={() => {
          if (pendingHistoryLoad) {
            void loadDataEntryHistoryToEditor(pendingHistoryLoad)
          }
          setPendingHistoryLoad(null)
        }}
        onCancel={() => setPendingHistoryLoad(null)}
      />
      <ConfirmDialog
        isOpen={pendingStockCheckHistoryLoad !== null}
        title="Load stock check history?"
        message="Loading this record will replace your current stock check view. Unsaved changes will be lost."
        variant="danger"
        confirmLabel="Load and replace"
        onConfirm={() => {
          if (pendingStockCheckHistoryLoad) {
            setSelectedStockCheckHistoryRecord(pendingStockCheckHistoryLoad)
          }
          setPendingStockCheckHistoryLoad(null)
        }}
        onCancel={() => setPendingStockCheckHistoryLoad(null)}
      />

    </main>
  )
}
