import type { SupabaseClient } from '@supabase/supabase-js'

function mapToStockEventMode(mode: 'stock-in' | 'stock-closing') {
  return mode === 'stock-closing' ? 'closing_check' : 'arrival_entry'
}

type UserContext = {
  userId: string
}

export async function logGenerateEvent(
  supabase: SupabaseClient,
  input: {
    user: UserContext
    inputFileName: string
    catalogVersion: string
    outputFromModel: unknown
    finalOutput: unknown
    edited: boolean
    stockMode: 'stock-in' | 'stock-closing'
  }
) {
  const payload = {
    user_id: input.user.userId,
    input_file_name: input.inputFileName,
    catalog_version: input.catalogVersion,
    output_from_model: input.outputFromModel,
    final_output: input.finalOutput,
    edited: input.edited,
    stock_mode: mapToStockEventMode(input.stockMode),
  }

  return supabase.from('event_generate').insert(payload).select('uid_generate').single()
}

export async function logStockInputEvent(
  supabase: SupabaseClient,
  input: {
    user: UserContext
    mode: 'closing_check' | 'arrival_entry'
    date: string
    itemData: unknown
  }
) {
  return supabase.from('event_stock_check').insert({
    user_id: input.user.userId,
    date: input.date,
    mode: input.mode,
    item_data: input.itemData,
  })
}

export async function logCatalogSaveEvent(
  supabase: SupabaseClient,
  input: {
    user: UserContext
    csvData: string
    catalogVersion: string | null
  }
) {
  return supabase.from('event_catalog_save').insert({
    user_id: input.user.userId,
    csv_data: input.csvData,
    catalog_version: input.catalogVersion,
  })
}

export async function logPushToSnowflakeEvent(
  supabase: SupabaseClient,
  input: {
    user: UserContext
    uidGenerate: string | null
  }
) {
  return supabase.from('event_push').insert({
    user_id: input.user.userId,
    uid_generate: input.uidGenerate,
  })
}
