import { NextResponse } from 'next/server'

import {
  getMissingBigQueryEnvKeys,
  getRawStockTableName,
  queryBigQueryRows,
} from '../../../../lib/bigquery/warehouse'
import { getAuthContext } from '../../../../lib/supabase/route-auth'

type StockCheckEvent = {
  uid_stock_check: string
  created_at: string
  date: string
  record_name?: string | null
  mode: string
  item_data: {
    items?: unknown[]
    unknown_items?: unknown[]
    validated?: boolean
  } | null
}

type StockCheckHistoryItem = {
  uid_stock_check: string
  timestamp: string
  stock_date: string
  record_name?: string | null
  mode: string
  validated: boolean
  item_count: number
  unknown_count: number
  record_data: {
    items: Array<{
      code: string
      product: string
      category: string
      location: string
      sub_location: string
      origin: string
      inner_quantity: number | null
      inner_unit: string
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
}

function normalizeNotes(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function stripRedMarkedTag(note: string) {
  return note.replace(/\s*\|\s*red_marked=true/gi, '').trim()
}

function parseQuantity(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const next = Number(value)
    return Number.isFinite(next) ? next : null
  }
  return null
}

function toSupabaseRecordData(itemData: StockCheckEvent['item_data']) {
  const items = Array.isArray(itemData?.items) ? itemData.items : []
  const unknownItems = Array.isArray(itemData?.unknown_items) ? itemData.unknown_items : []

  return {
    items: items
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const note = normalizeNotes(row.notes)
        return {
          code: String(row.code ?? ''),
          product: String(row.product ?? ''),
          category: String(row.category ?? ''),
          location: String(row.location ?? 'Unknown'),
          sub_location: String(row.sub_location ?? 'Unknown'),
          origin: String(row.origin ?? ''),
          inner_quantity: parseQuantity(row.inner_quantity),
          inner_unit: String(row.inner_unit ?? 'box'),
          official_name: String(row.official_name ?? row.product ?? ''),
          stocklist_name: String(row.stocklist_name ?? row.official_name ?? row.product ?? ''),
          quantity: parseQuantity(row.quantity),
          red_marked: Boolean(row.red_marked),
          notes: note,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item?.official_name || item?.code)),
    unknown_items: unknownItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const note = normalizeNotes(row.notes)
        return {
          user_input: String(row.user_input ?? row.official_name ?? ''),
          quantity: parseQuantity(row.quantity),
          red_marked: Boolean(row.red_marked),
          notes: note,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item?.user_input)),
    validated: Boolean(itemData?.validated),
  }
}

function toWarehouseRecordData(itemData: unknown[], validated: boolean) {
  const items: StockCheckHistoryItem['record_data']['items'] = []
  const unknownItems: StockCheckHistoryItem['record_data']['unknown_items'] = []

  for (const rawItem of itemData) {
    if (!rawItem || typeof rawItem !== 'object') continue

    const row = rawItem as Record<string, unknown>
    const note = normalizeNotes(row.notes)
    const redMarked = /(^|\|)\s*red_marked=true\s*$/i.test(note) || note.toLowerCase().includes('red_marked=true')
    const cleanNote = stripRedMarkedTag(note)
    const code = row.catalog_code

    if (code === null || code === undefined || String(code).trim().length === 0) {
      const userInput = String(row.official_name ?? row.product_raw ?? row.product ?? '').trim()
      if (userInput.length === 0) continue

      unknownItems.push({
        user_input: userInput,
        quantity: parseQuantity(row.quantity),
        red_marked: redMarked,
        notes: cleanNote,
      })
      continue
    }

    items.push({
      code: String(code),
      product: String(row.product ?? row.product_raw ?? ''),
      category: String(row.category ?? ''),
      location: String(row.location ?? 'Unknown'),
      sub_location: String(row.sub_location ?? 'Unknown'),
      origin: String(row.origin ?? ''),
      inner_quantity: parseQuantity(row.inner_quantity),
      inner_unit: String(row.inner_unit ?? 'box'),
      official_name: String(row.official_name ?? row.product_raw ?? row.product ?? ''),
      stocklist_name: String(row.stocklist_name ?? row.official_name ?? row.product_raw ?? row.product ?? ''),
      quantity: parseQuantity(row.quantity),
      red_marked: redMarked,
      notes: cleanNote,
    })
  }

  return {
    items,
    unknown_items: unknownItems,
    validated,
  }
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

function parseWarehouseItemData(raw: unknown) {
  const value = unwrapBigQueryValue(raw)
  if (Array.isArray(value)) return value

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  return []
}

function formatBigQueryDate(value: unknown) {
  const unwrapped = unwrapBigQueryValue(value)
  if (typeof unwrapped === 'string') return unwrapped.slice(0, 10)
  if (unwrapped instanceof Date) return unwrapped.toISOString().slice(0, 10)
  return ''
}

function formatBigQueryTimestamp(value: unknown) {
  const unwrapped = unwrapBigQueryValue(value)
  if (typeof unwrapped === 'string') return unwrapped
  if (unwrapped instanceof Date) return unwrapped.toISOString()
  return new Date().toISOString()
}

async function fetchBigQueryHistory(): Promise<StockCheckHistoryItem[]> {
  const missingEnv = getMissingBigQueryEnvKeys()
  if (missingEnv.length > 0) {
    return []
  }

  const tableName = getRawStockTableName()
  const rows = await queryBigQueryRows(
    `
      SELECT
        photo_id,
        upload_date,
        stock_date,
        mode,
        validated,
        item_data
      FROM ${tableName}
      WHERE mode = @mode
        AND STARTS_WITH(photo_id, @photo_prefix)
      ORDER BY upload_date DESC
      LIMIT 200
    `,
    {
      mode: 'stock-closing',
      photo_prefix: 'stock-check-',
    },
  )

  return rows.map((row) => {
    const itemData = parseWarehouseItemData(rowValue(row, 'item_data'))
    const unknownCount = itemData.filter((item) => {
      if (!item || typeof item !== 'object') return false
      return (item as { catalog_code?: unknown }).catalog_code === null
    }).length

    const validated = String(rowValue(row, 'validated') ?? '').toLowerCase() === 'yes'

    return {
      uid_stock_check: String(rowValue(row, 'photo_id') ?? ''),
      timestamp: formatBigQueryTimestamp(rowValue(row, 'upload_date')),
      stock_date: formatBigQueryDate(rowValue(row, 'stock_date')),
      record_name: null,
      mode: String(rowValue(row, 'mode') ?? 'closing_check'),
      validated,
      item_count: itemData.length,
      unknown_count: unknownCount,
      record_data: toWarehouseRecordData(itemData, validated),
    }
  }).filter((entry) => entry.uid_stock_check.length > 0)
}

function mapSupabaseHistory(data: StockCheckEvent[] | null) {
  return (data ?? []).map((entry) => {
    const normalized = toSupabaseRecordData(entry.item_data)

    return {
      uid_stock_check: entry.uid_stock_check,
      timestamp: entry.created_at,
      stock_date: entry.date,
      record_name: entry.record_name ?? null,
      mode: entry.mode,
      validated: normalized.validated,
      item_count: normalized.items.length,
      unknown_count: normalized.unknown_items.length,
      record_data: normalized,
    }
  })
}

export async function GET() {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  try {
    const { data, error } = await auth.supabase
      .from('event_stock_check')
      .select('uid_stock_check, created_at, date, record_name, mode, item_data')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      const bigQueryHistory = await fetchBigQueryHistory()
      return NextResponse.json({
        history: bigQueryHistory,
        count: bigQueryHistory.length,
        source: 'bigquery-fallback',
        warning: `Supabase history unavailable: ${error.message}`,
      })
    }

    const supabaseHistory = mapSupabaseHistory(data as StockCheckEvent[] | null)
    if (supabaseHistory.length > 0) {
      return NextResponse.json({
        history: supabaseHistory,
        count: supabaseHistory.length,
        source: 'supabase',
      })
    }

    const bigQueryHistory = await fetchBigQueryHistory()

    return NextResponse.json({
      history: bigQueryHistory,
      count: bigQueryHistory.length,
      source: 'bigquery-fallback',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
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

  const uidStockCheck =
    payload && typeof payload === 'object' && typeof (payload as { uid_stock_check?: unknown }).uid_stock_check === 'string'
      ? (payload as { uid_stock_check: string }).uid_stock_check.trim()
      : ''

  if (!uidStockCheck) {
    return NextResponse.json({ error: 'uid_stock_check is required.' }, { status: 400 })
  }

  try {
    const { error } = await auth.supabase
      .from('event_stock_check')
      .delete()
      .eq('uid_stock_check', uidStockCheck)
      .eq('user_id', auth.user.id)

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to delete stock-check history record.',
          details: error.message,
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ success: true, uid_stock_check: uidStockCheck })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
