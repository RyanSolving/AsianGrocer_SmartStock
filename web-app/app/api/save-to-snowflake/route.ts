import { NextResponse } from 'next/server'

import { parsedStockSchema } from '../../../lib/stock-schema'

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = parsedStockSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const hasSnowflakeEnv =
    !!process.env.SNOWFLAKE_ACCOUNT &&
    !!process.env.SNOWFLAKE_USER &&
    !!process.env.SNOWFLAKE_PASSWORD &&
    !!process.env.SNOWFLAKE_WAREHOUSE &&
    !!process.env.SNOWFLAKE_DB &&
    !!process.env.SNOWFLAKE_SCHEMA

  if (!hasSnowflakeEnv) {
    return NextResponse.json(
      {
        error: 'Snowflake environment variables are not fully configured.',
        message: 'Validated payload accepted, but DB write is not enabled yet.',
        accepted: parsed.data,
      },
      { status: 501 }
    )
  }

  // Snowflake insert is intentionally left as a stub until credentials and connection flow are finalized.
  return NextResponse.json(
    {
      message: 'Snowflake credentials detected. Insert implementation is pending.',
      accepted: parsed.data,
    },
    { status: 202 }
  )
}
