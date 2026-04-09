import { NextResponse } from 'next/server'

import { getAuthContext } from '../../../../lib/supabase/route-auth'

type StockCheckEvent = {
  uid_stock_check: string
  created_at: string
  date: string
  mode: string
  item_data: {
    items?: unknown[]
    unknown_items?: unknown[]
    validated?: boolean
  } | null
}

export async function GET() {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  try {
    const { data, error } = await auth.supabase
      .from('event_stock_check')
      .select('uid_stock_check, created_at, date, mode, item_data')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to fetch stock check history.',
          details: error.message,
        },
        { status: 400 }
      )
    }

    const history = (data as StockCheckEvent[] | null ?? []).map((entry) => {
      const items = Array.isArray(entry.item_data?.items) ? entry.item_data?.items : []
      const unknownItems = Array.isArray(entry.item_data?.unknown_items) ? entry.item_data?.unknown_items : []
      const validated = Boolean(entry.item_data?.validated)

      return {
        uid_stock_check: entry.uid_stock_check,
        timestamp: entry.created_at,
        stock_date: entry.date,
        mode: entry.mode,
        validated,
        item_count: items.length,
        unknown_count: unknownItems.length,
      }
    })

    return NextResponse.json({
      history,
      count: history.length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
