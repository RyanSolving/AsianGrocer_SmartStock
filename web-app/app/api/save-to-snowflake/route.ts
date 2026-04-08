import { NextResponse } from 'next/server'
import snowflake from 'snowflake-sdk'

import {
  catalogEntrySchema,
  itemSchema,
  parsedStockSchema,
  snowflakeStagingRecordSchema,
  stockModeSchema,
} from '../../../lib/stock-schema'

export const runtime = 'nodejs'

const unknownItemSchema = itemSchema
const missingCatalogItemsSchema = catalogEntrySchema.array().default([])

function getMissingSnowflakeEnvKeys() {
  const missing: string[] = []

  if (!process.env.SNOWFLAKE_ACCOUNT) missing.push('SNOWFLAKE_ACCOUNT')
  if (!process.env.SNOWFLAKE_USER) missing.push('SNOWFLAKE_USER')
  if (!process.env.SNOWFLAKE_PASSWORD) missing.push('SNOWFLAKE_PASSWORD')
  if (!process.env.SNOWFLAKE_WAREHOUSE) missing.push('SNOWFLAKE_WAREHOUSE')
  if (!process.env.SNOWFLAKE_DB && !process.env.SNOWFLAKE_DATABASE) missing.push('SNOWFLAKE_DB or SNOWFLAKE_DATABASE')
  if (!process.env.SNOWFLAKE_SCHEMA) missing.push('SNOWFLAKE_SCHEMA')

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

function getQualifiedTableName() {
  const database = process.env.SNOWFLAKE_DB ?? process.env.SNOWFLAKE_DATABASE
  const schema = process.env.SNOWFLAKE_SCHEMA
  const table = process.env.SNOWFLAKE_TABLE ?? 'stock_photos_raw'

  if (!database || !schema) {
    throw new Error('Snowflake database and schema are required.')
  }

  return [database, schema, table].map(sanitizeIdentifier).join('.')
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

function executeSnowflake(
  connection: ReturnType<typeof snowflake.createConnection>,
  sqlText: string,
  binds: Array<string | number | null>
) {
  return new Promise<{ queryId: string | null }>((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete(error, statement) {
        if (error) {
          reject(error)
          return
        }

        resolve({ queryId: statement?.getQueryId?.() ?? null })
      },
    })
  })
}

async function ensureSnowflakeTableExists(
  connection: ReturnType<typeof snowflake.createConnection>,
  tableName: string
) {
  await executeSnowflake(
    connection,
    `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        photo_id VARCHAR,
        mode VARCHAR,
        upload_date TIMESTAMP_TZ,
        stock_date DATE,
        photo_url VARCHAR,
        total_items INT,
        confidence_overall VARCHAR,
        item_data VARIANT,
        created_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
      )
    `,
    []
  )

  await executeSnowflake(connection, `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS mode VARCHAR`, [])
}

function closeSnowflakeConnection(connection: ReturnType<typeof snowflake.createConnection>) {
  return new Promise<void>((resolve) => {
    connection.destroy(() => resolve())
  })
}

function normalizeUnknownItem(item: unknown) {
  const parsed = unknownItemSchema.safeParse(item)
  if (!parsed.success) {
    throw new Error('One of the unknown items could not be normalized for Snowflake.')
  }

  return parsed.data
}

function catalogEntryToStagedItem(entry: unknown) {
  const parsed = catalogEntrySchema.parse(entry)

  return {
    catalog_id: parsed.id,
    product_raw: parsed.stocklist_name || parsed.official_name,
    location: parsed.location,
    sub_location: parsed.sub_location,
    category: parsed.category,
    product: parsed.product,
    attribute: parsed.attribute,
    official_name: parsed.official_name,
    stocklist_name: parsed.stocklist_name || null,
    navigation_guide: parsed.navigation_guide || null,
    row_position: parsed.row_position ?? 'single',
    quantity_raw: null,
    quantity: null,
    quantity_conflict_flag: false,
    confidence: 'high' as const,
    catalog_match_status: 'unknown' as const,
    notes: null,
  }
}

function buildSnowflakeStagingRecord(input: {
  parsedData: ReturnType<typeof parsedStockSchema.parse>
  unknownItems: unknown[]
  missingCatalogItems: unknown[]
}) {
  const itemData = [
    ...input.parsedData.items,
    ...input.missingCatalogItems.map(catalogEntryToStagedItem),
    ...input.unknownItems.map(normalizeUnknownItem),
  ]

  return snowflakeStagingRecordSchema.parse({
    photo_id: input.parsedData.photo_id,
    mode: input.parsedData.mode,
    upload_date: input.parsedData.upload_date,
    stock_date: input.parsedData.stock_date,
    photo_url: input.parsedData.photo_url,
    total_items: itemData.length,
    confidence_overall: input.parsedData.confidence_overall,
    item_data: itemData,
  })
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const envelope =
    payload && typeof payload === 'object' && 'data' in payload
      ? {
          data: parsedStockSchema.safeParse((payload as { data?: unknown }).data),
          unknownItems: (payload as { unknown_items?: unknown }).unknown_items,
          missingCatalogItems: (payload as { missing_catalog_items?: unknown }).missing_catalog_items,
        }
      : null

  let parsedData
  let unknownItems: unknown[] = []
  let missingCatalogItems: unknown[] = []

  if (envelope) {
    const unknownResult = unknownItemSchema.array().default([]).safeParse(envelope.unknownItems)
    const missingResult = missingCatalogItemsSchema.safeParse(envelope.missingCatalogItems)

    if (!envelope.data.success) {
      return NextResponse.json(
        {
          error: 'Payload validation failed.',
          details: envelope.data.error.flatten(),
        },
        { status: 400 }
      )
    }

    if (!unknownResult.success) {
      return NextResponse.json(
        {
          error: 'Unknown item payload validation failed.',
          details: unknownResult.error.flatten(),
        },
        { status: 400 }
      )
    }

    if (!missingResult.success) {
      return NextResponse.json(
        {
          error: 'Missing catalog payload validation failed.',
          details: missingResult.error.flatten(),
        },
        { status: 400 }
      )
    }

    parsedData = envelope.data.data
    unknownItems = unknownResult.data
    missingCatalogItems = missingResult.data
  } else {
    const parsed = parsedStockSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Payload validation failed.',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    parsedData = parsed.data
  }

  const missingEnvKeys = getMissingSnowflakeEnvKeys()
  if (missingEnvKeys.length > 0) {
    return NextResponse.json(
      {
        error: 'Snowflake environment variables are not fully configured.',
        missing: missingEnvKeys,
        accepted: parsedData,
      },
      { status: 501 }
    )
  }

  const stagedRecord = buildSnowflakeStagingRecord({
    parsedData,
    unknownItems,
    missingCatalogItems,
  })

  const tableName = getQualifiedTableName()
  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DB ?? process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    role: process.env.SNOWFLAKE_ROLE,
  })

  try {
    await connectSnowflake(connection)
    await ensureSnowflakeTableExists(connection, tableName)

    const result = await executeSnowflake(
      connection,
      `
        INSERT INTO ${tableName} (
          photo_id,
          mode,
          upload_date,
          stock_date,
          photo_url,
          total_items,
          confidence_overall,
          item_data
        ) SELECT
          ?,
          ?,
          TO_TIMESTAMP_TZ(?),
          TO_DATE(?),
          ?,
          ?,
          ?,
          PARSE_JSON(?)
      
      `,
      [
        stagedRecord.photo_id,
        stockModeSchema.parse(stagedRecord.mode),
        stagedRecord.upload_date,
        stagedRecord.stock_date,
        stagedRecord.photo_url,
        stagedRecord.total_items,
        stagedRecord.confidence_overall,
        JSON.stringify(stagedRecord.item_data),
      ]
    )

    return NextResponse.json(
      {
        message: 'Snowflake staging row inserted successfully.',
        table: tableName,
        query_id: result.queryId,
        inserted: {
          photo_id: stagedRecord.photo_id,
          mode: stagedRecord.mode,
          total_items: stagedRecord.total_items,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Snowflake insert failed.'
    return NextResponse.json(
      {
        error: 'Snowflake insert failed.',
        details: message,
      },
      { status: 502 }
    )
  } finally {
    await closeSnowflakeConnection(connection)
  }
}
