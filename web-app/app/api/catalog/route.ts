import { NextResponse } from 'next/server'
import { loadDefaultCatalog, parseCSVCatalog } from '../../../lib/fruit-catalog'
import { getAuthContext } from '../../../lib/supabase/route-auth'

function mapCatalogEntriesForInsert(versionId: string, entries: ReturnType<typeof parseCSVCatalog>) {
  return entries.map((entry) => ({
    version_id: versionId,
    id: entry.id,
    code: entry.code ?? null,
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

  const url = new URL(request.url)
  const selectedVersionId = url.searchParams.get('version_id')

  const versionsResult = await auth.supabase
    .from('catalog_versions')
    .select('id, version_name, uploaded_at, item_count, is_active')
    .order('uploaded_at', { ascending: false })

  if (versionsResult.error) {
    return NextResponse.json(
      {
        error: 'Failed to load catalog versions.',
        details: versionsResult.error.message,
      },
      { status: 500 }
    )
  }

  const versions = versionsResult.data ?? []
  const activeVersionId = selectedVersionId ?? versions[0]?.id ?? null

  if (!activeVersionId) {
    const catalog = loadDefaultCatalog()
    return NextResponse.json({
      catalog,
      versions: [],
      active_version_id: null,
      source: 'default',
    })
  }

  const entriesResult = await auth.supabase
    .from('catalog_entries')
    .select('id, code, location, sub_location, category, product, attribute, official_name, stocklist_name, navigation_guide, row_position')
    .eq('version_id', activeVersionId)
    .order('id', { ascending: true })

  if (entriesResult.error) {
    return NextResponse.json(
      {
        error: 'Failed to load catalog entries.',
        details: entriesResult.error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    catalog: entriesResult.data ?? [],
    versions,
    active_version_id: activeVersionId,
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

  const versionNameInput = String(formData.get('version_name') ?? '').trim()
  const fallbackName = `${csvFile.name.replace(/\.csv$/i, '')}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
  const versionName = versionNameInput || fallbackName

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

  const existingVersion = await auth.supabase
    .from('catalog_versions')
    .select('id')
    .eq('version_name', versionName)
    .maybeSingle()

  if (existingVersion.error) {
    return NextResponse.json(
      {
        error: 'Failed to validate catalog version name.',
        details: existingVersion.error.message,
      },
      { status: 500 }
    )
  }

  if (existingVersion.data) {
    return NextResponse.json({ error: 'Catalog version name already exists.' }, { status: 409 })
  }

  const versionInsert = await auth.supabase
    .from('catalog_versions')
    .insert({
      version_name: versionName,
      uploaded_by: auth.user.id,
      item_count: entries.length,
      is_active: true,
    })
    .select('id, version_name, uploaded_at, item_count, is_active')
    .single()

  if (versionInsert.error || !versionInsert.data) {
    return NextResponse.json(
      {
        error: 'Failed to create catalog version.',
        details: versionInsert.error?.message ?? 'Unknown insert error.',
      },
      { status: 500 }
    )
  }

  const versionId = versionInsert.data.id

  const entryInsert = await auth.supabase.from('catalog_entries').insert(mapCatalogEntriesForInsert(versionId, entries))
  if (entryInsert.error) {
    await auth.supabase.from('catalog_versions').delete().eq('id', versionId)
    return NextResponse.json(
      {
        error: 'Failed to save catalog entries.',
        details: entryInsert.error.message,
      },
      { status: 500 }
    )
  }

  await auth.supabase
    .from('catalog_versions')
    .update({ is_active: false })
    .neq('id', versionId)

  const versionsResult = await auth.supabase
    .from('catalog_versions')
    .select('id, version_name, uploaded_at, item_count, is_active')
    .order('uploaded_at', { ascending: false })

  return NextResponse.json(
    {
      message: 'Catalog uploaded to database.',
      catalog: entries,
      versions: versionsResult.data ?? [versionInsert.data],
      active_version_id: versionId,
      source: 'database',
    },
    { status: 201 }
  )
}
