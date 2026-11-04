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

  // getClaims verifies the JWT signature locally against the project's cached JWKS
  // (no Auth-server round trip) when the project uses asymmetric signing keys. For
  // projects still on a symmetric secret it falls back to a getUser() network check,
  // so this is never less strict than before.
  const { data: claimsData, error } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  const userId = typeof claims?.sub === 'string' ? claims.sub : ''

  if (error || !userId) {
    return NextResponse.json(
      {
        error: 'Unauthorized. Please sign in.',
      },
      { status: 401 }
    )
  }

  const user = {
    id: userId,
    email: typeof claims?.email === 'string' ? claims.email : null,
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
      email: user.email,
    },
    roles,
    supabase,
  }
}
