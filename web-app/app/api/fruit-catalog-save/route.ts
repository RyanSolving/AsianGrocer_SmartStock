import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logCatalogSaveEvent } from '../../../lib/supabase/events'
import { getAuthContext } from '../../../lib/supabase/route-auth'

const catalogSaveSchema = z.object({
  csv_data: z.string().min(1),
  catalog_version: z.string().min(1).nullable().optional(),
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

  const parsed = catalogSaveSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const insert = await logCatalogSaveEvent(auth.supabase, {
    user: {
      userId: auth.user.id,
    },
    csvData: parsed.data.csv_data,
    catalogVersion: parsed.data.catalog_version ?? null,
  })

  if (insert.error) {
    return NextResponse.json(
      {
        error: 'Failed to save catalog event.',
        details: insert.error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Catalog save event logged.' }, { status: 201 })
}
