import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logStockInputEvent } from '../../../lib/supabase/events'
import { getAuthContext } from '../../../lib/supabase/route-auth'

const stockInputSchema = z.object({
  date: z.string().date(),
  mode: z.enum(['closing_check', 'arrival_entry']),
  item_data: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]),
})

export async function POST(request: Request) {
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

  const parsed = stockInputSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const insert = await logStockInputEvent(auth.supabase, {
    user: {
      userId: auth.user.id,
    },
    mode: parsed.data.mode,
    date: parsed.data.date,
    itemData: parsed.data.item_data,
  })

  if (insert.error) {
    return NextResponse.json(
      {
        error: 'Failed to save stock input event.',
        details: insert.error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Stock input event saved.' }, { status: 201 })
}
