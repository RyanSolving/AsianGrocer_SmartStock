import { NextResponse } from 'next/server'

import {
  ensureRawStockTableExists,
  getMissingBigQueryEnvKeys,
  getRawStockTableName,
  insertRawStockRecord,
} from '../../../lib/bigquery/warehouse'
import { normalizeSellPrice, type SellPrice } from '../../../lib/stock-price'
import { applyCatalogPriceChanges, collectPriceChanges, type PricedLine } from '../../../lib/catalog-prices'
import { buildManualEntryRecordName } from '../../../lib/record-names'
import { parseSection, sectionOfItems, type Section } from '../../../lib/sections'
import { getAuthContext } from '../../../lib/supabase/route-auth'
import { logPushToBigQueryEvent } from '../../../lib/supabase/events'
import {
  buildWarehouseStagingRecord,
  parsedStockSchema,
  saveToWarehouseEnvelopeSchema,
  stockModeSchema,
} from '../../../lib/stock-schema'

export const runtime = 'nodejs'

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

  const isRepush = payload && typeof payload === 'object' && 'uid_generate' in payload && !('data' in payload)
  let uidGenerate: string | null = null
  let parsedData: ReturnType<typeof parsedStockSchema.parse>
  let validated: 'yes' | 'no' = 'no'
  let unknownItems: unknown[] = []
  let missingCatalogItems: unknown[] = []
  let requestedSection: Section | null = null

  if (isRepush) {
    uidGenerate = typeof (payload as any).uid_generate === 'string' ? (payload as any).uid_generate : null
    if (typeof uidGenerate !== 'string' || !uidGenerate) {
      return NextResponse.json(
        {
          error: 'Invalid or missing uid_generate for re-push.',
        },
        { status: 400 },
      )
    }

    const { data: eventData, error: eventError } = await auth.supabase
      .from('event_generate')
      .select('final_output, section')
      .eq('uid_generate', uidGenerate)
      .single()

    if (eventError || !eventData) {
      return NextResponse.json(
        {
          error: 'Failed to fetch original transcription data for re-push.',
          details: eventError?.message,
        },
        { status: 404 },
      )
    }

    const finalOutput = eventData.final_output
    const parsed = parsedStockSchema.safeParse(finalOutput)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Original transcription data validation failed.',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    parsedData = parsed.data
    validated = 'yes'
    requestedSection = parseSection((eventData as { section?: unknown }).section)
  } else {
    const envelope = saveToWarehouseEnvelopeSchema.safeParse(payload)
    if (!envelope.success) {
      return NextResponse.json(
        {
          error: 'Payload validation failed.',
          details: envelope.error.flatten(),
        },
        { status: 400 },
      )
    }

    parsedData = envelope.data.data
    validated = envelope.data.validated === 'yes' ? 'yes' : 'no'
    unknownItems = envelope.data.unknown_items
    missingCatalogItems = envelope.data.missing_catalog_items
    uidGenerate = typeof envelope.data.uid_generate === 'string' && envelope.data.uid_generate.length > 0
      ? envelope.data.uid_generate
      : null
    requestedSection = envelope.data.section ?? null
  }

  if (persistOnly) {
    const stagedRecord = buildWarehouseStagingRecord({
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
      ...(parsedData.extra_delivery ? { extra_delivery: true } : {}),
    })

    let savedUidGenerate = uidGenerate

    // On a re-save, the prices this record put in the catalog the last time it was saved.
    const previouslySaved = new Map<string, SellPrice>()
    if (savedUidGenerate && stagedRecord.mode === 'stock-in') {
      try {
        const { data: previous } = await auth.supabase
          .from('event_generate')
          .select('final_output')
          .eq('uid_generate', savedUidGenerate)
          .maybeSingle()
        const oldItems = (previous as { final_output?: { items?: unknown[] } } | null)?.final_output?.items
        for (const raw of Array.isArray(oldItems) ? oldItems : []) {
          const old = raw as { catalog_code?: string | null; sell?: unknown }
          const code = old?.catalog_code?.trim()
          if (code && old.sell) previouslySaved.set(code, normalizeSellPrice(old.sell as Record<string, unknown>))
        }
      } catch {
        // Without it a corrected re-save may leave the catalog price as it was; the save itself goes on.
      }
    }

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
        .select('uid_generate')

      if (updateGenerateError) {
        return NextResponse.json(
          {
            error: 'Failed to save draft to Supabase.',
            details: updateGenerateError.message,
          },
          { status: 500 },
        )
      }

      if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          {
            error: 'Save blocked by database policy. The record may belong to another user, or the UPDATE policy is missing. Run the latest RLS migration in Supabase.',
            uid_generate: savedUidGenerate,
          },
          { status: 403 },
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
          section: requestedSection ?? sectionOfItems(stagedRecord.item_data.filter((item) => item.catalog_code).map((item) => ({ location: item.location }))),
        })
        .select('uid_generate')
        .single()

      if (insertGenerateError) {
        return NextResponse.json(
          {
            error: 'Failed to create manual draft in Supabase.',
            details: insertGenerateError.message,
          },
          { status: 500 },
        )
      }

      savedUidGenerate = insertedGenerate?.uid_generate ?? null
    }

    // A price changed on this delivery becomes the catalog price (BUSINESS_RULES.md §1d).
    const appliedPriceChanges = stagedRecord.mode === 'stock-in'
      ? await applyCatalogPriceChanges(auth.supabase, collectPriceChanges(stagedRecord.item_data as PricedLine[]), previouslySaved)
      : []

    return NextResponse.json(
      {
        success: true,
        uid_generate: savedUidGenerate,
        catalog_prices_updated: appliedPriceChanges.length,
        message: 'Saved to Supabase. You can keep editing before loading to BigQuery.',
      },
      { status: 200 },
    )
  }

  // Vegies are not sent to the warehouse (BigQuery); their records live in Supabase only.
  if (requestedSection === 'vegies') {
    return NextResponse.json(
      { success: true, skipped: true, section: 'vegies', message: 'Vegies are not sent to the warehouse.' },
      { status: 200 },
    )
  }

  const missingEnvKeys = getMissingBigQueryEnvKeys()
  if (missingEnvKeys.length > 0) {
    return NextResponse.json(
      {
        error: 'BigQuery environment variables are not fully configured.',
        missing: missingEnvKeys,
        accepted: parsedData,
      },
      { status: 501 },
    )
  }

  const stagedRecord = buildWarehouseStagingRecord({
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
    ...(parsedData.extra_delivery ? { extra_delivery: true } : {}),
  })

  const tableName = getRawStockTableName()

  try {
    await ensureRawStockTableExists(tableName)

    const result = await insertRawStockRecord(tableName, {
      ...stagedRecord,
      mode: stockModeSchema.parse(stagedRecord.mode),
    })

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
        .select('uid_generate')

      if (updateGenerateError) {
        historySyncWarning = updateGenerateError.message
      } else if (!updatedRows || updatedRows.length === 0) {
        historySyncWarning = 'UPDATE blocked by RLS policy (0 rows affected). Apply the consolidate_rls_policies migration in Supabase.'
      }
    }

    const pushEvent = await logPushToBigQueryEvent(auth.supabase, {
      user: {
        userId: auth.user.id,
      },
      uidGenerate,
    })

    if (pushEvent.error) {
      return NextResponse.json(
        {
          error: 'BigQuery row inserted but push event logging failed.',
          details: pushEvent.error.message,
          job_id: result.queryId,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(
      {
        message: 'BigQuery staging row inserted successfully.',
        table: tableName,
        job_id: result.queryId,
        ...(historySyncWarning
          ? {
            warning: 'Saved to BigQuery, but failed to sync edited data to transcription history.',
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
      { status: 200 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BigQuery insert failed.'
    return NextResponse.json(
      {
        error: 'BigQuery insert failed.',
        details: message,
      },
      { status: 502 },
    )
  }
}
