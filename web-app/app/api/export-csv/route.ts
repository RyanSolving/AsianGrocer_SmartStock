import { NextResponse } from 'next/server'
import { z } from 'zod'

import type { ParsedStock, StockItem } from '../../../lib/stock-schema'
import { parsedStockSchema } from '../../../lib/stock-schema'

const exportCsvBodySchema = parsedStockSchema.extend({
  unknown_items: z.array(z.record(z.unknown())).default([]),
  missing_catalog_items: z.array(z.record(z.unknown())).default([]),
})

function escapeCsv(value: string) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function toCsv(
  data: ParsedStock,
  unknownItems: Record<string, unknown>[] = [],
  missingItems: Record<string, unknown>[] = []
) {
  const header = [
    'Item Code',
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
    'Source',
  ].join(',')

  const knownRows = data.items.map((item: StockItem) =>
    [
      item.catalog_code ?? '',
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
      'known',
    ]
      .map((value) => escapeCsv(String(value)))
      .join(',')
  )

  const unknownRows = unknownItems.map((item: Record<string, unknown>) =>
    [
      '',
      data.stock_date,
      (item.location as string) ?? 'Unknown',
      (item.sub_location as string) ?? 'Unknown',
      (item.category as string) ?? 'Unknown',
      (item.product as string) ?? 'Unknown',
      (item.attribute as string) ?? '',
      (item.official_name as string) ?? 'Unknown',
      (item.product_raw as string) ?? '',
      '',
      item.quantity === null ? '' : String(item.quantity),
      (item.confidence as string) ?? 'low',
      (item.notes as string) ?? 'Unmatched item',
      'unknown',
    ]
      .map((value) => escapeCsv(String(value)))
      .join(',')
  )

  const missingRows = missingItems.map((item: Record<string, unknown>) =>
    [
      (item.code as string) ?? '',
      data.stock_date,
      (item.location as string) ?? 'Unknown',
      (item.sub_location as string) ?? 'Unknown',
      (item.category as string) ?? 'Unknown',
      (item.product as string) ?? 'Unknown',
      (item.attribute as string) ?? '',
      (item.official_name as string) ?? '',
      (item.stocklist_name as string) ?? '',
      (item.navigation_guide as string) ?? '',
      '',
      'high',
      'Missing from stocklist',
      'missing_catalog',
    ]
      .map((value) => escapeCsv(String(value)))
      .join(',')
  )

  const rows = [...knownRows, ...unknownRows, ...missingRows]

  return [header, ...rows].join('\n')
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = exportCsvBodySchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const csv = toCsv(parsed.data, parsed.data.unknown_items, parsed.data.missing_catalog_items)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stock-${parsed.data.photo_id}.csv"`,
    },
  })
}
