import snowflake from 'snowflake-sdk'

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

const DEFAULT_FACT_TABLE = 'FACT_TABLE'
const DEFAULT_PRODUCT_TABLE = 'DIM_PRODUCT'
const DEFAULT_CATEGORY_TABLE = 'DIM_PROD_CAT'
const DEFAULT_LOCATION_TABLE = 'DIM_LOCATION'

function getDashboardDatabaseAndSchema() {
  const database = process.env.SNOWFLAKE_DASHBOARD_DB ?? process.env.SNOWFLAKE_DB ?? process.env.SNOWFLAKE_DATABASE
  const schema = process.env.SNOWFLAKE_DASHBOARD_SCHEMA ?? process.env.SNOWFLAKE_SCHEMA

  return { database, schema }
}

function normalizeFilterValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function getMissingSnowflakeEnvKeys() {
  const missing: string[] = []
  const { database, schema } = getDashboardDatabaseAndSchema()

  if (!process.env.SNOWFLAKE_ACCOUNT) missing.push('SNOWFLAKE_ACCOUNT')
  if (!process.env.SNOWFLAKE_USER) missing.push('SNOWFLAKE_USER')
  if (!process.env.SNOWFLAKE_PASSWORD) missing.push('SNOWFLAKE_PASSWORD')
  if (!process.env.SNOWFLAKE_WAREHOUSE) missing.push('SNOWFLAKE_WAREHOUSE')
  if (!database) missing.push('SNOWFLAKE_DASHBOARD_DB or SNOWFLAKE_DB or SNOWFLAKE_DATABASE')
  if (!schema) missing.push('SNOWFLAKE_DASHBOARD_SCHEMA or SNOWFLAKE_SCHEMA')

  return missing
}

function sanitizeIdentifier(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Snowflake identifier cannot be empty.')
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
  }

  return `"${trimmed.toUpperCase().replaceAll('"', '""')}"`
}

function getQualifiedTableName(tableName: string) {
  const { database, schema } = getDashboardDatabaseAndSchema()

  if (!database || !schema) {
    throw new Error('Snowflake database and schema are required.')
  }

  return [database, schema, tableName].map(sanitizeIdentifier).join('.')
}

function getDashboardTableNames() {
  return {
    fact: getQualifiedTableName(process.env.SNOWFLAKE_DASHBOARD_FACT_TABLE ?? DEFAULT_FACT_TABLE),
    product: getQualifiedTableName(process.env.SNOWFLAKE_DASHBOARD_PRODUCT_TABLE ?? DEFAULT_PRODUCT_TABLE),
    category: getQualifiedTableName(process.env.SNOWFLAKE_DASHBOARD_CATEGORY_TABLE ?? DEFAULT_CATEGORY_TABLE),
    location: getQualifiedTableName(process.env.SNOWFLAKE_DASHBOARD_LOCATION_TABLE ?? DEFAULT_LOCATION_TABLE),
  }
}

function connectSnowflake(connection: ReturnType<typeof snowflake.createConnection>) {
  return new Promise<void>((resolve, reject) => {
    connection.connect((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function querySnowflakeRows(
  connection: ReturnType<typeof snowflake.createConnection>,
  sqlText: string,
  binds: Array<string | number | null>,
) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete(error, _statement, rows) {
        if (error) {
          reject(error)
          return
        }

        resolve((rows ?? []) as Record<string, unknown>[])
      },
    })
  })
}

function closeSnowflakeConnection(connection: ReturnType<typeof snowflake.createConnection>) {
  return new Promise<void>((resolve) => {
    connection.destroy(() => resolve())
  })
}

function parseSnowflakeDate(value: unknown) {
  if (typeof value === 'string') {
    return value.slice(0, 10)
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  return ''
}

function parseSnowflakeTimestamp(value: unknown) {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
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
    photo_id: String(row.PHOTO_ID ?? ''),
    stock_date: parseSnowflakeDate(row.STOCK_DATE),
    mode: String(row.MODE ?? ''),
    cleaned_at: parseSnowflakeTimestamp(row.CLEANED_AT ?? row.CREATED_AT),
    quantity: parseQuantity(row.QUANTITY),
    product_name: String(row.PRODUCT_NAME ?? row.OFFICIAL_NAME ?? row.PRODUCT ?? row.CATALOG_CODE ?? 'Unknown').trim() || 'Unknown',
    category: String(row.CATEGORY_NAME ?? row.CATEGORY ?? 'Unknown').trim() || 'Unknown',
    location: String(row.LOCATION_NAME ?? row.LOCATION ?? 'Unknown').trim() || 'Unknown',
    sub_location: String(row.SUB_LOCATION_NAME ?? row.SUB_LOCATION ?? 'Unknown').trim() || 'Unknown',
  }
}

function compareRowsByFreshness(a: { cleaned_at: string, photo_id: string }, b: { cleaned_at: string, photo_id: string }) {
  const dateCompare = a.cleaned_at.localeCompare(b.cleaned_at)
  if (dateCompare !== 0) return dateCompare
  return a.photo_id.localeCompare(b.photo_id)
}

function buildFiltersWhereClause(filters: DashboardFilters) {
  const conditions: string[] = []
  const binds: Array<string | number | null> = []

  if (filters.location) {
    conditions.push(`LOWER(COALESCE(dl.LOCATION, '')) = LOWER(?)`)
    binds.push(filters.location)
  }

  if (filters.category) {
    conditions.push(`LOWER(COALESCE(dpc.CATEGORY, '')) = LOWER(?)`)
    binds.push(filters.category)
  }

  return {
    whereClause: conditions.length > 0 ? `\n      AND ${conditions.join('\n      AND ')}` : '',
    binds,
  }
}

function buildDateWindowClause(includePreviousDate: boolean) {
  return includePreviousDate ? 'IN (TO_DATE(?), DATEADD(DAY, -1, TO_DATE(?)))' : '= TO_DATE(?)'
}

async function fetchDashboardRows(filters: DashboardFilters, includePreviousDate: boolean) {
  const missingEnv = getMissingSnowflakeEnvKeys()
  if (missingEnv.length > 0) {
    return { rows: [] as ReturnType<typeof normalizeRow>[], missingEnv }
  }

  const { database, schema } = getDashboardDatabaseAndSchema()
  const tableNames = getDashboardTableNames()
  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database,
    schema,
    role: process.env.SNOWFLAKE_ROLE,
  })

  try {
    await connectSnowflake(connection)
    const filterConditions = buildFiltersWhereClause(filters)

    const sqlText = `
      SELECT
        f.PHOTO_ID,
        f.STOCK_DATE,
        f.MODE,
        f.CLEANED_AT,
        f.QUANTITY,
        COALESCE(dp.OFFICIAL_NAME, dp.PRODUCT, f.CATALOG_CODE, 'Unknown') AS PRODUCT_NAME,
        COALESCE(dpc.CATEGORY, 'Unknown') AS CATEGORY_NAME,
        COALESCE(dl.LOCATION, 'Unknown') AS LOCATION_NAME,
        COALESCE(f.SUB_LOCATION, 'Unknown') AS SUB_LOCATION_NAME
      FROM ${tableNames.fact} f
      LEFT JOIN ${tableNames.product} dp
        ON f.PRODUCT_SK = dp.PRODUCT_SK
      LEFT JOIN ${tableNames.category} dpc
        ON f.PROD_CAT_SK = dpc.PROD_CAT_SK
      LEFT JOIN ${tableNames.location} dl
        ON f.LOCATION_SK = dl.LOCATION_SK
      WHERE f.STOCK_DATE ${buildDateWindowClause(includePreviousDate)}
      ${filterConditions.whereClause}
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY f.STOCK_DATE, f.PRODUCT_SK, f.LOCATION_SK, f.SUB_LOCATION, f.MODE
        ORDER BY f.CLEANED_AT DESC NULLS LAST, f.PHOTO_ID DESC
      ) = 1
      ORDER BY f.STOCK_DATE ASC, PRODUCT_NAME ASC, LOCATION_NAME ASC, SUB_LOCATION_NAME ASC
    `

    const dateBinds: Array<string | number | null> = includePreviousDate
      ? [filters.date, filters.date]
      : [filters.date]

    const binds: Array<string | number | null> = [...dateBinds, ...filterConditions.binds]

    const rows = await querySnowflakeRows(connection, sqlText, binds)

    return {
      rows: rows.map(normalizeRow),
      missingEnv: [] as string[],
    }
  } finally {
    await closeSnowflakeConnection(connection)
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
    return { error: 'Snowflake environment variables are not fully configured.', missingEnv }
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
    return { error: 'Snowflake environment variables are not fully configured.', missingEnv }
  }

  return {
    selected_date: normalizedFilters.date,
    filters: buildResponseFilters(rows, normalizedFilters.date, normalizedFilters.location, normalizedFilters.category),
    items: groupStockLevelRows(rows, normalizedFilters.date),
    generated_at: new Date().toISOString(),
  }
}
