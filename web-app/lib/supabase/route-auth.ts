import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from './server'

export type AuthContext = {
  user: { id: string; email: string | null }
  roles: string[]
  supabase: ReturnType<typeof createSupabaseServerClient>
}

export async function getAuthContext(): Promise<AuthContext | NextResponse> {
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

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json(
      {
        error: 'Unauthorized. Please sign in.',
      },
      { status: 401 }
    )
  }

  const roleResult = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  const roles = roleResult.error
    ? []
    : (roleResult.data ?? [])
        .map((row) => row.role)
        .filter((role): role is string => typeof role === 'string' && role.length > 0)

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    roles,
    supabase,
  }
}
