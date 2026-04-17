import { NextRequest, NextResponse } from 'next/server'

import { fetchDashboardStockLevels } from '../../../../lib/dashboard-analytics'
import { getAuthContext } from '../../../../lib/supabase/route-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  const date = request.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const location = request.nextUrl.searchParams.get('location')
  const category = request.nextUrl.searchParams.get('category')

  try {
    const payload = await fetchDashboardStockLevels({ date, location, category })

    if ('error' in payload) {
      return NextResponse.json(payload, { status: 501 })
    }

    return NextResponse.json(payload, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load dashboard stock level data.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
