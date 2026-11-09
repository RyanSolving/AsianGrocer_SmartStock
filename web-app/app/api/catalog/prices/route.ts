import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthContext } from '../../../../lib/supabase/route-auth'
import { MAX_PRICE, normalizeSellPrice, priceUnits, roundPrice } from '../../../../lib/stock-price'

const bodySchema = z.object({
  prices: z.array(z.object({
    code: z.string().trim().min(1),
    price: z.number().finite().nonnegative().max(MAX_PRICE).nullable(),
    unit: z.enum(priceUnits).default('ea'),
    deals: z.array(z.object({ qty: z.number(), total: z.number() })).max(20).default([]),
  })).min(1).max(500),
})

/** Quick price entry: sets (or clears) the selling price of several items at once. */
export async function PUT(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) return auth

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid prices.', details: parsed.error.flatten() }, { status: 400 })
  }

  const saved: string[] = []
  const failed: Array<{ code: string; error: string }> = []
  for (const { code, price, unit, deals } of parsed.data.prices) {
    const sell = normalizeSellPrice({ price, unit, deals })
    const { data, error } = await auth.supabase
      .from('catalog_items')
      .update({ price: sell.price === null ? null : roundPrice(sell.price), price_unit: sell.unit, price_deals: sell.deals })
      .eq('code', code)
      .select('code')
    if (error) failed.push({ code, error: error.message })
    else if (!data || data.length === 0) failed.push({ code, error: 'Item not found.' })
    else saved.push(code)
  }

  return NextResponse.json({ saved, failed }, { status: failed.length > 0 && saved.length === 0 ? 400 : 200 })
}
