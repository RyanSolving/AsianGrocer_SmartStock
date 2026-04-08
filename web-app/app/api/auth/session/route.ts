import { NextResponse } from 'next/server'

import { getAuthContext } from '../../../../lib/supabase/route-auth'

export async function GET() {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  return NextResponse.json(
    {
      user: {
        id: auth.user.id,
        email: auth.user.email,
      },
      roles: auth.roles,
    },
    { status: 200 }
  )
}
