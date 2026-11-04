import { NextRequest, NextResponse } from 'next/server'

import { getAuthContext } from '../../../lib/supabase/route-auth'
import { isMissingTableError } from '../../../lib/supabase/errors'
import { combineStockInByDate, combineStockInRecords, readClosingItems } from '../../../lib/report-records'

export const runtime = 'nodejs'

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  const requested = request.nextUrl.searchParams.get('date') ?? ''
  const today = request.nextUrl.searchParams.get('today') ?? ''
  const wantsLatest = requested === 'latest'
  if (wantsLatest ? !isValidDate(today) : !isValidDate(requested) || (today !== '' && !isValidDate(today))) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD, or "latest" with today=YYYY-MM-DD.' }, { status: 400 })
  }

  try {
    // date=latest: the newest closing up to today that has an earlier closing to compare with
    // (same rule as latestReportDate), so Home needs one request instead of two.
    let date = requested
    if (wantsLatest) {
      const { data: recent, error: recentError } = await auth.supabase
        .from('event_stock_check')
        .select('date')
        .eq('mode', 'closing_check')
        .lte('date', today)
        .order('date', { ascending: false })
        .limit(2)
      if (recentError) {
        return NextResponse.json({ error: 'Failed to find the latest report.', details: recentError.message }, { status: 400 })
      }
      const dates = (recent ?? []).map((row) => String(row.date))
      date = dates.length >= 2 ? dates[0] : (dates[0] ?? today)
    }

    // Stock in saved after this closing, up to today, counts toward current stock until the
    // next closing is saved (then that closing already includes it).
    const lookAhead = today !== '' && today > date
    const [closingResult, prevClosingResult, stockInResult, overrideResult, laterClosingResult, laterStockInResult] = await Promise.all([
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data, record_name, created_at')
        .eq('mode', 'closing_check')
        .eq('date', date)
        .limit(1)
        .maybeSingle(),
      // Latest closing before the requested date (not strictly date-1, so missed days still work).
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data, record_name, created_at')
        .eq('mode', 'closing_check')
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      auth.supabase
        .from('event_generate')
        .select('uid_generate, final_output, log_time, record_name, input_file_name')
        .eq('stock_mode', 'arrival_entry')
        .eq('final_output->>stock_date', date)
        .order('log_time', { ascending: false }),
      auth.supabase
        .from('report_flag_override')
        .select('item_code, flag, updated_at')
        .eq('report_date', date),
      lookAhead
        ? auth.supabase
          .from('event_stock_check')
          .select('date')
          .eq('mode', 'closing_check')
          .gt('date', date)
          .lte('date', today)
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      lookAhead
        ? auth.supabase
          .from('event_generate')
          .select('uid_generate, final_output, log_time, record_name, input_file_name')
          .eq('stock_mode', 'arrival_entry')
          .gt('final_output->>stock_date', date)
          .lte('final_output->>stock_date', today)
        : Promise.resolve({ data: [], error: null }),
    ])

    const firstError = closingResult.error ?? prevClosingResult.error ?? stockInResult.error
      ?? laterClosingResult.error ?? laterStockInResult.error
    if (firstError) {
      return NextResponse.json(
        { error: 'Failed to load daily report data.', details: firstError.message },
        { status: 400 },
      )
    }

    const closing = closingResult.data ? readClosingItems(closingResult.data.item_data) : null
    const prevClosing = prevClosingResult.data ? readClosingItems(prevClosingResult.data.item_data) : null

    // Several Stock In records for one date: the latest main record (earlier ones are
    // re-saves and would double count) plus every record saved as an extra delivery.
    const stockInRecords = stockInResult.data ?? []
    const combinedStockIn = combineStockInRecords(stockInRecords)
    const stockInByCode = combinedStockIn.quantities
    const latestStockIn = combinedStockIn.main ?? combinedStockIn.extras[0] ?? null

    // Only while this is the newest closing; stock in on or after a later closing's date
    // belongs to that day's report instead.
    const nextClosingDate: string | null = laterClosingResult.data?.date ? String(laterClosingResult.data.date) : null
    const arrived = nextClosingDate === null
      ? combineStockInByDate(laterStockInResult.data ?? [], (record) => {
        const value = (record.final_output as { stock_date?: unknown } | null)?.stock_date
        return typeof value === 'string' ? value : null
      })
      : { quantities: {}, dates: [] as string[] }

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
        stockInExtraCount: combinedStockIn.extras.length,
        stockInReplacedCount: combinedStockIn.replacedCount,
        stockInByCode,
        // True when no later closing exists up to today: the sheet then shows current stock.
        isLatestClosing: today === '' ? null : nextClosingDate === null,
        arrivedSinceByCode: arrived.quantities,
        arrivedSinceDates: arrived.dates,
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
