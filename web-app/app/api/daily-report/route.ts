import { NextRequest, NextResponse } from 'next/server'

import { getAuthContext } from '../../../lib/supabase/route-auth'
import { isMissingTableError } from '../../../lib/supabase/errors'
import { parseSection } from '../../../lib/sections'
import { addDays, combineStockInByDate, daysBetween, findRecentlyStockedCodes, OUT_OF_STOCK_VISIBLE_DAYS, readClosingItems, stockDateOf } from '../../../lib/report-records'

export const runtime = 'nodejs'

/** How far back the first Stock In query reaches; older gaps get a second query. */
const STOCK_IN_WINDOW_DAYS = 31

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  // One section per request; the app asks for each section it shows ("both" is two requests).
  const sectionParam = request.nextUrl.searchParams.get('section')
  const section = sectionParam === null ? 'fruit' : parseSection(sectionParam)
  if (!section) {
    return NextResponse.json({ error: 'section must be "fruit" or "vegies".' }, { status: 400 })
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
        .eq('section', section)
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
    const [closingResult, prevClosingResult, stockInResult, overrideResult, laterClosingResult, laterStockInResult, recentClosingsResult] = await Promise.all([
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data, record_name, created_at')
        .eq('mode', 'closing_check')
        .eq('section', section)
        .eq('date', date)
        .limit(1)
        .maybeSingle(),
      // Latest closing before the requested date (not strictly date-1, so missed days still work).
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data, record_name, created_at')
        .eq('mode', 'closing_check')
        .eq('section', section)
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Stock in for this report is every day after the previous closing up to this date.
      // Fetched for a month back in parallel and narrowed once the previous closing is known.
      auth.supabase
        .from('event_generate')
        .select('uid_generate, final_output, log_time, record_name, input_file_name')
        .eq('stock_mode', 'arrival_entry')
        .eq('section', section)
        .gt('final_output->>stock_date', addDays(date, -STOCK_IN_WINDOW_DAYS))
        .lte('final_output->>stock_date', date)
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
          .eq('section', section)
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
          .eq('section', section)
          .gt('final_output->>stock_date', date)
          .lte('final_output->>stock_date', today)
        : Promise.resolve({ data: [], error: null }),
      // Closings of the last days, to keep items that just ran out on the report.
      auth.supabase
        .from('event_stock_check')
        .select('date, item_data')
        .eq('mode', 'closing_check')
        .eq('section', section)
        .gte('date', addDays(date, -OUT_OF_STOCK_VISIBLE_DAYS))
        .lt('date', date),
    ])

    const firstError = closingResult.error ?? prevClosingResult.error ?? stockInResult.error
      ?? laterClosingResult.error ?? laterStockInResult.error ?? recentClosingsResult.error
    if (firstError) {
      return NextResponse.json(
        { error: 'Failed to load daily report data.', details: firstError.message },
        { status: 400 },
      )
    }

    const closing = closingResult.data ? readClosingItems(closingResult.data.item_data) : null
    const prevClosing = prevClosingResult.data ? readClosingItems(prevClosingResult.data.item_data) : null
    const prevClosingDate: string | null = prevClosingResult.data?.date ? String(prevClosingResult.data.date) : null

    // Every Stock In after the previous closing up to this date (e.g. Friday's delivery when
    // the closings are Thursday and Saturday). Without a previous closing, this date only.
    let stockInRecords = stockInResult.data ?? []
    if (prevClosingDate && prevClosingDate <= addDays(date, -STOCK_IN_WINDOW_DAYS)) {
      const older = await auth.supabase
        .from('event_generate')
        .select('uid_generate, final_output, log_time, record_name, input_file_name')
        .eq('stock_mode', 'arrival_entry')
        .eq('section', section)
        .gt('final_output->>stock_date', prevClosingDate)
        .lte('final_output->>stock_date', addDays(date, -STOCK_IN_WINDOW_DAYS))
      if (older.error) {
        return NextResponse.json({ error: 'Failed to load daily report data.', details: older.error.message }, { status: 400 })
      }
      stockInRecords = [...stockInRecords, ...(older.data ?? [])]
    }
    stockInRecords = stockInRecords.filter((record) => {
      const stockDate = stockDateOf(record)
      return stockDate !== null && (prevClosingDate ? stockDate > prevClosingDate : stockDate === date)
    })
    // Per date: the latest main record (earlier ones are re-saves and would double count)
    // plus every record saved as an extra delivery; then the dates are added together.
    const combinedStockIn = combineStockInByDate(stockInRecords, (record) => stockDateOf(record))
    const stockInByCode = combinedStockIn.quantities
    const latestStockIn = combinedStockIn.latest
    // Units sold covers every day since the previous closing; the app shows a daily average.
    const soldDays = prevClosingDate ? Math.max(1, daysBetween(prevClosingDate, date)) : 1

    // Only while this is the newest closing; stock in on or after a later closing's date
    // belongs to that day's report instead.
    const nextClosingDate: string | null = laterClosingResult.data?.date ? String(laterClosingResult.data.date) : null
    const arrived = nextClosingDate === null
      ? combineStockInByDate(laterStockInResult.data ?? [], (record) => stockDateOf(record))
      : { quantities: {}, dates: [] as string[] }

    // Had stock at a closing in the last 7 days, but is not on this closing: still listed, as out of stock.
    const recentlyStockedByCode = closing
      ? findRecentlyStockedCodes({
        date,
        closingByCode: closing.quantities,
        earlierClosings: (recentClosingsResult.data ?? []).map((row) => ({ date: String(row.date), item_data: row.item_data })),
      })
      : {}

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
        section,
        closingFound: Boolean(closingResult.data),
        closingByCode: closing?.quantities ?? {},
        redMarkedByCode: closing?.redMarked ?? {},
        prevClosingDate,
        prevClosingByCode: prevClosing?.quantities ?? {},
        stockInRecordCount: stockInRecords.length,
        stockInExtraCount: combinedStockIn.extraCount,
        stockInReplacedCount: combinedStockIn.replacedCount,
        stockInByCode,
        /** Stock dates of the Stock In records counted (after the previous closing, up to date). */
        stockInDates: combinedStockIn.dates,
        /** Days units sold covers: from the previous closing to this one (1 when consecutive). */
        soldDays,
        // True when no later closing exists up to today: the sheet then shows current stock.
        isLatestClosing: today === '' ? null : nextClosingDate === null,
        arrivedSinceByCode: arrived.quantities,
        arrivedSinceDates: arrived.dates,
        /** Code -> last closing date with stock, for items that ran out in the last 7 days. */
        recentlyStockedByCode,
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
              date: stockDateOf(latestStockIn) ?? date,
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
