import { NextResponse } from 'next/server'

import { catalogItemSchema } from '../../../../lib/stock-schema'
import { getAuthContext } from '../../../../lib/supabase/route-auth'
import { getCategoriesFromDB, validateCategoryValue } from '../../../../lib/category-store'

function isMissingRelationError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === '42P01') return true
  return /relation .* does not exist/i.test(error.message ?? '')
}

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

  const parsed = catalogItemSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid catalog item payload.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const item = parsed.data

  // Validate category against database values
  const allowedCategories = await getCategoriesFromDB(auth.supabase)
  if (!validateCategoryValue(item.category, allowedCategories)) {
    return NextResponse.json(
      {
        error: 'Invalid category.',
        details: `Category "${item.category}" is not in the list of allowed categories.`,
        hint: `Allowed categories: ${allowedCategories.join(', ')}`,
      },
      { status: 400 }
    )
  }

  const result = await auth.supabase
    .from('catalog_items')
    .upsert({
      code: item.code,
      location: item.location,
      sub_location: item.sub_location,
      category: item.category,
      product: item.product,
      attribute: item.attribute,
      official_name: item.official_name,
      stocklist_name: item.stocklist_name,
      navigation_guide: item.navigation_guide,
      row_position: item.row_position,
      is_visible: item.is_visible,
    }, { onConflict: 'code' })

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return NextResponse.json(
        {
          error: 'Catalog write requires the new single-table schema.',
          details: result.error.message,
          hint: 'Run migration 20260409_catalog_items_single_table.sql to create public.catalog_items.',
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to save item.', details: result.error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Item saved successfully.', code: item.code }, { status: 200 })
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
    if (isMissingRelationError(result.error)) {
      return NextResponse.json(
        {
          error: 'Catalog delete requires the new single-table schema.',
          details: result.error.message,
          hint: 'Run migration 20260409_catalog_items_single_table.sql to create public.catalog_items.',
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to delete item.', details: result.error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Item deleted successfully.', code }, { status: 200 })
}
