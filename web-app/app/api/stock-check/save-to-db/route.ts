import { NextResponse } from 'next/server'

import {
  ensureRawStockTableExists,
  getMissingBigQueryEnvKeys,
  getRawStockTableName,
  insertRawStockRecord,
} from '../../../../lib/bigquery/warehouse'
import { buildManualEntryRecordName } from '../../../../lib/record-names'
import { getAuthContext } from '../../../../lib/supabase/route-auth'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import {
  buildWarehouseStagingRecord,
  saveToWarehouseEnvelopeSchema,
  type WarehouseStagingRecord,
} from '../../../../lib/stock-schema'

export const runtime = 'nodejs'

function toSupabaseMirrorItemData(stagedRecord: WarehouseStagingRecord) {
  const items = stagedRecord.item_data
    .filter((item) => item.catalog_code)
    .map((item) => ({
      code: item.catalog_code as string,
      product: item.product,
      category: item.category,
      location: item.location,
      sub_location: item.sub_location,
      origin: item.origin,
      inner_quantity: item.inner_quantity,
      inner_unit: item.inner_unit,
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

  const parsed = saveToWarehouseEnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const missingBigQueryEnv = getMissingBigQueryEnvKeys()
  if (missingBigQueryEnv.length > 0) {
    return NextResponse.json(
      {
        error: 'BigQuery environment variables are not fully configured.',
        missing: missingBigQueryEnv,
      },
      { status: 501 },
    )
  }

  const stockRecord = buildWarehouseStagingRecord({
    parsedData: parsed.data.data,
    validated: parsed.data.validated,
    unknownItems: parsed.data.unknown_items,
    missingCatalogItems: parsed.data.missing_catalog_items,
    forcedValidated: 'yes',
  })
  const recordName = buildManualEntryRecordName(stockRecord.stock_date)
  const mirrorItemData = toSupabaseMirrorItemData(stockRecord)
  const tableName = getRawStockTableName()

  let bigQueryJobId: string | null = null

  try {
    await ensureRawStockTableExists(tableName)

    const bigQueryResult = await insertRawStockRecord(tableName, stockRecord)
    bigQueryJobId = bigQueryResult.queryId

    const supabase = createSupabaseServerClient()

    const { data, error } = await supabase
      .from('event_stock_check')
      .upsert(
        {
          user_id: authContext.user.id,
          date: stockRecord.stock_date,
          record_name: recordName,
          mode: 'closing_check',
          item_data: mirrorItemData,
        },
        { onConflict: 'user_id,date,mode' },
      )
      .select('uid_stock_check, created_at, record_name')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json(
        {
          success: true,
          warning: 'Saved to BigQuery, but Supabase history mirror failed.',
          details: error.message,
          job_id: bigQueryJobId,
          bigquery_table: tableName,
          bigquery_photo_id: stockRecord.photo_id,
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      {
        success: true,
        uid_stock_check: data.uid_stock_check,
        created_at: data.created_at,
        record_name: data.record_name ?? recordName,
        message: 'Stock check saved to BigQuery and mirrored to Supabase history.',
        job_id: bigQueryJobId,
        bigquery_table: tableName,
        bigquery_photo_id: stockRecord.photo_id,
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
  }
}
