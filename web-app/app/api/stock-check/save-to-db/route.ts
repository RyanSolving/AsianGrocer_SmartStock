import { NextResponse } from 'next/server'
import snowflake from 'snowflake-sdk'
import { getAuthContext } from '../../../../lib/supabase/route-auth'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import {
  buildSnowflakeStagingRecord,
  saveToSnowflakeEnvelopeSchema,
  type SnowflakeStagingRecord,
} from '../../../../lib/stock-schema'

export const runtime = 'nodejs'

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
  binds: Array<string | number | null>,
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
  tableName: string,
) {
  await executeSnowflake(
    connection,
    `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        photo_id VARCHAR,
        mode VARCHAR,
        validated VARCHAR,
        upload_date TIMESTAMP_TZ,
        stock_date DATE,
        photo_url VARCHAR,
        total_items INT,
        confidence_overall VARCHAR,
        item_data VARIANT,
        created_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
      )
    `,
    [],
  )

  await executeSnowflake(connection, `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS mode VARCHAR`, [])
  await executeSnowflake(connection, `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS validated VARCHAR`, [])
}

function closeSnowflakeConnection(connection: ReturnType<typeof snowflake.createConnection>) {
  return new Promise<void>((resolve) => {
    connection.destroy(() => resolve())
  })
}

function toSupabaseMirrorItemData(stagedRecord: SnowflakeStagingRecord) {
  const items = stagedRecord.item_data
    .filter((item) => item.catalog_code)
    .map((item) => ({
      code: item.catalog_code as string,
      product: item.product,
      category: item.category,
      location: item.location,
      sub_location: item.sub_location,
      official_name: item.official_name,
      stocklist_name: item.stocklist_name ?? item.official_name,
      quantity: item.quantity,
      red_marked: (item.notes ?? '').toLowerCase().includes('red_marked=true'),
      notes: (item.notes ?? '').replace(/\s*\|\s*red_marked=true/gi, '').trim(),
    }))

  const unknownItems = stagedRecord.item_data
    .filter((item) => !item.catalog_code)
    .map((item) => ({
      user_input: item.official_name || item.product_raw,
      quantity: item.quantity,
      red_marked: (item.notes ?? '').toLowerCase().includes('red_marked=true'),
      notes: (item.notes ?? '').replace(/\s*\|\s*red_marked=true/gi, '').trim(),
    }))

  return {
    items,
    unknown_items: unknownItems,
    validated: stagedRecord.validated === 'yes',
  }
}

export async function POST(request: Request) {
  // Check authentication
  const authContext = await getAuthContext()
  if (authContext instanceof NextResponse) {
    return authContext
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = saveToSnowflakeEnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const missingSnowflakeEnv = getMissingSnowflakeEnvKeys()
  if (missingSnowflakeEnv.length > 0) {
    return NextResponse.json(
      {
        error: 'Snowflake environment variables are not fully configured.',
        missing: missingSnowflakeEnv,
      },
      { status: 501 },
    )
  }

  const stockRecord = buildSnowflakeStagingRecord({
    parsedData: parsed.data.data,
    validated: parsed.data.validated,
    unknownItems: parsed.data.unknown_items,
    missingCatalogItems: parsed.data.missing_catalog_items,
    forcedValidated: 'yes',
  })
  const mirrorItemData = toSupabaseMirrorItemData(stockRecord)

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

  let snowflakeQueryId: string | null = null

  try {
    await connectSnowflake(connection)
    await ensureSnowflakeTableExists(connection, tableName)

    const snowflakeResult = await executeSnowflake(
      connection,
      `
        INSERT INTO ${tableName} (
          photo_id,
          mode,
          validated,
          upload_date,
          stock_date,
          photo_url,
          total_items,
          confidence_overall,
          item_data
        ) SELECT
          ?,
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
        stockRecord.photo_id,
        stockRecord.mode,
        stockRecord.validated,
        stockRecord.upload_date,
        stockRecord.stock_date,
        stockRecord.photo_url,
        stockRecord.total_items,
        stockRecord.confidence_overall,
        JSON.stringify(stockRecord.item_data),
      ],
    )

    snowflakeQueryId = snowflakeResult.queryId

    const supabase = createSupabaseServerClient()

    const { data, error } = await supabase
      .from('event_stock_check')
      .insert({
        user_id: authContext.user.id,
        date: stockRecord.stock_date,
        mode: 'closing_check',
        item_data: mirrorItemData,
      })
      .select('uid_stock_check, created_at')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json(
        {
          success: true,
          warning: 'Saved to Snowflake, but Supabase history mirror failed.',
          details: error.message,
          query_id: snowflakeQueryId,
          snowflake_table: tableName,
          snowflake_photo_id: stockRecord.photo_id,
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      {
        success: true,
        uid_stock_check: data.uid_stock_check,
        created_at: data.created_at,
        message: 'Stock check saved to Snowflake and mirrored to Supabase history.',
        query_id: snowflakeQueryId,
        snowflake_table: tableName,
        snowflake_photo_id: stockRecord.photo_id,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('Error saving stock check:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save stock check',
      },
      { status: 500 },
    )
  } finally {
    await closeSnowflakeConnection(connection)
  }
}
