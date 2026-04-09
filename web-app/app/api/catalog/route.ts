import { NextResponse } from 'next/server'
import { loadDefaultCatalog, normalizeCatalogEntry, parseCSVCatalog } from '../../../lib/fruit-catalog'
import { getAuthContext } from '../../../lib/supabase/route-auth'

type SupabaseErrorLike = {
  code?: string | null
  message?: string | null
}

type CatalogRow = {
  code: string
  location: string
  sub_location: string
  category: string
  product: string
  attribute: string
  official_name: string
  stocklist_name: string
  navigation_guide: string
  row_position: 'left' | 'right' | 'single'
}

function isMissingRelationError(error: SupabaseErrorLike | null | undefined) {
  if (!error) return false
  if (error.code === '42P01') return true
  return /relation .* does not exist/i.test(error.message ?? '')
}

function isPermissionDeniedError(error: SupabaseErrorLike | null | undefined) {
  if (!error) return false
  if (error.code === '42501') return true
  return /permission denied|row-level security/i.test(error.message ?? '')
}

function fallbackCatalogResponse(reason: string) {
  const defaultCatalog = loadDefaultCatalog()
  return NextResponse.json(
    {
      catalog: defaultCatalog,
      item_count: defaultCatalog.length,
      source: 'master-csv-fallback',
      warning: reason,
    },
    { status: 200 }
  )
}

function mapRowsToCatalog(rows: CatalogRow[]) {
  return rows.map((entry) => normalizeCatalogEntry({
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
    row_position: entry.row_position ?? 'single',
  }))
}

async function loadCatalogFromSingleTable(supabase: any) {
  const result = await supabase
    .from('catalog_items')
    .select('code, location, sub_location, category, product, attribute, official_name, stocklist_name, navigation_guide, row_position')
    .order('code', { ascending: true })

  if (result.error) {
    return {
      catalog: [] as ReturnType<typeof normalizeCatalogEntry>[],
      error: result.error as SupabaseErrorLike,
      source: 'database' as const,
    }
  }

  const rows = (result.data ?? []).map((entry: any) => ({
    code: entry.code,
    location: entry.location,
    sub_location: entry.sub_location,
    category: entry.category,
    product: entry.product,
    attribute: entry.attribute,
    official_name: entry.official_name,
    stocklist_name: entry.stocklist_name,
    navigation_guide: entry.navigation_guide,
    row_position: entry.row_position ?? 'single',
  }))

  return {
    catalog: mapRowsToCatalog(rows),
    error: null,
    source: 'database' as const,
  }
}

async function loadCatalogFromLegacyTables(supabase: any) {
  const activeVersion = await supabase
    .from('catalog_versions')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (activeVersion.error) {
    return {
      catalog: [] as ReturnType<typeof normalizeCatalogEntry>[],
      error: activeVersion.error as SupabaseErrorLike,
      source: 'database-legacy' as const,
    }
  }

  const activeVersionId = activeVersion.data?.id
  if (!activeVersionId) {
    return {
      catalog: [] as ReturnType<typeof normalizeCatalogEntry>[],
      error: null,
      source: 'database-legacy' as const,
    }
  }

  const entriesResult = await supabase
    .from('catalog_entries')
    .select('id, code, location, sub_location, category, product, attribute, official_name, stocklist_name, navigation_guide, row_position')
    .eq('version_id', activeVersionId)
    .order('id', { ascending: true })

  if (entriesResult.error) {
    return {
      catalog: [] as ReturnType<typeof normalizeCatalogEntry>[],
      error: entriesResult.error as SupabaseErrorLike,
      source: 'database-legacy' as const,
    }
  }

  const rows = (entriesResult.data ?? []).map((entry: any) => ({
    code: (entry.code ?? String(entry.id ?? '')).trim(),
    location: entry.location,
    sub_location: entry.sub_location,
    category: entry.category,
    product: entry.product,
    attribute: entry.attribute,
    official_name: entry.official_name,
    stocklist_name: entry.stocklist_name,
    navigation_guide: entry.navigation_guide,
    row_position: entry.row_position ?? 'single',
  }))

  return {
    catalog: mapRowsToCatalog(rows),
    error: null,
    source: 'database-legacy' as const,
  }
}

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
    row_position: entry.row_position ?? 'single',
  }))
}

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  const singleTable = await loadCatalogFromSingleTable(auth.supabase)
  if (!singleTable.error) {
    return NextResponse.json({
      catalog: singleTable.catalog,
      item_count: singleTable.catalog.length,
      source: singleTable.source,
    })
  }

  if (isPermissionDeniedError(singleTable.error)) {
    return fallbackCatalogResponse(
      'Catalog database permissions are not configured for the current user. Serving fallback CSV catalog from project files.'
    )
  }

  if (!isMissingRelationError(singleTable.error)) {
    return NextResponse.json(
      {
        error: 'Failed to load catalog items.',
        details: singleTable.error.message,
      },
      { status: 500 }
    )
  }

  const legacyTable = await loadCatalogFromLegacyTables(auth.supabase)
  if (legacyTable.error) {
    if (isPermissionDeniedError(legacyTable.error)) {
      return fallbackCatalogResponse(
        'Legacy catalog tables exist but current permissions block access. Serving fallback CSV catalog from project files.'
      )
    }

    if (!isMissingRelationError(legacyTable.error)) {
      return NextResponse.json(
        {
          error: 'Failed to load catalog items from legacy catalog tables.',
          details: legacyTable.error.message,
          hint: 'Ensure catalog migrations are applied and that an active catalog version exists.',
        },
        { status: 500 }
      )
    }

    return fallbackCatalogResponse(
      'Catalog database tables were not found. Serving fallback CSV catalog from project files.'
    )
  }

  return NextResponse.json({
    catalog: legacyTable.catalog,
    item_count: legacyTable.catalog.length,
    source: legacyTable.source,
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
    if (isMissingRelationError(upsertResult.error)) {
      return NextResponse.json(
        {
          error: 'Catalog write requires the new single-table schema.',
          details: upsertResult.error.message,
          hint: 'Run migration 20260409_catalog_items_single_table.sql to create public.catalog_items.',
        },
        { status: 409 }
      )
    }

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
    row_position: entry.row_position ?? 'single',
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
