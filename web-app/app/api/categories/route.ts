import { NextRequest, NextResponse } from 'next/server'
import { getCategoriesFromDB } from '../../../lib/category-store'
import { getAuthContext } from '../../../lib/supabase/route-auth'

export async function GET(request: NextRequest) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  try {
    const categories = await getCategoriesFromDB(auth.supabase)
    const normalizedCategories = Array.from(new Set(
      categories
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )).sort((a, b) => a.localeCompare(b))

    return NextResponse.json(
      {
        success: true,
        categories: normalizedCategories,
        count: normalizedCategories.length,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch categories',
        categories: [],
      },
      { status: 500 }
    )
  }
}
