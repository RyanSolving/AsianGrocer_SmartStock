import { NextResponse } from 'next/server'
import { loadDefaultCatalog, normalizeCatalogEntry, parseCSVCatalog } from '../../../lib/fruit-catalog'
import { getAuthContext } from '../../../lib/supabase/route-auth'

function mapCatalogEntriesForInsert(entries: ReturnType<typeof parseCSVCatalog>) {
  return entries.map((entry) => ({
    code: entry.code,
    location: entry.location,
    sub_location: entry.sub_location,
    category: entry.category,
    product: entry.product,
    attribute: entry.attribute,
    official_name: entry.official_name,
    stocklist_name: entry.stocklist_name,
    navigation_guide: entry.navigation_guide,
    row_position: entry.row_position ?? null,
  }))
}

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  // Fetch all catalog items from the single table
  const result = await auth.supabase
    .from('catalog_items')
    .select('code, location, sub_location, category, product, attribute, official_name, stocklist_name, navigation_guide, row_position')
    .order('code', { ascending: true })

  if (result.error) {
    return NextResponse.json(
      {
        error: 'Failed to load catalog items.',
        details: result.error.message,
      },
      { status: 500 }
    )
  }

  const catalog = (result.data ?? []).map((entry) => normalizeCatalogEntry({
    id: 0, // legacy field, not used
    code: entry.code,
    location: entry.location,
    sub_location: entry.sub_location,
    category: entry.category,
    product: entry.product,
    attribute: entry.attribute,
    official_name: entry.official_name,
    stocklist_name: entry.stocklist_name,
    navigation_guide: entry.navigation_guide,
    row_position: entry.row_position,
  }))

  return NextResponse.json({
    catalog,
    item_count: catalog.length,
    source: 'database',
  })
}

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Request must be multipart/form-data.' }, { status: 400 })
  }

  const csvFile = formData.get('csv_file')
  if (!(csvFile instanceof File)) {
    return NextResponse.json({ error: 'Missing csv_file upload.' }, { status: 400 })
  }

  const csvText = await csvFile.text()
  let entries
  try {
    entries = parseCSVCatalog(csvText)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid CSV catalog format.',
        details: error instanceof Error ? error.message : 'Unknown CSV parse error.',
      },
      { status: 400 }
    )
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'Parsed catalog is empty.' }, { status: 400 })
  }

  // Upsert: insert new items, update existing ones (on conflict on code)
  const upsertResult = await auth.supabase
    .from('catalog_items')
    .upsert(mapCatalogEntriesForInsert(entries), { onConflict: 'code' })

  if (upsertResult.error) {
    return NextResponse.json(
      {
        error: 'Failed to save catalog items.',
        details: upsertResult.error.message,
      },
      { status: 500 }
    )
  }

  // Fetch the updated catalog
  const result = await auth.supabase
    .from('catalog_items')
    .select('code, location, sub_location, category, product, attribute, official_name, stocklist_name, navigation_guide, row_position')
    .order('code', { ascending: true })

  const catalog = (result.data ?? []).map((entry) => normalizeCatalogEntry({
    id: 0,
    code: entry.code,
    location: entry.location,
    sub_location: entry.sub_location,
    category: entry.category,
    product: entry.product,
    attribute: entry.attribute,
    official_name: entry.official_name,
    stocklist_name: entry.stocklist_name,
    navigation_guide: entry.navigation_guide,
    row_position: entry.row_position,
  }))

  return NextResponse.json(
    {
      message: 'Catalog uploaded to database.',
      catalog,
      item_count: catalog.length,
      source: 'database',
    },
    { status: 201 }
  )
}
