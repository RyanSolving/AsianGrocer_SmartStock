import { NextResponse } from 'next/server'
import snowflake from 'snowflake-sdk'

snowflake.configure({ logLevel: 'ERROR' })

import { logPushToSnowflakeEvent } from '../../../lib/supabase/events'
import { getAuthContext } from '../../../lib/supabase/route-auth'
import { buildManualEntryRecordName } from '../../../lib/record-names'
import {
  buildSnowflakeStagingRecord,
  parsedStockSchema,
  saveToSnowflakeEnvelopeSchema,
  stockModeSchema,
} from '../../../lib/stock-schema'

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
    []
  )

  await executeSnowflake(connection, `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS mode VARCHAR`, [])
  await executeSnowflake(connection, `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS validated VARCHAR`, [])
}

function closeSnowflakeConnection(connection: ReturnType<typeof snowflake.createConnection>) {
  return new Promise<void>((resolve) => {
    connection.destroy(() => resolve())
  })
}

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const persistOnly = Boolean(payload && typeof payload === 'object' && (payload as { persist_only?: unknown }).persist_only)

  // Check if this is a re-push request with uid_generate
  const isRepush = payload && typeof payload === 'object' && 'uid_generate' in payload && !('data' in payload)
  let uidGenerate: string | null = null
  let parsedData: ReturnType<typeof parsedStockSchema.parse>
  let validated: 'yes' | 'no' = 'no'
  let unknownItems: unknown[] = []
  let missingCatalogItems: unknown[] = []

  if (isRepush) {
    // Re-push case: fetch data from database
    uidGenerate = typeof (payload as any).uid_generate === 'string' ? (payload as any).uid_generate : null
    if (typeof uidGenerate !== 'string' || !uidGenerate) {
      return NextResponse.json(
        {
          error: 'Invalid or missing uid_generate for re-push.',
        },
        { status: 400 }
      )
    }

    // Fetch the original event_generate record
    const { data: eventData, error: eventError } = await auth.supabase
      .from('event_generate')
      .select('final_output')
      .eq('uid_generate', uidGenerate)
      .eq('user_id', auth.user.id)
      .single()

    if (eventError || !eventData) {
      return NextResponse.json(
        {
          error: 'Failed to fetch original transcription data for re-push.',
          details: eventError?.message,
        },
        { status: 404 }
      )
    }

    // Parse the final_output as parsed data
    const finalOutput = eventData.final_output
    const parsed = parsedStockSchema.safeParse(finalOutput)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Original transcription data validation failed.',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    parsedData = parsed.data
    validated = 'yes' // Re-push records are always validated (saved via Done pipeline)
  } else {
    const envelope = saveToSnowflakeEnvelopeSchema.safeParse(payload)
    if (!envelope.success) {
      return NextResponse.json(
        {
          error: 'Payload validation failed.',
          details: envelope.error.flatten(),
        },
        { status: 400 }
      )
    }

    parsedData = envelope.data.data
    validated = envelope.data.validated === 'yes' ? 'yes' : 'no'
    unknownItems = envelope.data.unknown_items
    missingCatalogItems = envelope.data.missing_catalog_items
    uidGenerate = typeof envelope.data.uid_generate === 'string' && envelope.data.uid_generate.length > 0
      ? envelope.data.uid_generate
      : null
  }

  if (persistOnly) {
    const stagedRecord = buildSnowflakeStagingRecord({
      parsedData,
      validated,
      unknownItems,
      missingCatalogItems,
    })
    const recordName = buildManualEntryRecordName(stagedRecord.stock_date)

    const persistedFinalOutput = parsedStockSchema.parse({
      photo_id: stagedRecord.photo_id,
      mode: stagedRecord.mode,
      upload_date: stagedRecord.upload_date,
      stock_date: stagedRecord.stock_date,
      photo_url: stagedRecord.photo_url,
      total_items: stagedRecord.item_data.length,
      confidence_overall: stagedRecord.confidence_overall,
      items: stagedRecord.item_data,
    })

    let savedUidGenerate = uidGenerate

    if (savedUidGenerate) {
      const { data: updatedRows, error: updateGenerateError } = await auth.supabase
        .from('event_generate')
        .update({
          input_file_name: recordName,
          record_name: recordName,
          final_output: persistedFinalOutput,
          edited: true,
        })
        .eq('uid_generate', savedUidGenerate)
        .eq('user_id', auth.user.id)
        .select('uid_generate')

      if (updateGenerateError) {
        return NextResponse.json(
          {
            error: 'Failed to save draft to Supabase.',
            details: updateGenerateError.message,
          },
          { status: 500 }
        )
      }

      // Detect silent RLS block — Supabase returns no error but updates 0 rows
      if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          {
            error: 'Save blocked by database policy. The record may belong to another user, or the UPDATE policy is missing. Run the latest RLS migration in Supabase.',
            uid_generate: savedUidGenerate,
          },
          { status: 403 }
        )
      }
    } else {
      const { data: insertedGenerate, error: insertGenerateError } = await auth.supabase
        .from('event_generate')
        .insert({
          user_id: auth.user.id,
          input_file_name: recordName,
          record_name: recordName,
          catalog_version: 'manual',
          output_from_model: { source: 'manual-entry' },
          final_output: persistedFinalOutput,
          edited: true,
          stock_mode: stagedRecord.mode === 'stock-closing' ? 'closing_check' : 'arrival_entry',
        })
        .select('uid_generate')
        .single()

      if (insertGenerateError) {
        return NextResponse.json(
          {
            error: 'Failed to create manual draft in Supabase.',
            details: insertGenerateError.message,
          },
          { status: 500 }
        )
      }

      savedUidGenerate = insertedGenerate?.uid_generate ?? null
    }

    return NextResponse.json(
      {
        success: true,
        uid_generate: savedUidGenerate,
        message: 'Saved to Supabase. You can keep editing before loading to Snowflake.',
      },
      { status: 200 }
    )
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
    validated,
    unknownItems,
    missingCatalogItems,
  })
  const recordName = buildManualEntryRecordName(stagedRecord.stock_date)

  const persistedFinalOutput = parsedStockSchema.parse({
    photo_id: stagedRecord.photo_id,
    mode: stagedRecord.mode,
    upload_date: stagedRecord.upload_date,
    stock_date: stagedRecord.stock_date,
    photo_url: stagedRecord.photo_url,
    total_items: stagedRecord.item_data.length,
    confidence_overall: stagedRecord.confidence_overall,
    items: stagedRecord.item_data,
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
        stagedRecord.photo_id,
        stockModeSchema.parse(stagedRecord.mode),
        stagedRecord.validated,
        stagedRecord.upload_date,
        stagedRecord.stock_date,
        stagedRecord.photo_url,
        stagedRecord.total_items,
        stagedRecord.confidence_overall,
        JSON.stringify(stagedRecord.item_data),
      ]
    )

    let historySyncWarning: string | null = null

    if (uidGenerate) {
      const { data: updatedRows, error: updateGenerateError } = await auth.supabase
        .from('event_generate')
        .update({
          input_file_name: recordName,
          record_name: recordName,
          final_output: persistedFinalOutput,
          edited: true,
        })
        .eq('uid_generate', uidGenerate)
        .eq('user_id', auth.user.id)
        .select('uid_generate')

      if (updateGenerateError) {
        historySyncWarning = updateGenerateError.message
      } else if (!updatedRows || updatedRows.length === 0) {
        // Silent RLS block — update appeared to succeed but wrote 0 rows
        historySyncWarning = 'UPDATE blocked by RLS policy (0 rows affected). Apply the consolidate_rls_policies migration in Supabase.'
      }
    }

    const pushEvent = await logPushToSnowflakeEvent(auth.supabase, {
      user: {
        userId: auth.user.id,
      },
      uidGenerate,
    })

    if (pushEvent.error) {
      return NextResponse.json(
        {
          error: 'Snowflake row inserted but push event logging failed.',
          details: pushEvent.error.message,
          query_id: result.queryId,
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        message: 'Snowflake staging row inserted successfully.',
        table: tableName,
        query_id: result.queryId,
        ...(historySyncWarning
          ? {
            warning: 'Saved to Snowflake, but failed to sync edited data to transcription history.',
            history_sync_error: historySyncWarning,
          }
          : {}),
        inserted: {
          photo_id: stagedRecord.photo_id,
          mode: stagedRecord.mode,
          validated: stagedRecord.validated,
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
