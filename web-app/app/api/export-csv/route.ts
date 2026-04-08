import { NextResponse } from 'next/server'

import type { ParsedStock } from '../../../lib/stock-schema'
import { parsedStockSchema } from '../../../lib/stock-schema'

function escapeCsv(value: string) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function toCsv(data: ParsedStock) {
  const header = [
    'Date',
    'Location',
    'Sub-location',
    'Category',
    'Product',
    'Attribute',
    'Official Name',
    'Name on Stocklist',
    'Navigation Guide',
    'Quantity',
    'Confidence',
    'Note',
  ].join(',')

  const rows = data.items.map((item) =>
    [
      data.stock_date,
      item.location,
      item.sub_location,
      item.category,
      item.product,
      item.attribute,
      item.official_name,
      item.stocklist_name ?? item.product_raw,
      item.navigation_guide ?? '',
      item.quantity === null ? '' : String(item.quantity),
      item.confidence,
      item.notes ?? '',
    ]
      .map((value) => escapeCsv(value))
      .join(',')
  )

  return [header, ...rows].join('\n')
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = parsedStockSchema.safeParse(payload)
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
      'Content-Disposition': `attachment; filename="stock-${parsed.data.photo_id}.csv"`,
    },
  })
}
