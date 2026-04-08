import { NextResponse } from 'next/server'
import { loadDefaultCatalog } from '../../../lib/fruit-catalog'

export async function GET() {
  const catalog = loadDefaultCatalog()
  return NextResponse.json({ catalog })
}
