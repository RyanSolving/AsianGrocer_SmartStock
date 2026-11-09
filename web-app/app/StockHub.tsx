'use client'

import { useMemo, useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { toPng } from 'html-to-image'
import {
  BarChart3,
  Database,
  Download,
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
  Tag,
  ChevronDown,
} from 'lucide-react'
import { ToastViewport } from './components/ui/Toast'
import { Sheet } from './components/ui/Sheet'
import { fieldClass, inputClass, NumberInput } from './components/ui/Input'
import { focusNextQuantityInput, isRowListed, rankSuggestions } from '../lib/entry-chain'
import { AppShell, type ShellSection } from './components/AppShell'
import { EditorTopBar } from './components/EditorTopBar'
import { useChoiceSheet } from './components/ChoiceSheet'
import { formatDayLabel, formatTimeLabel } from '../lib/date-utils'
import { sectionFromQuery } from '../lib/hub-navigation'
import { useKeypadEntry } from '../lib/use-keypad-entry'
import { latestReportDate } from '../lib/report-records'
import { friendlyError, toast } from '../lib/toast-store'

import { DailyReportPanel } from './components/DailyReportPanel'
import { DashboardPanel } from './components/DashboardPanel'
import { HomePanel } from './components/HomePanel'
import { CatalogManagementView } from './catalog/CatalogManagementView'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './components/CreateCatalogItemModal'
import { EmbeddedStockCheckPanel } from './components/EmbeddedStockCheckPanel'
import { StockLedger, toLedgerAreas } from './components/StockLedger'
import { LedgerPhotoSheet, type PhotoGroup, type PhotoRow } from './components/LedgerPhotoSheet'
import { SellPriceEditor } from './components/SellPriceEditor'
import { ConfirmDialog, useConfirm } from './components/ConfirmDialog'
import { SectionLandingState } from './components/SectionLandingState'
import type { SelectedStockCheckHistoryRecord } from './components/EmbeddedStockCheckPanel'
import { StockCheckHistoryDialog } from './components/StockCheckHistoryDialog'
import { TranscriptionHistoryDialog } from './components/TranscriptionHistoryDialog'
import { filterVisibleCatalogItems } from '../lib/catalog-visibility'
import { describePriceChange, emptySellPrice, formatDeals, formatMainPrice, formatSellPrice, normalizeSellPrice, priceChangeOf, type PriceDeal, type PriceUnit, type SellPrice } from '../lib/stock-price'
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
import { normalizeInsideSectionLabel } from '../lib/stock-paper-utils'
import { STATUS } from '../lib/status-messages'
import { getLocalTodayDate } from '../lib/date-utils'
import { useHistoryRealtime } from '../lib/realtime/history-realtime'
import { WAREHOUSE_SYNC_ENABLED } from '../lib/warehouse-sync'

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
  /** Arrived on a special discount (BUSINESS_RULES.md §1b). */
  special?: boolean
  /** Selling price on this delivery. Left out = the catalog price (BUSINESS_RULES.md §1d). */
  sell?: SellPrice
  /** The catalog price this row started from, set when the delivery is saved. */
  catalog_sell?: SellPrice
}

type UnknownItem = {
  notes?: string | null
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
  special?: boolean
  sell?: SellPrice
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
  special?: boolean
  notes?: string | null
  /** Normal selling price, what it is sold by, and combo deals. */
  price?: number | null
  price_unit?: PriceUnit
  price_deals?: PriceDeal[]
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
  return new Date(timestamp).toLocaleDateString('en-AU', {
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

type HubSection = ShellSection
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
const OUTSIDE_SECTION_ID = 'outside-coolroom'
const UNKNOWN_SECTION_ID = 'unclassified-staff-inspection'
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

/** A saved row's selling price (`sell`, or the catalog price it started from), as saved; nothing when absent. */
function readSavedSell(row: Record<string, unknown>, key: 'sell' | 'catalog_sell'): { sell?: SellPrice; catalog_sell?: SellPrice } {
  const value = row[key]
  if (!value || typeof value !== 'object') return {}
  return { [key]: normalizeSellPrice(value as { price?: unknown; unit?: unknown; deals?: unknown }) }
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
      ...(row.special === true ? { special: true } : {}),
      ...readSavedSell(row, 'sell'),
      ...readSavedSell(row, 'catalog_sell'),
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
        ...(normalizedRow.special ? { special: true } : {}),
        ...(normalizedRow.sell ? { sell: normalizedRow.sell } : {}),
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

export function StockHub({ initialSection }: { initialSection: HubSection }) {
  const today = useMemo(() => getLocalTodayDate(), [])
  const stockMode: StockMode = 'stock-in'
  const [activeSection, showSection] = useState<HubSection>(initialSection)

  const setActiveSection = useCallback((section: HubSection) => {
    const href = section === 'home' ? '/welcome' : `/?section=${section}`
    if (window.location.pathname + window.location.search !== href) window.history.pushState(null, '', href)
    showSection(section)
  }, [])

  useEffect(() => {
    function restoreSection() {
      showSection(sectionFromQuery(new URLSearchParams(window.location.search).get('section')))
    }
    window.addEventListener('popstate', restoreSection)
    return () => window.removeEventListener('popstate', restoreSection)
  }, [])
  // Bumped each time Home opens, so its numbers refresh quietly behind the cached ones.
  const [homeRefreshKey, setHomeRefreshKey] = useState(0)
  /** Bumped on every live Stock In / Stock Close change, so the reports reload by themselves. */
  const [liveReportKey, setLiveReportKey] = useState(0)
  const hasShownHomeRef = useRef(false)
  const [reportDateRequest, setReportDateRequest] = useState<{ date: string; key: number } | null>(null)
  const [stockInPhase, setStockInPhase] = useState<'landing' | 'editing'>('landing')
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false)
  const [visitedSections, setVisitedSections] = useState<Set<HubSection>>(() => new Set<HubSection>([initialSection, 'data-entry']))
  const [dataEntryMode, setDataEntryMode] = useState<DataEntryMode>('manual')
  const [activeCatalog, setActiveCatalog] = useState<CatalogItem[] | null>(null)
  const [isCatalogOpen, setIsCatalogOpen] = useState(false)
  const [parsedData, setParsedData] = useState<ParsedPayload | null>(null)
  const [unknownItems, setUnknownItems] = useState<UnknownItem[]>([])
  const [missingCatalogItems, setMissingCatalogItems] = useState<CatalogItem[]>([])
  const [reviewRequiredCount, setReviewRequiredCount] = useState(0)
  const [catalogSource, setCatalogSource] = useState<'master' | 'uploaded' | 'edited' | null>(null)
  const [catalogItemCount, setCatalogItemCount] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingStockInPhoto, setIsExportingStockInPhoto] = useState(false)
  const stockInPhotoRef = useRef<HTMLDivElement | null>(null)
  /** Latest exportStockInPhoto, so the Save flow (awaiting a save) always uses the current sheet. */
  const exportPhotoRef = useRef<(() => Promise<boolean>) | null>(null)
  /** Catalog prices the last save updated, for the "saved" message. */
  const catalogPricesUpdatedRef = useRef(0)
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
  const [pendingHistoryLoad, setPendingHistoryLoad] = useState<string | null>(null)
  const [pendingStockCheckHistoryLoad, setPendingStockCheckHistoryLoad] = useState<SelectedStockCheckHistoryRecord | null>(null)
  const [offlineQueueCount, setOfflineQueueCount] = useState(0)
  const [stockInQueueCount, setStockInQueueCount] = useState(0)
  const [isOfflineSyncing, setIsOfflineSyncing] = useState(false)
  const [hasStockInLocalDraft, setHasStockInLocalDraft] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const [dataEntrySearchTerm, setDataEntrySearchTerm] = useState('')
  const [dataEntryStatusFilter, setDataEntryStatusFilter] = useState<'all' | 'pending' | 'pushed'>('all')
  const [dataEntryNewItemName, setDataEntryNewItemName] = useState('')
  const [dataEntryAddHighlightIndex, setDataEntryAddHighlightIndex] = useState<number>(-1)
  const [dataEntrySelectedCatalogCode, setDataEntrySelectedCatalogCode] = useState<string | null>(null)
  const [manualEntryQuantity, setManualEntryQuantity] = useState('')
  const [manualEntrySpecial, setManualEntrySpecial] = useState(false)
  const [manualEntryNote, setManualEntryNote] = useState('')
  /** Price typed for the item being added; null = the catalog price. */
  const [manualEntrySell, setManualEntrySell] = useState<SellPrice | null>(null)
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
  const [stockCheckHistory, setStockCheckHistory] = useState<StockCheckHistoryEntry[]>([])
  const [isStockCheckHistoryLoading, setIsStockCheckHistoryLoading] = useState(false)
  // Report and Dashboard open on the newest date that has a full report (today's comes after 4 PM).
  const latestReportDay = useMemo(
    () => latestReportDate(stockCheckHistory.map((entry) => entry.stock_date), getLocalTodayDate()),
    [stockCheckHistory],
  )
  const [stockCheckSearchTerm, setStockCheckSearchTerm] = useState('')
  const [stockCheckStatusFilter, setStockCheckStatusFilter] = useState<'all' | 'validated' | 'unvalidated'>('all')
  const [selectedStockCheckHistoryRecord, setSelectedStockCheckHistoryRecord] = useState<SelectedStockCheckHistoryRecord | null>(null)
  const [hasSavedToSupabase, setHasSavedToSupabase] = useState(false)
  const [hasLoadedToDb, setHasLoadedToDb] = useState(false)
  const [isValidatedByStaff, setIsValidatedByStaff] = useState(false)
  const stockEntryRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const isManualEntryMode = dataEntryMode === 'manual'
  const [confirmAction, confirmElement] = useConfirm()

  useEffect(() => {
    setVisitedSections((current) => (current.has(activeSection) ? current : new Set(current).add(activeSection)))
    setIsHistorySheetOpen(false)
    if (activeSection === 'home') {
      // The first open already loads; only returning to Home refreshes.
      if (hasShownHomeRef.current) setHomeRefreshKey((value) => value + 1)
      hasShownHomeRef.current = true
    }
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
  /** Catalog selling price by item code (hidden items too), for the Stock In price column. */
  const catalogSellByCode = useMemo(() => {
    const prices = new Map<string, SellPrice>()
    for (const item of activeCatalog ?? []) {
      prices.set(item.code.trim().toUpperCase(), normalizeSellPrice({ price: item.price, unit: item.price_unit, deals: item.price_deals }))
    }
    return prices
  }, [activeCatalog])
  /** The Stock In row whose price sheet is open (its list index), if any. */
  const [priceSheetIndex, setPriceSheetIndex] = useState<number | null>(null)
  const [entryPriceOpen, setEntryPriceOpen] = useState(false)
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
        message: 'It will no longer appear in Stock In or Stock Close. You can show it again from Catalog.',
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
        throw new Error(payload?.error ?? 'Could not load stock close history.')
      }

      setStockCheckHistory(Array.isArray(payload.history) ? payload.history : [])
    } catch (error) {
      if (shouldSilenceOfflineNetworkError(error)) {
        return
      }

      if (!silent) {
        setApiError(error instanceof Error ? error.message : 'Could not load stock close history.')
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
    const total = counted(draft.parsedData.items) + counted(draft.missingCatalogItems) + counted(draft.unknownItems)
    return total

  }, [hasStockInLocalDraft, stockInPhase])

  const restoreStockInDraft = useCallback(() => {
    if (typeof window === 'undefined') return

    const draft = loadOfflineDraft<StockInOfflineDraft>('stock-in')
    if (!draft || !draft.parsedData) return

    // Stock in is typed only; a draft saved in the old photo mode opens as a typed sheet.
    setDataEntryMode('manual')
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

    // Nothing entered yet (or already saved) is not a draft worth resuming.
    const hasCount = (items: Array<{ quantity?: number | null }> | undefined) =>
      (items ?? []).some((item) => item.quantity !== null && item.quantity !== undefined)
    const hasEntries =
      hasCount(parsedData.items) || hasCount(missingCatalogItems) || hasCount(unknownItems)
    if (!hasEntries || hasSavedToSupabase) {
      clearOfflineDraft('stock-in')
      setHasStockInLocalDraft(false)
      return
    }

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
  // While a history list or one of its confirm dialogs is open, live changes wait, so a row
  // never moves under the person's finger; they are applied when it closes.
  const isHistoryBusy = isHistoryOpen || isHistorySheetOpen || pendingHistoryLoad !== null || pendingStockCheckHistoryLoad !== null
  const isHistoryBusyRef = useRef(isHistoryBusy)
  isHistoryBusyRef.current = isHistoryBusy
  const deferredHistoryRefresh = useRef({ stockIn: false, stockCheck: false })

  useHistoryRealtime(session?.user?.id, {
    onStockInChange: () => {
      setLiveReportKey((value) => value + 1)
      if (isHistoryBusyRef.current) deferredHistoryRefresh.current.stockIn = true
      else void loadTranscriptionHistory({ silent: true })
    },
    onStockCheckChange: () => {
      setLiveReportKey((value) => value + 1)
      if (isHistoryBusyRef.current) deferredHistoryRefresh.current.stockCheck = true
      else void loadStockCheckHistory({ silent: true })
    },
  })

  useEffect(() => {
    if (isHistoryBusy) return
    const deferred = deferredHistoryRefresh.current
    if (deferred.stockIn) void loadTranscriptionHistory({ silent: true })
    if (deferred.stockCheck) void loadStockCheckHistory({ silent: true })
    deferredHistoryRefresh.current = { stockIn: false, stockCheck: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when the history UI closes
  }, [isHistoryBusy])

  useEffect(() => {
    setDataEntryAddHighlightIndex(-1)
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

  useKeypadEntry(stockEntryRef, activeSection === 'data-entry' && stockInPhase === 'editing')
  const { ask, choiceSheet } = useChoiceSheet()

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
        notes: c_item.notes ?? null,
        special: c_item.special === true,
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

  /** The export photo lists counted items only, grouped the same way as the list. */
  const stockInPhoto = useMemo(() => {
    const toRow = (row: IndexedItem): PhotoRow => {
      const code = row.item.catalog_code?.trim().toUpperCase() ?? ''
      const catalogItem = code ? visibleCatalog.find((c) => c.code.trim().toUpperCase() === code) : null
      const { sell, change } = priceStateOf(row.item)
      return {
        key: `${row.source}-${row.index}`,
        name: catalogItem?.official_name ?? row.item.official_name ?? row.item.product_raw ?? '',
        quantity: String(row.item.quantity ?? ''),
        tone: row.source === 'missing' ? 'warning' : row.source === 'unknown' ? 'alert' : undefined,
        special: row.item.special === true,
        note: row.item.notes?.trim() || undefined,
        price: formatMainPrice(sell),
        priceDeals: formatDeals(sell),
        priceNote: change ? describePriceChange(change) : undefined,
        priceChanged: change !== null,
      }
    }
    const counted = (rows: IndexedItem[]) => sortIndexedItemsByName(rows.filter((row) => row.item.quantity !== null)).map(toRow)
    const toGroups = (sections: typeof paperSections.leftColumn): PhotoGroup[] => sections.map((section) => ({
      title: section.title,
      rows: counted([...section.rows.left, ...section.rows.right, ...section.rows.single]),
    }))
    const all = (split: typeof paperSections.outsideRows) => [...split.left, ...split.right, ...split.single]

    return {
      insideLeft: toGroups(paperSections.leftColumn),
      insideRight: toGroups(paperSections.rightColumn),
      outside: counted(all(paperSections.outsideRows)),
      unknown: counted(all(paperSections.unknownRows)),
    }
    // priceStateOf reads the catalog prices, so the photo follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperSections, visibleCatalog, catalogSellByCode])

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

  const dataEntryLedgerAreas = useMemo(
    () => toLedgerAreas(dataEntryCardSections, { outside: OUTSIDE_SECTION_ID, unknown: UNKNOWN_SECTION_ID }),
    [dataEntryCardSections],
  )

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

  // A price typed for one item does not carry over to the next one picked.
  useEffect(() => { setManualEntrySell(null); setEntryPriceOpen(false) }, [dataEntrySelectedCatalogCode])

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

    // Prefill the new-item profile, but leave it closed: opening an 8-field form
    // mid-typing (a typo is enough) pushed the count list off the screen.
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

  const addKnownDataEntryItem = useCallback((catalogItem: CatalogItem, quantityOverride: number | null = null, special = false, note = '', sell: SellPrice | null = null): boolean => {
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
            special,
            notes: note.trim() || null,
            ...(sell ? { sell } : {}),
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
    dataEntryQtyInputRef.current?.focus()
  }, [syncItemProfilesFromCatalogItem])

  const handleItemInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setSearchOpen(true)
      setDataEntryAddHighlightIndex(0)
      return
    }
    if (!searchOpen || dataEntryAddSuggestions.length === 0 || dataEntrySelectedCatalogCode) {
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
      setSearchOpen(false)
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
  }, [searchOpen, dataEntryAddHighlightIndex, dataEntryAddSuggestions, dataEntrySelectedCatalogCode, selectDataEntryCatalogSuggestion])

  useEffect(() => {
    if (searchOpen && dataEntryAddHighlightIndex >= 0) {
      document.getElementById(`stock-in-option-${dataEntryAddHighlightIndex}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [searchOpen, dataEntryAddHighlightIndex])

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
        if (patch.special !== undefined) item.special = patch.special
        if (patch.notes !== undefined) item.notes = patch.notes
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
        if (patch.sell !== undefined) item.sell = patch.sell
        if (patch.quantity !== undefined) item.quantity = patch.quantity
        if (patch.quantity_raw !== undefined) item.quantity_raw = patch.quantity_raw
        if (patch.quantity_conflict_flag !== undefined) item.quantity_conflict_flag = patch.quantity_conflict_flag
        if (patch.special !== undefined) item.special = patch.special
        if (patch.notes !== undefined) item.notes = patch.notes
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
          special: manualEntrySpecial,
          notes: manualEntryNote.trim() || null,
        },
      ])
      setDataEntryNewItemName('')
      setDataEntrySelectedCatalogCode(null)
      setManualEntryQuantity('')
      setManualEntrySpecial(false)
      setManualEntryNote(''); setManualEntrySell(null)
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
        ...(manualEntrySpecial ? { special: true } : {}),
        ...(manualEntryNote.trim() ? { notes: manualEntryNote.trim() } : {}),
        ...(manualEntrySell ? { sell: manualEntrySell } : {}),
      })
      setDataEntryNewItemName('')
      setDataEntrySelectedCatalogCode(null)
      setManualEntryQuantity('')
      setManualEntrySpecial(false)
      setManualEntryNote(''); setManualEntrySell(null)
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
        ...(manualEntrySpecial ? { special: true } : {}),
        ...(manualEntryNote.trim() ? { notes: manualEntryNote.trim() } : {}),
      })
      setDataEntryNewItemName('')
      setDataEntrySelectedCatalogCode(null)
      setManualEntryQuantity('')
      setManualEntrySpecial(false)
      setManualEntryNote(''); setManualEntrySell(null)
      setApiError(null)
      noteAdded(chosen.official_name, quantity, snapshot)
      return true
    }

    const added = addKnownDataEntryItem(chosen, quantity, manualEntrySpecial, manualEntryNote, manualEntrySell)
    if (added) {
      setManualEntrySpecial(false)
      setManualEntryNote(''); setManualEntrySell(null)
      noteAdded(chosen.official_name, quantity, snapshot)
    }
    return added
  }, [
    addKnownDataEntryItem,
    noteAdded,
    unknownItems,
    dataEntryAddSuggestions,
    dataEntryNewItemName,
    manualEntryQuantity,
    manualEntrySpecial,
    manualEntryNote,
    manualEntrySell,
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
      dataEntryItemInputRef.current?.focus()
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
      price: created.price,
      price_unit: created.price_unit,
      price_deals: created.price_deals,
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
      // Editing a profile keeps the catalog price as it is; a new item starts without one.
      price: editingCatalogItem?.price ?? null,
      price_unit: editingCatalogItem?.price_unit ?? 'ea',
      price_deals: editingCatalogItem?.price_deals ?? [],
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
    if (row.source === 'missing') return `${baseCls} !text-warning`
    if (row.source === 'unknown') return `${baseCls} !text-red-600 font-semibold`
    return baseCls
  }

  function getCardClasses(row: IndexedItem | undefined) {
    if (!row) return ''
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

  /**
   * Price of a Stock In row and the change it makes. The price is the catalog price until staff
   * type another; the change is measured against the catalog price the row started from (kept
   * on the row once saved, so a reopened Stock In still shows what changed).
   */
  function priceStateOf(item: { catalog_code: string | null; sell?: SellPrice; catalog_sell?: SellPrice }) {
    const code = item.catalog_code?.trim().toUpperCase() ?? ''
    const inCatalog = code !== '' && (catalogSellByCode.has(code) || item.catalog_sell !== undefined)
    const live = code !== '' ? catalogSellByCode.get(code) ?? emptySellPrice : emptySellPrice
    const sell = item.sell ?? live
    const reference = item.catalog_sell ?? live
    return { sell, change: priceChangeOf(sell, reference, inCatalog) }
  }

  /** Writes the price and the catalog price it started from on each counted row, for saving. */
  function withPriceStamped<T extends { catalog_code: string | null; quantity: number | null; sell?: SellPrice; catalog_sell?: SellPrice }>(item: T): T {
    if (item.quantity === null) return item
    const code = item.catalog_code?.trim().toUpperCase() ?? ''
    const live = code !== '' ? catalogSellByCode.get(code) : undefined
    const sell = item.sell ?? live
    const catalogSell = item.catalog_sell ?? live
    return { ...item, ...(sell ? { sell } : {}), ...(catalogSell ? { catalog_sell: catalogSell } : {}) }
  }

  /** Name cell of the phone list; missing and unknown items keep their warning colours. */
  function renderDataEntryLedgerName(row: IndexedItem) {
    const code = row.item.catalog_code?.trim().toUpperCase() ?? ''
    const latestCatalogItem = code ? visibleCatalog.find((c) => c.code.trim().toUpperCase() === code) : null
    const displayName = latestCatalogItem?.official_name ?? row.item.official_name ?? row.item.product_raw ?? ''
    const tone = row.source === 'missing' ? 'text-warning' : row.source === 'unknown' ? 'font-semibold text-red-600' : undefined
    const special = row.item.special === true
    return (
      <div className="report-name">
        <button
          type="button"
          aria-label={`Special discount: ${displayName}`}
          aria-pressed={special}
          title={special ? 'Special discount (tap to clear)' : 'Mark as special discount'}
          onClick={() => updateItem(row.index, { special: !special })}
          className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 before:absolute before:-inset-2.5 before:content-[''] ${special ? 'bg-[#fbe9e5] text-[#a33626]' : 'text-slate-400 hover:text-ink'}`}
        >
          <Tag className="h-4 w-4" strokeWidth={special ? 2.25 : 1.75} aria-hidden="true" />
        </button>
        <span className={tone}>
          {displayName}
          {special ? <> <span className="report-tag report-tag-special ml-1 align-[1px]">Special</span></> : null}
          {row.item.notes?.trim() ? <span className="block text-[13px] font-normal italic text-muted">{row.item.notes.trim()}</span> : null}
        </span>
      </div>
    )
  }

  /** Price cell of the phone list: the price as text; tap to change it. A changed price is highlighted. */
  function renderDataEntryPriceCell(row: IndexedItem) {
    const { sell, change } = priceStateOf(row.item)
    const name = row.item.official_name || row.item.product_raw || 'item'
    const main = formatMainPrice(sell)
    const deals = formatDeals(sell)
    const extraDeals = sell.deals.length > 1 ? ` +${sell.deals.length - 1}` : ''
    return (
      <button
        type="button"
        data-price-row-index={row.index}
        aria-label={`Price for ${name}: ${formatSellPrice(sell) || 'none'}. Tap to change.`}
        // Keep focus where it is on press: the count box losing focus first shifts the page, and the
        // tap would then land on whatever moved under the finger.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setPriceSheetIndex(row.index)}
        className={`stock-price-btn${change ? ' is-changed' : ''}`}
      >
        {main || deals ? (
          <>
            {main ? <span className="stock-price-main"><span>{main.split(' ')[0]}</span><span className="stock-price-unit">{main.split(' ')[1]}</span></span> : null}
            {sell.deals[0] ? <span className="stock-price-deal">{`${sell.deals[0].qty} for $${sell.deals[0].total.toFixed(2)}${extraDeals}`}</span> : null}
          </>
        ) : <span className="stock-price-empty">+ Price</span>}
      </button>
    )
  }

  const priceSheetRow = priceSheetIndex === null ? null : indexedItems.find((row) => row.index === priceSheetIndex) ?? null

  /** Takes an item off the Stock In list (its count is cleared), with Undo. */
  function removeDataEntryRow(row: IndexedItem) {
    const name = row.item.official_name || row.item.product_raw || 'Item'
    const wasTouched = dataEntryTouchedIndexes.has(row.index)
    const untouch = () => setDataEntryTouchedIndexes((current) => {
      if (!current.has(row.index)) return current
      const next = new Set(current)
      next.delete(row.index)
      return next
    })
    const restoreTouch = () => {
      if (wasTouched) setDataEntryTouchedIndexes((current) => new Set(current).add(row.index))
    }

    if (row.source === 'unknown') {
      // Typed names not in the catalog are dropped from the sheet entirely.
      const pos = -2000 - row.index
      const removed = unknownItems[pos]
      setUnknownItems((current) => current.filter((_, i) => i !== pos))
      setIsValidatedByStaff(false)
      setHasSavedToSupabase(false)
      untouch()
      setLastAddedEntry(null)
      toast.info(`${name} removed`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            setUnknownItems((current) => [...current.slice(0, pos), removed, ...current.slice(pos)])
            restoreTouch()
          },
        },
      })
      return
    }

    const before = {
      quantity: row.item.quantity,
      quantity_raw: row.item.quantity_raw,
      quantity_conflict_flag: row.item.quantity_conflict_flag,
      special: row.item.special,
      notes: row.item.notes ?? null,
      sell: row.item.sell,
      catalog_sell: row.item.catalog_sell,
    }
    updateItem(row.index, { quantity: null, quantity_raw: null, quantity_conflict_flag: false, special: false, notes: null, sell: undefined, catalog_sell: undefined })
    untouch()
    toast.info(`${name} removed`, {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          updateItem(row.index, before)
          if (!wasTouched) untouch()
        },
      },
    })
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

  /**
   * Same as the Daily Report export: render the photo sheet off screen, then download it as PNG.
   * Part of Save (one button does both). Returns whether a photo was made; a sheet with no
   * counted items has nothing to photograph and counts as done.
   */
  async function exportStockInPhoto(): Promise<boolean> {
    if (isExportingStockInPhoto) return false
    if (filledItemCount === 0) return true
    const date = parsedData?.stock_date || today

    try {
      flushSync(() => setIsExportingStockInPhoto(true))
      if (!stockInPhotoRef.current) throw new Error('The stock in sheet is no longer available.')
      const dataUrl = await toPng(stockInPhotoRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: '#fefefe' })
      const link = document.createElement('a')
      link.download = `stock-in-${date}.png`
      link.href = dataUrl
      link.click()
      return true
    } catch (failure) {
      const friendly = friendlyError(failure instanceof Error ? failure.message : 'Failed to export the stock in photo.')
      toast.error(`Saved, but the photo failed: ${friendly.message}`, {
        details: friendly.details ?? 'Tap Save again to try the photo once more.',
        duration: 8000,
      })
      return false
    } finally {
      setIsExportingStockInPhoto(false)
    }
  }
  exportPhotoRef.current = exportStockInPhoto

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
      // Rows go out with the price they show (the catalog price unless changed).
      const filteredItems = parsedData.items.filter((item) => {
        if (!item.catalog_code) return true
        return visibleCatalogCodes.has(item.catalog_code.trim().toUpperCase())
      }).map(withPriceStamped)
      const filteredMissingCatalogItems = missingCatalogItems.filter((item) => visibleCatalogCodes.has(item.code.trim().toUpperCase()))

      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsedData,
          items: filteredItems,
          unknown_items: unknownItems.map(withPriceStamped),
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

  async function saveToSupabase(overrides: { stock_date?: string; extra_delivery?: boolean } = {}) {
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
      data: { ...parsedData, ...overrides, items: parsedData.items.map(withPriceStamped) },
      validated: 'yes',
      unknown_items: unknownItems.map(withPriceStamped),
      missing_catalog_items: missingCatalogItems,
      uid_generate: latestGenerateUid ?? undefined,
      persist_only: true,
    }
    catalogPricesUpdatedRef.current = 0

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

      // setApiStatus(STATUS.SAVED) // Removed to prevent a double toast with "Stock in saved"
      if (typeof payload?.catalog_prices_updated === 'number') {
        catalogPricesUpdatedRef.current = payload.catalog_prices_updated
      }
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

  const clearStockInSheet = useCallback(() => {
    clearOfflineDraft('stock-in')
    setHasStockInLocalDraft(false)
    setManualEntryNote(''); setManualEntrySell(null)
    setParsedData(null)
    setUnknownItems([])
    setMissingCatalogItems([])
    setLatestGenerateUid(null)
    setEditingHistoryUid(null)
    setSelectedHistoryUid(null)
    setHasSavedToSupabase(false)
    setHasLoadedToDb(false)
    setIsValidatedByStaff(false)
    setDataEntryTouchedIndexes(new Set())
    setLastAddedEntry(null)
    setStockInPhase('landing')
  }, [])

  const handleStockInDone = useCallback(async () => {
    if (!parsedData) {
      setApiError('No data to save.')
      return
    }

    // Step 1: validate
    const valid = normalizeAndMarkValidated(false)
    if (!valid) return

    // Step 2: two checks before a new record is saved (an edit of a saved record skips them).
    const overrides: { stock_date?: string; extra_delivery?: boolean } = {}
    if (!latestGenerateUid) {
      // A continued draft keeps the day it was started; ask before filing it under that day.
      const today = getLocalTodayDate()
      if (parsedData.stock_date && parsedData.stock_date !== today) {
        const answer = await ask({
          title: `This sheet is dated ${formatDayLabel(parsedData.stock_date)}`,
          message: `Today is ${formatDayLabel(today)}. Which day did this delivery arrive?`,
          choices: [
            { value: 'today', label: `Today, ${formatDayLabel(today)}`, primary: true },
            { value: 'keep', label: formatDayLabel(parsedData.stock_date), description: 'Keep the date on the sheet' },
          ],
        })
        if (!answer) return
        if (answer === 'today') {
          overrides.stock_date = today
          setParsedData((prev) => prev ? { ...prev, stock_date: today } : prev)
        }
      }

      // Another Stock In for the same day: a second delivery, or the same one counted again?
      const stockDate = overrides.stock_date ?? parsedData.stock_date
      const sameDay = historyData.filter((entry) =>
        (entry.transcriptionData as { stock_date?: unknown } | null)?.stock_date === stockDate)
      if (sameDay.length > 0) {
        const answer = await ask({
          title: `Stock In already saved for ${formatDayLabel(stockDate)}`,
          message: sameDay.length === 1
            ? `One was saved at ${formatTimeLabel(sameDay[0].timestamp)}. Is this another delivery?`
            : `${sameDay.length} were saved for that day. Is this another delivery?`,
          choices: [
            { value: 'extra', label: 'Extra delivery', description: 'Add these items to that day\'s stock in', primary: true },
            { value: 'replace', label: 'Same delivery, counted again', description: 'Use this sheet instead of the earlier one' },
          ],
        })
        if (!answer) return
        if (answer === 'extra') overrides.extra_delivery = true
      }
    }

    // Step 3: save to Supabase (the only step staff wait for)
    const saved = await saveToSupabase(overrides)
    if (!saved) return

    // Step 4: the photo of the saved sheet downloads as part of the same Save. If it cannot be
    // made the sheet stays open (the record is saved), so Save again tries the photo once more.
    const photoMade = await exportPhotoRef.current?.()
    if (photoMade === false) return
    const pricesUpdated = catalogPricesUpdatedRef.current
    if (pricesUpdated > 0) void loadCatalogFromApi().catch(() => undefined)

    // Step 5: empty the sheet and return to the menu right away. Emptying the sheet (not only the
    // stored draft) matters: saving updates the sheet, which schedules a draft auto-save, and that
    // save would otherwise write the finished sheet back as "Continue draft" a moment later.
    const uid = typeof saved === 'string' ? saved : latestGenerateUid
    clearStockInSheet()

    // Step 6: warehouse (BigQuery) sync runs in the background with its own progress toast.
    // Paused for now (lib/warehouse-sync): Supabase is the only store.
    if (WAREHOUSE_SYNC_ENABLED && uid && window.navigator.onLine) {
      syncStockInToWarehouse(uid)
    } else if (window.navigator.onLine) {
      toast.success([
        'Stock in saved',
        'photo downloaded',
        pricesUpdated > 0 ? `${pricesUpdated} catalog ${pricesUpdated === 1 ? 'price' : 'prices'} updated` : null,
      ].filter(Boolean).join(' · '))
    }
  }, [parsedData, normalizeAndMarkValidated, latestGenerateUid, saveToSupabase, syncStockInToWarehouse, clearStockInSheet, ask, historyData])

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

      // Success, no extra toast needed since handleStockInDone fires "Stock in saved"
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
      title: 'Delete this stock close?',
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
  }, [today, setActiveSection])

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
      || new Date(entry.timestamp).toLocaleDateString('en-AU').toLowerCase().includes(term)

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

          {visitedSections.has('home') ? (
            <div hidden={activeSection !== 'home'}>
              <HomePanel
                catalogItems={visibleCatalog}
                refreshKey={homeRefreshKey + liveReportKey}
                onNavigate={(section, options) => {
                  if (options?.reportDate) setReportDateRequest({ date: options.reportDate, key: Date.now() })
                  setActiveSection(section)
                }}
              />
            </div>
          ) : null}
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
                onClearHistorySelection={() => setSelectedStockCheckHistoryRecord(null)}
                historyRecords={stockCheckHistory}
                onToggleCatalogVisibility={toggleCatalogItemVisibility}
                onOpenHistory={() => setIsHistorySheetOpen(true)}
              />
            </div>
          ) : null}
          {visitedSections.has('daily-report') ? (
            <div hidden={activeSection !== 'daily-report'}>
              <DailyReportPanel catalogItems={visibleCatalog} requestedDate={reportDateRequest} defaultDate={latestReportDay} liveKey={liveReportKey} />
            </div>
          ) : null}
          {visitedSections.has('dashboard') ? (
            <div hidden={activeSection !== 'dashboard'}>
              <DashboardPanel catalogItems={visibleCatalog} defaultDate={latestReportDay} liveKey={liveReportKey} />
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
                } else if (action === 'discard') {
                  clearStockInSheet()
                  toast.success('Stock in draft removed')
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
              <section className="stock-in-editor keypad-editor rounded-card border border-line bg-surface p-3 sm:p-6">
                <EditorTopBar
                  title={editingHistoryUid ? 'Edit stock in' : 'Stock in'}
                  showTitleOnPhone={!!editingHistoryUid}
                  onBack={() => setStockInPhase('landing')}
                  dateId="paper-stock-date"
                  dateValue={parsedData?.stock_date ?? ''}
                  onDateChange={updateParsedStockDate}
                  dateDisabled={!parsedData}
                />

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

                {/* Stock in is always typed: deliveries are counted item by item, never photographed. */}
                <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="md:rounded-card md:border md:border-line md:p-4">
                        <div ref={stockEntryRef} className="keypad-entry space-y-2">
                          <div className="relative">
                            <label htmlFor="stock-in-item-search" className="mb-1.5 block text-[14px] font-medium text-ink">Item</label>
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                              <input
                                id="stock-in-item-search"
                                ref={dataEntryItemInputRef}
                                type="search"
                                role="combobox"
                                aria-autocomplete="list"
                                aria-expanded={searchOpen && !!dataEntryNewItemName.trim() && !!dataEntryAddSuggestions.length && !dataEntrySelectedCatalogCode}
                                aria-controls="stock-in-options"
                                aria-activedescendant={searchOpen && !dataEntrySelectedCatalogCode && dataEntryAddSuggestions[dataEntryAddHighlightIndex] ? `stock-in-option-${dataEntryAddHighlightIndex}` : undefined}
                                onFocus={() => setSearchOpen(true)}
                                onBlur={(event) => {
                                  if (!event.relatedTarget?.closest('#stock-in-options')) setSearchOpen(false)
                                }}
                                value={dataEntryNewItemName}
                                onChange={(event) => {
                                  setSearchOpen(true)
                                  setDataEntryNewItemName(event.target.value)
                                  setDataEntrySelectedCatalogCode(null)
                                }}
                                onKeyDown={handleItemInputKeyDown}
                                placeholder="Search by name or code"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                enterKeyHint="next"
                                disabled={!parsedData}
                                className={`${fieldClass} min-h-12 pl-10`}
                              />
                            </div>

                            {searchOpen && dataEntryNewItemName.trim().length > 0 && dataEntryAddSuggestions.length > 0 && parsedData && !dataEntrySelectedCatalogCode && (
                              <div id="stock-in-options" role="listbox" aria-label="Matching items" className="absolute z-30 mt-1 max-h-[min(15rem,var(--stock-results-height,15rem))] w-full overflow-y-auto overscroll-contain rounded-control border border-line bg-surface shadow-raised">
                                {dataEntryAddSuggestions.map((item, suggestionIndex) => {
                                  const currentQty = dataEntryQtyByCode.get(item.code.trim().toUpperCase())
                                  const highlighted = suggestionIndex === dataEntryAddHighlightIndex
                                  return (
                                    <button
                                      key={item.code}
                                      type="button"
                                      id={`stock-in-option-${suggestionIndex}`}
                                      tabIndex={-1}
                                      role="option"
                                      aria-selected={highlighted}
                                      onMouseDown={(event) => event.preventDefault()}
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
                            {searchOpen && dataEntryNewItemName.trim().length > 0 && dataEntryAddSuggestions.length === 0 && parsedData && !dataEntrySelectedCatalogCode && (
                              <p className="mt-1.5 text-[13px] text-muted">Not in the catalog. Add it with a quantity to review later.</p>
                            )}
                          </div>

                          <div className="flex items-end gap-2">
                            <div className="w-1/2 min-w-0">
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
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={submitManualEntry}
                              disabled={!parsedData || !parsedData.stock_date || dataEntryNewItemName.trim().length === 0 || parseWholeQuantity(manualEntryQuantity) === null}
                              className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-control bg-forest px-3 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest/30"
                            >
                              <Plus className="h-5 w-5" aria-hidden="true" />
                              Add item
                            </button>
                          </div>

                          {selectedDataEntryCatalogItem ? (() => {
                            const catalogSell = catalogSellByCode.get(selectedDataEntryCatalogItem.code.trim().toUpperCase()) ?? emptySellPrice
                            const current = manualEntrySell ?? catalogSell
                            const change = priceChangeOf(current, catalogSell, true)
                            return (
                              <>
                                <button
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => setEntryPriceOpen(true)}
                                  aria-label={`Selling price of ${selectedDataEntryCatalogItem.official_name}. Tap to change.`}
                                  className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left ${change ? 'bg-warning-soft' : 'bg-slate-50'}`}
                                >
                                  <span className="min-w-0">
                                    <span className="block text-[13px] text-muted">Selling price</span>
                                    <span className="block text-[16px] font-semibold text-ink">
                                      {formatSellPrice(current) || 'No price yet'}
                                    </span>
                                    {change ? <span className="block text-[13px] font-medium text-warning">{describePriceChange(change)}</span> : null}
                                  </span>
                                  <span className="shrink-0 text-[14px] font-semibold text-forest">Change</span>
                                </button>
                                {entryPriceOpen ? (
                                  <Sheet
                                    open
                                    onClose={() => setEntryPriceOpen(false)}
                                    title={selectedDataEntryCatalogItem.official_name}
                                    description={change ? describePriceChange(change) : 'Selling price, from the catalog. A change is saved to the catalog.'}
                                    size="sm"
                                    footer={<button type="button" onClick={() => setEntryPriceOpen(false)} className="min-h-12 w-full rounded-control bg-forest px-4 text-[16px] font-semibold text-white">Done</button>}
                                  >
                                    <SellPriceEditor
                                      name={selectedDataEntryCatalogItem.official_name}
                                      value={current}
                                      onChange={(next) => setManualEntrySell(next)}
                                      onEnter={() => setEntryPriceOpen(false)}
                                    />
                                  </Sheet>
                                ) : null}
                              </>
                            )
                          })() : null}

                          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1 text-[15px] text-ink">
                            <input
                              type="checkbox"
                              checked={manualEntrySpecial}
                              onChange={(event) => setManualEntrySpecial(event.target.checked)}
                              disabled={!parsedData}
                              className="h-5 w-5 rounded border-slate-300 text-forest focus:ring-forest"
                            />
                            <span className="inline-flex items-center gap-2">
                              <Tag className="h-4 w-4 text-[#a33626]" aria-hidden="true" />
                              Special (discount)
                            </span>
                          </label>

                          <div>
                            <label htmlFor="stock-in-note" className="mb-1.5 block text-[14px] font-medium text-ink">Note <span className="font-normal text-muted">(optional)</span></label>
                            <input
                              id="stock-in-note"
                              type="text"
                              maxLength={200}
                              autoComplete="off"
                              enterKeyHint="done"
                              value={manualEntryNote}
                              onChange={(event) => setManualEntryNote(event.target.value)}
                              placeholder="e.g. dropped price to 5.99"
                              disabled={!parsedData}
                              className="min-h-12 w-full rounded-control border border-line bg-white px-3 text-[16px] text-ink placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest disabled:opacity-60"
                            />
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
                          aria-expanded={isItemProfilesExpanded}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left"
                        >
                          <div>
                            <p className="text-[14px] font-semibold text-ink">Item profile</p>
                            <p className="mt-0.5 text-[13px] text-muted">
                              {editableDataEntryCatalogItem ? 'Edit this item in the catalog.' : 'New item? Add it to the catalog.'}
                            </p>
                          </div>
                          <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition-transform duration-150 ${isItemProfilesExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
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
                </div>
              </section>

              <section className="rounded-card border border-line bg-surface p-3 sm:p-6">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                  <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Counted items</h2>
                  <p className="text-[14px] text-muted tabular">
                    {stockInQueueCount > 0
                      ? `${stockInQueueCount} save${stockInQueueCount > 1 ? 's' : ''} waiting to upload`
                      : `${filledItemCount} ${filledItemCount === 1 ? 'item' : 'items'} · tap a number to change it`}
                  </p>
                </div>

                <div className="space-y-6">
                  {isExportingStockInPhoto ? (
                    <div aria-hidden="true" className="pointer-events-none fixed right-full top-0">
                      <LedgerPhotoSheet
                        ref={stockInPhotoRef}
                        title="Stock in"
                        date={parsedData?.stock_date || today}
                        quantityLabel="Stock in"
                        insideLeft={stockInPhoto.insideLeft}
                        insideRight={stockInPhoto.insideRight}
                        outside={stockInPhoto.outside}
                        unknown={stockInPhoto.unknown}
                        layout="list"
                      />
                    </div>
                  ) : null}

                  {/* One list at every width: every area and category stays open. */}
                  <div className="stock-paper-wrap is-ledger">
                    <StockLedger
                      areas={dataEntryLedgerAreas}
                      keyPrefix="data-entry-ledger"
                      quantityLabel="Stock in"
                      priceLabel="Price"
                      getRowClass={(index) => {
                        const row = indexedItems.find((item) => item.index === index)
                        const changed = row ? priceStateOf(row.item).change !== null : false
                        return [getCardClasses(row), changed ? 'stock-row-price-changed' : ''].filter(Boolean).join(' ')
                      }}
                      renderName={renderDataEntryLedgerName}
                      renderQuantityCell={renderDataEntryQuantityCell}
                      renderPriceCell={renderDataEntryPriceCell}
                      onRemove={removeDataEntryRow}
                      getItemLabel={(row) => row.item.official_name || row.item.product_raw || 'item'}
                    />
                  </div>

                  {priceSheetRow ? (() => {
                    const { sell, change } = priceStateOf(priceSheetRow.item)
                    const name = priceSheetRow.item.official_name || priceSheetRow.item.product_raw || 'Item'
                    return (
                      <Sheet
                        open
                        onClose={() => setPriceSheetIndex(null)}
                        title={name}
                        description={change ? describePriceChange(change) : 'Selling price. It starts from the catalog price; a change is saved to the catalog.'}
                        size="sm"
                        footer={<button type="button" onClick={() => setPriceSheetIndex(null)} className="min-h-12 w-full rounded-control bg-forest px-4 text-[16px] font-semibold text-white">Done</button>}
                      >
                        <SellPriceEditor
                          name={name}
                          value={sell}
                          onChange={(next) => updateItem(priceSheetRow.index, { sell: next })}
                          onEnter={() => setPriceSheetIndex(null)}
                        />
                      </Sheet>
                    )
                  })() : null}
                </div>


                <div className="mobile-sticky-actions mt-5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStockInDone}
                    disabled={!parsedData || isSavingSupabase || isLoadingBigQuery || isExporting || isExportingStockInPhoto}
                    aria-busy={isSavingSupabase || isExportingStockInPhoto || undefined}
                    title="Saves the stock in and downloads its photo"
                    className="inline-flex min-h-12 min-w-0 flex-1 items-center whitespace-nowrap justify-center gap-2 rounded-control bg-forest px-3 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest/40"
                  >
                    {isSavingSupabase || isExportingStockInPhoto ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                        <span>{isSavingSupabase ? 'Saving…' : 'Making photo…'}</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-5 w-5" aria-hidden="true" />
                        <span className="truncate">Save · {filledItemCount}<span className="hidden min-[360px]:inline"> {filledItemCount === 1 ? 'item' : 'items'}</span></span>
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
        onRepush={WAREHOUSE_SYNC_ENABLED ? repushToBigQuery : undefined}
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


      {choiceSheet}
      <ConfirmDialog
        isOpen={pendingHistoryLoad !== null}
        title="Load history record?"
        message="Loading this record will replace your current work. Unsaved changes will be lost."
        variant="danger"
        confirmLabel="Open and replace"
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
        title="Open this saved stock close?"
        message="It replaces the sheet you have open now. Changes you have not saved will be lost."
        variant="danger"
        confirmLabel="Open and replace"
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
