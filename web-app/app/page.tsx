'use client'

import { useMemo, useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import {
  BarChart3,
  Database,
  Download,
  FileImage,
  History,
  Loader2,
  ClipboardList,
  Save,
  Search,
  Settings,
  X,
  Plus,
  Check,
  Undo2,
  ChevronLeft,
} from 'lucide-react'
import { ToastViewport } from './components/ui/Toast'
import { Sheet } from './components/ui/Sheet'
import { fieldClass, inputClass, NumberInput } from './components/ui/Input'
import { focusNextQuantityInput, isRowListed, rankSuggestions } from '../lib/entry-chain'
import { AppShell } from './components/AppShell'
import { friendlyError, toast } from '../lib/toast-store'

import { DailyReportPanel } from './components/DailyReportPanel'
import { DashboardPanel } from './components/DashboardPanel'
import { CatalogManagementView } from './catalog/CatalogManagementView'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './components/CreateCatalogItemModal'
import { EmbeddedStockCheckPanel } from './components/EmbeddedStockCheckPanel'
import { EntryMethodToggle } from './components/EntryMethodToggle'
import { StockPaperCardSection, StockPaperSectionTable, StockPaperThreeColumnTable } from './components/StockPaperTables'
import { ConfirmDialog, useConfirm } from './components/ConfirmDialog'
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
  scheduleDraftSave,
  subscribeOfflineDraftUpdates,
  subscribeOfflineQueueUpdates,
  syncOfflineQueue,
} from '../lib/offline/queue'
import { formatSheetDate, normalizeInsideSectionLabel } from '../lib/stock-paper-utils'
import { STATUS } from '../lib/status-messages'
import { getLocalTodayDate } from '../lib/date-utils'
import { useHistoryRealtime } from '../lib/realtime/history-realtime'

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
  origin: string
  inner_quantity: number | null
  inner_unit: CatalogInnerUnit
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
  origin: string
  inner_quantity: number | null
  inner_unit: CatalogInnerUnit
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
  origin: string
  inner_quantity: number | null
  inner_unit: CatalogInnerUnit
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

type CatalogInnerUnit = 'box' | 'bag' | 'punnet' | 'piece' | 'tray' | 'bunch' | 'pack' | 'kg' | 'g'

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
      className={`w-full min-h-14 rounded-control border px-3 py-2.5 text-left transition-colors duration-150 ${selected
          ? 'border-forest-600 bg-forest-50'
          : 'border-line bg-surface hover:bg-slate-50 active:bg-slate-100'
        }`}
    >
      <p className="truncate text-[15px] font-medium text-ink">{title}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-[13px] text-muted">{formatSidebarHistoryDate(timestamp)}</p>
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

type HubSection = 'data-entry' | 'stock-check' | 'daily-report' | 'dashboard' | 'catalog'
type LastAddedEntry = {
  id: number
  name: string
  quantity: number
  note?: string
  snapshot: { parsedData: ParsedPayload | null; missing: CatalogItem[]; unknown: UnknownItem[] }
}
type DataEntryMode = 'manual' | 'photo'
type InlineCreateItemForm = {
  official_name: string
  stocklist_name: string
  product: string
  category: string
  location: 'Inside Coolroom' | 'Outside Coolroom'
  sub_location: string
  attribute: string
  origin: string
  inner_quantity: number | null
  inner_unit: CatalogInnerUnit
}
const DATA_ENTRY_MOBILE_VIEW_KEY = 'smartstock:data-entry-mobile-view'
const DATA_ENTRY_EXPANDED_SECTIONS_KEY = 'smartstock:data-entry-expanded-sections'
const OUTSIDE_SECTION_ID = 'outside-coolroom'
const UNKNOWN_SECTION_ID = 'unclassified-staff-inspection'
const AUTO_EXPAND_SECTION_ROW_LIMIT = 20
const INSIDE_SUB_LOCATION_OPTIONS = ['Apples', 'Citrus', 'Asian', 'Melon', 'All Year', 'Seasonal', 'Stonefruit'] as const
const OUTSIDE_SUB_LOCATION_OPTIONS = ['Outside Coolroom'] as const
const INNER_UNIT_OPTIONS: CatalogInnerUnit[] = ['box', 'bag', 'punnet', 'piece', 'tray', 'bunch', 'pack', 'kg', 'g']

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
    origin: item.origin,
    inner_quantity: item.inner_quantity,
    inner_unit: item.inner_unit,
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
  const parsed = Number.parseFloat(trimmed)
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
      origin: typeof row.origin === 'string' ? row.origin : '',
      inner_quantity: typeof row.inner_quantity === 'number' && Number.isFinite(row.inner_quantity)
        ? row.inner_quantity
        : typeof row.inner_quantity === 'string' && Number.isFinite(Number(row.inner_quantity))
          ? Number(row.inner_quantity)
          : null,
      inner_unit: INNER_UNIT_OPTIONS.includes(row.inner_unit as CatalogInnerUnit) ? row.inner_unit as CatalogInnerUnit : 'box',
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
        origin: normalizedRow.origin,
        inner_quantity: normalizedRow.inner_quantity,
        inner_unit: normalizedRow.inner_unit,
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

export default function Home() {
  const today = useMemo(() => getLocalTodayDate(), [])
  const stockMode: StockMode = 'stock-in'
  const [activeSection, setActiveSection] = useState<HubSection>('data-entry')
  const [stockInPhase, setStockInPhase] = useState<'landing' | 'editing'>('landing')
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false)
  const [visitedSections, setVisitedSections] = useState<Set<HubSection>>(() => new Set<HubSection>(['data-entry']))
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
  const [isLoadingBigQuery, setIsLoadingBigQuery] = useState(false)
  const [isCatalogUploading, setIsCatalogUploading] = useState(false)
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [latestGenerateUid, setLatestGenerateUid] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<string | null>(null)
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
  const [dataEntryTouchedIndexes, setDataEntryTouchedIndexes] = useState<Set<number>>(() => new Set())
  const [lastAddedEntry, setLastAddedEntry] = useState<LastAddedEntry | null>(null)
  const hadParsedDataRef = useRef(false)
  const dataEntryItemInputRef = useRef<HTMLInputElement | null>(null)
  const dataEntryQtyInputRef = useRef<HTMLInputElement | null>(null)
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
    origin: '',
    inner_quantity: null,
    inner_unit: 'box',
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
  const [confirmAction, confirmElement] = useConfirm()

  useEffect(() => {
    setVisitedSections((current) => (current.has(activeSection) ? current : new Set(current).add(activeSection)))
    setIsHistorySheetOpen(false)
  }, [activeSection])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }, [])

  const addToast = useCallback((variant: 'success' | 'error', message: string) => {
    if (variant === 'error') {
      const friendly = friendlyError(message)
      toast.error(friendly.message, { details: friendly.details })
    } else {
      toast.success(message)
    }
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
      const confirmed = await confirmAction({
        title: `Hide ${target.official_name}?`,
        message: 'It will no longer appear in Stock In or Check Stock. You can show it again from Catalog.',
        confirmLabel: 'Hide item',
      })
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
  }, [activeCatalog, confirmAction])

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
        origin: item.origin ?? '',
        inner_quantity: item.inner_quantity ?? null,
        inner_unit: item.inner_unit ?? 'box',
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

  const loadTranscriptionHistory = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!silent) {
      setIsHistoryLoading(true)
      setApiError(null)
    }

    try {
      const response = await fetch('/api/transcription-history', { cache: 'no-store' })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load transcription history.')
      }

      const allHistory = Array.isArray(payload.history) ? payload.history : []
      // DB stores mode as 'closing_check' or 'arrival_entry' — exclude closing records from Stock In view
      setHistoryData(allHistory.filter((entry: HistoryEntry) => entry.stockMode !== 'closing_check'))
    } catch (error) {
      if (shouldSilenceOfflineNetworkError(error)) {
        return
      }

      if (!silent) {
        setApiError(error instanceof Error ? error.message : 'Failed to load history.')
      }
    } finally {
      if (!silent) setIsHistoryLoading(false)
    }
  }, [])

  const loadStockCheckHistory = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!silent) {
      setIsStockCheckHistoryLoading(true)
      setApiError(null)
    }

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

      if (!silent) {
        setApiError(error instanceof Error ? error.message : 'Failed to load stock check history.')
      }
    } finally {
      if (!silent) setIsStockCheckHistoryLoading(false)
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

  // Count from the saved draft itself: on the start screen the editor is still empty.
  const stockInDraftItemCount = useMemo(() => {
    if (!hasStockInLocalDraft || stockInPhase !== 'landing') return 0
    const draft = loadOfflineDraft<StockInOfflineDraft>('stock-in')
    if (!draft?.parsedData) return 0
    const counted = (items: Array<{ quantity?: number | null }> | undefined) =>
      (items ?? []).filter((item) => item.quantity !== null && item.quantity !== undefined).length
    return counted(draft.parsedData.items) + counted(draft.missingCatalogItems) + counted(draft.unknownItems)
  }, [hasStockInLocalDraft, stockInPhase])

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
      // Only clear when work in this session was cleared. On a fresh load parsedData starts
      // empty, and the saved draft must survive so "Continue draft" can restore it.
      if (hadParsedDataRef.current) {
        clearOfflineDraft('stock-in')
        setHasStockInLocalDraft(false)
      }
      return
    }
    hadParsedDataRef.current = true

    // Debounced so typing stays smooth on slow phones; flushed when the app is hidden or closed.
    const save = () => {
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
    }
    return scheduleDraftSave(save)
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

        // History lists are not needed to render the page, so load them in the
        // background in parallel instead of blocking startup behind each request.
        void loadTranscriptionHistory()
        void loadStockCheckHistory()

        try {
          await loadCatalogFromApi()
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

  // Keep Stock In / Stock Close history live without a manual refresh.
  useHistoryRealtime(session?.user?.id, {
    onStockInChange: () => void loadTranscriptionHistory({ silent: true }),
    onStockCheckChange: () => void loadStockCheckHistory({ silent: true }),
  })

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
    const friendly = friendlyError(apiError)
    toast.error(friendly.message, { details: friendly.details })
    setApiError(null)
  }, [apiError])

  useEffect(() => {
    if (!apiStatus) return
    // Ambient "ready" messages are obvious from the screen itself.
    if (apiStatus !== STATUS.READY_MANUAL && apiStatus !== STATUS.STARTING_FRESH) toast.success(apiStatus)
    setApiStatus(null)
  }, [apiStatus])

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
      const versionName = `${baseName}-${getLocalTodayDate()}`
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
        origin: item.origin ?? '',
        inner_quantity: item.inner_quantity ?? null,
        inner_unit: item.inner_unit ?? 'box',
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
        origin: c_item.origin,
        inner_quantity: c_item.inner_quantity,
        inner_unit: c_item.inner_unit,
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

    return [...allItems, ...missingItems, ...unknownMapped].filter((row) =>
      isRowListed(row.item, dataEntryTouchedIndexes.has(row.index))
    )
  }, [activeCatalog, dataEntryTouchedIndexes, missingCatalogItems, parsedData, unknownItems, visibleCatalogCodes])

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
    return rankSuggestions(visibleCatalog, dataEntryNewItemName)
  }, [dataEntryNewItemName, visibleCatalog])

  const dataEntryQtyByCode = useMemo(() => {
    const map = new Map<string, number>()
    indexedItems.forEach((row) => {
      const code = (row.item.catalog_code ?? '').trim().toUpperCase()
      if (code && row.item.quantity !== null) map.set(code, row.item.quantity)
    })
    return map
  }, [indexedItems])

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

  const editableDataEntryCatalogItem = useMemo(() => {
    if (selectedDataEntryCatalogItem) return selectedDataEntryCatalogItem

    const typedKey = dataEntryNewItemName.trim().toLowerCase()
    if (!typedKey) return null

    return visibleCatalog.find((item) => {
      return item.code.trim().toLowerCase() === typedKey
        || item.official_name.trim().toLowerCase() === typedKey
        || item.stocklist_name.trim().toLowerCase() === typedKey
    }) ?? null
  }, [dataEntryNewItemName, selectedDataEntryCatalogItem, visibleCatalog])

  const syncItemProfilesFromCatalogItem = useCallback((catalogItem: CatalogItem) => {
    setInlineCreateForm({
      official_name: catalogItem.official_name ?? '',
      stocklist_name: catalogItem.stocklist_name ?? catalogItem.official_name ?? '',
      product: catalogItem.product ?? '',
      category: catalogItem.category ?? '',
      location: catalogItem.location === 'Outside Coolroom' ? 'Outside Coolroom' : 'Inside Coolroom',
      sub_location: catalogItem.sub_location ?? (catalogItem.location === 'Outside Coolroom' ? OUTSIDE_SUB_LOCATION_OPTIONS[0] : INSIDE_SUB_LOCATION_OPTIONS[0]),
      attribute: catalogItem.attribute ?? '',
      origin: catalogItem.origin ?? '',
      inner_quantity: catalogItem.inner_quantity ?? null,
      inner_unit: catalogItem.inner_unit ?? 'box',
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

  const addKnownDataEntryItem = useCallback((catalogItem: CatalogItem, quantityOverride: number | null = null): boolean => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before adding items.')
      return false
    }

    const codeKey = catalogItem.code.trim().toUpperCase()
    if (existingKnownCodes.has(codeKey)) {
      setApiStatus(`${catalogItem.official_name} is already in the list.`)
      setApiError(null)
      setDataEntryNewItemName('')
      return false
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
            origin: catalogItem.origin,
            inner_quantity: catalogItem.inner_quantity,
            inner_unit: catalogItem.inner_unit,
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
    return true
  }, [existingKnownCodes, parsedData])

  const selectDataEntryCatalogSuggestion = useCallback((catalogItem: CatalogItem) => {
    setDataEntrySelectedCatalogCode(catalogItem.code)
    setDataEntryNewItemName(catalogItem.official_name)
    syncItemProfilesFromCatalogItem(catalogItem)
    setDataEntryAddHighlightIndex(-1)
    setApiError(null)
    // Chain: item picked -> keypad opens on Qty
    requestAnimationFrame(() => dataEntryQtyInputRef.current?.focus())
  }, [syncItemProfilesFromCatalogItem])

  const handleItemInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (dataEntryAddSuggestions.length === 0 || dataEntrySelectedCatalogCode) {
      if (event.key === 'Enter' && event.currentTarget.value.trim()) {
        event.preventDefault()
        dataEntryQtyInputRef.current?.focus()
      }
      return
    }

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
  }, [dataEntryAddHighlightIndex, dataEntryAddSuggestions, dataEntrySelectedCatalogCode, selectDataEntryCatalogSuggestion])

  const updateItem = useCallback((index: number, patch: Partial<StockItem>) => {
    setIsValidatedByStaff(false)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    if (patch.quantity !== undefined || patch.quantity_raw !== undefined) {
      setDataEntryTouchedIndexes((current) => (current.has(index) ? current : new Set(current).add(index)))
      setLastAddedEntry(null)
    }

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

  const noteAdded = useCallback((name: string, quantity: number, snapshot: LastAddedEntry['snapshot'], note?: string) => {
    setLastAddedEntry({ id: Date.now(), name, quantity, note, snapshot })
    setDataEntryTouchedIndexes(new Set())
  }, [])

  const undoLastAdded = useCallback(() => {
    if (!lastAddedEntry) return
    setParsedData(lastAddedEntry.snapshot.parsedData)
    setMissingCatalogItems(lastAddedEntry.snapshot.missing)
    setUnknownItems(lastAddedEntry.snapshot.unknown)
    setLastAddedEntry(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    dataEntryItemInputRef.current?.focus()
  }, [lastAddedEntry])

  const addManualKnownItem = useCallback((): boolean => {
    if (!parsedData) {
      setApiError('Please start manual entry or parse a photo before adding items.')
      return false
    }

    if (!parsedData.stock_date || !isIsoDate(parsedData.stock_date)) {
      setApiError('Please set a valid stock date before adding items.')
      return false
    }

    const itemName = dataEntryNewItemName.trim()
    if (!itemName) {
      setApiError('Enter an item name before adding.')
      return false
    }

    const quantity = parseWholeQuantity(manualEntryQuantity)
    if (quantity === null) {
      setApiError('Enter a whole-number quantity before adding.')
      return false
    }

    // Copies, because updateItem edits missing/unknown rows in place
    const snapshot: LastAddedEntry['snapshot'] = {
      parsedData,
      missing: missingCatalogItems.map((entry) => ({ ...entry })),
      unknown: unknownItems.map((entry) => ({ ...entry })),
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
          origin: '',
          inner_quantity: null,
          inner_unit: 'box',
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
      noteAdded(itemName, quantity, snapshot, 'not in catalog')
      return true
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
      noteAdded(chosen.official_name, quantity, snapshot)
      return true
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
      noteAdded(chosen.official_name, quantity, snapshot)
      return true
    }

    const added = addKnownDataEntryItem(chosen, quantity)
    if (added) noteAdded(chosen.official_name, quantity, snapshot)
    return added
  }, [
    addKnownDataEntryItem,
    noteAdded,
    unknownItems,
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

  const submitManualEntry = useCallback(() => {
    if (addManualKnownItem()) {
      // Chain: added -> back to an empty search for the next item
      requestAnimationFrame(() => dataEntryItemInputRef.current?.focus())
    }
  }, [addManualKnownItem])

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
      origin: created.origin,
      inner_quantity: created.inner_quantity,
      inner_unit: created.inner_unit,
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
            origin: created.origin,
            inner_quantity: created.inner_quantity,
            inner_unit: created.inner_unit,
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

    if (!officialName || !category) {
      setApiError('Items profile mini form requires Official Name and Category.')
      return
    }

    const editingCatalogItem = editableDataEntryCatalogItem
    const payload: CreateCatalogItemPayload = {
      code: editingCatalogItem?.code ?? generateCatalogCode(category, product, inlineCreateForm.attribute.trim()),
      location: inlineCreateForm.location,
      sub_location: inlineCreateForm.sub_location,
      category,
      product,
      attribute: inlineCreateForm.attribute.trim(),
      origin: inlineCreateForm.origin.trim(),
      inner_quantity: inlineCreateForm.inner_quantity,
      inner_unit: inlineCreateForm.inner_unit,
      official_name: officialName,
      stocklist_name: stocklistName,
      navigation_guide: editingCatalogItem?.navigation_guide ?? '',
      row_position: editingCatalogItem?.row_position ?? 'single',
      is_visible: editingCatalogItem?.is_visible ?? true,
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

      if (editingCatalogItem) {
        const normalizedCode = editingCatalogItem.code.trim().toUpperCase()
        const updatedCatalogItem: CatalogItem = {
          ...editingCatalogItem,
          ...payload,
          id: editingCatalogItem.id,
        }

        setActiveCatalog((current) => {
          if (!current) return current
          return current.map((item) => (
            item.code.trim().toUpperCase() === normalizedCode ? updatedCatalogItem : item
          ))
        })

        setParsedData((current) => {
          if (!current) return current
          return {
            ...current,
            items: current.items.map((item) => (
              (item.catalog_code ?? '').trim().toUpperCase() === normalizedCode
                ? {
                    ...item,
                    product_raw: payload.stocklist_name || payload.official_name,
                    location: payload.location,
                    sub_location: payload.sub_location,
                    category: payload.category,
                    product: payload.product,
                    attribute: payload.attribute,
                    origin: payload.origin,
                    inner_quantity: payload.inner_quantity,
                    inner_unit: payload.inner_unit,
                    official_name: payload.official_name,
                    stocklist_name: payload.stocklist_name,
                    navigation_guide: payload.navigation_guide,
                    row_position: payload.row_position,
                  }
                : item
            )),
          }
        })

        setMissingCatalogItems((current) => current.map((item) => (
          item.code.trim().toUpperCase() === normalizedCode
            ? {
                ...item,
                location: payload.location,
                sub_location: payload.sub_location,
                category: payload.category,
                product: payload.product,
                attribute: payload.attribute,
                origin: payload.origin,
                inner_quantity: payload.inner_quantity,
                inner_unit: payload.inner_unit,
                official_name: payload.official_name,
                stocklist_name: payload.stocklist_name,
                navigation_guide: payload.navigation_guide,
                row_position: payload.row_position,
              }
            : item
        )))

        setHasSavedToSupabase(false)
        setHasLoadedToDb(false)
        setIsValidatedByStaff(false)
        setApiStatus(`Updated catalog profile for ${payload.official_name}.`)
      } else {
        addCreatedDataEntryItem(payload)
        setInlineCreateForm((current) => ({
          ...current,
          official_name: '',
          stocklist_name: '',
          product: '',
          attribute: '',
          origin: '',
          inner_quantity: null,
          inner_unit: 'box',
        }))
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to save catalog item.')
    } finally {
      setIsInlineCreateSaving(false)
    }
  }, [addCreatedDataEntryItem, editableDataEntryCatalogItem, inlineCreateForm, parsedData])

  const startManualEntry = useCallback(() => {
    const freshToday = getLocalTodayDate()
    const manualDraft = buildManualParsedPayload(visibleCatalog, stockMode, freshToday)

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
  }, [visibleCatalog])

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

      // Keep history in sync in the background; realtime also refreshes it.
      void loadTranscriptionHistory({ silent: true })
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
    const num = parseFloat(trimmed)
    if (isNaN(num)) {
      return { quantity: null, quantity_raw: trimmed, quantity_conflict_flag: true }
    }
    return { quantity: num, quantity_raw: trimmed, quantity_conflict_flag: false }
  }

  function getClasses(row: IndexedItem | undefined, baseCls: string) {
    if (!row) return baseCls
    if (row.index === highlightedDataEntryIndex) return `${baseCls} !bg-success-soft transition-colors duration-700`
    if (row.source === 'missing') return `${baseCls} !text-warning`
    if (row.source === 'unknown') return `${baseCls} !text-red-600 font-semibold`
    return baseCls
  }

  function getCardClasses(row: IndexedItem | undefined) {
    if (!row) return ''
    if (row.index === highlightedDataEntryIndex) return 'ring-2 ring-accent bg-success-soft'
    if (row.source === 'missing') return 'border-warning/30 bg-warning-soft'
    if (row.source === 'unknown') return 'border-red-300 bg-red-50'
    return ''
  }

  function renderDataEntryLabelCell(row: IndexedItem, className: string) {
    const code = row.item.catalog_code?.trim().toUpperCase() ?? ''
    const latestCatalogItem = code ? visibleCatalog.find(c => c.code.trim().toUpperCase() === code) : null;
    const displayName = latestCatalogItem?.official_name ?? row.item.official_name ?? row.item.product_raw ?? '';

    return (
      <div className="flex items-center gap-1">
        <input
          data-entry-row-index={row.index}
          className={getClasses(row, className)}
          value={displayName}
          readOnly
          onChange={(event) =>
            updateItem(row.index, { official_name: event.target.value })
          }
        />
      </div>
    )
  }

  function renderDataEntryQuantityCell(row: IndexedItem) {
    return (
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        onKeyDown={focusNextQuantityInput}
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
        endpoint: '/api/save-to-bigquery',
        payload: requestPayload,
      })
      setApiStatus(STATUS.OFFLINE_QUEUED)
      setHasSavedToSupabase(false)
      setIsSavingSupabase(false)
      return
    }

    try {
      const response = await fetch('/api/save-to-bigquery', {
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
          endpoint: '/api/save-to-bigquery',
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

  // Re-push mode: the API reads the saved Supabase record by uid, so Retry is always safe.
  const syncStockInToWarehouse = useCallback((uid: string, toastId?: number) => {
    const id = toastId ?? toast.progress('Saved · syncing to warehouse…')
    if (toastId) toast.update(id, { tone: 'progress', message: 'Syncing to warehouse…', action: undefined, details: undefined })
    void (async () => {
      try {
        const response = await fetch('/api/save-to-bigquery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid_generate: uid }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error ?? 'Warehouse sync failed.')
        setHasLoadedToDb(true)
        toast.update(id, { tone: 'success', message: 'Stock in saved and synced' })
      } catch (error) {
        toast.update(id, {
          tone: 'error',
          message: 'Saved. Warehouse sync failed.',
          details: error instanceof Error ? error.message : undefined,
          action: { label: 'Retry', onClick: () => syncStockInToWarehouse(uid) },
        })
      }
    })()
  }, [])

  const handleStockInDone = useCallback(async () => {
    if (!parsedData) {
      setApiError('No data to save.')
      return
    }

    // Step 1: validate
    const valid = normalizeAndMarkValidated(false)
    if (!valid) return

    // Step 2: save to Supabase (the only step staff wait for)
    const saved = await saveToSupabase()
    if (!saved) return

    // Step 3: clear draft and return to the menu right away
    clearOfflineDraft('stock-in')
    setHasStockInLocalDraft(false)
    setStockInPhase('landing')

    // Step 4: warehouse (BigQuery) sync runs in the background with its own progress toast
    const uid = typeof saved === 'string' ? saved : latestGenerateUid
    if (uid && window.navigator.onLine) {
      syncStockInToWarehouse(uid)
    } else if (window.navigator.onLine) {
      toast.success('Stock in saved')
    }
  }, [parsedData, normalizeAndMarkValidated, latestGenerateUid, saveToSupabase, syncStockInToWarehouse])

  async function loadToBigQuery(overrideUidOrSaved?: string | boolean) {
    if (!parsedData) {
      setApiError('No parsed data to load yet. Parse a stock photo first.')
      return false
    }

    const targetUid = typeof overrideUidOrSaved === 'string' ? overrideUidOrSaved : latestGenerateUid

    if (!targetUid && overrideUidOrSaved !== true) {
      setApiError('No transcription record is available yet. Parse a stock photo first.')
      return false
    }

    // Validation and Supabase save are guaranteed by handleStockInDone pipeline

    setIsLoadingBigQuery(true)
    setApiError(null)
    setApiStatus(null)

    try {
      // Use re-push mode: send only uid_generate so the API fetches
      // the authoritative data from the Supabase record we just saved.
      // This prevents stale closure data from overwriting the correct record.
      const response = await fetch('/api/save-to-bigquery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid_generate: targetUid,
        }),
      })

      const payload = await response.json()

      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before saving to BigQuery.')
      }

      if (!response.ok) {
        const details = payload?.details
        const detailsText = typeof details === 'string' ? details : details ? JSON.stringify(details) : ''
        throw new Error(
          detailsText
            ? `${payload?.error ?? 'BigQuery save failed.'} Details: ${detailsText}`
            : payload?.error ?? 'BigQuery save failed.'
        )
      }

      // Success, no extra toast needed since handleStockInDone fires "All done!"
      setHasLoadedToDb(true)
      return true
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected BigQuery save error.')
      return false
    } finally {
      setIsLoadingBigQuery(false)
    }
  }

  async function repushToBigQuery(uid: string) {
    setIsRepushing(true)
    setApiError(null)
    setApiStatus(null)

    try {
      const response = await fetch('/api/save-to-bigquery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid_generate: uid,
          reprocess: true,
        }),
      })

      const payload = await response.json()

      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before pushing to BigQuery.')
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to repush to BigQuery.')
      }

      setApiStatus(`Entry repushed to BigQuery successfully.`)
      // Reload history to refresh push status
      await loadTranscriptionHistory()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unexpected repush error.')
    } finally {
      setIsRepushing(false)
    }
  }

  async function deleteTranscriptionHistory(uid: string) {
    const confirmed = await confirmAction({
      title: 'Delete this stock-in record?',
      message: 'It is removed from the app history for good. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
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
    const confirmed = await confirmAction({
      title: 'Delete this stock check?',
      message: 'It is removed from the app history for good. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
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
    const freshToday = getLocalTodayDate()
    setEditingHistoryUid(null)
    setSelectedHistoryUid(null)
    setLatestGenerateUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setParsedData((prev) => prev ? { ...prev, stock_date: freshToday } : prev)
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
      const filteredHistory = freshHistory.filter((entry) => entry.stockMode !== 'closing_check')
      setHistoryData(filteredHistory)

      const fresh = filteredHistory.find((entry) => entry.uid_generate === uid)

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
    <AppShell
      active={activeSection}
      onNavigate={(section) => setActiveSection(section)}
      sync={{ isOnline, pendingCount: offlineQueueCount, isSyncing: isOfflineSyncing }}
      account={session ? { email: session.user.email ?? null, roles: session.roles } : null}
      isAuthLoading={isAuthLoading}
      onSignOut={signOut}
      onOpenHistory={showSidebarHistory ? () => setIsHistorySheetOpen(true) : undefined}
      historyLabel={isStockCheckTab ? 'Stock check history' : 'Stock in history'}
    >
      <ToastViewport />
      {confirmElement}
      <Sheet
        open={isHistorySheetOpen && showSidebarHistory}
        onClose={() => setIsHistorySheetOpen(false)}
        title={isStockCheckTab ? 'Stock check history' : 'Stock in history'}
        size="md"
      >
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[14px] text-muted">Tap a record to open it.</p>
                {isStockCheckTab ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsHistorySheetOpen(false)
                      void openStockCheckHistory()
                    }}
                    className="inline-flex min-h-10 items-center rounded-control px-2 text-[14px] font-semibold text-forest-800 hover:bg-forest-50"
                  >
                    Manage all
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsHistorySheetOpen(false)
                      void openHistory()
                    }}
                    className="inline-flex min-h-10 items-center rounded-control px-2 text-[14px] font-semibold text-forest-800 hover:bg-forest-50"
                  >
                    Manage all
                  </button>
                )}
              </div>

              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
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
                  placeholder={isStockCheckTab ? 'Search date or ID' : 'Search file or date'}
                  className={fieldClass}
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
                  className={`${inputClass} w-auto pr-8`}
                >
                  <option value="all">All</option>
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
                  <p className="py-6 text-center text-[15px] text-muted">Loading history…</p>
                ) : sidebarStockCheckHistory.length === 0 ? (
                  <p className="py-6 text-center text-[15px] text-muted">No records yet.</p>
                ) : (
                  <div className="space-y-2">
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
                            setIsHistorySheetOpen(false)
                            if (activeSection === 'stock-check' && selectedStockCheckHistoryRecord) {
                                setPendingStockCheckHistoryLoad(entry)
                            } else {
                                setSelectedStockCheckHistoryRecord(entry)
                            }
                          }}
                          badges={[
                            {
                              label: modeLabel,
                              className: 'rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700',
                            },
                            {
                              label: entry.validated ? 'Validated' : 'Unvalidated',
                              className: `rounded-full px-2 py-0.5 text-[12px] font-medium ${entry.validated
                                  ? 'bg-success-soft text-success'
                                  : 'bg-warning-soft text-warning'
                                }`,
                            },
                          ]}
                        />
                      )
                    })}
                  </div>
                )
              ) : isHistoryLoading ? (
                <p className="py-6 text-center text-[15px] text-muted">Loading history…</p>
              ) : sidebarDataEntryHistory.length === 0 ? (
                <p className="py-6 text-center text-[15px] text-muted">No records yet.</p>
              ) : (
                <div className="space-y-2">
                  {sidebarDataEntryHistory.map((entry) => {
                    const modeLabel = entry.stockMode === 'closing_check' ? 'Closing' : 'Arrival'

                    return (
                      <SidebarHistoryCard
                        key={entry.uid_generate}
                        title={entry.filename}
                        timestamp={entry.timestamp}
                        selected={selectedHistoryUid === entry.uid_generate}
                        onClick={() => {
                          setIsHistorySheetOpen(false)
                          if (activeSection === 'data-entry' && stockInPhase === 'landing') setStockInPhase('editing')
                          if (parsedData && parsedData.items.some(i => i.quantity !== null) && !editingHistoryUid) {
                            setPendingHistoryLoad(entry.uid_generate)
                          } else {
                            void loadDataEntryHistoryToEditor(entry.uid_generate)
                          }
                        }}
                        badges={[
                          {
                            label: modeLabel,
                            className: 'rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700',
                          },
                          {
                            label: entry.isPushed ? 'Pushed' : 'Pending',
                            className: `rounded-full px-2 py-0.5 text-[12px] font-medium ${entry.isPushed
                                ? 'bg-success-soft text-success'
                                : 'bg-warning-soft text-warning'
                              }`,
                          },
                        ]}
                      />
                    )
                  })}
                </div>
              )}
            </div>
      </Sheet>

          {visitedSections.has('catalog') ? (
            <div hidden={activeSection !== 'catalog'}>
              <CatalogManagementView embedded />
            </div>
          ) : null}
          {visitedSections.has('stock-check') ? (
            <div hidden={activeSection !== 'stock-check'}>
              <EmbeddedStockCheckPanel
                catalogItems={visibleCatalog}
                selectedHistoryRecord={selectedStockCheckHistoryRecord}
                historyRecords={stockCheckHistory}
                onToggleCatalogVisibility={toggleCatalogItemVisibility}
                onOpenHistory={() => setIsHistorySheetOpen(true)}
              />
            </div>
          ) : null}
          {visitedSections.has('daily-report') ? (
            <div hidden={activeSection !== 'daily-report'}>
              <DailyReportPanel catalogItems={visibleCatalog} />
            </div>
          ) : null}
          {visitedSections.has('dashboard') ? (
            <div hidden={activeSection !== 'dashboard'}>
              <DashboardPanel catalogItems={visibleCatalog} />
            </div>
          ) : null}
          <div hidden={activeSection !== 'data-entry'}>
          {stockInPhase === 'landing' ? (
            <SectionLandingState
              sectionLabel="Stock in"
              subtitle="Count what arrived this morning."
              hasDraft={hasStockInLocalDraft}
              draftAge={getOfflineDraftAge('stock-in')}
              draftItemCount={stockInDraftItemCount}
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
              <section className="rounded-card border border-line bg-surface p-4 sm:p-6">
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => setStockInPhase('landing')}
                    className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-control px-2 text-[15px] text-muted hover:bg-slate-100 hover:text-ink"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    Menu
                  </button>
                  <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                    <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                      {editingHistoryUid ? 'Edit stock in' : 'Stock in'}
                    </h1>
                    <p className="text-[14px] text-muted tabular">
                      {formatSheetDate(parsedData?.stock_date || today)} · {filledItemCount} {filledItemCount === 1 ? 'item' : 'items'} counted
                    </p>
                  </div>
                </div>

                {editingHistoryUid && (
                  <div className="mb-4 flex items-center gap-3 rounded-control bg-forest-50 px-3 py-2 text-[14px] text-forest-900">
                    <p className="min-w-0 flex-1">Saving will update the saved record.</p>
                    <button
                      type="button"
                      onClick={startNewDraftFromCurrent}
                      className="inline-flex min-h-9 shrink-0 items-center rounded-[8px] px-2.5 text-[14px] font-semibold text-forest-800 hover:bg-forest-100"
                    >
                      Save as new
                    </button>
                  </div>
                )}

                <div className="grid gap-4">
                  <EntryMethodToggle
                    value={isManualEntryMode ? 'manual' : 'photo'}
                    onManual={confirmStartManualEntry}
                    onPhoto={confirmStartPhotoEntry}
                    manualLabel="Type"
                    photoLabel="Photo"
                    manualHelpText="Search an item, type the count, press Enter."
                    photoHelpText="Take or choose a photo of the paper sheet, then check the numbers."
                  />

                  {isManualEntryMode ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="md:rounded-card md:border md:border-line md:p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <label htmlFor="paper-stock-date" className="whitespace-nowrap text-[14px] font-medium text-ink">Stock date</label>
                            <input
                              id="paper-stock-date"
                              type="date"
                              value={parsedData?.stock_date ?? ''}
                              onChange={(event) => updateParsedStockDate(event.target.value)}
                              disabled={!parsedData}
                              className={`${inputClass} w-auto tabular`}
                            />
                          </div>

                          <div ref={dataEntryAddContainerRef} className="relative">
                            <label htmlFor="stock-in-item-search" className="mb-1.5 block text-[14px] font-medium text-ink">Item</label>
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                              <input
                                id="stock-in-item-search"
                                ref={dataEntryItemInputRef}
                                type="search"
                                value={dataEntryNewItemName}
                                onChange={(event) => {
                                  setDataEntryNewItemName(event.target.value)
                                  setDataEntrySelectedCatalogCode(null)
                                }}
                                onKeyDown={handleItemInputKeyDown}
                                placeholder="Search item"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                enterKeyHint="next"
                                disabled={!parsedData}
                                className={`${fieldClass} min-h-12 pl-10`}
                              />
                            </div>

                            {dataEntryNewItemName.trim().length > 0 && dataEntryAddSuggestions.length > 0 && parsedData && !dataEntrySelectedCatalogCode && (
                              <div role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-control border border-line bg-surface shadow-raised">
                                {dataEntryAddSuggestions.map((item, suggestionIndex) => {
                                  const currentQty = dataEntryQtyByCode.get(item.code.trim().toUpperCase())
                                  const highlighted = suggestionIndex === dataEntryAddHighlightIndex
                                  return (
                                    <button
                                      key={item.code}
                                      type="button"
                                      role="option"
                                      aria-selected={highlighted}
                                      onPointerDown={(event) => event.preventDefault()}
                                      onClick={() => selectDataEntryCatalogSuggestion(item)}
                                      className={`flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left last:border-b-0 ${highlighted ? 'bg-forest-50' : 'hover:bg-slate-50 active:bg-slate-100'}`}
                                    >
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[15px] text-ink">{item.official_name}</span>
                                        <span className="block truncate text-[12px] text-muted">{item.category || item.code}</span>
                                      </span>
                                      {currentQty !== undefined ? (
                                        <span className="shrink-0 rounded-full bg-forest-50 px-2 py-0.5 text-[12px] font-medium text-forest-800 tabular">has {currentQty}</span>
                                      ) : null}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          <div className="flex items-end gap-2">
                            <div className="min-w-0 flex-1">
                              <label htmlFor="stock-in-qty" className="mb-1.5 block text-[14px] font-medium text-ink">Quantity</label>
                              <NumberInput
                                id="stock-in-qty"
                                ref={dataEntryQtyInputRef}
                                inputMode="numeric"
                                enterKeyHint="done"
                                value={manualEntryQuantity}
                                onChange={(event) => setManualEntryQuantity(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    submitManualEntry()
                                  }
                                }}
                                placeholder="0"
                                disabled={!parsedData}
                                className="min-h-12 text-[18px] font-semibold"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={submitManualEntry}
                              disabled={!parsedData || !parsedData.stock_date || dataEntryNewItemName.trim().length === 0 || parseWholeQuantity(manualEntryQuantity) === null}
                              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-control bg-forest px-5 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest/30"
                            >
                              <Plus className="h-5 w-5" aria-hidden="true" />
                              Add
                            </button>
                          </div>

                          {lastAddedEntry ? (
                            <div key={lastAddedEntry.id} className="flex animate-fade-in items-center gap-2 rounded-control bg-forest-50 py-1.5 pl-3 pr-1.5" role="status">
                              <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                              <p className="min-w-0 flex-1 truncate text-[14px] text-ink">
                                <span className="font-medium">{lastAddedEntry.name}</span>
                                <span className="tabular"> · {lastAddedEntry.quantity}</span>
                                {lastAddedEntry.note ? <span className="text-muted"> · {lastAddedEntry.note}</span> : null}
                              </p>
                              <button
                                type="button"
                                onClick={undoLastAdded}
                                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[8px] px-2.5 text-[14px] font-semibold text-forest-800 hover:bg-forest-100"
                              >
                                <Undo2 className="h-4 w-4" aria-hidden="true" />
                                Undo
                              </button>
                            </div>
                          ) : null}
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
                            <p className="mt-0.5 text-xs text-slate-500">
                              {editableDataEntryCatalogItem ? 'Edit this catalog profile.' : 'Create a catalog profile if it is new.'}
                            </p>
                          </div>
                          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-[12px] font-medium text-muted">
                            {isItemProfilesExpanded ? 'Collapse' : 'Expand'}
                          </span>
                        </button>

                        {isItemProfilesExpanded && (
                          <>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <label className="text-[13px] font-medium text-muted">
                                Official Name
                                <input
                                  type="text"
                                  value={inlineCreateForm.official_name}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, official_name: event.target.value }))}
                                  placeholder="Official Name"
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                />
                              </label>
                              <label className="text-[13px] font-medium text-muted">
                                Origin
                                <input
                                  type="text"
                                  value={inlineCreateForm.origin}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, origin: event.target.value }))}
                                  placeholder="Origin"
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                />
                              </label>
                              <label className="text-[13px] font-medium text-muted">
                                Category
                                <select
                                  value={inlineCreateForm.category}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, category: event.target.value }))}
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                >
                                  <option value="">Select category</option>
                                  {dataEntryCreateCategories.map((category) => (
                                    <option key={category} value={category}>{category}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-[13px] font-medium text-muted">
                                Location
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
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                >
                                  <option value="Inside Coolroom">Inside Coolroom</option>
                                  <option value="Outside Coolroom">Outside Coolroom</option>
                                </select>
                              </label>
                              <label className="text-[13px] font-medium text-muted">
                                Sub-location
                                <select
                                  value={inlineCreateForm.sub_location}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, sub_location: event.target.value }))}
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                >
                                  {(inlineCreateForm.location === 'Outside Coolroom' ? OUTSIDE_SUB_LOCATION_OPTIONS : INSIDE_SUB_LOCATION_OPTIONS).map((subLocation) => (
                                    <option key={subLocation} value={subLocation}>{subLocation}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <label className="min-w-[150px] flex-1 text-[13px] font-medium text-muted">
                                Attribute
                                <input
                                  type="text"
                                  value={inlineCreateForm.attribute}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, attribute: event.target.value }))}
                                  placeholder="e.g. Loose"
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                />
                              </label>
                              <label className="w-32 text-[13px] font-medium text-muted">
                                Quantity / Weight (items)
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={inlineCreateForm.inner_quantity ?? ''}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, inner_quantity: event.target.value === '' ? null : Number(event.target.value) }))}
                                  placeholder="e.g. 8"
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                />
                              </label>
                              <label className="w-32 text-[13px] font-medium text-muted">
                                Unit
                                <select
                                  value={inlineCreateForm.inner_unit}
                                  onChange={(event) => setInlineCreateForm((current) => ({ ...current, inner_unit: event.target.value as CatalogInnerUnit }))}
                                  className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 focus:border-brand-500 focus:outline-none"
                                >
                                  {INNER_UNIT_OPTIONS.map((unit) => (
                                    <option key={unit} value={unit}>{unit}</option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                onClick={submitInlineCreateItem}
                                disabled={isInlineCreateSaving || !parsedData}
                                className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                              >
                                {isInlineCreateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editableDataEntryCatalogItem ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                {isInlineCreateSaving ? 'Saving...' : editableDataEntryCatalogItem ? 'Save profile' : 'Add item if new'}
                              </button>
                              <button
                                type="button"
                                onClick={openDataEntryCreateItemModal}
                                disabled={!parsedData || dataEntryNewItemName.trim().length === 0}
                                className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                          <label htmlFor="paper-stock-date" className="text-[13px] font-medium text-muted">Date</label>
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

              <section className="rounded-card border border-line bg-surface p-4 sm:p-6">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                  <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Counted items</h2>
                  <p className="text-[14px] text-muted tabular">
                    {stockInQueueCount > 0
                      ? `${stockInQueueCount} save${stockInQueueCount > 1 ? 's' : ''} waiting to upload`
                      : `${filledItemCount} ${filledItemCount === 1 ? 'item' : 'items'} · tap a number to change it`}
                  </p>
                </div>

                <div className="mobile-sticky-add mb-4 space-y-3">
                  <div ref={dataEntryFindContainerRef} className="relative">
                    <Search className="pointer-events-none absolute left-3 top-[22px] h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      type="search"
                      value={dataEntryFindTerm}
                      onChange={(event) => setDataEntryFindTerm(event.target.value)}
                      placeholder="Find in this list"
                      aria-label="Find in this list"
                      className={`${fieldClass} pl-10 pr-10`}
                    />

                    {dataEntryFindTerm.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDataEntryFindTerm('')}
                        aria-label="Clear stocklist search"
                        className="absolute right-1 top-0.5 inline-flex h-10 w-10 items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
                    <div className="mb-3 flex items-center justify-between gap-2 md:hidden">
                      <span className="text-[14px] text-muted">View</span>
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
                    disabled={!parsedData || isSavingSupabase || isLoadingBigQuery || isExporting}
                    aria-busy={isSavingSupabase || undefined}
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control bg-forest px-5 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest/40"
                  >
                    {isSavingSupabase ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-5 w-5" aria-hidden="true" />
                        <span>Done · {filledItemCount} {filledItemCount === 1 ? 'item' : 'items'}</span>
                      </>
                    )}
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowOverflow(v => !v)}
                      className="inline-flex min-h-12 w-12 items-center justify-center rounded-control border border-line bg-surface text-ink hover:bg-slate-100"
                      aria-label="More actions"
                      aria-expanded={showOverflow}
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
                    <th className="pb-2 font-medium pl-2">Origin</th>
                    <th className="pb-2 font-medium pl-2">Inner Qty</th>
                    <th className="pb-2 font-medium pl-2">Inner Unit</th>
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
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-info"
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
                        <input className="w-full min-w-[110px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.origin} onChange={(e) => { const c = [...activeCatalog]; c[index].origin = e.target.value; setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" min="0" step="1" className="w-full min-w-[90px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.inner_quantity ?? ''} onChange={(e) => { const c = [...activeCatalog]; c[index].inner_quantity = e.target.value === '' ? null : Number(e.target.value); setActiveCatalog(c); setCatalogSource('edited') }} />
                      </td>
                      <td className="py-2 pr-2">
                        <select className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none" value={item.inner_unit} onChange={(e) => { const c = [...activeCatalog]; c[index].inner_unit = e.target.value as CatalogInnerUnit; setActiveCatalog(c); setCatalogSource('edited') }}>
                          {INNER_UNIT_OPTIONS.map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
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
                const newRow = { id: 0, code: newCode, location: '', sub_location: '', category: '', product: '', attribute: '', origin: '', inner_quantity: null, inner_unit: 'box' as const, official_name: '', stocklist_name: '', navigation_guide: '', row_position: 'single' as const, is_visible: true }
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
        onRepush={repushToBigQuery}
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

    </AppShell>
  )
}
