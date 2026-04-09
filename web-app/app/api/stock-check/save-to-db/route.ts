import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '../../../../lib/supabase/route-auth'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'

const stockCheckPayloadSchema = z.object({
  date: z.string(),
  items: z.array(
    z.object({
      code: z.string(),
      product: z.string(),
      category: z.string(),
      location: z.string(),
      sub_location: z.string(),
      official_name: z.string(),
      stocklist_name: z.string(),
      quantity: z.number().nullable(),
      red_marked: z.boolean(),
      notes: z.string(),
    })
  ),
  unknown_items: z.array(
    z.object({
      user_input: z.string(),
      quantity: z.number().nullable(),
      red_marked: z.boolean(),
      notes: z.string(),
    })
  ).optional(),
  validated: z.boolean(),
  export_format: z.enum(['csv', 'pdf', 'image']).optional(),
})

export async function POST(request: Request) {
  // Check authentication
  const authContext = await getAuthContext()
  if (authContext instanceof NextResponse) {
    return authContext
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = stockCheckPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  try {
    const supabase = createSupabaseServerClient()

    // Insert into event_stock_check table
    const { data, error } = await supabase
      .from('event_stock_check')
      .insert({
        user_id: authContext.user.id,
        date: parsed.data.date,
        mode: 'closing_check', // Default mode; could be made dynamic
        item_data: {
          items: parsed.data.items,
          unknown_items: parsed.data.unknown_items ?? [],
          validated: parsed.data.validated,
          export_format: parsed.data.export_format,
        },
      })
      .select('uid_stock_check, created_at')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      throw new Error(error.message)
    }

    return NextResponse.json(
      {
        success: true,
        uid_stock_check: data.uid_stock_check,
        created_at: data.created_at,
        message: 'Stock check saved successfully',
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error saving stock check:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save stock check',
      },
      { status: 500 }
    )
  }
}
