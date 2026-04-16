import { NextResponse } from 'next/server'
import { buildStockCheckRecordName } from '../../../../lib/record-names'
import { getAuthContext } from '../../../../lib/supabase/route-auth'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import { buildSupabaseStockCheckUpsertRow, toSupabaseMirrorItemData } from '../../../../lib/stock-check-save'
import {
  buildSnowflakeStagingRecord,
  saveToSnowflakeEnvelopeSchema,
} from '../../../../lib/stock-schema'

export const runtime = 'nodejs'

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

  const parsed = saveToSnowflakeEnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const stockRecord = buildSnowflakeStagingRecord({
    parsedData: parsed.data.data,
    validated: parsed.data.validated,
    unknownItems: parsed.data.unknown_items,
    missingCatalogItems: parsed.data.missing_catalog_items,
    forcedValidated: 'yes',
  })
  const recordName = buildStockCheckRecordName(stockRecord.stock_date)
  const mirrorItemData = toSupabaseMirrorItemData(stockRecord)

  try {
    const supabase = createSupabaseServerClient()
    const upsertRow = buildSupabaseStockCheckUpsertRow({
      userId: authContext.user.id,
      stockDate: stockRecord.stock_date,
      itemData: mirrorItemData,
    })

    const { data, error } = await supabase
      .from('event_stock_check')
      .upsert(upsertRow, { onConflict: 'user_id,date,mode' })
      .select('uid_stock_check, created_at, record_name')
      .single()

    if (error) {
      console.error('Supabase upsert error:', error)
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(
      {
        success: true,
        uid_stock_check: data.uid_stock_check,
        created_at: data.created_at,
        record_name: data.record_name ?? recordName,
        message: 'Stock check saved to Supabase.',
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('Error saving stock check to Supabase:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save stock check',
      },
      { status: 500 },
    )
  }
}
