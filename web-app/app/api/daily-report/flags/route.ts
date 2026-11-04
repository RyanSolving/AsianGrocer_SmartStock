import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { stockFlags } from '../../../../lib/report-insights'
import { isMissingTableError } from '../../../../lib/supabase/errors'
import { getAuthContext } from '../../../../lib/supabase/route-auth'

export const runtime = 'nodejs'

/**
 * Sets one item's stock flag on one report date (BUSINESS_RULES.md §3b).
 * - `flag: 'auto'` removes the override, so the calculated flag shows again.
 * - `flag: null` removes the badge.
 * - any other flag replaces the calculated one.
 */
const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  code: z.string().trim().min(1).max(64),
  flag: z.union([z.literal('auto'), z.null(), z.enum(stockFlags)]),
})

export async function POST(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) return auth

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid flag change.', details: parsed.error.flatten() }, { status: 400 })
  }

  const { date, code, flag } = parsed.data
  const table = auth.supabase.from('report_flag_override')

  const { error } = flag === 'auto'
    ? await table.delete().eq('user_id', auth.user.id).eq('report_date', date).eq('item_code', code)
    : await table.upsert(
      { user_id: auth.user.id, report_date: date, item_code: code, flag, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,report_date,item_code' },
    )

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error: 'Badge changes are not set up yet.',
          details: 'Run the Supabase migration 20261104_report_flag_overrides.sql, then try again.',
        },
        { status: 501 },
      )
    }
    return NextResponse.json({ error: 'Could not save the badge.', details: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, date, code, flag })
}
