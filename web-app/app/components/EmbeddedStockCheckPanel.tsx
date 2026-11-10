'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Check, ChevronDown, Download, FileImage, Loader2, Plus, Save, Search, Undo2, X } from 'lucide-react'
import { NumberInput, fieldClass } from './ui/Input'
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
import { EditorTopBar } from './EditorTopBar'
import { useChoiceSheet } from './ChoiceSheet'
import { useKeypadEntry } from '../../lib/use-keypad-entry'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './CreateCatalogItemModal'
import { StockLedger, toLedgerAreas } from './StockLedger'
import { LedgerPhotoSheet, type PhotoGroup, type PhotoRow } from './LedgerPhotoSheet'
import {
  OUTSIDE_SECTION_ID,
  UNKNOWN_SECTION_ID,
  buildOutsideDisplayColumns,
  buildPaperSections,
  sortIndexedRowsByName,
} from '../../lib/stock-paper-layout'
import { STATUS } from '../../lib/status-messages'
import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'
import { SectionLandingState } from './SectionLandingState'
import { SectionPicker } from './SectionPicker'
import { useSectionChoice } from '../../lib/section-store'
import { filterBySection, sectionLabel, type Section, type SectionChoice } from '../../lib/sections'
import { getOfflineDraftAge } from '../../lib/offline/queue'
import { formatDayLabel, formatTimeLabel, getLocalTodayDate } from '../../lib/date-utils'
import { WAREHOUSE_SYNC_ENABLED } from '../../lib/warehouse-sync'
import { findUncountedItems } from '../../lib/closing-completeness'
import { mergePhotoRows } from '../../lib/photo-merge'

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
  /** Fruit or Vegies; records saved before sections existed are fruit. */
  section?: Section
  validated: boolean
  record_data?: StockCheckRecordData
}

type StockCheckHistoryRecord = {
  uid_stock_check: string
  timestamp: string
  section?: Section
  stock_date?: string
  validated: boolean
  record_data?: StockCheckRecordData
}

type RecheckWarning = {
  key: string
  label: string
  section: string
  previousQuantity: number
  /** Stock that arrived for this date (0 when none, or not known for unknown items). */
  stockIn: number
  currentQuantity: number | null
  reason: 'now_zero' | 'now_blank'
  /** Index of the sheet row this warning is about, so the count can be typed in place. */
  rowIndex: number | null
}

type SaveCheckData = {
  prevClosingByCode: Record<string, number>
  stockInByCode: Record<string, number>
}

const SAVE_CHECK_TIMEOUT_MS = 6000

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
  /** Items taken off today's list (see listRowKey). Optional: older drafts have none. */
  removedRowKeys?: string[]
}

function normalizeCompareKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseNumericQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  return value
}

/** Identifies a row on today's list across re-parses: the catalog code, or the row id for free-typed items. */
function listRowKey(row: Pick<StockCheckRow, 'code' | 'id'>) {
  return row.code ? `code:${row.code.trim().toUpperCase()}` : `id:${row.id}`
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

/** Ambient messages that do not need a toast. */
const QUIET_STATUSES = new Set<string>([
  STATUS.READY_MANUAL,
  'Saving stock check...',
  'Photo closing entry is ready. Choose a photo to parse.',
])

export function EmbeddedStockCheckPanel({
  catalogItems,
  selectedHistoryRecord,
  onClearHistorySelection,
  historyRecords,
  onToggleCatalogVisibility,
  onOpenHistory,
}: {
  catalogItems: CatalogItem[] | null
  onClearHistorySelection?: () => void
  selectedHistoryRecord?: SelectedStockCheckHistoryRecord | null
  historyRecords?: StockCheckHistoryRecord[]
  onToggleCatalogVisibility?: (code: string, nextVisible: boolean) => Promise<boolean>
  onOpenHistory?: () => void
}) {
  const today = useMemo(() => getLocalTodayDate(), [])
  // Fruit and Vegies are counted separately, by different people: the sheet is for one section,
  // chosen on the start screen. A saved record opened from history brings its own section.
  const [sectionPref, setSectionPref] = useSectionChoice()
  const section: Section = selectedHistoryRecord?.section ?? (sectionPref === 'vegies' ? 'vegies' : 'fruit')
  const draftFeature = section === 'vegies' ? 'stock-check-vegies' as const : 'stock-check' as const
  const scopedCatalog = useMemo(() => filterBySection(catalogItems, section), [catalogItems, section])
  const [rows, setRows] = useState<StockCheckRow[]>([])
  const [stockEntryMode, setStockEntryMode] = useState<'manual' | 'photo'>('manual')
  const [stockPhotoFile, setStockPhotoFile] = useState<File | null>(null)
  const [stockDate, setStockDate] = useState(today)
  const [isValidated, setIsValidated] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCheckingCounts, setIsCheckingCounts] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [phase, setPhase] = useState<'landing' | 'editing'>('landing')
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
  const [isRenderingPhoto, setIsRenderingPhoto] = useState(false)
  const closingPhotoRef = useRef<HTMLDivElement | null>(null)
  const [manualCheckQuantity, setManualCheckQuantity] = useState('')
  const [touchedRowIndexes, setTouchedRowIndexes] = useState<Set<number>>(() => new Set())
  /** Rows taken off today's list (by code, or row id for free-typed items). Adding the item again brings it back. */
  const [removedRowKeys, setRemovedRowKeys] = useState<Set<string>>(() => new Set())
  const [lastAddedCheck, setLastAddedCheck] = useState<{ id: number; name: string; quantity: number; note?: string; snapshot: StockCheckRow[] } | null>(null)
  const checkItemInputRef = useRef<HTMLInputElement | null>(null)
  const checkQtyInputRef = useRef<HTMLInputElement | null>(null)
  const checkEntryRef = useRef<HTMLDivElement>(null)
  // Save reads the date through a ref, so a date changed during Save (flushSync) is used at once.
  const stockDateRef = useRef(stockDate)
  stockDateRef.current = stockDate
  const { ask, choiceSheet } = useChoiceSheet()
  useKeypadEntry(checkEntryRef, phase === 'editing' && stockEntryMode === 'manual')
  const [manualCheckRedMarked, setManualCheckRedMarked] = useState(false)
  const [manualCheckHighlightIndex, setManualCheckHighlightIndex] = useState(0)
  const [isItemProfilesExpanded, setIsItemProfilesExpanded] = useState(false)
  const [showItemSuggestions, setShowItemSuggestions] = useState(false)
  const [selectedProfileItem, setSelectedProfileItem] = useState<CatalogItem | null>(null)
  const skipNextRecheckResetRef = useRef(false)
  const loadedHistoryUid = selectedHistoryRecord?.uid_stock_check ?? null
  const visibleCatalogItems = useMemo(() => filterVisibleCatalogItems(scopedCatalog), [scopedCatalog])
  const availableCategories = useMemo(() => {
    if (!scopedCatalog || scopedCatalog.length === 0) return []
    const uniqueCategories = new Set(scopedCatalog.map((item) => item.category).filter((cat) => cat && cat.trim().length > 0))
    return Array.from(uniqueCategories).sort()
  }, [scopedCatalog])
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
    if (visibleCatalogItems.length === 0) return

    setRows((prev) => {
      if (prev.length > 0) return prev
      return visibleCatalogItems.map(makeCatalogRow)
    })
  }, [visibleCatalogItems])

  const refreshOfflineState = useCallback(() => {
    if (typeof window === 'undefined') return

    setIsOnline(window.navigator.onLine)
    setStockCheckQueueCount(getPendingOfflineCountByFeature(draftFeature))
    setHasStockCheckLocalDraft(hasOfflineDraft(draftFeature))
  }, [draftFeature])

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

    const draft = loadOfflineDraft<StockCheckOfflineDraft>(draftFeature)
    if (!draft || !Array.isArray(draft.rows)) {
      setHasRestoredOfflineDraft(true)
      return
    }

    setStockEntryMode(draft.stockEntryMode ?? 'manual')
    setStockDate(typeof draft.stockDate === 'string' && draft.stockDate.length > 0 ? draft.stockDate : today)
    setRows(draft.rows)
    setRemovedRowKeys(new Set(Array.isArray(draft.removedRowKeys) ? draft.removedRowKeys : []))
    setIsValidated(Boolean(draft.isValidated))
    setHasPassedRecheck(Boolean(draft.hasPassedRecheck))
    setStatus(STATUS.DRAFT_RECOVERED)
    setError(null)
    setHasRestoredOfflineDraft(true)
  }, [hasRestoredOfflineDraft, loadedHistoryUid, today, phase, draftFeature])

  useEffect(() => {
    if (!hasRestoredOfflineDraft) return

    // A sheet with nothing counted yet (the catalog pre-fill) is not a draft worth resuming.
    if (rows.length === 0 || !rows.some((row) => row.quantity !== null)) {
      clearOfflineDraft(draftFeature)
      setHasStockCheckLocalDraft(false)
      return
    }

    // Debounced so typing stays smooth on slow phones; flushed when the app is hidden or closed.
    return scheduleDraftSave(() => {
      saveOfflineDraft(draftFeature, {
        stockEntryMode,
        stockDate,
        rows,
        isValidated,
        hasPassedRecheck,
        removedRowKeys: Array.from(removedRowKeys),
      })
      setHasStockCheckLocalDraft(true)
    })
  }, [draftFeature, hasPassedRecheck, hasRestoredOfflineDraft, isValidated, removedRowKeys, rows, stockDate, stockEntryMode])

  const startManualEntry = useCallback(() => {
    const freshToday = getLocalTodayDate()
    setStockEntryMode('manual')
    setStockPhotoFile(null)
    setRows([])
    setRemovedRowKeys(new Set())
    setStockDate(freshToday)
    clearOfflineDraft(draftFeature)
    setHasStockCheckLocalDraft(false)
    setManualCheckRedMarked(false)
    setStatus(STATUS.READY_MANUAL)
    setError(null)
    setIsValidated(false)
    setHasPassedRecheck(false)
    setShowRecheckWarningModal(false)
    setRecheckWarnings([])
  }, [draftFeature])

  /** Puts a cleared draft back (the Undo after Start new). */
  function restoreStockCheckDraft(draft: StockCheckOfflineDraft) {
    setStockEntryMode(draft.stockEntryMode ?? 'manual')
    setStockDate(typeof draft.stockDate === 'string' && draft.stockDate.length > 0 ? draft.stockDate : today)
    setRows(draft.rows)
    setRemovedRowKeys(new Set(Array.isArray(draft.removedRowKeys) ? draft.removedRowKeys : []))
    setIsValidated(Boolean(draft.isValidated))
    setHasPassedRecheck(Boolean(draft.hasPassedRecheck))
    saveOfflineDraft(draftFeature, draft)
    setHasStockCheckLocalDraft(true)
    setPhase('editing')
    setStatus(STATUS.DRAFT_RECOVERED)
    setError(null)
  }

  // Switching between Type and Photo keeps every count on the sheet.
  const confirmStartManualEntry = useCallback(() => {
    setStockEntryMode('manual')
    setError(null)
  }, [])

  const confirmStartPhotoEntry = useCallback(() => {
    setStockEntryMode('photo')
    setStockPhotoFile(null)
    setError(null)
  }, [])

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
        const headline = String(payload?.error ?? 'Parse request failed.').replace(/[.:]\s*$/, '')
        // "Headline: details" shows the headline in the toast and the rest under Details.
        throw new Error(detailsText ? `${headline}: ${detailsText}` : `${headline}.`)
      }

      const parsedRows = buildRowsFromParsedPhoto(visibleCatalogItems, payload as ParsedPhotoResponse)
      const merge = mergePhotoRows(rowsRef.current, parsedRows)
      setRows(merge.rows)
      setStockDate(typeof payload?.data?.stock_date === 'string' && payload.data.stock_date.length > 0 ? payload.data.stock_date : today)
      setIsValidated(false)
      setHasPassedRecheck(false)
      setShowRecheckWarningModal(false)
      setRecheckWarnings([])
      setStatus(merge.kept > 0
        ? `Photo filled ${merge.filled} ${merge.filled === 1 ? 'count' : 'counts'}. ${merge.kept} typed ${merge.kept === 1 ? 'count was' : 'counts were'} kept where the photo read differently.`
        : `Photo filled ${merge.filled} ${merge.filled === 1 ? 'count' : 'counts'}. Check them before saving.`)
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

  // parsePhoto reads the newest rows when the response arrives, not the rows from when it started.
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

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
    setRemovedRowKeys(new Set())
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
    const kept = removedRowKeys.size > 0
      ? indexedRows.filter((entry) => !removedRowKeys.has(listRowKey(entry.row)))
      : indexedRows
    if (stockEntryMode !== 'manual') {
      return kept
    }

    return kept.filter((entry) => entry.row.quantity !== null || touchedRowIndexes.has(entry.index))
  }, [indexedRows, removedRowKeys, stockEntryMode, touchedRowIndexes])

  const quantityByCode = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((row) => {
      if (row.code && row.quantity !== null) map.set(row.code.trim().toUpperCase(), row.quantity)
    })
    return map
  }, [rows])

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

  /** The export photo lists counted items only; red-marked items stay red. */
  const closingPhoto = useMemo(() => {
    const toRow = (entry: IndexedRow): PhotoRow => {
      const code = entry.row.code?.trim().toUpperCase() ?? ''
      const catalogItem = code ? scopedCatalog?.find((c) => c.code.trim().toUpperCase() === code) : null
      return {
        key: `${entry.row.id}-${entry.index}`,
        name: catalogItem?.official_name ?? entry.row.official_name ?? '',
        quantity: String(entry.row.quantity ?? ''),
        marked: entry.row.red_marked,
        tone: entry.row.source === 'unknown' ? 'alert' : undefined,
      }
    }
    const counted = (entries: IndexedRow[]) => sortIndexedRowsByName(entries.filter((entry) => entry.row.quantity !== null)).map(toRow)
    const all = (split: typeof paperSections.outsideRows) => [...split.left, ...split.right, ...split.single]
    const toGroups = (sections: typeof paperSections.leftColumn): PhotoGroup[] => sections.map((section) => ({
      title: section.title,
      rows: counted(all(section.rows)),
    }))
    return {
      insideLeft: toGroups(paperSections.leftColumn),
      insideRight: toGroups(paperSections.rightColumn),
      outside: counted(all(paperSections.outsideRows)),
      unknown: counted(all(paperSections.unknownRows)),
    }
  }, [scopedCatalog, paperSections])

  const stockLedgerAreas = useMemo(
    () => toLedgerAreas(stockCardSections, { outside: OUTSIDE_SECTION_ID, unknown: UNKNOWN_SECTION_ID }),
    [stockCardSections],
  )

  const isExportActionDisabled = isExporting || isSaving || isParsing

  const getCardHighlightClass = useCallback((index: number | undefined) => {
    if (index === undefined) return ''
    const target = indexedRows[index]
    if (!target) return ''
    if (target.row.source === 'unknown') return 'border-warning/30 bg-warning-soft'
    if (target.row.red_marked) return 'border-red-300 bg-red-50'
    return ''
  }, [indexedRows])

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
    // An item taken off today's list comes back when it is added again.
    const key = `code:${item.code.trim().toUpperCase()}`
    setRemovedRowKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
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

  /**
   * Items that should be on this closing but are blank or 0 (BUSINESS_RULES.md §8).
   * Catalog items are checked against the server's previous closing and today's stock-in.
   * Without that data (offline), they fall back to the last validated sheet in history.
   * Unknown (free-typed) items are always compared with the last validated sheet.
   */
  function buildSaveWarnings(serverData: SaveCheckData | null): RecheckWarning[] {
    const previousRecord = latestPreviousValidatedRecord?.record_data ?? null
    const sectionOf = (row: { location: string; sub_location: string }) => `${row.location} / ${row.sub_location}`
    const labelOf = (row: { official_name: string; stocklist_name: string; product: string; code: string | null }) =>
      row.official_name || row.stocklist_name || row.product || row.code || ''

    const knownRowIndex = (code: string) => {
      const index = rows.findIndex((row) => isKnownRow(row) && row.code === code)
      return index >= 0 ? index : null
    }
    const unknownRowIndex = (compareKey: string) => {
      const index = rows.findIndex((row) => !row.code && normalizeCompareKey(row.official_name || row.stocklist_name || row.product) === compareKey)
      return index >= 0 ? index : null
    }
    const known = rows.filter((row) => isKnownRow(row))
    const sheet = known.map((row) => ({ code: row.code as string, label: labelOf(row), section: sectionOf(row), quantity: parseNumericQuantity(row.quantity) }))
    // Hidden catalog items are left off the sheet on purpose, so they are not asked about.
    const catalog: Array<{ code: string; label: string; section: string }> = visibleCatalogItems.map((item) => ({ code: item.code, label: labelOf(item), section: sectionOf(item) }))

    const fallbackPrevious: Record<string, number> = {}
    if (!serverData && previousRecord) {
      for (const item of previousRecord.items) {
        const quantity = parseNumericQuantity(item.quantity)
        if (item.code && quantity !== null) fallbackPrevious[item.code] = (fallbackPrevious[item.code] ?? 0) + quantity
      }
    }

    const warnings: RecheckWarning[] = findUncountedItems({
      sheet,
      catalog,
      prevClosingByCode: serverData?.prevClosingByCode ?? fallbackPrevious,
      stockInByCode: serverData?.stockInByCode ?? {},
    }).map((item) => ({
      key: `known-${item.code}`,
      label: item.label,
      section: item.section,
      previousQuantity: item.previousClosing,
      stockIn: item.stockIn,
      currentQuantity: item.current,
      reason: item.reason === 'blank' ? 'now_blank' : 'now_zero',
      rowIndex: knownRowIndex(item.code),
    }))

    if (previousRecord) {
      const currentUnknownByName = new Map<string, StockCheckRow>()
      for (const row of rows) {
        if (row.code) continue
        currentUnknownByName.set(normalizeCompareKey(row.official_name || row.stocklist_name || row.product), row)
      }
      for (const previousRow of previousRecord.unknown_items) {
        const previousQuantity = parseNumericQuantity(previousRow.quantity)
        if (previousQuantity === null || previousQuantity <= 0) continue
        const compareKey = normalizeCompareKey(previousRow.user_input)
        const currentQuantity = parseNumericQuantity(currentUnknownByName.get(compareKey)?.quantity)
        if (currentQuantity === null || currentQuantity <= 0) {
          warnings.push({
            key: `unknown-${compareKey}`,
            label: previousRow.user_input,
            section: 'Unknown Items',
            previousQuantity,
            stockIn: 0,
            currentQuantity,
            reason: currentQuantity === null ? 'now_blank' : 'now_zero',
            rowIndex: unknownRowIndex(compareKey),
          })
        }
      }
    }

    return warnings
  }

  async function loadSaveCheckData(): Promise<SaveCheckData | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SAVE_CHECK_TIMEOUT_MS)
    try {
      const response = await fetch(`/api/daily-report?date=${encodeURIComponent(stockDateRef.current)}&section=${section}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) return null
      const payload = await response.json()
      return {
        prevClosingByCode: payload?.prevClosingByCode ?? {},
        stockInByCode: payload?.stockInByCode ?? {},
      }
    } catch {
      return null
    } finally {
      window.clearTimeout(timer)
    }
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
      date: stockDateRef.current,
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
        stock_date: stockDateRef.current,
        photo_url: null,
        total_items: knownItems.length,
        confidence_overall: 'high' as const,
        items: knownItems,
      },
      validated: validated ? 'yes' as const : 'no' as const,
      unknown_items: unknownItems,
      missing_catalog_items: [],
      section,
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
        feature: draftFeature,
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
      clearOfflineDraft(draftFeature)
      setHasStockCheckLocalDraft(false)
      return 'saved'
    } catch (e) {
      if (isNetworkRequestError(e)) {
        enqueueOfflineRequest({
          feature: draftFeature,
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

  /**
   * Before Save: a new sheet not dated today asks which day it is for (a continued draft keeps
   * the day it was started), and a date that already has a saved close asks before replacing it.
   */
  async function confirmSaveDate() {
    const today = getLocalTodayDate()
    let date = stockDateRef.current
    if (!loadedHistoryUid && date !== today) {
      const answer = await ask({
        title: `This sheet is dated ${formatDayLabel(date)}`,
        message: `Today is ${formatDayLabel(today)}. Which day is this count for?`,
        choices: [
          { value: 'today', label: `Today, ${formatDayLabel(today)}`, primary: true },
          { value: 'keep', label: formatDayLabel(date), description: 'Keep the date on the sheet' },
        ],
      })
      if (!answer) return false
      if (answer === 'today') {
        flushSync(() => setStockDate(today))
        date = today
      }
    }

    const existing = (historyRecords ?? []).find((record) => record.stock_date === date && record.uid_stock_check !== loadedHistoryUid)
    if (existing) {
      const answer = await ask({
        title: `Replace the stock close for ${formatDayLabel(date)}?`,
        message: `One was already saved at ${formatTimeLabel(existing.timestamp)}. Saving this sheet replaces it.`,
        choices: [{ value: 'replace', label: 'Replace it', description: 'The earlier count for that day is overwritten' }],
      })
      if (!answer) return false
    }
    return true
  }

  /** One Save: check for uncounted items -> (warnings sheet if needed) -> save -> background warehouse sync (when on). */
  async function handleSave() {
    if (isSaving || isCheckingCounts) return
    if (!(await confirmSaveDate())) return
    setIsCheckingCounts(true)
    let warnings: RecheckWarning[]
    try {
      warnings = buildSaveWarnings(await loadSaveCheckData())
    } finally {
      setIsCheckingCounts(false)
    }

    setRecheckWarnings(warnings)
    if (warnings.length > 0) {
      setHasPassedRecheck(false)
      setShowRecheckWarningModal(true)
      return
    }
    setHasPassedRecheck(true)
    void saveAndSync()
  }

  async function saveAndSync() {
    setShowRecheckWarningModal(false)
    const envelope = buildWarehouseEnvelopePayload(rows, true)
    const outcome = await saveStockCheck()
    if (outcome !== 'saved') return
    // The warehouse copy is paused for now (lib/warehouse-sync): Supabase is the only store.
    if (WAREHOUSE_SYNC_ENABLED && section === 'fruit') syncToWarehouse(envelope)
    else toast.success('Closing saved')
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

  /** Same as the Daily Report export: render the photo sheet off screen, then download it as PNG. */
  async function exportPhoto() {
    setIsExporting(true)
    setStatus(null)
    setError(null)

    try {
      flushSync(() => setIsRenderingPhoto(true))
      if (!closingPhotoRef.current) {
        throw new Error('Stocklist area is not ready for photo export.')
      }

      const dataUrl = await toPng(closingPhotoRef.current, {
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
      setIsRenderingPhoto(false)
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

  /**
   * Takes an item off today's list: its count and reorder mark are cleared and the row is hidden.
   * The catalog is unchanged, and a toast offers Undo.
   */
  function removeFromTodaysList(item: IndexedRow) {
    const before = rows[item.index]
    if (!before) return
    const key = listRowKey(before)
    const wasTouched = touchedRowIndexes.has(item.index)
    const name = before.official_name || before.stocklist_name || before.product || 'Item'

    updateRow(item.index, { quantity: null, red_marked: false })
    setTouchedRowIndexes((current) => {
      if (!current.has(item.index)) return current
      const next = new Set(current)
      next.delete(item.index)
      return next
    })
    setRemovedRowKeys((current) => new Set(current).add(key))
    setLastAddedCheck(null)

    toast.info(`${name} removed from today's list`, {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          updateRow(item.index, { quantity: before.quantity, red_marked: before.red_marked })
          if (wasTouched) setTouchedRowIndexes((current) => new Set(current).add(item.index))
          setRemovedRowKeys((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        },
      },
    })
  }

  /** Name cell of the list: the reorder mark, then the name, which wraps. */
  function renderLedgerName(item: IndexedRow) {
    const code = item.row.code?.trim().toUpperCase() ?? ''
    const latestCatalogItem = code ? scopedCatalog?.find((c) => c.code.trim().toUpperCase() === code) : null
    const displayName = latestCatalogItem?.official_name ?? item.row.official_name ?? ''
    return (
      <div className="report-name">
        <button
          type="button"
          aria-label={`Mark ${displayName} as selling fast`}
          aria-pressed={item.row.red_marked}
          onClick={() => toggleRed(item.index)}
          className={`relative mt-[5px] h-3.5 w-3.5 shrink-0 rounded-full border before:absolute before:-inset-3 before:content-[''] ${item.row.red_marked ? 'border-red-600 bg-red-600' : 'border-slate-400 bg-transparent'}`}
          title="Mark as selling fast"
        />
        <span className={item.row.red_marked ? 'font-semibold text-red-600' : undefined}>{displayName}</span>
      </div>
    )
  }

  function renderQuantityCell(item: IndexedRow) {
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
    const draft = loadOfflineDraft<{ rows?: Array<{ quantity: number | null }> }>(draftFeature)
    return (draft?.rows ?? []).filter((row) => row.quantity !== null).length
  })()

  // Changing section on the start screen swaps in that section's items and its own draft.
  function chooseSection(choice: SectionChoice) {
    if (choice === 'both' || choice === section) return
    setSectionPref(choice)
    setRows([])
    setRemovedRowKeys(new Set())
    setHasRestoredOfflineDraft(false)
    setTouchedRowIndexes(new Set())
    setLastAddedCheck(null)
  }

  if (phase === 'landing') {
    return (
      <>
      <div className="mx-auto w-full max-w-xl pt-2 sm:pt-6">
        <p className="mb-2 text-[14px] font-medium text-ink">What are you counting?</p>
        <SectionPicker value={section} onChange={chooseSection} choices={['fruit', 'vegies']} label="Section to count" />
      </div>
      <SectionLandingState
        sectionLabel={`Stock close · ${sectionLabel[section]}`}
        subtitle="Count what is left at 4 PM, then save and export."
        hasDraft={hasStockCheckLocalDraft}
        draftAge={getOfflineDraftAge(draftFeature)}
        draftItemCount={stockCheckDraftItemCount}
        historyCount={historyRecords?.length || 0}
        onAction={(action) => {
          if (action === 'new') {
            // Start straight away. A draft that existed is kept in memory for one Undo.
            const previousDraft = hasStockCheckLocalDraft ? loadOfflineDraft<StockCheckOfflineDraft>(draftFeature) : null
            const previousCount = stockCheckDraftItemCount
            startManualEntry()
            setPhase('editing')
            if (previousDraft && Array.isArray(previousDraft.rows) && previousCount > 0) {
              toast.info(`New sheet started. Draft with ${previousCount} ${previousCount === 1 ? 'item' : 'items'} cleared.`, {
                duration: 8000,
                action: { label: 'Undo', onClick: () => restoreStockCheckDraft(previousDraft) },
              })
            }
          } else if (action === 'discard') {
            onClearHistorySelection?.()
            startManualEntry()
            setLastAddedCheck(null)
            setTouchedRowIndexes(new Set())
            toast.success('Stock close draft removed')
          } else if (action === 'continue') {
            setPhase('editing')
            // draft restore effect will handle it
          } else if (action === 'history') {
            if (onOpenHistory) onOpenHistory()
            else setPhase('editing')
          }
        }}
      />
      </>
    )
  }

  return (
    <div className="space-y-4">
      {choiceSheet}
      <section className="keypad-editor rounded-card border border-line bg-surface p-3 sm:p-6">
        <EditorTopBar
          title={`${loadedHistoryUid ? 'Edit stock close' : 'Stock close'} · ${sectionLabel[section]}`}
          showTitleOnPhone
          onBack={() => setPhase('landing')}
          dateId="check-stock-date"
          dateValue={stockDate}
          onDateChange={(value) => setStockDate(value || today)}
        />
        <div className="mb-3 empty:hidden">
          {stockCheckQueueCount > 0 || !isOnline ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[13px] font-medium text-warning">
              {!isOnline ? 'Offline · saves stay on this phone' : `${stockCheckQueueCount} save${stockCheckQueueCount > 1 ? 's' : ''} waiting to upload`}
            </p>
          ) : null}
          {visibleCatalogItems.length === 0 && (
            <p className="mt-2 rounded-control bg-warning-soft px-3 py-2 text-[14px] text-warning">
              {(catalogItems?.length ?? 0) > 0
                ? `There are no ${sectionLabel[section].toLowerCase()} items in the catalog yet. Add them in Catalog (location ${section === 'vegies' ? 'Vegies' : 'Inside or Outside Coolroom'}), or type item names and counts; they are kept for review.`
                : 'The catalog did not load. You can still type item names and counts; they are kept for review.'}
            </p>
          )}
        </div>

        <div className="mb-3">
          <EntryMethodToggle
            value={stockEntryMode}
            onManual={confirmStartManualEntry}
            onPhoto={confirmStartPhotoEntry}
          />
        </div>

        {stockEntryMode === 'manual' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="relative md:rounded-card md:border md:border-line md:p-4">
              <div ref={checkEntryRef} className="keypad-entry space-y-2">
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
                      placeholder="Search by name or code"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      className={`${fieldClass} min-h-12 pl-10`}
                    />
                  </div>

                  {showItemSuggestions && newItemName.trim().length > 0 && suggestions.length > 0 && (
                    <div role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[min(15rem,var(--stock-results-height,15rem))] overflow-y-auto overscroll-contain rounded-control border border-line bg-surface shadow-raised">
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
                  <div className="w-1/2 min-w-0">
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
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-control bg-forest px-3 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest/30"
                  >
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    Add item
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
                aria-expanded={isItemProfilesExpanded}
                className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-muted hover:text-ink"
              >
                <span>Item profile</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${isItemProfilesExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
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

        {/* One list at every width; the photo sheet is mounted only while exporting. */}
        <div className="mt-5 stock-paper-wrap is-ledger">
          <StockLedger
            areas={stockLedgerAreas}
            keyPrefix="stock-check-ledger"
            quantityLabel="Closing"
            getRowClass={getCardHighlightClass}
            renderName={renderLedgerName}
            onRemove={removeFromTodaysList}
            getItemLabel={(item) => item.row.official_name || item.row.stocklist_name || item.row.product}
            renderQuantityCell={renderQuantityCell}
          />
        </div>

        {isRenderingPhoto ? (
          <div aria-hidden="true" className="pointer-events-none fixed right-full top-0">
            <LedgerPhotoSheet
              ref={closingPhotoRef}
              title="Closing stock"
              date={stockDate}
              quantityLabel="Closing"
              insideLeft={closingPhoto.insideLeft}
              insideRight={closingPhoto.insideRight}
              outside={closingPhoto.outside}
              unknown={closingPhoto.unknown}
            />
          </div>
        ) : null}

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
              onClick={() => void handleSave()}
              disabled={isExporting || isSaving || isParsing || isCheckingCounts}
              aria-busy={isSaving || isCheckingCounts || undefined}
              className="inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-control bg-forest px-4 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-forest-700 disabled:cursor-not-allowed disabled:bg-forest/40"
            >
              {isSaving || isCheckingCounts ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : isSyncingWarehouse ? <Loader2 className="h-5 w-5 animate-spin opacity-70" aria-hidden="true" /> : <Save className="h-5 w-5" aria-hidden="true" />}
              <span className="truncate">{isSaving ? 'Saving…' : isCheckingCounts ? 'Checking…' : 'Save'}</span>
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
        title={`Count ${recheckWarnings.length} item${recheckWarnings.length === 1 ? '' : 's'} before saving`}
        description="These had stock at the last closing or arrived today, but are blank or 0. Count them, or save anyway if 0 is right."
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
                <p className="text-[12px] text-muted">
                  {warning.previousQuantity}
                  {warning.stockIn > 0 ? <span> + {warning.stockIn} in</span> : null}
                  <span> → now</span>
                </p>
                {warning.rowIndex !== null && rows[warning.rowIndex] ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    autoComplete="off"
                    placeholder="0"
                    aria-label={`Count for ${warning.label}`}
                    className="stock-qty-input mt-1 w-20"
                    value={rows[warning.rowIndex].quantity ?? ''}
                    onChange={(event) => setQuantity(warning.rowIndex as number, event.target.value)}
                  />
                ) : (
                  <p className="text-[15px] font-semibold text-warning">{warning.currentQuantity === null ? 'blank' : warning.currentQuantity}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Sheet>


    </div>
  )
}
