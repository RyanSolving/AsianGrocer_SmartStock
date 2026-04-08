import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '../../../../lib/supabase/server'

export async function POST() {
  let supabase

  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Supabase is not configured.',
        details: error instanceof Error ? error.message : 'Unknown Supabase configuration error.',
      },
      { status: 500 }
    )
  }

  const { error } = await supabase.auth.signOut()

  if (error) {
    return NextResponse.json(
      {
        error: 'Failed to sign out.',
        details: error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Signed out.' }, { status: 200 })
}
