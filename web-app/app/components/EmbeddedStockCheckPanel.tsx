'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, EyeOff, FileImage, Loader2, Plus, Search, X } from 'lucide-react'
import { toPng } from 'html-to-image'
import { normalizeBlankStockCheckQuantities } from '../../lib/stock-check-utils'
import { filterVisibleCatalogItems } from '../../lib/catalog-visibility'
import { EntryMethodToggle } from './EntryMethodToggle'
import { CreateCatalogItemModal, type CreateCatalogItemPayload } from './CreateCatalogItemModal'
import { StockPaperCardSection, StockPaperSectionTable, StockPaperThreeColumnTable } from './StockPaperTables'
import { formatSheetDate, normalizeInsideSectionLabel } from '../../lib/stock-paper-utils'

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

function splitRows(items: IndexedRow[]): RowColumns {
  const singles = items.filter((x) => x.row.row_position === 'single')
  const paired = items.filter((x) => x.row.row_position !== 'single')
  const left: IndexedRow[] = []
  const right: IndexedRow[] = []

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

function getRowDisplayNameForSort(row: StockCheckRow) {
  return (row.official_name || row.stocklist_name || row.product || '').trim()
}

function sortIndexedRowsByName(rows: IndexedRow[]) {
  return [...rows].sort((a, b) => {
    const nameCompare = getRowDisplayNameForSort(a.row).localeCompare(getRowDisplayNameForSort(b.row), undefined, {
      sensitivity: 'base',
      numeric: true,
    })

    if (nameCompare !== 0) return nameCompare

    const codeCompare = (a.row.code || '').localeCompare(b.row.code || '', undefined, {
      sensitivity: 'base',
      numeric: true,
    })

    if (codeCompare !== 0) return codeCompare

    return a.index - b.index
  })
}

function normalizeCompareKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseNumericQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  return value
}

export { normalizeBlankStockCheckQuantities }
const STOCK_CHECK_MOBILE_VIEW_KEY = 'smartstock:stock-check-mobile-view'
const STOCK_CHECK_EXPANDED_SECTIONS_KEY = 'smartstock:stock-check-expanded-sections'
const OUTSIDE_SECTION_ID = 'outside-coolroom'
const UNKNOWN_SECTION_ID = 'unclassified-staff-inspection'

function toSectionId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function buildInsideSectionId(title: string) {
  return `inside-${toSectionId(title)}`
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

export function EmbeddedStockCheckPanel({
  catalogItems,
  selectedHistoryRecord,
  historyRecords,
  onToggleCatalogVisibility,
}: {
  catalogItems: CatalogItem[] | null
  selectedHistoryRecord?: SelectedStockCheckHistoryRecord | null
  historyRecords?: StockCheckHistoryRecord[]
  onToggleCatalogVisibility?: (code: string, nextVisible: boolean) => Promise<boolean>
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
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
  const [newItemName, setNewItemName] = useState('')
  const [createCatalogItemPrefillName, setCreateCatalogItemPrefillName] = useState('')
  const [showCreateCatalogItemModal, setShowCreateCatalogItemModal] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recheckWarnings, setRecheckWarnings] = useState<RecheckWarning[]>([])
  const [showRecheckWarningModal, setShowRecheckWarningModal] = useState(false)
  const [hasPassedRecheck, setHasPassedRecheck] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [highlightedRowIndex, setHighlightedRowIndex] = useState<number | null>(null)
  const [paperZoom, setPaperZoom] = useState(1)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [stockMobileView, setStockMobileView] = useState<'card' | 'paper'>('card')
  const [stockExportType, setStockExportType] = useState<'csv' | 'photo'>('csv')
  const [stockCheckExpandedSections, setStockCheckExpandedSections] = useState<Set<string>>(new Set())
  const [storedExpandedSectionKeys, setStoredExpandedSectionKeys] = useState<string[] | null>(null)
  const [hasLoadedExpandedSectionPrefs, setHasLoadedExpandedSectionPrefs] = useState(false)
  const [hasInitializedExpandedSections, setHasInitializedExpandedSections] = useState(false)
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

  const startManualEntry = useCallback(() => {
    setStockEntryMode('manual')
    setStockPhotoFile(null)
    setRows(visibleCatalogItems.map(makeCatalogRow))
    setStatus('Manual closing entry is ready.')
    setError(null)
    setIsValidated(false)
    setHasPassedRecheck(false)
    setShowRecheckWarningModal(false)
    setRecheckWarnings([])
  }, [visibleCatalogItems])

  const startPhotoEntry = useCallback(() => {
    setStockEntryMode('photo')
    setStockPhotoFile(null)
    setStatus('Photo closing entry is ready. Choose a photo to parse.')
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

    const nextRows = visibleCatalogItems.map(makeCatalogRow)
    const codeToIndex = new Map(nextRows.map((row, index) => [row.code.trim().toUpperCase(), index]))

    for (const item of recordData.items) {
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
          official_name: item.official_name || current.official_name,
          stocklist_name: item.stocklist_name || current.stocklist_name,
          quantity: item.quantity,
          red_marked: item.red_marked,
          notes: item.notes || '',
        }
        continue
      }

      nextRows.push({
        id: `history-known-${selectedHistoryRecord.uid_stock_check}-${item.code}`,
        code: item.code,
        location: item.location || 'Unknown',
        sub_location: item.sub_location || 'Unknown',
        category: item.category || 'Unknown',
        product: item.product || item.official_name,
        attribute: '',
        official_name: item.official_name || item.product,
        stocklist_name: item.stocklist_name || item.official_name || item.product,
        navigation_guide: '',
        row_position: 'single',
        quantity: item.quantity,
        red_marked: item.red_marked,
        notes: item.notes || '',
        source: 'unknown',
      })
    }

    for (const item of recordData.unknown_items) {
      nextRows.push({
        id: `history-unknown-${selectedHistoryRecord.uid_stock_check}-${item.user_input}`,
        code: null,
        location: 'Unknown',
        sub_location: 'Unknown',
        category: 'Unknown',
        product: item.user_input,
        attribute: '',
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
  }, [selectedHistoryRecord, today, visibleCatalogItems])

  useEffect(() => {
    if (skipNextRecheckResetRef.current) {
      skipNextRecheckResetRef.current = false
      return
    }

    setHasPassedRecheck(false)
  }, [rows, stockDate])

  const suggestions = useMemo(() => {
    if (!newItemName.trim() || visibleCatalogItems.length === 0) return []
    const q = newItemName.toLowerCase()
    return visibleCatalogItems
      .filter((item) => {
        return (
          item.official_name.toLowerCase().includes(q)
          || item.stocklist_name.toLowerCase().includes(q)
          || item.product.toLowerCase().includes(q)
        )
      })
      .slice(0, 6)
  }, [newItemName, visibleCatalogItems])

  const indexedRows = useMemo(() => rows.map((row, index) => ({ row, index })), [rows])

  const findSuggestions = useMemo(() => {
    const term = findTerm.trim().toLowerCase()
    if (!term) return []

    return indexedRows
      .filter(({ row }) => {
        const official = row.official_name.toLowerCase()
        const stocklist = row.stocklist_name.toLowerCase()
        return official.includes(term) || stocklist.includes(term)
      })
      .slice(0, 8)
  }, [findTerm, indexedRows])

  const getHighlightClass = useCallback((index: number | undefined) => {
    if (index === undefined || index !== highlightedRowIndex) {
      return ''
    }
    return 'bg-emerald-100 transition-colors duration-700'
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

  const paperSections = useMemo(() => {
    const insideRows = indexedRows.filter(
      (x) => x.row.location === 'Inside Coolroom' && x.row.source !== 'unknown'
    )

    const insideRowsByCategory = new Map<string, IndexedRow[]>()

    insideRows.forEach((entry) => {
      const sectionLabel = normalizeInsideSectionLabel(entry.row.category, entry.row.sub_location)
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
        rows: splitRows(sortIndexedRowsByName(sectionRows)),
      }))

    const midpoint = Math.ceil(insideSections.length / 2)

    const outsideRows = sortIndexedRowsByName(indexedRows.filter((x) => x.row.location === 'Outside Coolroom'))
    const unknownRows = sortIndexedRowsByName(indexedRows.filter((x) => x.row.source === 'unknown'))

    return {
      leftColumn: insideSections.slice(0, midpoint),
      rightColumn: insideSections.slice(midpoint),
      outsideRows: splitRows(outsideRows),
      unknownRows: splitRows(unknownRows),
    }
  }, [indexedRows])

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

  const isExportActionDisabled = stockExportType === 'csv'
    ? !isValidated || isExporting || isSaving || isParsing
    : isExporting || isSaving || isParsing

  const getCardHighlightClass = useCallback((index: number | undefined) => {
    if (index === undefined) return ''
    const target = indexedRows[index]
    if (!target) return ''
    if (index === highlightedRowIndex) return 'ring-2 ring-emerald-400 bg-emerald-50'
    if (target.row.source === 'unknown') return 'border-amber-300 bg-amber-50'
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
    setStatus(`Created and added ${created.official_name} immediately.`)
    setError(null)
  }

  function compareWithPreviousValidatedStockCheck() {
    if (!latestPreviousValidatedRecord?.record_data) {
      setRecheckWarnings([])
      setHasPassedRecheck(true)
      setShowRecheckWarningModal(false)
      setStatus('No previous validated stock-check found. Recheck passed. You can save now.')
      setError(null)
      return
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
      setStatus('Recheck complete. No potential missed items found. You can save now.')
      setError(null)
      return
    }

    setRecheckWarnings(warnings)
    setHasPassedRecheck(false)
    setShowRecheckWarningModal(true)
    setStatus(`Recheck found ${warnings.length} potential missed item(s). Review warnings before save.`)
    setError(null)
  }

  function applyValidatedState(normalizedRows: StockCheckRow[]) {
    skipNextRecheckResetRef.current = true
    setRows(normalizedRows)
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

  function buildSnowflakeEnvelopePayload(inputRows: StockCheckRow[], validated: boolean) {
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

  async function saveStockCheck() {
    const normalizedRows = normalizeBlankStockCheckQuantities(rows)

    applyValidatedState(normalizedRows)
    setIsSaving(true)
    setStatus('Saving stock check...')
    setError(null)

    try {
      const response = await fetch('/api/stock-check/save-to-supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSnowflakeEnvelopePayload(normalizedRows, true)),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Save failed.')
      }

      setStatus(`Saved (UID: ${payload?.uid_stock_check ?? '-'}) and validated. Blank quantities were set to 0. Export and Push to Snowflake Database are enabled.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
      setStatus('Validated by staff. Blank quantities were set to 0. Save to Supabase failed, please retry Save.')
    } finally {
      setIsSaving(false)
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

  async function exportPhoto() {
    if (!stockPaperRef.current) {
      setError('Stocklist area is not ready for photo export.')
      return
    }

    setIsExporting(true)
    setStatus(null)
    setError(null)

    const zoomBeforeExport = currentZoomRef.current
    const needsZoomReset = isMobileViewport && zoomBeforeExport !== 1

    try {
      if (needsZoomReset) {
        setPaperZoom(1)
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      }

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
      if (needsZoomReset) {
        setPaperZoom(zoomBeforeExport)
      }
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
        body: JSON.stringify(buildSnowflakeEnvelopePayload(rows, isValidated)),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Push to Snowflake Database failed.')
      }

      setStatus(`Pushed to Snowflake Database (UID: ${payload?.uid_stock_check ?? '-'})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push to Snowflake Database failed.')
    } finally {
      setIsSaving(false)
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
          data-stock-row-index={item.index}
          className={`${className} ${item.row.red_marked ? 'text-red-600 font-semibold' : ''}`}
          value={item.row.official_name}
          readOnly
          onChange={(event) => updateRow(item.index, { official_name: event.target.value })}
        />
        {canToggleVisibility && (
          <button
            type="button"
            aria-label={isVisible ? 'Hide item' : 'Show item'}
            title={isVisible ? 'Hide item' : 'Show item'}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700"
            onClick={(event) => {
              event.stopPropagation()
              void toggleStockCheckVisibility(code, !isVisible).catch((toggleError) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Failed to update visibility.')
              })
            }}
          >
            {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    )
  }

  function renderQuantityCell(item: IndexedRow) {
    return (
      <input
        type="number"
        data-stock-row-index={item.index}
        className={`stock-qty-input ${item.row.red_marked ? 'text-red-600' : ''}`}
        aria-label={`Quantity for ${item.row.official_name}`}
        value={item.row.quantity ?? ''}
        onChange={(event) => setQuantity(item.index, event.target.value)}
      />
    )
  }

  if (visibleCatalogItems.length === 0) {
    return (
      <section className="card-surface rounded-2xl p-4 pb-24 sm:p-6 md:p-8 md:pb-8">
        <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Stock Check</h1>
        <p className="mt-2 text-sm text-slate-600">Catalog is empty. Upload or manage catalog first, then return to stock check.</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="card-surface rounded-2xl p-4 sm:p-6 md:p-8">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl md:text-3xl">Stock Check</h1>
          <p className="mt-1 text-sm text-slate-600">Paper layout with fixed catalog rows, inline quantity checks, and red reorder markers.</p>
          {loadedHistoryUid && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              <span>Loaded from history</span>
              <span className="font-mono text-[11px]">{loadedHistoryUid}</span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <EntryMethodToggle
            value={stockEntryMode}
            onManual={startManualEntry}
            onPhoto={startPhotoEntry}
            manualHelpText="Manual entry is active. Adjust quantities directly in the paper view."
            photoHelpText="Photo entry is active. Choose a stock-closing image and parse it into the same paper layout."
          />
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="relative">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stock Date</label>
            <input
              type="date"
              value={stockDate}
              onChange={(event) => setStockDate(event.target.value || today)}
              className="mb-3 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
            />

            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Add Item</label>
            <input
              type="text"
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              placeholder="Type to match catalog or add as new"
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-700 focus:border-brand-500 focus:outline-none"
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
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Create new Item
          </button>
        </div>

        {isMobileViewport && (
          <div className="mt-3 mb-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 md:hidden">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Mobile View</span>
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
          </div>
        )}

        <div className="mb-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={expandAllStockCheckSections}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAllStockCheckSections}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Collapse all
          </button>
        </div>

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

        {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {status && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</p>}
        {!hasPassedRecheck && !isValidated && (
          <p className="mt-1 text-xs font-medium text-amber-700">Run Recheck before Save.</p>
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Find In Stocklist</label>
            <div ref={stockFindContainerRef} className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={findTerm}
                onChange={(event) => setFindTerm(event.target.value)}
                placeholder="Search official or stocklist name"
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
              />

              {findTerm.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setFindTerm('')}
                  aria-label="Clear stocklist search"
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
                  onPressRow={(item) => focusAndHighlightRow(item.index)}
                  renderLabelCell={renderLabelCell}
                  renderQuantityCell={renderQuantityCell}
                />
              ))}
            </div>
          ) : (
            <div
              ref={stockPaperRef}
              className="stock-paper min-w-[700px] sm:min-w-[760px] md:min-w-[820px]"
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

        <div className="mt-5 space-y-3">
          <div className="space-y-2">
            <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Primary Actions</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={compareWithPreviousValidatedStockCheck}
                disabled={isExporting || isSaving || isParsing}
                className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-[13px] font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Recheck
              </button>

              <button
                type="button"
                onClick={saveStockCheck}
                disabled={!hasPassedRecheck || isExporting || isSaving || isParsing}
                className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : isValidated ? 'Saved' : 'Save'}
              </button>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={stockExportType}
                  onChange={(event) => setStockExportType(event.target.value as 'csv' | 'photo')}
                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 focus:border-brand-500 focus:outline-none"
                  aria-label="Choose export format"
                >
                  <option value="csv">CSV file</option>
                  <option value="photo">Photo</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (stockExportType === 'csv') {
                      void exportCsv()
                      return
                    }

                    void exportPhoto()
                  }}
                  disabled={isExportActionDisabled}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileImage className="h-4 w-4" />
                  Export
                </button>
              </div>

              <button
                type="button"
                onClick={saveToDb}
                disabled={!isValidated || isExporting || isSaving || isParsing}
                className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Push to Snowflake Database
              </button>
            </div>
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

      {showRecheckWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Recheck Warnings</h3>
                <p className="text-sm text-slate-600">
                  These items were in stock previously but are now 0 or blank. Confirm after rechecking physically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRecheckWarningModal(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
              {recheckWarnings.map((warning) => (
                <div key={warning.key} className="rounded-md border border-amber-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-900">{warning.label}</p>
                  <p className="mt-0.5 text-xs text-slate-600">{warning.section}</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Previous: {warning.previousQuantity} | Current: {warning.currentQuantity === null ? 'blank' : warning.currentQuantity}
                    {' '}({warning.reason === 'now_blank' ? 'now blank' : 'now 0'})
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowRecheckWarningModal(false)
                  setHasPassedRecheck(false)
                  setStatus('Recheck requires edits. Please update quantities and run Recheck again.')
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                Back to Edit
              </button>
              <button
                type="button"
                onClick={saveStockCheck}
                className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 sm:w-auto"
              >
                Confirm Recheck & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
