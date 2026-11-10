import { NextRequest, NextResponse } from 'next/server'

import { parseSection } from '../../../../lib/sections'
import { addDays, buildSalesTrend } from '../../../../lib/report-records'
import { getAuthContext } from '../../../../lib/supabase/route-auth'

export const runtime = 'nodejs'

/** How far back to look for the first day's baseline closing (a skipped week still works). */
const BASELINE_LOOKBACK_DAYS = 14

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
}

/**
 * Units sold per day for the `days` days ending on `end` (Home screen chart).
 * Same formula as the Daily Report: closing against the latest earlier closing, plus stock in.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) return auth

  const sectionParam = request.nextUrl.searchParams.get('section')
  const section = sectionParam === null ? 'fruit' : parseSection(sectionParam)
  if (!section) {
    return NextResponse.json({ error: 'section must be "fruit" or "vegies".' }, { status: 400 })
  }

  const end = request.nextUrl.searchParams.get('end') ?? ''
  const days = Number(request.nextUrl.searchParams.get('days') ?? '7')
  if (!isValidDate(end) || !Number.isInteger(days) || days < 1 || days > 31) {
    return NextResponse.json({ error: 'end must be YYYY-MM-DD and days 1 to 31.' }, { status: 400 })
  }

  const start = addDays(end, -(days - 1))
  const lookbackStart = addDays(start, -BASELINE_LOOKBACK_DAYS)

  const [closingResult, stockInResult] = await Promise.all([
    auth.supabase
      .from('event_stock_check')
      .select('date, item_data')
      .eq('mode', 'closing_check')
      .eq('section', section)
      .gte('date', lookbackStart)
      .lte('date', end)
      .order('date', { ascending: true }),
    auth.supabase
      .from('event_generate')
      .select('final_output, log_time')
      .eq('stock_mode', 'arrival_entry')
      .eq('section', section)
      .gte('final_output->>stock_date', start)
      .lte('final_output->>stock_date', end),
  ])

  const error = closingResult.error ?? stockInResult.error
  if (error) {
    return NextResponse.json({ error: 'Failed to load the sales trend.', details: error.message }, { status: 400 })
  }

  const stockIns = (stockInResult.data ?? [])
    .map((row) => ({
      stock_date: String((row.final_output as { stock_date?: unknown } | null)?.stock_date ?? ''),
      final_output: row.final_output,
      log_time: row.log_time ?? null,
    }))
    .filter((row) => isValidDate(row.stock_date))

  const trend = buildSalesTrend({
    start,
    end,
    closings: (closingResult.data ?? []).map((row) => ({ date: row.date, item_data: row.item_data })),
    stockIns,
  })

  return NextResponse.json({ start, end, days: trend }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
