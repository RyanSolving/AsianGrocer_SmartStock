import type { SnowflakeStagingRecord } from './stock-schema'
import { buildStockCheckRecordName } from './record-names'

export type SupabaseStockCheckRecordData = {
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

export type SupabaseStockCheckUpsertRow = {
  user_id: string
  date: string
  record_name: string
  mode: 'closing_check'
  item_data: SupabaseStockCheckRecordData
}

export function toSupabaseMirrorItemData(stagedRecord: SnowflakeStagingRecord): SupabaseStockCheckRecordData {
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
    validated: true,
  }
}

export function buildSupabaseStockCheckUpsertRow(input: {
  userId: string
  stockDate: string
  itemData: SupabaseStockCheckRecordData
}): SupabaseStockCheckUpsertRow {
  return {
    user_id: input.userId,
    date: input.stockDate,
    record_name: buildStockCheckRecordName(input.stockDate),
    mode: 'closing_check',
    item_data: input.itemData,
  }
}
