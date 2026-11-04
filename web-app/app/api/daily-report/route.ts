import { NextRequest, NextResponse } from 'next/server'

import { getAuthContext } from '../../../lib/supabase/route-auth'
import { isMissingTableError } from '../../../lib/supabase/errors'
import { readClosingItems, readStockInItems } from '../../../lib/report-records'

export const runtime = 'nodejs'

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  try {
    const [closingResult, prevClosingResult, stockInResult, overrideResult] = await Promise.all([
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data, record_name, created_at')
        .eq('user_id', auth.user.id)
        .eq('mode', 'closing_check')
        .eq('date', date)
        .limit(1)
        .maybeSingle(),
      // Latest closing before the requested date (not strictly date-1, so missed days still work).
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data, record_name, created_at')
        .eq('user_id', auth.user.id)
        .eq('mode', 'closing_check')
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      auth.supabase
        .from('event_generate')
        .select('uid_generate, final_output, log_time, record_name, input_file_name')
        .eq('user_id', auth.user.id)
        .eq('stock_mode', 'arrival_entry')
        .eq('final_output->>stock_date', date)
        .order('log_time', { ascending: false }),
      auth.supabase
        .from('report_flag_override')
        .select('item_code, flag, updated_at')
        .eq('user_id', auth.user.id)
        .eq('report_date', date),
    ])

    const firstError = closingResult.error ?? prevClosingResult.error ?? stockInResult.error
    if (firstError) {
      return NextResponse.json(
        { error: 'Failed to load daily report data.', details: firstError.message },
        { status: 400 },
      )
    }

    const closing = closingResult.data ? readClosingItems(closingResult.data.item_data) : null
    const prevClosing = prevClosingResult.data ? readClosingItems(prevClosingResult.data.item_data) : null

    // If several stock-in records exist for the date, use the latest only (summing could
    // double-count re-saved drafts). The count is returned so the UI can warn.
    const stockInRecords = stockInResult.data ?? []
    const stockInByCode = stockInRecords.length > 0 ? readStockInItems(stockInRecords[0].final_output) : {}
    const latestStockIn = stockInRecords[0] ?? null

    // Overrides are optional: before the migration runs, the report still works without them.
    const overridesAvailable = !isMissingTableError(overrideResult.error)
    if (overrideResult.error && overridesAvailable) {
      console.error('Failed to load report flag overrides:', overrideResult.error.message)
    }
    const flagOverrides: Record<string, { flag: string | null; updatedAt: string }> = {}
    for (const row of overrideResult.error ? [] : overrideResult.data ?? []) {
      if (typeof row.item_code === 'string' && row.item_code.trim()) {
        flagOverrides[row.item_code.trim()] = { flag: row.flag ?? null, updatedAt: row.updated_at }
      }
    }

    return NextResponse.json(
      {
        date,
        closingFound: Boolean(closingResult.data),
        closingByCode: closing?.quantities ?? {},
        redMarkedByCode: closing?.redMarked ?? {},
        prevClosingDate: prevClosingResult.data?.date ?? null,
        prevClosingByCode: prevClosing?.quantities ?? {},
        stockInRecordCount: stockInRecords.length,
        stockInByCode,
        // Which saved records these figures come from, for the "Sources" row.
        sources: {
          closing: closingResult.data
            ? { name: closingResult.data.record_name ?? null, date: closingResult.data.date, savedAt: closingResult.data.created_at ?? null }
            : null,
          previousClosing: prevClosingResult.data
            ? { name: prevClosingResult.data.record_name ?? null, date: prevClosingResult.data.date, savedAt: prevClosingResult.data.created_at ?? null }
            : null,
          stockIn: latestStockIn
            ? {
              name: latestStockIn.record_name ?? latestStockIn.input_file_name ?? null,
              date,
              savedAt: latestStockIn.log_time ?? null,
              uid: latestStockIn.uid_generate ?? null,
            }
            : null,
        },
        flagOverrides,
        overridesAvailable,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
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
