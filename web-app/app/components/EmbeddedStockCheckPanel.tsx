'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, Download, FileImage, Loader2, Plus, Save, Search, Undo2, X } from 'lucide-react'
import { NumberInput, fieldClass, inputClass } from './ui/Input'
import { focusNextQuantityInput, parseTypedQuantity, rankSuggestions } from '../../lib/entry-chain'
import { friendlyError, toast } from '../../lib/toast-store'
import { toPng } from 'html-to-image'
import { filterVisibleCatalogItems } from '../../lib/catalog-visibility'
import {
  clearOfflineDraft,
  enqueueOfflineRequest,
  getPendingOfflineCountByFeature,
  hasOfflineDraft,
  isNetworkRequestError,
  loadOfflineDraft,
  saveOfflineDraft,
  scheduleDraftSave,
  subscribeOfflineDraftUpdates,
  subscribeOfflineQueueUpdates,
} from '../../lib/offline/queue'
import { EntryMethodToggle } from './EntryMethodToggle'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './CreateCatalogItemModal'
import { StockPaperCardSection, StockPaperSectionTable, StockPaperThreeColumnTable } from './StockPaperTables'
import { formatSheetDate, normalizeInsideSectionLabel } from '../../lib/stock-paper-utils'
import {
  OUTSIDE_SECTION_ID,
  UNKNOWN_SECTION_ID,
  buildInsideSectionId,
  buildOutsideDisplayColumns,
  buildPaperSections,
} from '../../lib/stock-paper-layout'
import { STATUS } from '../../lib/status-messages'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'
import { SectionLandingState } from './SectionLandingState'
import { getOfflineDraftAge } from '../../lib/offline/queue'
import { getLocalTodayDate } from '../../lib/date-utils'

type CatalogInnerUnit = 'box' | 'bag' | 'punnet' | 'piece' | 'tray' | 'bunch' | 'pack' | 'kg' | 'g'

type CatalogItem = {
  id?: number
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
}

type StockCheckRow = {
  id: string
  code: string | null
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

type StockCheckRecordData = {
  items: Array<{
    code: string
    product: string
    category: string
    location: string
    sub_location: string
    origin?: string
    inner_quantity?: number | null
    inner_unit?: CatalogInnerUnit
    official_name: string
    stocklist_name: string
    quantity: number | null
    red_marked: boolean
    notes: string
  }>
  unknown_items: Array<{
    user_input: string
    quantity: number | null
    red_marked: boolean
    notes: string
  }>
  validated: boolean
}

export type SelectedStockCheckHistoryRecord = {
  uid_stock_check: string
  stock_date: string
  validated: boolean
  record_data?: StockCheckRecordData
}

type StockCheckHistoryRecord = {
  uid_stock_check: string
  timestamp: string
  validated: boolean
  record_data?: StockCheckRecordData
}

type RecheckWarning = {
  key: string
  label: string
  section: string
  previousQuantity: number
  currentQuantity: number | null
  reason: 'now_zero' | 'now_blank'
}

type ParsedPhotoItem = {
  catalog_code?: string | null
  product_raw?: string | null
  location?: string | null
  sub_location?: string | null
  category?: string | null
  product?: string | null
  attribute?: string | null
  origin?: string | null
  inner_quantity?: number | null
  inner_unit?: CatalogInnerUnit | null
  official_name?: string | null
  stocklist_name?: string | null
  navigation_guide?: string | null
  row_position?: 'left' | 'right' | 'single' | null
  quantity?: number | null
  notes?: string | null
}

type ParsedPhotoResponse = {
  data?: {
    stock_date?: string | null
    items?: ParsedPhotoItem[]
  }
  unknown_items?: Array<{
    product_raw?: string | null
    location?: string | null
    sub_location?: string | null
    category?: string | null
    product?: string | null
    attribute?: string | null
    origin?: string | null
    inner_quantity?: number | null
    inner_unit?: CatalogInnerUnit | null
    official_name?: string | null
    stocklist_name?: string | null
    navigation_guide?: string | null
    row_position?: 'left' | 'right' | 'single' | null
    quantity?: number | null
  }>
  missing_catalog_items?: Array<CatalogItem & { quantity?: number | null }>
  uid_generate?: string | null
  review_required_count?: number
  catalog_item_count?: number
  catalog_source?: string | null
}

type StockCheckOfflineDraft = {
  stockEntryMode: 'manual' | 'photo'
  stockDate: string
  rows: StockCheckRow[]
  isValidated: boolean
  hasPassedRecheck: boolean
}

function normalizeCompareKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseNumericQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  return value
}

const STOCK_CHECK_MOBILE_VIEW_KEY = 'smartstock:stock-check-mobile-view'
const STOCK_CHECK_EXPANDED_SECTIONS_KEY = 'smartstock:stock-check-expanded-sections'
function makeCatalogRow(item: CatalogItem): StockCheckRow {
  return {
    id: `catalog-${item.code}`,
    code: item.code,
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
    row_position: item.row_position ?? 'single',
    quantity: null,
    red_marked: false,
    notes: '',
    source: 'catalog',
  }
}

function normalizeTextValue(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : fallback
}

function buildRowsFromParsedPhoto(items: CatalogItem[], response: ParsedPhotoResponse) {
  const nextRows = items.map(makeCatalogRow)
  const codeToIndex = new Map(nextRows.map((row, index) => [row.code.trim().toUpperCase(), index]))

  const updateKnownRow = (rowIndex: number, patch: Partial<StockCheckRow>) => {
    nextRows[rowIndex] = {
      ...nextRows[rowIndex],
      ...patch,
    }
  }

  const pushKnownRow = (row: StockCheckRow) => {
    const nextIndex = nextRows.length
    nextRows.push(row)
    if (row.code) {
      codeToIndex.set(row.code.trim().toUpperCase(), nextIndex)
    }
  }

  const pushUnknownRow = (row: StockCheckRow) => {
    nextRows.push(row)
  }

  for (const item of response.data?.items ?? []) {
    const codeKey = item.catalog_code?.trim().toUpperCase() ?? ''
    const quantity = typeof item.quantity === 'number' ? item.quantity : null
    const baseRow: StockCheckRow = {
      id: `parsed-${codeKey || crypto.randomUUID()}`,
      code: codeKey || null,
      location: normalizeTextValue(item.location, 'Unknown'),
      sub_location: normalizeTextValue(item.sub_location, 'Unknown'),
      category: normalizeTextValue(item.category, 'Unknown'),
      product: normalizeTextValue(item.product, normalizeTextValue(item.official_name, normalizeTextValue(item.product_raw, 'Unknown'))),
      attribute: normalizeTextValue(item.attribute, ''),
      origin: normalizeTextValue(item.origin, ''),
      inner_quantity: typeof item.inner_quantity === 'number' ? item.inner_quantity : null,
      inner_unit: item.inner_unit ?? 'box',
      official_name: normalizeTextValue(item.official_name, normalizeTextValue(item.product_raw, 'Unknown')),
      stocklist_name: normalizeTextValue(item.stocklist_name, normalizeTextValue(item.official_name, normalizeTextValue(item.product_raw, 'Unknown'))),
      navigation_guide: normalizeTextValue(item.navigation_guide, ''),
      row_position: item.row_position ?? 'single',
      quantity,
      red_marked: false,
      notes: normalizeTextValue(item.notes, ''),
      source: codeKey ? 'catalog' : 'unknown',
    }

    if (!codeKey) {
      pushUnknownRow(baseRow)
      continue
    }

    const existingIndex = codeToIndex.get(codeKey)
    if (existingIndex === undefined) {
      pushKnownRow(baseRow)
      continue
    }

    updateKnownRow(existingIndex, {
      location: baseRow.location,
      sub_location: baseRow.sub_location,
      category: baseRow.category,
      product: baseRow.product,
      attribute: baseRow.attribute,
      origin: baseRow.origin,
      inner_quantity: baseRow.inner_quantity,
      inner_unit: baseRow.inner_unit,
      official_name: baseRow.official_name,
      stocklist_name: baseRow.stocklist_name,
      navigation_guide: baseRow.navigation_guide,
      row_position: baseRow.row_position,
      quantity: baseRow.quantity,
      notes: baseRow.notes,
      source: 'catalog',
    })
  }

  for (const item of response.missing_catalog_items ?? []) {
    const codeKey = item.code.trim().toUpperCase()
    const quantity = typeof item.quantity === 'number' ? item.quantity : null
    const existingIndex = codeToIndex.get(codeKey)
    const baseRow: StockCheckRow = {
      id: `missing-${codeKey || crypto.randomUUID()}`,
      code: item.code,
      location: normalizeTextValue(item.location, 'Inside Coolroom'),
      sub_location: normalizeTextValue(item.sub_location, 'Unknown'),
      category: normalizeTextValue(item.category, 'Unknown'),
      product: normalizeTextValue(item.product, normalizeTextValue(item.official_name, 'Unknown')),
      attribute: normalizeTextValue(item.attribute, ''),
      origin: normalizeTextValue(item.origin, ''),
      inner_quantity: typeof item.inner_quantity === 'number' ? item.inner_quantity : null,
      inner_unit: item.inner_unit ?? 'box',
      official_name: normalizeTextValue(item.official_name, normalizeTextValue(item.product, 'Unknown')),
      stocklist_name: normalizeTextValue(item.stocklist_name, normalizeTextValue(item.official_name, normalizeTextValue(item.product, 'Unknown'))),
      navigation_guide: normalizeTextValue(item.navigation_guide, ''),
      row_position: item.row_position ?? 'single',
      quantity,
      red_marked: false,
      notes: '',
      source: 'catalog',
    }

    if (existingIndex === undefined) {
      pushKnownRow(baseRow)
      continue
    }

    updateKnownRow(existingIndex, {
      location: baseRow.location,
      sub_location: baseRow.sub_location,
      category: baseRow.category,
      product: baseRow.product,
      attribute: baseRow.attribute,
      origin: baseRow.origin,
      inner_quantity: baseRow.inner_quantity,
      inner_unit: baseRow.inner_unit,
      official_name: baseRow.official_name,
      stocklist_name: baseRow.stocklist_name,
      navigation_guide: baseRow.navigation_guide,
      row_position: baseRow.row_position,
      quantity: baseRow.quantity,
      notes: baseRow.notes,
      source: 'catalog',
    })
  }

  for (const item of response.unknown_items ?? []) {
    pushUnknownRow({
      id: `unknown-${crypto.randomUUID()}`,
      code: null,
      location: normalizeTextValue(item.location, 'Unknown'),
      sub_location: normalizeTextValue(item.sub_location, 'Unknown'),
      category: normalizeTextValue(item.category, 'Unknown'),
      product: normalizeTextValue(item.product, normalizeTextValue(item.official_name, normalizeTextValue(item.product_raw, 'Unknown'))),
      attribute: normalizeTextValue(item.attribute, ''),
      origin: normalizeTextValue(item.origin, ''),
      inner_quantity: typeof item.inner_quantity === 'number' ? item.inner_quantity : null,
      inner_unit: item.inner_unit ?? 'box',
      official_name: normalizeTextValue(item.official_name, normalizeTextValue(item.product_raw, 'Unknown')),
      stocklist_name: normalizeTextValue(item.stocklist_name, normalizeTextValue(item.official_name, normalizeTextValue(item.product_raw, 'Unknown'))),
      navigation_guide: normalizeTextValue(item.navigation_guide, ''),
      row_position: item.row_position ?? 'single',
      quantity: typeof item.quantity === 'number' ? item.quantity : null,
      red_marked: false,
      notes: 'Parsed from photo',
      source: 'unknown',
    })
  }

  return nextRows
}

function isKnownRow(row: StockCheckRow) {
  return row.source === 'catalog' && Boolean(row.code)
}

function clampZoom(value: number) {
  return Math.min(2, Math.max(0.5, value))
}

function getTouchDistance(
  touchA: { clientX: number, clientY: number },
  touchB: { clientX: number, clientY: number },
) {
  return Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY)
}

/** Ambient messages that do not need a toast. */
const QUIET_STATUSES = new Set<string>([
  STATUS.READY_MANUAL,
  'Saving stock check...',
  'Switching to paper view for photo export...',
  'Photo closing entry is ready. Choose a photo to parse.',
])

export function EmbeddedStockCheckPanel({
  catalogItems,
  selectedHistoryRecord,
  historyRecords,
  onToggleCatalogVisibility,
  onOpenHistory,
}: {
  catalogItems: CatalogItem[] | null
  selectedHistoryRecord?: SelectedStockCheckHistoryRecord | null
  historyRecords?: StockCheckHistoryRecord[]
  onToggleCatalogVisibility?: (code: string, nextVisible: boolean) => Promise<boolean>
  onOpenHistory?: () => void
}) {
  const today = useMemo(() => getLocalTodayDate(), [])
  const stockPaperRef = useRef<HTMLDivElement | null>(null)
  const stockPaperAreaRef = useRef<HTMLDivElement | null>(null)
  const stockFindContainerRef = useRef<HTMLDivElement | null>(null)
  const [rows, setRows] = useState<StockCheckRow[]>([])
  const [stockEntryMode, setStockEntryMode] = useState<'manual' | 'photo'>('manual')
  const [stockPhotoFile, setStockPhotoFile] = useState<File | null>(null)
  const [stockDate, setStockDate] = useState(today)
  const [isValidated, setIsValidated] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [phase, setPhase] = useState<'landing' | 'editing'>('landing')
  const [pendingModeSwitch, setPendingModeSwitch] = useState<'manual' | 'photo' | null>(null)
  const [pendingStartNew, setPendingStartNew] = useState(false)
  const [stockCheckQueueCount, setStockCheckQueueCount] = useState(0)
  const [hasStockCheckLocalDraft, setHasStockCheckLocalDraft] = useState(false)
  const [hasRestoredOfflineDraft, setHasRestoredOfflineDraft] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [createCatalogItemPrefillName, setCreateCatalogItemPrefillName] = useState('')
  const [showCreateCatalogItemModal, setShowCreateCatalogItemModal] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSyncingWarehouse, setIsSyncingWarehouse] = useState(false)

  useEffect(() => {
    if (!error) return
    const friendly = friendlyError(error)
    toast.error(friendly.message, { details: friendly.details })
    setError(null)
  }, [error])

  useEffect(() => {
    if (!status) return
    if (!QUIET_STATUSES.has(status)) toast.success(status)
    setStatus(null)
  }, [status])
  const [recheckWarnings, setRecheckWarnings] = useState<RecheckWarning[]>([])
  const [showRecheckWarningModal, setShowRecheckWarningModal] = useState(false)
  const [hasPassedRecheck, setHasPassedRecheck] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [highlightedRowIndex, setHighlightedRowIndex] = useState<number | null>(null)
  const [paperZoom, setPaperZoom] = useState(1)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [stockMobileView, setStockMobileView] = useState<'card' | 'paper'>('card')
  const [isExportSnapshotMode, setIsExportSnapshotMode] = useState(false)
  const [stockCheckExpandedSections, setStockCheckExpandedSections] = useState<Set<string>>(new Set())
  const [storedExpandedSectionKeys, setStoredExpandedSectionKeys] = useState<string[] | null>(null)
  const [hasLoadedExpandedSectionPrefs, setHasLoadedExpandedSectionPrefs] = useState(false)
  const [hasInitializedExpandedSections, setHasInitializedExpandedSections] = useState(false)
  const [manualCheckQuantity, setManualCheckQuantity] = useState('')
  const [touchedRowIndexes, setTouchedRowIndexes] = useState<Set<number>>(() => new Set())
  const [lastAddedCheck, setLastAddedCheck] = useState<{ id: number; name: string; quantity: number; note?: string; snapshot: StockCheckRow[] } | null>(null)
  const checkItemInputRef = useRef<HTMLInputElement | null>(null)
  const checkQtyInputRef = useRef<HTMLInputElement | null>(null)
  const [manualCheckRedMarked, setManualCheckRedMarked] = useState(false)
  const [manualCheckHighlightIndex, setManualCheckHighlightIndex] = useState(0)
  const [isItemProfilesExpanded, setIsItemProfilesExpanded] = useState(false)
  const [showItemSuggestions, setShowItemSuggestions] = useState(false)
  const [selectedProfileItem, setSelectedProfileItem] = useState<CatalogItem | null>(null)
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartZoomRef = useRef(1)
  const currentZoomRef = useRef(1)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextRecheckResetRef = useRef(false)
  const loadedHistoryUid = selectedHistoryRecord?.uid_stock_check ?? null
  const visibleCatalogItems = useMemo(() => filterVisibleCatalogItems(catalogItems), [catalogItems])
  const availableCategories = useMemo(() => {
    if (!catalogItems || catalogItems.length === 0) return []
    const uniqueCategories = new Set(catalogItems.map((item) => item.category).filter((cat) => cat && cat.trim().length > 0))
    return Array.from(uniqueCategories).sort()
  }, [catalogItems])
  const catalogCodes = useMemo(() => {
    return new Set(visibleCatalogItems.map((item) => item.code.trim().toUpperCase()))
  }, [visibleCatalogItems])
  const rowVisibilityByCode = useMemo(() => {
    const map = new Map<string, boolean>()

    visibleCatalogItems.forEach((item) => {
      map.set(item.code.trim().toUpperCase(), item.is_visible !== false)
    })

    return map
  }, [visibleCatalogItems])

  useEffect(() => {
    currentZoomRef.current = paperZoom
  }, [paperZoom])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateMobileState = () => {
      const isMobile = mediaQuery.matches
      setIsMobileViewport(isMobile)
      if (isMobile) {
        try {
          const stored = window.localStorage.getItem(STOCK_CHECK_MOBILE_VIEW_KEY)
          if (stored === 'card' || stored === 'paper') {
            setStockMobileView(stored)
            return
          }
        } catch {
          // Ignore storage availability errors and use default.
        }

        setStockMobileView('card')
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
    if (!isMobileViewport || typeof window === 'undefined') return

    try {
      window.localStorage.setItem(STOCK_CHECK_MOBILE_VIEW_KEY, stockMobileView)
    } catch {
      // Ignore storage availability errors.
    }
  }, [isMobileViewport, stockMobileView])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = window.localStorage.getItem(STOCK_CHECK_EXPANDED_SECTIONS_KEY)
      if (!stored) {
        setStoredExpandedSectionKeys(null)
        setHasLoadedExpandedSectionPrefs(true)
        return
      }

      const parsed = JSON.parse(stored)
      if (!Array.isArray(parsed)) {
        setStoredExpandedSectionKeys(null)
        setHasLoadedExpandedSectionPrefs(true)
        return
      }

      const keys = parsed.filter((entry): entry is string => typeof entry === 'string')
      setStoredExpandedSectionKeys(keys)
    } catch {
      // Ignore malformed local storage.
      setStoredExpandedSectionKeys(null)
    } finally {
      setHasLoadedExpandedSectionPrefs(true)
    }
  }, [])

  useEffect(() => {
    if (!hasInitializedExpandedSections || typeof window === 'undefined') return

    try {
      window.localStorage.setItem(STOCK_CHECK_EXPANDED_SECTIONS_KEY, JSON.stringify(Array.from(stockCheckExpandedSections)))
    } catch {
      // Ignore storage availability errors.
    }
  }, [hasInitializedExpandedSections, stockCheckExpandedSections])

  useEffect(() => {
    if (!isMobileViewport) {
      setPaperZoom(1)
    }
  }, [isMobileViewport])

  const setZoomValue = useCallback((nextValue: number) => {
    setPaperZoom(clampZoom(nextValue))
  }, [])

  const zoomIn = useCallback(() => {
    setPaperZoom((prev) => clampZoom(prev + 0.1))
  }, [])

  const zoomOut = useCallback(() => {
    setPaperZoom((prev) => clampZoom(prev - 0.1))
  }, [])

  const resetZoom = useCallback(() => {
    setPaperZoom(1)
  }, [])

  const handlePaperTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || event.touches.length !== 2) {
      pinchStartDistanceRef.current = null
      return
    }

    pinchStartDistanceRef.current = getTouchDistance(event.touches[0], event.touches[1])
    pinchStartZoomRef.current = currentZoomRef.current
  }, [isMobileViewport])

  const handlePaperTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || event.touches.length !== 2 || !pinchStartDistanceRef.current) return

    event.preventDefault()

    const currentDistance = getTouchDistance(event.touches[0], event.touches[1])
    const distanceRatio = currentDistance / pinchStartDistanceRef.current
    setZoomValue(pinchStartZoomRef.current * distanceRatio)
  }, [isMobileViewport, setZoomValue])

  const clearPinchState = useCallback(() => {
    pinchStartDistanceRef.current = null
  }, [])

  useEffect(() => {
    if (visibleCatalogItems.length === 0) return

    setRows((prev) => {
      if (prev.length > 0) return prev
      return visibleCatalogItems.map(makeCatalogRow)
    })
  }, [visibleCatalogItems])

  const refreshOfflineState = useCallback(() => {
    if (typeof window === 'undefined') return

    setIsOnline(window.navigator.onLine)
    setStockCheckQueueCount(getPendingOfflineCountByFeature('stock-check'))
    setHasStockCheckLocalDraft(hasOfflineDraft('stock-check'))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    refreshOfflineState()

    const unsubscribeQueue = subscribeOfflineQueueUpdates(refreshOfflineState)
    const unsubscribeDraft = subscribeOfflineDraftUpdates(refreshOfflineState)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      unsubscribeQueue()
      unsubscribeDraft()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshOfflineState])

  useEffect(() => {
    if (typeof window === 'undefined' || hasRestoredOfflineDraft || phase !== 'editing') return

    if (loadedHistoryUid) {
      setHasRestoredOfflineDraft(true)
      return
    }

    const draft = loadOfflineDraft<StockCheckOfflineDraft>('stock-check')
    if (!draft || !Array.isArray(draft.rows)) {
      setHasRestoredOfflineDraft(true)
      return
    }

    setStockEntryMode(draft.stockEntryMode ?? 'manual')
    setStockDate(typeof draft.stockDate === 'string' && draft.stockDate.length > 0 ? draft.stockDate : today)
    setRows(draft.rows)
    setIsValidated(Boolean(draft.isValidated))
    setHasPassedRecheck(Boolean(draft.hasPassedRecheck))
    setStatus(STATUS.DRAFT_RECOVERED)
    setError(null)
    setHasRestoredOfflineDraft(true)
  }, [hasRestoredOfflineDraft, loadedHistoryUid, today, phase])

  useEffect(() => {
    if (!hasRestoredOfflineDraft) return

    // A sheet with nothing counted yet (the catalog pre-fill) is not a draft worth resuming.
    if (rows.length === 0 || !rows.some((row) => row.quantity !== null)) {
      clearOfflineDraft('stock-check')
      setHasStockCheckLocalDraft(false)
      return
    }

    // Debounced so typing stays smooth on slow phones; flushed when the app is hidden or closed.
    return scheduleDraftSave(() => {
      saveOfflineDraft('stock-check', {
        stockEntryMode,
        stockDate,
        rows,
        isValidated,
        hasPassedRecheck,
      })
      setHasStockCheckLocalDraft(true)
    })
  }, [hasPassedRecheck, hasRestoredOfflineDraft, isValidated, rows, stockDate, stockEntryMode])

  const startManualEntry = useCallback(() => {
    const freshToday = getLocalTodayDate()
    setStockEntryMode('manual')
    setStockPhotoFile(null)
    setRows([])
    setStockDate(freshToday)
    clearOfflineDraft('stock-check')
    setHasStockCheckLocalDraft(false)
    setManualCheckRedMarked(false)
    setStatus(STATUS.READY_MANUAL)
    setError(null)
    setIsValidated(false)
    setHasPassedRecheck(false)
    setShowRecheckWarningModal(false)
    setRecheckWarnings([])
  }, [])

  const confirmStartManualEntry = useCallback(() => {
    if (rows.length > 0) {
      setPendingModeSwitch('manual')
    } else {
      startManualEntry()
    }
  }, [rows.length, startManualEntry])

  const startPhotoEntry = useCallback(() => {
    const freshToday = getLocalTodayDate()
    setStockEntryMode('photo')
    setStockPhotoFile(null)
    setRows([])
    setStockDate(freshToday)
    clearOfflineDraft('stock-check')
    setHasStockCheckLocalDraft(false)
    setManualCheckRedMarked(false)
    setStatus('Photo closing entry is ready. Choose a photo to parse.')
    setError(null)
  }, [])

  const confirmStartPhotoEntry = useCallback(() => {
    if (rows.length > 0) {
      setPendingModeSwitch('photo')
    } else {
      startPhotoEntry()
    }
  }, [rows.length, startPhotoEntry])

  const parsePhoto = useCallback(async () => {
    if (!stockPhotoFile) {
      setError('Please select a stock closing photo first.')
      return
    }

    setStockEntryMode('photo')
    setIsParsing(true)
    setError(null)
    setStatus(null)

    try {
      const formData = new FormData()
      formData.append('photo', stockPhotoFile)
      formData.append('mode', 'stock-closing')
      if (visibleCatalogItems.length > 0) {
        formData.append('catalog', JSON.stringify(visibleCatalogItems))
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

      const payload = await response.json()
      if (response.status === 401) {
        throw new Error('Unauthorized. Please sign in at /login before parsing photos.')
      }

      if (!response.ok) {
        const details = payload?.details
        const detailsText = typeof details === 'string' ? details : details ? JSON.stringify(details) : ''
        throw new Error(detailsText ? `${payload?.error ?? 'Parse request failed.'} Details: ${detailsText}` : (payload?.error ?? 'Parse request failed.'))
      }

      const parsedRows = buildRowsFromParsedPhoto(visibleCatalogItems, payload as ParsedPhotoResponse)
      setRows(parsedRows)
      setStockDate(typeof payload?.data?.stock_date === 'string' && payload.data.stock_date.length > 0 ? payload.data.stock_date : today)
      setIsValidated(false)
      setHasPassedRecheck(false)
      setShowRecheckWarningModal(false)
      setRecheckWarnings([])
      setStatus(`Parsed ${parsedRows.length} stock row(s) from photo. Run Recheck before Save.`)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setError('Parsing timed out after 5 minutes. The stock photo took too long to process.')
      } else {
        setError(error instanceof Error ? error.message : 'Unexpected parse error.')
      }
    } finally {
      setIsParsing(false)
    }
  }, [stockPhotoFile, today, visibleCatalogItems])

  useEffect(() => {
    if (!selectedHistoryRecord || visibleCatalogItems.length === 0) return

    const recordData = selectedHistoryRecord.record_data
    if (!recordData) return

    const nextRows: StockCheckRow[] = []
    const codeToIndex = new Map<string, number>()
    const catalogByCode = new Map(
      visibleCatalogItems.map((item) => [item.code.trim().toUpperCase(), item]),
    )

    for (const item of recordData.items) {
      if (item.quantity === null) {
        continue
      }

      const codeKey = item.code.trim().toUpperCase()
      const existingIndex = codeToIndex.get(codeKey)

      if (existingIndex !== undefined) {
        const current = nextRows[existingIndex]
        nextRows[existingIndex] = {
          ...current,
          location: item.location || current.location,
          sub_location: item.sub_location || current.sub_location,
          category: item.category || current.category,
          product: item.product || current.product,
          origin: item.origin || current.origin,
          inner_quantity: item.inner_quantity ?? current.inner_quantity,
          inner_unit: item.inner_unit ?? current.inner_unit,
          official_name: item.official_name || current.official_name,
          stocklist_name: item.stocklist_name || current.stocklist_name,
          quantity: item.quantity,
          red_marked: item.red_marked,
          notes: item.notes || '',
        }
        continue
      }

      const catalogMatch = catalogByCode.get(codeKey)

      nextRows.push({
        id: `history-known-${selectedHistoryRecord.uid_stock_check}-${item.code}`,
        code: item.code,
        location: item.location || catalogMatch?.location || 'Unknown',
        sub_location: item.sub_location || catalogMatch?.sub_location || 'Unknown',
        category: item.category || catalogMatch?.category || 'Unknown',
        product: item.product || catalogMatch?.product || item.official_name,
        attribute: catalogMatch?.attribute ?? '',
        origin: item.origin || catalogMatch?.origin || '',
        inner_quantity: item.inner_quantity ?? catalogMatch?.inner_quantity ?? null,
        inner_unit: item.inner_unit ?? catalogMatch?.inner_unit ?? 'box',
        official_name: item.official_name || catalogMatch?.official_name || item.product,
        stocklist_name: item.stocklist_name || catalogMatch?.stocklist_name || item.official_name || item.product,
        navigation_guide: catalogMatch?.navigation_guide ?? '',
        row_position: catalogMatch?.row_position ?? 'single',
        quantity: item.quantity,
        red_marked: item.red_marked,
        notes: item.notes || '',
        source: 'catalog',
      })
      codeToIndex.set(codeKey, nextRows.length - 1)
    }

    for (const item of recordData.unknown_items) {
      if (item.quantity === null) {
        continue
      }

      nextRows.push({
        id: `history-unknown-${selectedHistoryRecord.uid_stock_check}-${item.user_input}`,
        code: null,
        location: 'Unknown',
        sub_location: 'Unknown',
        category: 'Unknown',
        product: item.user_input,
        attribute: '',
        origin: '',
        inner_quantity: null,
        inner_unit: 'box',
        official_name: item.user_input,
        stocklist_name: item.user_input,
        navigation_guide: '',
        row_position: 'single',
        quantity: item.quantity,
        red_marked: item.red_marked,
        notes: item.notes || '',
        source: 'unknown',
      })
    }

    setRows(nextRows)
    setStockDate(selectedHistoryRecord.stock_date || today)
    setIsValidated(recordData.validated || selectedHistoryRecord.validated)
    setHasPassedRecheck(false)
    setRecheckWarnings([])
    setShowRecheckWarningModal(false)
    setStatus(`Loaded stock check record ${selectedHistoryRecord.uid_stock_check}.`)
    setError(null)
    setPhase('editing')
  }, [selectedHistoryRecord, today, visibleCatalogItems])

  useEffect(() => {
    if (skipNextRecheckResetRef.current) {
      skipNextRecheckResetRef.current = false
      return
    }

    setHasPassedRecheck(false)
  }, [rows, stockDate])

  const suggestions = useMemo(() => {
    if (visibleCatalogItems.length === 0) return []
    return rankSuggestions(visibleCatalogItems, newItemName)
  }, [newItemName, visibleCatalogItems])

  const activeProfileItem = useMemo(() => {
    if (selectedProfileItem) {
      return selectedProfileItem
    }

    if (!newItemName.trim() || suggestions.length === 0) {
      return null
    }

    const normalizedName = newItemName.trim().toLowerCase()
    const exactMatch = suggestions.find((item) => {
      return item.official_name.trim().toLowerCase() === normalizedName
    })

    return exactMatch ?? suggestions[0]
  }, [newItemName, selectedProfileItem, suggestions])

  const indexedRows = useMemo(() => rows.map((row, index) => ({ row, index })), [rows])

  const displayedIndexedRows = useMemo(() => {
    if (stockEntryMode !== 'manual') {
      return indexedRows
    }

    return indexedRows.filter((entry) => entry.row.quantity !== null || touchedRowIndexes.has(entry.index))
  }, [indexedRows, stockEntryMode, touchedRowIndexes])

  const quantityByCode = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((row) => {
      if (row.code && row.quantity !== null) map.set(row.code.trim().toUpperCase(), row.quantity)
    })
    return map
  }, [rows])

  const findSuggestions = useMemo(() => {
    const term = findTerm.trim().toLowerCase()
    if (!term) return []

    return displayedIndexedRows
      .filter(({ row }) => {
        const official = row.official_name.toLowerCase()
        const stocklist = row.stocklist_name.toLowerCase()
        return official.includes(term) || stocklist.includes(term)
      })
      .slice(0, 8)
  }, [findTerm, displayedIndexedRows])

  const getHighlightClass = useCallback((index: number | undefined) => {
    if (index === undefined || index !== highlightedRowIndex) {
      return ''
    }
    return 'bg-success-soft transition-colors duration-700'
  }, [highlightedRowIndex])

  const focusAndHighlightRow = useCallback((index: number) => {
    const targetRow = indexedRows[index]
    const sectionId = !targetRow
      ? undefined
      : targetRow.row.source === 'unknown'
      ? UNKNOWN_SECTION_ID
      : targetRow.row.location === 'Outside Coolroom'
      ? OUTSIDE_SECTION_ID
      : buildInsideSectionId(normalizeInsideSectionLabel(targetRow.row.category, targetRow.row.sub_location))

    if (sectionId) {
      setStockCheckExpandedSections((current) => {
        if (current.has(sectionId)) return current
        const next = new Set(current)
        next.add(sectionId)
        return next
      })
    }

    const target = stockPaperAreaRef.current?.querySelector(`[data-stock-row-index="${index}"]`) as HTMLElement | null
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    setHighlightedRowIndex(index)

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }

    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedRowIndex(null)
      highlightTimeoutRef.current = null
    }, 3000)
  }, [indexedRows])

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleOutsideFindClick = (event: MouseEvent | TouchEvent) => {
      if (!findTerm.trim()) return

      const targetNode = event.target as Node | null
      if (!targetNode) return

      if (stockFindContainerRef.current?.contains(targetNode)) return
      setFindTerm('')
    }

    document.addEventListener('mousedown', handleOutsideFindClick)
    document.addEventListener('touchstart', handleOutsideFindClick)

    return () => {
      document.removeEventListener('mousedown', handleOutsideFindClick)
      document.removeEventListener('touchstart', handleOutsideFindClick)
    }
  }, [findTerm])

  const paperSections = useMemo(() => buildPaperSections(displayedIndexedRows), [displayedIndexedRows])

  const outsideDisplayColumns = useMemo(
    () => buildOutsideDisplayColumns(paperSections.outsideRows),
    [paperSections.outsideRows],
  )

  const stockCardSections = useMemo(() => {
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

  const isStockCheckSectionCollapsed = useCallback((sectionId: string) => {
    return !stockCheckExpandedSections.has(sectionId)
  }, [stockCheckExpandedSections])

  const stockCheckSectionIds = useMemo(() => {
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

  const areAllStockCheckSectionsExpanded = useMemo(() => {
    if (stockCheckSectionIds.length === 0) return false
    return stockCheckSectionIds.every((sectionId) => stockCheckExpandedSections.has(sectionId))
  }, [stockCheckExpandedSections, stockCheckSectionIds])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!hasLoadedExpandedSectionPrefs || hasInitializedExpandedSections) return

    const initialExpanded = storedExpandedSectionKeys
      ? new Set(storedExpandedSectionKeys)
      : new Set(stockCheckSectionIds)

    setStockCheckExpandedSections(initialExpanded)
    setHasInitializedExpandedSections(true)
  }, [hasInitializedExpandedSections, hasLoadedExpandedSectionPrefs, stockCheckSectionIds, storedExpandedSectionKeys])

  const toggleStockCheckSection = useCallback((sectionId: string) => {
    setStockCheckExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }, [])

  const expandAllStockCheckSections = useCallback(() => {
    setStockCheckExpandedSections(new Set(stockCheckSectionIds))
  }, [stockCheckSectionIds])

  const collapseAllStockCheckSections = useCallback(() => {
    setStockCheckExpandedSections(new Set())
  }, [])

  const isExportActionDisabled = isExporting || isSaving || isParsing

  const getCardHighlightClass = useCallback((index: number | undefined) => {
    if (index === undefined) return ''
    const target = indexedRows[index]
    if (!target) return ''
    if (index === highlightedRowIndex) return 'ring-2 ring-accent bg-success-soft'
    if (target.row.source === 'unknown') return 'border-warning/30 bg-warning-soft'
    if (target.row.red_marked) return 'border-red-300 bg-red-50'
    return ''
  }, [highlightedRowIndex, indexedRows])

  const latestPreviousValidatedRecord = useMemo(() => {
    if (!historyRecords || historyRecords.length === 0) return null

    return historyRecords
      .filter((entry) => entry.validated && Boolean(entry.record_data))
      .filter((entry) => entry.uid_stock_check !== loadedHistoryUid)
      .sort((a, b) => {
        const left = new Date(a.timestamp).getTime()
        const right = new Date(b.timestamp).getTime()
        return right - left
      })[0] ?? null
  }, [historyRecords, loadedHistoryUid])

  function updateRow(index: number, patch: Partial<StockCheckRow>) {
    setRows((prev) => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...patch }
      return copy
    })
  }

  function setQuantity(index: number, value: string) {
    const next = value.trim().length === 0 ? null : Number(value.replace(',', '.'))
    setTouchedRowIndexes((current) => (current.has(index) ? current : new Set(current).add(index)))
    setLastAddedCheck(null)
    updateRow(index, { quantity: next === null || Number.isNaN(next) ? null : next })
  }

  function toggleRed(index: number) {
    updateRow(index, { red_marked: !rows[index].red_marked })
  }

  function addKnownFromSuggestion(item: CatalogItem, quantityOverride: number | null = null, redMarked = false) {
    setRows((prev) => {
      const existingIndex = prev.findIndex((x) => x.code === item.code)
      const nextRow = {
        ...makeCatalogRow(item),
        quantity: quantityOverride,
        red_marked: redMarked,
      }

      if (existingIndex < 0) {
        return [...prev, nextRow]
      }

      const next = [...prev]
      next[existingIndex] = {
        ...next[existingIndex],
        ...nextRow,
      }
      return next
    })
    setNewItemName('')
    setShowItemSuggestions(false)
    setSelectedProfileItem(item)
    setError(null)
  }

  function addUnknownItem() {
    const trimmed = newItemName.trim()
    if (!trimmed) {
      setError('Enter item name first, then click Create new Item.')
      return
    }

    setCreateCatalogItemPrefillName(trimmed)
    setShowCreateCatalogItemModal(true)
    setError(null)
  }

  function addCreatedStockCheckItem(created: CreateCatalogItemPayload) {
    const normalizedCode = created.code.trim().toUpperCase()

    setRows((prev) => {
      const exists = prev.some((row) => row.code?.trim().toUpperCase() === normalizedCode)
      if (exists) return prev

      return [...prev, makeCatalogRow(created)]
    })

    setShowCreateCatalogItemModal(false)
    setCreateCatalogItemPrefillName('')
    setNewItemName('')
    setShowItemSuggestions(false)
    setSelectedProfileItem(created)
    setStatus(`Created and added ${created.official_name} immediately.`)
    setError(null)
  }

  const handleStockCheckItemInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (suggestions.length === 0 || !showItemSuggestions) {
        if (event.key === 'Enter' && event.currentTarget.value.trim()) {
          event.preventDefault()
          checkQtyInputRef.current?.focus()
        }
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setManualCheckHighlightIndex((prev) => (prev + 1) % suggestions.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setManualCheckHighlightIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
      } else if (event.key === 'Enter' && suggestions.length > 0) {
        event.preventDefault()
        selectStockCheckCatalogSuggestion(suggestions[manualCheckHighlightIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setManualCheckHighlightIndex(0)
        setShowItemSuggestions(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestions, manualCheckHighlightIndex, showItemSuggestions]
  )

  function selectStockCheckCatalogSuggestion(item: CatalogItem) {
    setNewItemName(item.official_name)
    setManualCheckHighlightIndex(0)
    setShowItemSuggestions(false)
    setSelectedProfileItem(item)
    setError(null)
    // Chain: item picked -> keypad opens on Quantity
    requestAnimationFrame(() => checkQtyInputRef.current?.focus())
  }

  function addStockCheckManualKnownItem(): boolean {
    const trimmedItem = newItemName.trim()
    const trimmedQty = manualCheckQuantity.trim()

    if (!stockDate) {
      setError('Please select a stock date first.')
      return false
    }
    if (!trimmedItem) {
      setError('Please select an item from suggestion or enter an item code.')
      return false
    }
    const typedQuantity = parseTypedQuantity(trimmedQty)
    if (typedQuantity === null) {
      setError('Please enter a valid quantity.')
      return false
    }

    const normalizedInput = normalizeCompareKey(trimmedItem)
    let matchedItem: CatalogItem | null = null

    if (selectedProfileItem?.code) {
      const normalizedSelectedCode = normalizeCompareKey(selectedProfileItem.code)
      matchedItem = visibleCatalogItems.find((item) => {
        return normalizeCompareKey(item.code) === normalizedSelectedCode
      }) ?? selectedProfileItem
    }

    if (!matchedItem) {
      matchedItem = visibleCatalogItems.find((item) => {
        return normalizeCompareKey(item.code) === normalizedInput
          || normalizeCompareKey(item.official_name) === normalizedInput
          || normalizeCompareKey(item.stocklist_name) === normalizedInput
      }) ?? null
    }

    const snapshot = rows

    if (matchedItem) {
      addKnownFromSuggestion(matchedItem, typedQuantity, manualCheckRedMarked)
    } else {
      setRows((prev) => [
        ...prev,
        {
          id: `unknown-manual-${crypto.randomUUID()}`,
          code: null,
          location: 'Unknown',
          sub_location: 'Unknown',
          category: 'Unknown',
          product: trimmedItem,
          attribute: '',
          origin: '',
          inner_quantity: null,
          inner_unit: 'box',
          official_name: trimmedItem,
          stocklist_name: trimmedItem,
          navigation_guide: '',
          row_position: 'single',
          quantity: typedQuantity,
          red_marked: manualCheckRedMarked,
          notes: 'Manual offline entry',
          source: 'unknown',
        },
      ])
      setError(null)
    }

    setLastAddedCheck({
      id: Date.now(),
      name: matchedItem?.official_name ?? trimmedItem,
      quantity: typedQuantity,
      note: matchedItem ? undefined : 'not in catalog',
      snapshot,
    })
    setTouchedRowIndexes(new Set())

    setNewItemName('')
    setManualCheckQuantity('')
    setManualCheckRedMarked(false)
    setManualCheckHighlightIndex(0)
    return true
  }

  function submitStockCheckManualEntry() {
    if (addStockCheckManualKnownItem()) {
      // Chain: added -> back to an empty search for the next item
      requestAnimationFrame(() => checkItemInputRef.current?.focus())
    }
  }

  function undoLastAddedCheck() {
    if (!lastAddedCheck) return
    setRows(lastAddedCheck.snapshot)
    setLastAddedCheck(null)
    checkItemInputRef.current?.focus()
  }

  function compareWithPreviousValidatedStockCheck(): number {
    if (!latestPreviousValidatedRecord?.record_data) {
      setRecheckWarnings([])
      setHasPassedRecheck(true)
      setShowRecheckWarningModal(false)
      return 0
    }

    const currentKnownByCode = new Map<string, StockCheckRow>()
    const currentUnknownByName = new Map<string, StockCheckRow>()

    for (const row of rows) {
      if (row.code) {
        currentKnownByCode.set(row.code.trim().toUpperCase(), row)
      } else {
        const fallbackName = row.official_name || row.stocklist_name || row.product
        currentUnknownByName.set(normalizeCompareKey(fallbackName), row)
      }
    }

    const warnings: RecheckWarning[] = []

    for (const previousRow of latestPreviousValidatedRecord.record_data.items) {
      const previousQuantity = parseNumericQuantity(previousRow.quantity)
      if (previousQuantity === null || previousQuantity <= 0) continue

      const key = previousRow.code.trim().toUpperCase()
      const currentRow = currentKnownByCode.get(key)
      const currentQuantity = parseNumericQuantity(currentRow?.quantity)

      if (currentQuantity === null || currentQuantity <= 0) {
        warnings.push({
          key: `known-${key}`,
          label: previousRow.official_name || previousRow.stocklist_name || previousRow.product || previousRow.code,
          section: `${previousRow.location} / ${previousRow.sub_location}`,
          previousQuantity,
          currentQuantity,
          reason: currentQuantity === null ? 'now_blank' : 'now_zero',
        })
      }
    }

    for (const previousRow of latestPreviousValidatedRecord.record_data.unknown_items) {
      const previousQuantity = parseNumericQuantity(previousRow.quantity)
      if (previousQuantity === null || previousQuantity <= 0) continue

      const compareKey = normalizeCompareKey(previousRow.user_input)
      const currentRow = currentUnknownByName.get(compareKey)
      const currentQuantity = parseNumericQuantity(currentRow?.quantity)

      if (currentQuantity === null || currentQuantity <= 0) {
        warnings.push({
          key: `unknown-${compareKey}`,
          label: previousRow.user_input,
          section: 'Unknown Items',
          previousQuantity,
          currentQuantity,
          reason: currentQuantity === null ? 'now_blank' : 'now_zero',
        })
      }
    }

    if (warnings.length === 0) {
      setRecheckWarnings([])
      setHasPassedRecheck(true)
      setShowRecheckWarningModal(false)
      return 0
    }

    setRecheckWarnings(warnings)
    setHasPassedRecheck(false)
    setShowRecheckWarningModal(true)
    return warnings.length
  }

  function applyValidatedState() {
    skipNextRecheckResetRef.current = true
    setIsValidated(true)
    setHasPassedRecheck(true)
    setShowRecheckWarningModal(false)
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
        origin: x.origin,
        inner_quantity: x.inner_quantity,
        inner_unit: x.inner_unit,
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

  function buildWarehouseEnvelopePayload(inputRows: StockCheckRow[], validated: boolean) {
    const known = inputRows.filter((x) => isKnownRow(x))
    const unknown = inputRows.filter((x) => x.source === 'unknown')

    const knownItems = known.map((x) => ({
      catalog_code: x.code as string,
      product_raw: x.stocklist_name || x.official_name || x.product,
      location: x.location,
      sub_location: x.sub_location,
      category: x.category,
      product: x.product,
      attribute: x.attribute,
      origin: x.origin,
      inner_quantity: x.inner_quantity,
      inner_unit: x.inner_unit,
      official_name: x.official_name,
      stocklist_name: x.stocklist_name,
      navigation_guide: x.navigation_guide,
      row_position: x.row_position,
      quantity_raw: x.quantity === null ? null : String(x.quantity),
      quantity: x.quantity,
      quantity_conflict_flag: false,
      confidence: 'high' as const,
      catalog_match_status: 'exact' as const,
      notes: x.red_marked ? [x.notes, 'red_marked=true'].filter(Boolean).join(' | ') : x.notes,
    }))

    const unknownItems = unknown.map((x) => ({
      catalog_code: null,
      product_raw: x.official_name || x.product,
      location: 'Unknown',
      sub_location: 'Unknown',
      category: 'Unknown',
      product: x.product || x.official_name,
      attribute: '',
      origin: '',
      inner_quantity: null,
      inner_unit: 'box' as const,
      official_name: x.official_name,
      stocklist_name: x.stocklist_name || x.official_name,
      navigation_guide: '',
      row_position: 'single' as const,
      quantity_raw: x.quantity === null ? null : String(x.quantity),
      quantity: x.quantity,
      quantity_conflict_flag: false,
      confidence: 'high' as const,
      catalog_match_status: 'unknown' as const,
      notes: x.red_marked ? [x.notes, 'red_marked=true'].filter(Boolean).join(' | ') : x.notes,
    }))

    return {
      data: {
        photo_id: `stock-check-${crypto.randomUUID()}`,
        mode: 'stock-closing' as const,
        upload_date: new Date().toISOString(),
        stock_date: stockDate,
        photo_url: null,
        total_items: knownItems.length,
        confidence_overall: 'high' as const,
        items: knownItems,
      },
      validated: validated ? 'yes' as const : 'no' as const,
      unknown_items: unknownItems,
      missing_catalog_items: [],
    }
  }

  async function saveStockCheck(): Promise<'saved' | 'queued' | 'failed'> {
    const requestEnvelope = buildWarehouseEnvelopePayload(rows, true)

    applyValidatedState()
    setIsSaving(true)
    setStatus('Saving stock check...')
    setError(null)

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      enqueueOfflineRequest({
        feature: 'stock-check',
        endpoint: '/api/stock-check/save-to-supabase',
        payload: requestEnvelope,
      })
      setStatus('Saved on this phone. It will upload when the connection is back.')
      setIsSaving(false)
      return 'queued'
    }

    try {
      const response = await fetch('/api/stock-check/save-to-supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestEnvelope),
      })

      const responsePayload = await response.json()
      if (!response.ok) {
        throw new Error(responsePayload?.error ?? 'Save failed.')
      }

      // Clear the local draft so it doesn't get incorrectly restored next time
      clearOfflineDraft('stock-check')
      setHasStockCheckLocalDraft(false)
      return 'saved'
    } catch (e) {
      if (isNetworkRequestError(e)) {
        enqueueOfflineRequest({
          feature: 'stock-check',
          endpoint: '/api/stock-check/save-to-supabase',
          payload: requestEnvelope,
        })
        setStatus('Saved on this phone. It will upload when the connection is back.')
        return 'queued'
      }

      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed.')
      return 'failed'
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Pushes the saved closing to the warehouse (BigQuery) without blocking the screen.
   * The envelope is captured once, so Retry sends exactly what was saved.
   */
  function syncToWarehouse(envelope: ReturnType<typeof buildWarehouseEnvelopePayload>, toastId?: number) {
    const id = toastId ?? toast.progress('Saved · syncing to warehouse…')
    if (toastId) toast.update(id, { tone: 'progress', message: 'Syncing to warehouse…', action: undefined, details: undefined })
    setIsSyncingWarehouse(true)
    void (async () => {
      try {
        const response = await fetch('/api/stock-check/save-to-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(envelope),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error ?? 'Warehouse sync failed.')
        toast.update(id, { tone: 'success', message: 'Closing saved and synced' })
      } catch (e) {
        toast.update(id, {
          tone: 'error',
          message: 'Saved. Warehouse sync failed.',
          details: e instanceof Error ? e.message : undefined,
          action: { label: 'Retry', onClick: () => syncToWarehouse(envelope) },
        })
      } finally {
        setIsSyncingWarehouse(false)
      }
    })()
  }

  /** One Save: recheck -> (warnings sheet if needed) -> save -> background warehouse sync. */
  function handleSave() {
    if (isSaving) return
    const warningCount = compareWithPreviousValidatedStockCheck()
    if (warningCount > 0) return
    void saveAndSync()
  }

  async function saveAndSync() {
    setShowRecheckWarningModal(false)
    const envelope = buildWarehouseEnvelopePayload(rows, true)
    const outcome = await saveStockCheck()
    if (outcome === 'saved') syncToWarehouse(envelope)
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

      setStatus('CSV saved to your downloads.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function exportPhoto() {
    setIsExporting(true)
    setStatus(null)
    setError(null)

    const zoomBeforeExport = currentZoomRef.current
    const needsZoomReset = isMobileViewport && zoomBeforeExport !== 1
    const previousExpandedSections = new Set(stockCheckExpandedSections)
    const switchedFromCard = isMobileViewport && stockMobileView === 'card'

    try {
      if (switchedFromCard) {
        setStatus('Switching to paper view for photo export...')
        setStockMobileView('paper')
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
      }

      if (!stockPaperRef.current) {
        throw new Error('Stocklist area is not ready for photo export.')
      }

      if (needsZoomReset) {
        setPaperZoom(1)
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      }

      setStockCheckExpandedSections(new Set(stockCheckSectionIds))
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })

      setIsExportSnapshotMode(true)
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })

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

      setStatus('Photo saved to your downloads.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo export failed.')
    } finally {
      setIsExportSnapshotMode(false)
      setStockCheckExpandedSections(previousExpandedSections)
      if (needsZoomReset) {
        setPaperZoom(zoomBeforeExport)
      }
      if (switchedFromCard) {
        setStockMobileView('card')
      }
      setIsExporting(false)
    }
  }

  const toggleStockCheckVisibility = useCallback(async (code: string, nextVisible: boolean) => {
    if (!onToggleCatalogVisibility) {
      return
    }

    const changed = await onToggleCatalogVisibility(code, nextVisible)

    if (!changed) {
      return
    }

    if (!nextVisible) {
      const normalizedCode = code.trim().toUpperCase()
      setRows((prev) => prev.filter((row) => row.code?.trim().toUpperCase() !== normalizedCode))
    }
  }, [onToggleCatalogVisibility])

  function renderLabelCell(item: IndexedRow | undefined, className: string) {
    if (!item) return null

    const code = item.row.code?.trim().toUpperCase() ?? ''
    const canToggleVisibility = item.row.source === 'catalog' && code.length > 0
    const isVisible = canToggleVisibility ? (rowVisibilityByCode.get(code) ?? true) : true

    const latestCatalogItem = code ? catalogItems.find(c => c.code.trim().toUpperCase() === code) : null;
    const displayName = latestCatalogItem?.official_name ?? item.row.official_name ?? '';

    if (isExportSnapshotMode) {
      return (
        <div className="stock-export-label-wrap">
          <span
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 rounded-full border ${item.row.red_marked ? 'border-red-600 bg-red-600' : 'border-slate-400 bg-transparent'}`}
          />
          <span
            data-stock-row-index={item.index}
            className={`stock-export-label ${className} ${item.row.red_marked ? 'text-red-600 font-semibold' : ''}`}
            title={displayName}
          >
            {displayName}
          </span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Toggle reorder mark"
          onClick={() => toggleRed(item.index)}
          className={`relative h-3.5 w-3.5 shrink-0 rounded-full border before:absolute before:-inset-3 before:content-[''] ${item.row.red_marked ? 'border-red-600 bg-red-600' : 'border-slate-400 bg-transparent'}`}
          title="Click to mark as selling fast"
        />
        <input
          data-stock-row-index={item.index}
          className={`${className} ${item.row.red_marked ? 'text-red-600 font-semibold' : ''}`}
          value={displayName}
          readOnly
          onChange={(event) => updateRow(item.index, { official_name: event.target.value })}
        />
      </div>
    )
  }

  function renderQuantityCell(item: IndexedRow) {
    if (isExportSnapshotMode) {
      return (
        <div
          data-stock-row-index={item.index}
          className={`stock-qty-input stock-export-qty ${item.row.red_marked ? 'text-red-600' : ''}`}
          aria-label={`Quantity for ${item.row.official_name}`}
        >
          {item.row.quantity ?? ''}
        </div>
      )
    }

    return (
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        onKeyDown={focusNextQuantityInput}
        data-stock-row-index={item.index}
        className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
        aria-label={`Quantity for ${item.row.official_name}`}
        value={item.row.quantity ?? ''}
        onChange={(event) => setQuantity(item.index, event.target.value)}
      />
    )
  }

  // Count from the saved draft: on the start screen the rows are the empty catalog pre-fill.
  const stockCheckDraftItemCount = (() => {
    if (!hasStockCheckLocalDraft) return 0
    const draft = loadOfflineDraft<{ rows?: Array<{ quantity: number | null }> }>('stock-check')
    return (draft?.rows ?? []).filter((row) => row.quantity !== null).length
  })()

  if (phase === 'landing') {
    return (
      <SectionLandingState
        sectionLabel="Closing count"
        subtitle="Count what is left at 4 PM, then save and export."
        hasDraft={hasStockCheckLocalDraft}
        draftAge={getOfflineDraftAge('stock-check')}
        draftItemCount={stockCheckDraftItemCount}
        historyCount={historyRecords?.length || 0}
        onAction={(action) => {
          if (action === 'new') {
            setPhase('editing')
            // Only a saved draft can be lost here; the rows pre-filled from the catalog are not work.
            if (hasStockCheckLocalDraft) {
              setPendingStartNew(true)
            } else {
              startManualEntry()
            }
          } else if (action === 'continue') {
            setPhase('editing')
            // draft restore effect will handle it
          } else if (action === 'history') {
            if (onOpenHistory) onOpenHistory()
            else setPhase('editing')
          }
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-surface p-4 sm:p-6">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setPhase('landing')}
            className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-control px-2 text-[15px] text-muted hover:bg-slate-100 hover:text-ink"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Menu
          </button>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {loadedHistoryUid ? 'Edit closing count' : 'Closing count'}
            </h1>
            <p className="text-[14px] text-muted tabular">
              {formatSheetDate(stockDate || today)} · {rows.filter(r => r.quantity !== null).length} items counted
            </p>
          </div>
          {stockCheckQueueCount > 0 || !isOnline ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[13px] font-medium text-warning">
              {!isOnline ? 'Offline · saves stay on this phone' : `${stockCheckQueueCount} save${stockCheckQueueCount > 1 ? 's' : ''} waiting to upload`}
            </p>
          ) : null}
          {visibleCatalogItems.length === 0 && (
            <p className="mt-2 rounded-control bg-warning-soft px-3 py-2 text-[14px] text-warning">
              The catalog did not load. You can still type item names and counts; they are kept for review.
            </p>
          )}
        </div>

        <div className="mb-4">
          <EntryMethodToggle
            value={stockEntryMode}
            onManual={confirmStartManualEntry}
            onPhoto={confirmStartPhotoEntry}
            manualHelpText="Search an item, type the count, press Enter."
            photoHelpText="Take or choose a photo of the closing sheet, then check the numbers."
          />
        </div>

        {stockEntryMode === 'manual' && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="relative md:rounded-card md:border md:border-line md:p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="check-stock-date" className="whitespace-nowrap text-[14px] font-medium text-ink">Stock date</label>
                  <input
                    id="check-stock-date"
                    type="date"
                    value={stockDate}
                    onChange={(event) => setStockDate(event.target.value || today)}
                    className={`${inputClass} w-auto tabular`}
                  />
                </div>

                <div className="relative">
                  <label htmlFor="check-item-search" className="mb-1.5 block text-[14px] font-medium text-ink">Item</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="check-item-search"
                      ref={checkItemInputRef}
                      type="search"
                      value={newItemName}
                      onChange={(event) => {
                        setNewItemName(event.target.value)
                        setManualCheckHighlightIndex(0)
                        setSelectedProfileItem(null)
                        setShowItemSuggestions(event.target.value.trim().length > 0)
                      }}
                      onKeyDown={handleStockCheckItemInputKeyDown}
                      placeholder="Search item"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      className={`${fieldClass} min-h-12 pl-10`}
                    />
                  </div>

                  {showItemSuggestions && newItemName.trim().length > 0 && suggestions.length > 0 && (
                    <div role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-control border border-line bg-surface shadow-raised">
                      {suggestions.map((item, idx) => {
                        const currentQty = quantityByCode.get(item.code.trim().toUpperCase())
                        const highlighted = idx === manualCheckHighlightIndex
                        return (
                          <button
                            key={item.code}
                            type="button"
                            role="option"
                            aria-selected={highlighted}
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => {
                              selectStockCheckCatalogSuggestion(item)
                              setManualCheckQuantity('')
                            }}
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
                  {showItemSuggestions && newItemName.trim().length > 0 && suggestions.length === 0 && (
                    <p className="mt-1.5 text-[13px] text-muted">Not in the catalog. Add it with a quantity to review later.</p>
                  )}
                </div>

                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="check-qty" className="mb-1.5 block text-[14px] font-medium text-ink">Quantity</label>
                    <NumberInput
                      id="check-qty"
                      ref={checkQtyInputRef}
                      value={manualCheckQuantity}
                      onChange={(event) => setManualCheckQuantity(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          submitStockCheckManualEntry()
                        }
                      }}
                      placeholder="0"
                      className="min-h-12 text-[18px] font-semibold"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={submitStockCheckManualEntry}
                    disabled={!stockDate || newItemName.trim().length === 0 || manualCheckQuantity.trim().length === 0}
                    className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-control bg-forest-900 px-5 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest-900/30"
                  >
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    Add
                  </button>
                </div>

                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1 text-[15px] text-ink">
                  <input
                    type="checkbox"
                    checked={manualCheckRedMarked}
                    onChange={(event) => setManualCheckRedMarked(event.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-danger focus:ring-danger"
                  />
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-danger" aria-hidden="true" />
                    Selling fast (red mark)
                  </span>
                </label>

                {lastAddedCheck ? (
                  <div key={lastAddedCheck.id} className="flex animate-fade-in items-center gap-2 rounded-control bg-forest-50 py-1.5 pl-3 pr-1.5" role="status">
                    <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    <p className="min-w-0 flex-1 truncate text-[14px] text-ink">
                      <span className="font-medium">{lastAddedCheck.name}</span>
                      <span className="tabular"> · {lastAddedCheck.quantity}</span>
                      {lastAddedCheck.note ? <span className="text-muted"> · {lastAddedCheck.note}</span> : null}
                    </p>
                    <button
                      type="button"
                      onClick={undoLastAddedCheck}
                      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[8px] px-2.5 text-[14px] font-semibold text-forest-800 hover:bg-forest-100"
                    >
                      <Undo2 className="h-4 w-4" aria-hidden="true" />
                      Undo
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-3">
              <button
                type="button"
                onClick={() => setIsItemProfilesExpanded(!isItemProfilesExpanded)}
                className="mb-2 inline-flex items-center justify-between gap-2 text-[13px] font-medium text-muted hover:text-brand-700"
              >
                <span>Item Profiles</span>
                <span className="text-sm">{isItemProfilesExpanded ? '▼' : '▶'}</span>
              </button>

              {isItemProfilesExpanded && (
                <div className="space-y-2 rounded-lg bg-white p-3">
                  {activeProfileItem ? (
                    <>
                      <div>
                        <p className="text-[12px] font-medium text-muted">Official Name</p>
                        <p className="mt-1 text-sm font-medium text-slate-800">{activeProfileItem.official_name}</p>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-muted">Product</p>
                        <p className="mt-1 text-sm text-slate-700">{activeProfileItem.product || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-muted">Category</p>
                        <p className="mt-1 text-sm text-slate-700">{activeProfileItem.category || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-muted">Location</p>
                        <p className="mt-1 text-sm text-slate-700">{activeProfileItem.location || '-'}</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Choose an item to preview read-only profile details.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {isMobileViewport && (
          <div className="mt-3 mb-2 rounded-lg border border-slate-200 bg-white p-2 md:hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] text-muted">View</span>
              <div className="flex items-center gap-2">
                <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setStockMobileView('card')}
                    className={`rounded px-3 py-1.5 text-xs font-semibold ${stockMobileView === 'card' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}
                  >
                    Card
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockMobileView('paper')}
                    className={`rounded px-3 py-1.5 text-xs font-semibold ${stockMobileView === 'paper' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}
                  >
                    Paper
                  </button>
                </div>
                <button
                  type="button"
                  onClick={areAllStockCheckSectionsExpanded ? collapseAllStockCheckSections : expandAllStockCheckSections}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  aria-label={areAllStockCheckSectionsExpanded ? 'Collapse all stock check sections' : 'Expand all stock check sections'}
                  title={areAllStockCheckSectionsExpanded ? 'Collapse all stock check sections' : 'Expand all stock check sections'}
                >
                  {areAllStockCheckSectionsExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
            </div>
          </div>
        )}

        {stockEntryMode === 'photo' && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-3">
            <input
              id="stock-check-photo-upload"
              type="file"
              className="hidden"
              accept="image/jpeg,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                setStockPhotoFile(file ?? null)
              }}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Stock closing photo</p>
                <p className="text-xs text-slate-500">
                  {stockPhotoFile ? stockPhotoFile.name : 'Choose a photo to parse closing rows.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <label
                  htmlFor="stock-check-photo-upload"
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Choose Photo
                </label>
                <button
                  type="button"
                  onClick={() => void parsePhoto()}
                  disabled={isParsing || !stockPhotoFile}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-300"
                >
                  {isParsing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isParsing ? 'Parsing...' : 'Parse Photo'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isMobileViewport && stockMobileView === 'paper' && (
          <div className="mt-4 flex justify-end">
            <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2">
              <button
                type="button"
                onClick={zoomOut}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-semibold text-slate-700 hover:bg-slate-50"
                aria-label="Zoom out paper view"
              >
                -
              </button>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-600">
                Zoom {Math.round(paperZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={zoomIn}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-semibold text-slate-700 hover:bg-slate-50"
                aria-label="Zoom in paper view"
              >
                +
              </button>
              <button
                type="button"
                onClick={resetZoom}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                100%
              </button>
            </div>
          </div>
        )}

        <div
          ref={stockPaperAreaRef}
          className="mt-5 stock-paper-wrap overflow-x-auto"
          onTouchStart={handlePaperTouchStart}
          onTouchMove={handlePaperTouchMove}
          onTouchEnd={clearPinchState}
          onTouchCancel={clearPinchState}
        >
          <div className="mobile-sticky-top mb-3 rounded-lg border border-slate-200 bg-white p-3">

            <div ref={stockFindContainerRef} className="relative">
              <Search className="pointer-events-none absolute left-3 top-[22px] h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={findTerm}
                onChange={(event) => setFindTerm(event.target.value)}
                placeholder="Find in this sheet"
                aria-label="Find in this sheet"
                className={`${fieldClass} pl-10 pr-10`}
              />

              {findTerm.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setFindTerm('')}
                  aria-label="Clear stocklist search"
                  className="absolute right-1 top-0.5 inline-flex h-10 w-10 items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {findTerm.trim().length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                  {findSuggestions.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-500">No matching items.</p>
                  ) : (
                    findSuggestions.map(({ row, index }) => (
                      <button
                        key={`find-${row.id}-${index}`}
                        type="button"
                        onClick={() => {
                          focusAndHighlightRow(index)
                          setFindTerm('')
                        }}
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 last:border-b-0"
                      >
                        <p className="truncate font-medium">{row.official_name}</p>
                        <p className="truncate text-xs text-slate-500">{row.stocklist_name}</p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {isMobileViewport && stockMobileView === 'card' ? (
            <div className="space-y-3 md:hidden">
              {stockCardSections.map((section) => (
                <StockPaperCardSection
                  key={`stock-check-card-${section.title}`}
                  title={section.title}
                  items={section.items}
                  keyPrefix="stock-check-mobile"
                  getCardClass={getCardHighlightClass}
                  isCollapsed={isStockCheckSectionCollapsed(section.id)}
                  onToggleCollapse={() => toggleStockCheckSection(section.id)}
                  onPressRow={(item) => focusAndHighlightRow(item.index)}
                  renderLabelCell={renderLabelCell}
                  renderQuantityCell={renderQuantityCell}
                />
              ))}
            </div>
          ) : (
            <div
              ref={stockPaperRef}
              className={`stock-paper min-w-[700px] sm:min-w-[760px] md:min-w-[820px] ${isExportSnapshotMode ? 'stock-paper-export' : ''}`}
              style={isMobileViewport ? { zoom: paperZoom } : undefined}
            >
            <div className="stock-date-row">
              <span>DATE:</span>
              <span className="stock-date-hand">{formatSheetDate(stockDate)}</span>
            </div>

            <div className="stock-sec-hdr">INSIDE COOLROOM</div>
            <div className="stock-inside-grid">
              <div className="stock-col stock-col-left">
                {paperSections.leftColumn.map((section) => (
                  <StockPaperSectionTable
                    key={section.id}
                    section={section}
                    keyPrefix="stock-check-left"
                    isCollapsed={isStockCheckSectionCollapsed(section.id)}
                    onToggleCollapse={() => toggleStockCheckSection(section.id)}
                    getCellClass={getHighlightClass}
                    renderLabelCell={renderLabelCell}
                    renderQuantityCell={renderQuantityCell}
                  />
                ))}
              </div>

              <div className="stock-col">
                {paperSections.rightColumn.map((section) => (
                  <StockPaperSectionTable
                    key={section.id}
                    section={section}
                    keyPrefix="stock-check-right"
                    isCollapsed={isStockCheckSectionCollapsed(section.id)}
                    onToggleCollapse={() => toggleStockCheckSection(section.id)}
                    getCellClass={getHighlightClass}
                    renderLabelCell={renderLabelCell}
                    renderQuantityCell={renderQuantityCell}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              className="stock-sec-hdr stock-sec-hdr-btn"
              onClick={() => toggleStockCheckSection(OUTSIDE_SECTION_ID)}
              aria-expanded={!isStockCheckSectionCollapsed(OUTSIDE_SECTION_ID)}
            >
              <span>OUTSIDE COOLROOM</span>
              <span className="stock-collapse-indicator" aria-hidden="true">{isStockCheckSectionCollapsed(OUTSIDE_SECTION_ID) ? '+' : '-'}</span>
            </button>
            {!isStockCheckSectionCollapsed(OUTSIDE_SECTION_ID) && (
              <StockPaperThreeColumnTable
                columns={outsideDisplayColumns}
                keyPrefix="stock-check-outside"
                getCellClass={getHighlightClass}
                renderLabelCell={renderLabelCell}
                renderQuantityCell={renderQuantityCell}
              />
            )}

            {paperSections.unknownRows.left.length > 0 || paperSections.unknownRows.right.length > 0 || paperSections.unknownRows.single.length > 0 ? (
              <>
                <button
                  type="button"
                  className="stock-sec-hdr stock-sec-hdr-btn !bg-red-900 !text-white"
                  onClick={() => toggleStockCheckSection(UNKNOWN_SECTION_ID)}
                  aria-expanded={!isStockCheckSectionCollapsed(UNKNOWN_SECTION_ID)}
                >
                  <span>UNCLASSIFIED / STAFF INSPECTION</span>
                  <span className="stock-collapse-indicator" aria-hidden="true">{isStockCheckSectionCollapsed(UNKNOWN_SECTION_ID) ? '+' : '-'}</span>
                </button>
                {!isStockCheckSectionCollapsed(UNKNOWN_SECTION_ID) && (
                  <StockPaperThreeColumnTable
                    columns={{
                      left: paperSections.unknownRows.left,
                      middle: paperSections.unknownRows.right,
                      right: paperSections.unknownRows.single,
                    }}
                    keyPrefix="stock-check-unknown"
                    getCellClass={getHighlightClass}
                    renderLabelCell={renderLabelCell}
                    renderQuantityCell={renderQuantityCell}
                  />
                )}
              </>
            ) : null}
            </div>
          )}
        </div>

        <div className="mobile-sticky-actions mt-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void exportPhoto()}
              disabled={isExportActionDisabled}
              aria-label="Export photo"
              title="Export photo"
              className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-control border border-line bg-surface px-3 text-[15px] font-semibold text-ink hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-ink/40"
            >
              {isExporting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <FileImage className="h-5 w-5" aria-hidden="true" />}
              <span className="hidden sm:inline">Photo</span>
            </button>
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={isExportActionDisabled}
              aria-label="Export CSV"
              title="Export CSV"
              className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-control border border-line bg-surface px-3 text-[15px] font-semibold text-ink hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-ink/40"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isExporting || isSaving || isParsing}
              aria-busy={isSaving || undefined}
              className="inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-control bg-forest-900 px-4 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest-900/40"
            >
              {isSaving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : isSyncingWarehouse ? <Loader2 className="h-5 w-5 animate-spin opacity-70" aria-hidden="true" /> : <Save className="h-5 w-5" aria-hidden="true" />}
              <span className="truncate">{isSaving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>
      </section>

      <CreateCatalogItemModal
        isOpen={showCreateCatalogItemModal}
        initialName={createCatalogItemPrefillName}
        categories={availableCategories}
        existingCodes={catalogCodes}
        onClose={() => {
          setShowCreateCatalogItemModal(false)
          setCreateCatalogItemPrefillName('')
        }}
        onCreated={addCreatedStockCheckItem}
      />

      <Sheet
        open={showRecheckWarningModal}
        onClose={() => setShowRecheckWarningModal(false)}
        title={`Check ${recheckWarnings.length} item${recheckWarnings.length === 1 ? '' : 's'} before saving`}
        description="These were in stock last time but are now 0 or blank. Count them again if you can."
        size="md"
        dismissible={!isSaving}
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              className="sm:min-h-11"
              onClick={() => {
                setShowRecheckWarningModal(false)
                setHasPassedRecheck(false)
              }}
            >
              Fix counts
            </Button>
            <Button size="lg" className="sm:min-h-11" loading={isSaving} loadingLabel="Saving…" onClick={() => void saveAndSync()}>
              Save anyway
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-line rounded-control border border-line">
          {recheckWarnings.map((warning) => (
            <li key={warning.key} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-ink">{warning.label}</p>
                <p className="truncate text-[13px] text-muted">{warning.section}</p>
              </div>
              <div className="shrink-0 text-right tabular">
                <p className="text-[15px] text-ink">
                  {warning.previousQuantity} <span className="text-muted">→</span>{' '}
                  <span className="font-semibold text-warning">{warning.currentQuantity === null ? 'blank' : warning.currentQuantity}</span>
                </p>
                <p className="text-[12px] text-muted">last → now</p>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>

      <ConfirmDialog
        isOpen={pendingStartNew}
        title="Start a new sheet?"
        message={`Your draft with ${stockCheckDraftItemCount} counted ${stockCheckDraftItemCount === 1 ? 'item' : 'items'} will be replaced by an empty sheet.`}
        variant="danger"
        confirmLabel="Replace draft"
        cancelLabel="Keep draft"
        onConfirm={() => {
          startManualEntry()
          setPendingStartNew(false)
        }}
        onCancel={() => setPendingStartNew(false)}
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
    </div>
  )
}
