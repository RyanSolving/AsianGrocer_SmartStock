import {
  getDashboardStockItemsTableName,
  getMissingBigQueryEnvKeys,
  queryBigQueryRows,
} from './bigquery/warehouse'

export type DashboardFilters = {
  date: string
  location?: string | null
  category?: string | null
}

export type DashboardMetricItem = {
  product_name: string
  category: string
  quantity: number
}

export type DashboardStockLevelItem = {
  product_name: string
  category: string
  current_quantity: number
  arrival_total_quantity: number
  stock_in_quantity: number
  previous_closing_quantity: number
  sold_out_percent: number
  red_flag: boolean
}

export type DashboardResponseFilters = {
  selected_date: string
  selected_location: string | 'all'
  selected_category: string | 'all'
  locations: string[]
  categories: string[]
}

function normalizeFilterValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function unwrapBigQueryValue(value: unknown) {
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { value: unknown }).value
  }

  return value
}

function rowValue(row: Record<string, unknown>, key: string) {
  return unwrapBigQueryValue(row[key] ?? row[key.toUpperCase()])
}

function parseWarehouseDate(value: unknown) {
  const unwrapped = unwrapBigQueryValue(value)
  if (typeof unwrapped === 'string') {
    return unwrapped.slice(0, 10)
  }

  if (unwrapped instanceof Date) {
    return unwrapped.toISOString().slice(0, 10)
  }

  return ''
}

function parseWarehouseTimestamp(value: unknown) {
  const unwrapped = unwrapBigQueryValue(value)
  if (typeof unwrapped === 'string') return unwrapped
  if (unwrapped instanceof Date) return unwrapped.toISOString()
  return new Date().toISOString()
}

function parseQuantity(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normalizeRow(row: Record<string, unknown>) {
  return {
    photo_id: String(rowValue(row, 'photo_id') ?? ''),
    stock_date: parseWarehouseDate(rowValue(row, 'stock_date')),
    mode: String(rowValue(row, 'mode') ?? ''),
    cleaned_at: parseWarehouseTimestamp(rowValue(row, 'cleaned_at') ?? rowValue(row, 'created_at')),
    quantity: parseQuantity(rowValue(row, 'quantity')),
    product_name: String(rowValue(row, 'product_name') ?? rowValue(row, 'official_name') ?? rowValue(row, 'product') ?? rowValue(row, 'catalog_code') ?? 'Unknown').trim() || 'Unknown',
    category: String(rowValue(row, 'category_name') ?? rowValue(row, 'category') ?? 'Unknown').trim() || 'Unknown',
    location: String(rowValue(row, 'location_name') ?? rowValue(row, 'location') ?? 'Unknown').trim() || 'Unknown',
    sub_location: String(rowValue(row, 'sub_location_name') ?? rowValue(row, 'sub_location') ?? 'Unknown').trim() || 'Unknown',
  }
}

function compareRowsByFreshness(a: { cleaned_at: string, photo_id: string }, b: { cleaned_at: string, photo_id: string }) {
  const dateCompare = a.cleaned_at.localeCompare(b.cleaned_at)
  if (dateCompare !== 0) return dateCompare
  return a.photo_id.localeCompare(b.photo_id)
}

function buildFiltersWhereClause(filters: DashboardFilters) {
  const conditions: string[] = []
  const params: Record<string, string> = {}

  if (filters.location) {
    conditions.push(`LOWER(COALESCE(location, '')) = LOWER(@location)`)
    params.location = filters.location
  }

  if (filters.category) {
    conditions.push(`LOWER(COALESCE(category, '')) = LOWER(@category)`)
    params.category = filters.category
  }

  return {
    whereClause: conditions.length > 0 ? `\n    WHERE ${conditions.join('\n      AND ')}` : '',
    params,
  }
}

function buildDateWindowClause(includePreviousDate: boolean) {
  return includePreviousDate ? 'IN (DATE(@selected_date), DATE_SUB(DATE(@selected_date), INTERVAL 1 DAY))' : '= DATE(@selected_date)'
}

async function fetchDashboardRows(filters: DashboardFilters, includePreviousDate: boolean) {
  const missingEnv = getMissingBigQueryEnvKeys()
  if (missingEnv.length > 0) {
    return { rows: [] as ReturnType<typeof normalizeRow>[], missingEnv }
  }

  const tableName = getDashboardStockItemsTableName()
  const filterConditions = buildFiltersWhereClause(filters)

  const sqlText = `
    WITH normalized AS (
      SELECT
        CAST(f.photo_id AS STRING) AS photo_id,
        SAFE_CAST(f.stock_date AS DATE) AS stock_date,
        CAST(f.mode AS STRING) AS mode,
        COALESCE(
          SAFE_CAST(f.cleaned_at AS TIMESTAMP),
          SAFE_CAST(f.created_at AS TIMESTAMP),
          SAFE_CAST(f.upload_date AS TIMESTAMP),
          CURRENT_TIMESTAMP()
        ) AS cleaned_at,
        COALESCE(SAFE_CAST(f.quantity AS FLOAT64), 0) AS quantity,
        COALESCE(CAST(f.official_name AS STRING), CAST(f.product AS STRING), CAST(f.catalog_code AS STRING), 'Unknown') AS product_name,
        COALESCE(CAST(f.category AS STRING), 'Unknown') AS category,
        COALESCE(CAST(f.location AS STRING), 'Unknown') AS location,
        COALESCE(CAST(f.sub_location AS STRING), 'Unknown') AS sub_location
      FROM ${tableName} f
      WHERE SAFE_CAST(f.stock_date AS DATE) ${buildDateWindowClause(includePreviousDate)}
    )
    SELECT
      photo_id,
      stock_date,
      mode,
      cleaned_at,
      quantity,
      product_name,
      category AS category_name,
      location AS location_name,
      sub_location AS sub_location_name
    FROM normalized
    ${filterConditions.whereClause}
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY stock_date, product_name, location, sub_location, mode
      ORDER BY cleaned_at DESC NULLS LAST, photo_id DESC
    ) = 1
    ORDER BY stock_date ASC, product_name ASC, location ASC, sub_location ASC
  `

  const rows = await queryBigQueryRows(sqlText, {
    selected_date: filters.date,
    ...filterConditions.params,
  })

  return {
    rows: rows.map(normalizeRow),
    missingEnv: [] as string[],
  }
}

function groupOverviewRows(rows: ReturnType<typeof normalizeRow>[], selectedDate: string) {
  const grouped = new Map<string, DashboardMetricItem>()

  for (const row of rows) {
    if (row.stock_date !== selectedDate) continue
    const key = row.product_name
    const existing = grouped.get(key)
    if (existing) {
      existing.quantity += row.quantity
      continue
    }

    grouped.set(key, {
      product_name: row.product_name,
      category: row.category,
      quantity: row.quantity,
    })
  }

  const metrics = Array.from(grouped.values()).sort((a, b) => {
    const quantityCompare = b.quantity - a.quantity
    if (quantityCompare !== 0) return quantityCompare
    return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: 'base', numeric: true })
  })

  const totalProductsInStock = metrics.filter((item) => item.quantity > 0).length

  return {
    totalProductsInStock,
    highest: metrics.slice(0, 5),
    lowest: Array.from(metrics).sort((a, b) => {
      const quantityCompare = a.quantity - b.quantity
      if (quantityCompare !== 0) return quantityCompare
      return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: 'base', numeric: true })
    }).slice(0, 5),
    all: metrics,
  }
}

function makeProductLocationKey(row: ReturnType<typeof normalizeRow>) {
  return [row.product_name, row.location, row.sub_location].join('::')
}

function selectLatestRows(rows: ReturnType<typeof normalizeRow>[], selectedDate: string, predicate?: (row: ReturnType<typeof normalizeRow>) => boolean) {
  const selectedRows = rows.filter((row) => row.stock_date === selectedDate && (predicate ? predicate(row) : true))
  const latest = new Map<string, ReturnType<typeof normalizeRow>>()

  for (const row of selectedRows) {
    const key = makeProductLocationKey(row)
    const existing = latest.get(key)
    if (!existing) {
      latest.set(key, row)
      continue
    }

    if (compareRowsByFreshness(existing, row) < 0) {
      latest.set(key, row)
    }
  }

  return Array.from(latest.values())
}

function groupStockLevelRows(rows: ReturnType<typeof normalizeRow>[], selectedDate: string) {
  const previousDate = new Date(`${selectedDate}T00:00:00Z`)
  previousDate.setUTCDate(previousDate.getUTCDate() - 1)
  const previousDateString = previousDate.toISOString().slice(0, 10)

  const currentRows = selectLatestRows(rows, selectedDate)
  const stockInRows = selectLatestRows(rows, selectedDate, (row) => row.mode === 'stock-in')
  const previousClosingRows = rows.filter((row) => row.stock_date === previousDateString && row.mode === 'stock-closing')

  const buckets = new Map<string, DashboardStockLevelItem>()

  const applyRows = (sourceRows: ReturnType<typeof normalizeRow>[], field: 'current_quantity' | 'stock_in_quantity' | 'previous_closing_quantity') => {
    for (const row of sourceRows) {
      const existing = buckets.get(row.product_name) ?? {
        product_name: row.product_name,
        category: row.category,
        current_quantity: 0,
        arrival_total_quantity: 0,
        stock_in_quantity: 0,
        previous_closing_quantity: 0,
        sold_out_percent: 0,
        red_flag: false,
      }

      existing[field] += row.quantity
      if (existing.category === 'Unknown' && row.category !== 'Unknown') {
        existing.category = row.category
      }

      buckets.set(row.product_name, existing)
    }
  }

  applyRows(currentRows, 'current_quantity')
  applyRows(stockInRows, 'stock_in_quantity')
  applyRows(previousClosingRows, 'previous_closing_quantity')

  const metrics = Array.from(buckets.values()).map((item) => {
    const arrivalTotal = item.stock_in_quantity + item.previous_closing_quantity
    const soldOutPercent = arrivalTotal > 0 ? (item.current_quantity / arrivalTotal) * 100 : 0

    return {
      ...item,
      arrival_total_quantity: arrivalTotal,
      sold_out_percent: soldOutPercent,
      red_flag: soldOutPercent < 20,
    }
  }).sort((a, b) => {
    if (a.red_flag !== b.red_flag) return a.red_flag ? -1 : 1
    const soldOutCompare = a.sold_out_percent - b.sold_out_percent
    if (soldOutCompare !== 0) return soldOutCompare
    return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: 'base', numeric: true })
  })

  return metrics
}

function buildResponseFilters(rows: ReturnType<typeof normalizeRow>[], selectedDate: string, location: string | null, category: string | null): DashboardResponseFilters {
  const locations = Array.from(new Set(rows.map((row) => row.location).filter((value) => value.length > 0))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  const categories = Array.from(new Set(rows.map((row) => row.category).filter((value) => value.length > 0))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))

  return {
    selected_date: selectedDate,
    selected_location: location ?? 'all',
    selected_category: category ?? 'all',
    locations,
    categories,
  }
}

export async function fetchDashboardOverview(filters: DashboardFilters) {
  const normalizedFilters = {
    date: filters.date,
    location: normalizeFilterValue(filters.location),
    category: normalizeFilterValue(filters.category),
  }

  const { rows, missingEnv } = await fetchDashboardRows(normalizedFilters, false)
  if (missingEnv.length > 0) {
    return { error: 'BigQuery environment variables are not fully configured.', missingEnv }
  }

  const overview = groupOverviewRows(rows, normalizedFilters.date)

  return {
    selected_date: normalizedFilters.date,
    filters: buildResponseFilters(rows, normalizedFilters.date, normalizedFilters.location, normalizedFilters.category),
    summary: {
      total_products_in_stock: overview.totalProductsInStock,
      total_products: overview.all.length,
      generated_at: new Date().toISOString(),
    },
    top_highest: overview.highest,
    top_lowest: overview.lowest,
  }
}

export async function fetchDashboardStockLevels(filters: DashboardFilters) {
  const normalizedFilters = {
    date: filters.date,
    location: normalizeFilterValue(filters.location),
    category: normalizeFilterValue(filters.category),
  }

  const { rows, missingEnv } = await fetchDashboardRows(normalizedFilters, true)
  if (missingEnv.length > 0) {
    return { error: 'BigQuery environment variables are not fully configured.', missingEnv }
  }

  return {
    selected_date: normalizedFilters.date,
    filters: buildResponseFilters(rows, normalizedFilters.date, normalizedFilters.location, normalizedFilters.category),
    items: groupStockLevelRows(rows, normalizedFilters.date),
    generated_at: new Date().toISOString(),
  }
}
