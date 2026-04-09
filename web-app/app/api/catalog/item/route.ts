import { NextResponse } from 'next/server'

import { getAuthContext } from '../../../../lib/supabase/route-auth'

// PUT: Update or insert a single catalog item
export async function PUT(request: Request) {
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

  const item = payload as Record<string, unknown>
  const code = item?.code as string | undefined

  if (!code || typeof code !== 'string' || !code.trim()) {
    return NextResponse.json({ error: 'Item code is required.' }, { status: 400 })
  }

  if (!item?.official_name || typeof item.official_name !== 'string' || !item.official_name.trim()) {
    return NextResponse.json({ error: 'Official name is required.' }, { status: 400 })
  }

  if (!item?.stocklist_name || typeof item.stocklist_name !== 'string' || !item.stocklist_name.trim()) {
    return NextResponse.json({ error: 'Name on stocklist is required.' }, { status: 400 })
  }

  const result = await auth.supabase
    .from('catalog_items')
    .upsert({
      code: code.trim(),
      location: (item.location as string) ?? 'Inside Coolroom',
      sub_location: (item.sub_location as string) ?? 'Apples',
      category: (item.category as string) ?? 'Other',
      product: (item.product as string) ?? '',
      attribute: (item.attribute as string) ?? '',
      official_name: (item.official_name as string).trim(),
      stocklist_name: (item.stocklist_name as string).trim(),
      navigation_guide: (item.navigation_guide as string) ?? '',
      row_position: (item.row_position as 'left' | 'right' | 'single') ?? 'single',
    }, { onConflict: 'code' })

  if (result.error) {
    return NextResponse.json(
      { error: 'Failed to save item.', details: result.error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Item saved successfully.', code }, { status: 200 })
}

// DELETE: Remove a catalog item by code
export async function DELETE(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (!code || !code.trim()) {
    return NextResponse.json({ error: 'Item code is required.' }, { status: 400 })
  }

  const result = await auth.supabase
    .from('catalog_items')
    .delete()
    .eq('code', code.trim())

  if (result.error) {
    return NextResponse.json(
      { error: 'Failed to delete item.', details: result.error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Item deleted successfully.', code }, { status: 200 })
}
