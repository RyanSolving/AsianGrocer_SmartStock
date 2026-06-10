import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '../../../../lib/supabase/route-auth'

const stockCheckPayloadSchema = z.object({
  date: z.string(),
  items: z.array(
    z.object({
      code: z.string(),
      product: z.string(),
      category: z.string(),
      location: z.string(),
      sub_location: z.string(),
      origin: z.string().default(''),
      inner_quantity: z.number().nullable().default(null),
      inner_unit: z.enum(['box', 'bag', 'punnet', 'piece', 'tray', 'bunch', 'pack']).default('box'),
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

function escapeCsv(value: string) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function toCsv(payload: z.infer<typeof stockCheckPayloadSchema>) {
  const header = [
    'Item Code',
    'Product',
    'Category',
    'Location',
    'Sub-location',
    'Origin',
    'Inner Quantity',
    'Inner Unit',
    'Official Name',
    'Quantity',
    'Red Marked',
    'Notes',
    'Date',
    'Validated',
  ].join(',')

  const itemRows = payload.items.map(item =>
    [
      item.code,
      item.product,
      item.category,
      item.location,
      item.sub_location,
      item.origin,
      item.inner_quantity === null ? '' : String(item.inner_quantity),
      item.inner_unit,
      item.official_name,
      item.quantity === null ? '' : String(item.quantity),
      item.red_marked ? 'Yes' : 'No',
      item.notes,
      payload.date,
      payload.validated ? 'Yes' : 'No',
    ]
      .map(value => escapeCsv(String(value)))
      .join(',')
  )

  const unknownRows = (payload.unknown_items ?? []).map(item =>
    [
      'NEW',
      item.user_input,
      'New Item',
      'To be determined',
      'To be determined',
      '',
      '',
      '',
      item.user_input,
      item.quantity === null ? '' : String(item.quantity),
      item.red_marked ? 'Yes' : 'No',
      item.notes,
      payload.date,
      payload.validated ? 'Yes' : 'No',
    ]
      .map(value => escapeCsv(String(value)))
      .join(',')
  )

  const rows = [...itemRows, ...unknownRows]
  return [header, ...rows].join('\n')
}

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

  const csv = toCsv(parsed.data)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stock-check-${parsed.data.date}.csv"`,
    },
  })
}
