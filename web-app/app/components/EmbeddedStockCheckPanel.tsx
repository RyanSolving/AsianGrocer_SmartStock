'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileImage, FileText, Loader2, Plus, Save, Search, X } from 'lucide-react'
import { toPng } from 'html-to-image'
import {
  catalogCategoryOptions,
  catalogLocationOptions,
  catalogRowPositionOptions,
  catalogSubLocationInsideOptions,
  catalogSubLocationOutsideOptions,
} from '../../lib/stock-schema'
import { normalizeBlankStockCheckQuantities } from '../../lib/stock-check-utils'

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

function normalizeSubLocation(value: string) {
  if (value.toLowerCase() === 'all year') return 'All Year'
  return value
}

function normalizeInsideSectionLabel(category: string, subLocation: string) {
  const raw = (category || subLocation || 'Unknown').trim()
  if (!raw) return 'Unknown'
  return normalizeSubLocation(raw)
}

function normalizeCompareKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseNumericQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  return value
}

function generateItemCode(category: string, product: string, attribute: string) {
  const cat3 = (category || 'OTH').toUpperCase().slice(0, 3)
  const prod3 = (product || 'NEW').toUpperCase().slice(0, 3)
  const attr3 = attribute ? attribute.toUpperCase().slice(0, 3) : 'STD'
  return `${cat3}-${prod3}-${attr3}`
}

export { normalizeBlankStockCheckQuantities }

function getSubLocationOptions(location: 'Inside Coolroom' | 'Outside Coolroom') {
  return location === 'Outside Coolroom'
    ? [...catalogSubLocationOutsideOptions]
    : [...catalogSubLocationInsideOptions]
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
}: {
  catalogItems: CatalogItem[] | null
  selectedHistoryRecord?: SelectedStockCheckHistoryRecord | null
  historyRecords?: StockCheckHistoryRecord[]
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const stockPaperRef = useRef<HTMLDivElement | null>(null)
  const stockFindContainerRef = useRef<HTMLDivElement | null>(null)
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
  const [recheckWarnings, setRecheckWarnings] = useState<RecheckWarning[]>([])
  const [showRecheckWarningModal, setShowRecheckWarningModal] = useState(false)
  const [hasPassedRecheck, setHasPassedRecheck] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [highlightedRowIndex, setHighlightedRowIndex] = useState<number | null>(null)
  const [paperZoom, setPaperZoom] = useState(1)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartZoomRef = useRef(1)
  const currentZoomRef = useRef(1)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextRecheckResetRef = useRef(false)
  const loadedHistoryUid = selectedHistoryRecord?.uid_stock_check ?? null

  useEffect(() => {
    currentZoomRef.current = paperZoom
  }, [paperZoom])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateMobileState = () => setIsMobileViewport(mediaQuery.matches)

    updateMobileState()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMobileState)
      return () => mediaQuery.removeEventListener('change', updateMobileState)
    }

    mediaQuery.addListener(updateMobileState)
    return () => mediaQuery.removeListener(updateMobileState)
  }, [])

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
    if (!catalogItems || catalogItems.length === 0) return

    setRows((prev) => {
      if (prev.length > 0) return prev
      return catalogItems.map(makeCatalogRow)
    })
  }, [catalogItems])

  useEffect(() => {
    if (!selectedHistoryRecord || !catalogItems || catalogItems.length === 0) return

    const recordData = selectedHistoryRecord.record_data
    if (!recordData) return

    const nextRows = catalogItems.map(makeCatalogRow)
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
  }, [catalogItems, selectedHistoryRecord, today])

  useEffect(() => {
    if (skipNextRecheckResetRef.current) {
      skipNextRecheckResetRef.current = false
      return
    }

    setHasPassedRecheck(false)
  }, [rows, stockDate])

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
    const target = stockPaperRef.current?.querySelector(`[data-stock-row-index="${index}"]`) as HTMLElement | null
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
  }, [])

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

      setStatus(`Saved (UID: ${payload?.uid_stock_check ?? '-'}) and validated. Blank quantities were set to 0. Export and Load to Snowflake are enabled.`)
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
        throw new Error(payload?.error ?? 'Load to Snowflake failed.')
      }

      setStatus(`Loaded to Snowflake (UID: ${payload?.uid_stock_check ?? '-'})`)

      if (rows.some((x) => x.source === 'unknown')) {
        openCreateUnknownModal()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load to Snowflake failed.')
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
          data-stock-row-index={item.index}
          className={`${className} ${item.row.red_marked ? 'text-red-600 font-semibold' : ''}`}
          value={item.row.official_name}
          onChange={(event) => updateRow(item.index, { official_name: event.target.value })}
        />
      </div>
    )
  }

  if (!catalogItems || catalogItems.length === 0) {
    return (
      <section className="card-surface rounded-2xl p-4 sm:p-6 md:p-8">
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

        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={compareWithPreviousValidatedStockCheck}
              disabled={isExporting || isSaving}
              className="w-full rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Recheck
            </button>

            <button
              type="button"
              onClick={saveStockCheck}
              disabled={!hasPassedRecheck || isExporting || isSaving}
              className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Saving...' : isValidated ? 'Saved' : 'Save'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!isValidated || isExporting || isSaving}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:gap-2 sm:px-4"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>

            <button
              type="button"
              onClick={exportPdf}
              disabled={!isValidated || isExporting || isSaving}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:gap-2 sm:px-4"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>

            <button
              type="button"
              onClick={exportPhoto}
              disabled={isExporting || isSaving}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:gap-2 sm:px-4"
            >
              <FileImage className="h-4 w-4" />
              Photo
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={saveToDb}
              disabled={!isValidated || isExporting || isSaving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Load to Snowflake
            </button>

            <button
              type="button"
              onClick={openCreateUnknownModal}
              disabled={!rows.some((x) => x.source === 'unknown') || isCreatingUnknownItems}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isCreatingUnknownItems ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Create Unknown Items
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {status && <p className="mt-3 text-sm text-emerald-700">{status}</p>}
        {!hasPassedRecheck && !isValidated && (
          <p className="mt-1 text-xs font-medium text-amber-700">Run Recheck before Save.</p>
        )}

        {isMobileViewport && (
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
          className="mt-5 stock-paper-wrap overflow-x-auto"
          onTouchStart={handlePaperTouchStart}
          onTouchMove={handlePaperTouchMove}
          onTouchEnd={clearPinchState}
          onTouchCancel={clearPinchState}
        >
          <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Find In Stocklist</label>
            <div ref={stockFindContainerRef} className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={findTerm}
                onChange={(event) => setFindTerm(event.target.value)}
                placeholder="Search official or stocklist name"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
              />

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
                                <td className={`stock-lbl ${getHighlightClass(left?.index)}`}>{renderLabelCell(left, 'stock-input')}</td>
                                <td className={`stock-qty ${getHighlightClass(left?.index)}`}>
                                  {left ? (
                                    <input
                                      type="number"
                                      data-stock-row-index={left.index}
                                      className={`stock-qty-input ${left.row.red_marked ? 'text-red-600' : ''}`}
                                      value={left.row.quantity ?? ''}
                                      onChange={(event) => setQuantity(left.index, event.target.value)}
                                    />
                                  ) : null}
                                </td>
                                <td className={`stock-lbl ${getHighlightClass(right?.index)}`}>{renderLabelCell(right, 'stock-input')}</td>
                                <td className={`stock-qty ${getHighlightClass(right?.index)}`}>
                                  {right ? (
                                    <input
                                      type="number"
                                      data-stock-row-index={right.index}
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
                              <td className={`stock-lbl ${getHighlightClass(single.index)}`} colSpan={3}>{renderLabelCell(single, 'stock-input stock-input-hw')}</td>
                              <td className={`stock-qty ${getHighlightClass(single.index)}`}>
                                <input
                                  type="number"
                                  data-stock-row-index={single.index}
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
                                <td className={`stock-lbl ${getHighlightClass(left?.index)}`}>{renderLabelCell(left, 'stock-input')}</td>
                                <td className={`stock-qty ${getHighlightClass(left?.index)}`}>
                                  {left ? (
                                    <input
                                      type="number"
                                      data-stock-row-index={left.index}
                                      className={`stock-qty-input ${left.row.red_marked ? 'text-red-600' : ''}`}
                                      value={left.row.quantity ?? ''}
                                      onChange={(event) => setQuantity(left.index, event.target.value)}
                                    />
                                  ) : null}
                                </td>
                                <td className={`stock-lbl ${getHighlightClass(right?.index)}`}>{renderLabelCell(right, 'stock-input')}</td>
                                <td className={`stock-qty ${getHighlightClass(right?.index)}`}>
                                  {right ? (
                                    <input
                                      type="number"
                                      data-stock-row-index={right.index}
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
                              <td className={`stock-lbl ${getHighlightClass(single.index)}`} colSpan={3}>{renderLabelCell(single, 'stock-input stock-input-hw')}</td>
                              <td className={`stock-qty ${getHighlightClass(single.index)}`}>
                                <input
                                  type="number"
                                  data-stock-row-index={single.index}
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
                    {outsideDisplayColumns.left.map((item, i) => (
                      <tr key={`outside-left-${i}`}>
                        <td className={`stock-lbl ${getHighlightClass(item.index)}`}>{renderLabelCell(item, 'stock-input')}</td>
                        <td className={`stock-qty ${getHighlightClass(item.index)}`}>
                          <input
                            type="number"
                            data-stock-row-index={item.index}
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
                    {outsideDisplayColumns.middle.map((item, i) => (
                      <tr key={`outside-right-${i}`}>
                        <td className={`stock-lbl ${getHighlightClass(item.index)}`}>{renderLabelCell(item, 'stock-input')}</td>
                        <td className={`stock-qty ${getHighlightClass(item.index)}`}>
                          <input
                            type="number"
                            data-stock-row-index={item.index}
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
                    {outsideDisplayColumns.right.map((item, i) => (
                      <tr key={`outside-single-${i}`}>
                        <td className={`stock-lbl ${getHighlightClass(item.index)}`}>{renderLabelCell(item, 'stock-input')}</td>
                        <td className={`stock-qty ${getHighlightClass(item.index)}`}>
                          <input
                            type="number"
                            data-stock-row-index={item.index}
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
                            <td className={`stock-lbl ${getHighlightClass(item.index)}`}>{renderLabelCell(item, 'stock-input')}</td>
                            <td className={`stock-qty ${getHighlightClass(item.index)}`}>
                              <input
                                type="number"
                                data-stock-row-index={item.index}
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
                            <td className={`stock-lbl ${getHighlightClass(item.index)}`}>{renderLabelCell(item, 'stock-input')}</td>
                            <td className={`stock-qty ${getHighlightClass(item.index)}`}>
                              <input
                                type="number"
                                data-stock-row-index={item.index}
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
                            <td className={`stock-lbl ${getHighlightClass(item.index)}`}>{renderLabelCell(item, 'stock-input')}</td>
                            <td className={`stock-qty ${getHighlightClass(item.index)}`}>
                              <input
                                type="number"
                                data-stock-row-index={item.index}
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
