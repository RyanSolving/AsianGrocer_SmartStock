import { NextResponse } from 'next/server'
import { z } from 'zod'

import type { ParsedStock, StockItem } from '../../../lib/stock-schema'
import { parsedStockSchema } from '../../../lib/stock-schema'
import { isEmptySellPrice, normalizeSellPrice, describeUnit } from '../../../lib/stock-price'

const exportCsvBodySchema = parsedStockSchema.extend({
  unknown_items: z.array(z.record(z.unknown())).default([]),
  missing_catalog_items: z.array(z.record(z.unknown())).default([]),
  validated: z.enum(['yes', 'no']).default('no'),
})

function escapeCsv(value: string) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

/** A price as dollars and cents for the CSV ("24.50"); empty when there is none. */
function csvPrice(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : ''
}

/** The four price columns of a row: Price, Sold By, Deals ("2 for 9.00; 3 for 12.00"), Catalog Price. */
function csvPriceColumns(sell: unknown, catalogSell: unknown) {
  const current = sell && typeof sell === 'object' ? normalizeSellPrice(sell as Record<string, unknown>) : null
  const reference = catalogSell && typeof catalogSell === 'object' ? normalizeSellPrice(catalogSell as Record<string, unknown>) : null
  const hasPrice = current !== null && !isEmptySellPrice(current)
  return [
    hasPrice ? csvPrice(current.price) : '',
    hasPrice ? describeUnit(current) : '',
    hasPrice ? current.deals.map((deal) => `${deal.qty} for ${csvPrice(deal.total)}`).join('; ') : '',
    reference ? csvPrice(reference.price) : '',
  ]
}

function toCsv(
  data: ParsedStock,
  unknownItems: Record<string, unknown>[] = [],
  missingItems: Record<string, unknown>[] = [],
  validated: 'yes' | 'no' = 'no'
) {
  const header = [
    'Item Code',
    'Date',
    'Location',
    'Sub-location',
    'Category',
    'Product',
    'Attribute',
    'Origin',
    'Inner Quantity',
    'Inner Unit',
    'Official Name',
    'Name on Stocklist',
    'Navigation Guide',
    'Quantity',
    'Confidence',
    'Note',
    'Source',
    'Validated',
    'Special',
    'Price',
    'Sold By',
    'Deals',
    'Catalog Price',
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
      item.origin,
      item.inner_quantity === null ? '' : String(item.inner_quantity),
      item.inner_unit,
      item.official_name,
      item.stocklist_name ?? item.product_raw,
      item.navigation_guide ?? '',
      item.quantity === null ? '' : String(item.quantity),
      item.confidence,
      item.notes ?? '',
      'known',
      validated,
      item.special ? 'yes' : 'no',
      ...csvPriceColumns(item.sell, item.catalog_sell),
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
      (item.origin as string) ?? '',
      item.inner_quantity === null ? '' : String(item.inner_quantity ?? ''),
      (item.inner_unit as string) ?? '',
      (item.official_name as string) ?? 'Unknown',
      (item.product_raw as string) ?? '',
      '',
      item.quantity === null ? '' : String(item.quantity),
      (item.confidence as string) ?? 'low',
      (item.notes as string) ?? 'Unmatched item',
      'unknown',
      validated,
      item.special === true ? 'yes' : 'no',
      ...csvPriceColumns(item.sell, null),
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
      (item.origin as string) ?? '',
      item.inner_quantity === null ? '' : String(item.inner_quantity ?? ''),
      (item.inner_unit as string) ?? '',
      (item.official_name as string) ?? '',
      (item.stocklist_name as string) ?? '',
      (item.navigation_guide as string) ?? '',
      '',
      'high',
      'Missing from stocklist',
      'missing_catalog',
      validated,
      item.special === true ? 'yes' : 'no',
      '',
      '',
      '',
      '',
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

  const csv = toCsv(parsed.data, parsed.data.unknown_items, parsed.data.missing_catalog_items, parsed.data.validated)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stock-${parsed.data.photo_id}.csv"`,
    },
  })
}
