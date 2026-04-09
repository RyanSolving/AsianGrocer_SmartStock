import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from 'zod'

import { loadDefaultCatalog, buildCatalogPrompt, parseCSVCatalog } from '../../../lib/fruit-catalog'
import { logGenerateEvent } from '../../../lib/supabase/events'
import { getAuthContext } from '../../../lib/supabase/route-auth'
import { catalogEntrySchema, parsedStockSchema, stockModeSchema } from '../../../lib/stock-schema'
import type { CatalogEntry, StockMode } from '../../../lib/stock-schema'

const allowedUnits = new Set(['kg', 'box', 'punnet', 'pack'])

const ocrExtractionSchema = z.object({
  mode: z.union([stockModeSchema, z.string()]).optional(),
  stock_date: z.union([z.string(), z.null()]).optional(),
  confidence_overall: z.union([z.string(), z.null()]).optional(),
  items: z.array(z.record(z.unknown())).nullish().transform(v => v ?? []),
})

const validCategories = [
  'Apples',
  'Pears',
  'Citrus',
  'Grapes',
  'Stone Fruits',
  'Berries',
  'Coconuts',
  'Exotic',
  'Asian',
  'Mangos',
  'Bananas',
  'Melons',
  'Pineapple',
  'Kiwi',
  'Avocado',
  'Other',
] as const

const validLocations = [
  'Inside Coolroom',
  'Outside Coolroom',
  'All Year Section',
  'Seasonal',
  'Asian',
  'Stonefruit',
  'Unknown',
] as const

export const maxDuration = 300 // Allows 5 minutes max on Vercel Pro/Local
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 300000)

const OCR_EXTRACTION_PROMPT = `You are extracting rows from a handwritten fruit stocklist image.

Rules:
1. Extract only rows that are visibly present in the image.
2. Do not infer missing catalog items.
3. Keep product_raw exactly close to handwritten text.
4. quantity can be null when unreadable or missing.
5. quantity_raw should keep original handwritten/OCR text for the quantity field when possible.
6. Set confidence to high|medium|low.
7. If quantity is ambiguous, set quantity_conflict_flag=true.
8. If the item matches a catalog entry, provide its catalog_code (from the section lists). Leave null if unknown.

Return strict JSON only:
{
  "stock_date": "YYYY-MM-DD or null",
  "confidence_overall": "high|medium|low",
  "items": [
    {
      "catalog_code": "string or null",
      "product_raw": "string",
      "quantity_raw": "string or null",
      "quantity": "number or null",
      "quantity_conflict_flag": false,
      "confidence": "high|medium|low",
      "notes": "string or null"
    }
  ]
}`

const LABEL_ALIAS_MAP: Array<[RegExp, string]> = [
  [/\bpackham\s*p\b/g, 'packham pear'],
  [/\bp\s*\/\s*pack\b/g, 'pear pack'],
  [/\brockit\s*p\s*\/\s*pack\b/g, 'rockit apple pack'],
  [/\brockit\b/g, 'rockit apple'],
  [/\byello\b/g, 'yellow'],
  [/\bdragon\s*fruit\b/g, 'dragon fruit'],
]

const MATCH_WEIGHTS = {
  tokenOverlap: 0.45,
  charSimilarity: 0.25,
  location: 0.2,
  rowPosition: 0.1,
}

const MATCH_THRESHOLD_FUZZY = 0.62

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    promise
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLabelForMatch(value: string) {
  let normalized = value.replace(/\([^)]*(?:kg|g|lb|pack|box|cm|l)s?\)/gi, '')
  normalized = normalizeText(normalized)
  for (const [pattern, replacement] of LABEL_ALIAS_MAP) {
    normalized = normalized.replace(pattern, replacement)
  }
  return normalizeText(normalized)
}

function tokenize(value: string) {
  return normalizeLabelForMatch(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function tokenOverlapScore(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let overlap = 0
  for (const token of Array.from(setA)) {
    if (setB.has(token)) overlap += 1
  }
  const denom = Math.max(setA.size, setB.size)
  return denom > 0 ? overlap / denom : 0
}

function diceCoefficient(a: string, b: string) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0

  const aBigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2)
    aBigrams.set(gram, (aBigrams.get(gram) ?? 0) + 1)
  }

  let overlap = 0
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2)
    const count = aBigrams.get(gram) ?? 0
    if (count > 0) {
      aBigrams.set(gram, count - 1)
      overlap += 1
    }
  }

  return (2 * overlap) / (a.length - 1 + (b.length - 1))
}



function parseNullableQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  const text = String(value).trim()
  if (!text) return null

  const match = text.match(/-?\d+/)
  return match ? Number.parseInt(match[0], 10) : null
}

function normalizeStockDate(value: unknown, fallback: string) {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback

  const isoLike = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoLike) {
    const [, y, m, d] = isoLike
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (dmy) {
    const [, d, m, year] = dmy
    const normalizedYear = year.length === 2 ? `20${year}` : year
    return `${normalizedYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  return fallback
}

async function parseCatalogFromFormData(formData: FormData) {
  const catalogField = formData.get('catalog')
  const catalogFile = formData.get('catalog_file')

  if (!(catalogField || catalogFile)) {
    return {
      catalog: loadDefaultCatalog(),
      catalog_source: 'master' as const,
    }
  }

  if (typeof catalogField === 'string') {
    try {
      const parsedJson = JSON.parse(catalogField)
      return {
        catalog: z.array(catalogEntrySchema).parse(parsedJson),
        catalog_source: 'uploaded' as const,
      }
    } catch {
      return {
        catalog: parseCSVCatalog(catalogField),
        catalog_source: 'uploaded' as const,
      }
    }
  }

  if (catalogFile instanceof File) {
    const text = await catalogFile.text()
    if (catalogFile.name.endsWith('.json')) {
      return {
        catalog: z.array(catalogEntrySchema).parse(JSON.parse(text)),
        catalog_source: 'uploaded' as const,
      }
    }
    return {
      catalog: parseCSVCatalog(text),
      catalog_source: 'uploaded' as const,
    }
  }

  return {
    catalog: loadDefaultCatalog(),
    catalog_source: 'master' as const,
  }
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1])
      } catch {
        return null
      }
    }

    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1))
      } catch {
        return null
      }
    }

    return null
  }
}

function normalizeStockMode(value: unknown): StockMode {
  const parsed = stockModeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'stock-in'
}

export async function POST(request: Request) {
  let parsedJson: unknown

  try {
    const auth = await getAuthContext()
    if (auth instanceof NextResponse) {
      return auth
    }

    const formData = await request.formData()
    const uploadedFile = formData.get('photo')
    const mode = normalizeStockMode(formData.get('mode'))

    let catalog = [] as z.infer<typeof catalogEntrySchema>[]
    let catalogSource: 'master' | 'uploaded' = 'master'

    try {
      const catalogPayload = await parseCatalogFromFormData(formData)
      catalog = catalogPayload.catalog
      catalogSource = catalogPayload.catalog_source
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid catalog payload'
      return NextResponse.json(
        {
          error: 'Catalog parsing failed. Provide a JSON array via "catalog" or "catalog_file".',
          details: message,
        },
        { status: 400 }
      )
    }

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ error: 'Missing photo file in form-data field "photo".' }, { status: 400 })
    }

    const now = new Date()
    const isoNow = now.toISOString()
    const stockDate = isoNow.slice(0, 10)

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is missing. Configure it in your environment variables.' },
        { status: 501 }
      )
    }

    if (!uploadedFile.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image uploads are supported.' }, { status: 400 })
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer())
    const base64 = buffer.toString('base64')
    const dataUrl = `data:${uploadedFile.type};base64,${base64}`

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-5.2'

    try {
      const catalogPrompt = buildCatalogPrompt(catalog, mode)
      const completion = await withTimeout(
        client.chat.completions.create({
          model,
          temperature: 0,
          max_completion_tokens: 16384,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: catalogPrompt,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
        }),
        OPENAI_TIMEOUT_MS,
        `OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms.`
      )

      const content = completion.choices[0]?.message?.content ?? ''
      parsedJson = tryParseJson(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error'
      return NextResponse.json({ error: 'Failed to parse image with OpenAI Vision.', details: message }, { status: 502 })
    }

    if (!parsedJson) {
      return NextResponse.json(
        {
          error: 'OpenAI response did not contain valid JSON.',
        },
        { status: 502 }
      )
    }

    const extracted = ocrExtractionSchema.safeParse(parsedJson)
    if (!extracted.success) {
      return NextResponse.json(
        {
          error: 'Failed to validate OCR extraction output.',
          details: extracted.error.flatten(),
        },
        { status: 502 }
      )
    }

    const normalizedItems = extracted.data.items.map((rawItem) => {
      const productRawCandidate = String(rawItem.product_raw ?? '').trim()
      const quantityRawCandidate = String(rawItem.quantity_raw ?? rawItem.quantity ?? '').trim()
      const quantityCandidate = parseNullableQuantity(rawItem.quantity ?? rawItem.quantity_raw)
      const conf = String(rawItem.confidence ?? 'medium').toLowerCase()

      return {
        catalog_code: typeof rawItem.catalog_code === 'string' ? rawItem.catalog_code : null,
        product_raw: productRawCandidate || 'Unknown Product',
        quantity_raw: quantityRawCandidate || (quantityCandidate !== null ? String(quantityCandidate) : null),
        quantity: quantityCandidate,
        quantity_conflict_flag: Boolean(rawItem.quantity_conflict_flag),
        confidence: (conf === 'high' || conf === 'low') ? conf : 'medium' as 'high' | 'medium' | 'low',
        notes: rawItem.notes ? String(rawItem.notes).trim() : null,
      }
    })

    // Build lookups
    const catalogByCode = new Map<string, CatalogEntry[]>()
  const catalogSearch = catalog.map((entry) => {
    if (!catalogByCode.has(entry.code)) {
      catalogByCode.set(entry.code, [])
    }
    catalogByCode.get(entry.code)!.push(entry)
    const candidates = [entry.stocklist_name, entry.official_name]
      .filter(Boolean)
      .map(v => normalizeText(v))

    return {
      entry,
      candidates,
      tokenCandidates: candidates.map(tokenize),
    }
  })

  const exactLookup = new Map<string, typeof catalogSearch[number]>()
  for (const item of catalogSearch) {
    for (const cand of item.candidates) {
      if (!exactLookup.has(cand)) exactLookup.set(cand, item)
    }
  }

  const matchedCatalogCodes = new Set<string>()
  const knownItems = [] as any[]
  const unknownItems = [] as any[]

  let fuzzyCount = 0
  let quantityConflictCount = 0

  for (const item of normalizedItems) {
    let matchedEntry: CatalogEntry | null = null
    let matchStatus: 'exact' | 'fuzzy' | 'unknown' = 'unknown'

    // Primary Match: catalog_code from AI
    if (item.catalog_code !== null && catalogByCode.has(item.catalog_code)) {
      matchedEntry = catalogByCode.get(item.catalog_code)![0]
      matchStatus = 'exact'
    } else {
      // Secondary Match: text exact
      const normRaw = normalizeText(item.product_raw)
      if (exactLookup.has(normRaw)) {
        matchedEntry = exactLookup.get(normRaw)!.entry
        matchStatus = 'exact'
      } else {
        // Tertiary Match: Fuzzy
        const rawTokens = tokenize(normRaw)
        let bestFuzzyScore = 0
        let bestMatch: CatalogEntry | null = null

        for (const candidate of catalogSearch) {
          for (let i = 0; i < candidate.candidates.length; i++) {
            const tokenScore = tokenOverlapScore(rawTokens, candidate.tokenCandidates[i])
            const charScore = diceCoefficient(normRaw, candidate.candidates[i])
            const score = tokenScore * 0.6 + charScore * 0.4

            if (score > bestFuzzyScore) {
              bestFuzzyScore = score
              bestMatch = candidate.entry
            }
          }
        }

        if (bestFuzzyScore > 0.6) {
          matchedEntry = bestMatch
          matchStatus = 'fuzzy'
        }
      }
    }

    if (!matchedEntry) {
      unknownItems.push({
        ...item,
        location: 'Unknown',
        sub_location: 'Unknown',
        category: 'Unknown',
        product: 'Unknown',
        attribute: '',
        official_name: 'Unknown',
        row_position: 'single',
        catalog_match_status: 'unknown',
      })
      continue
    }

    matchedCatalogCodes.add(matchedEntry.code)

    if (matchStatus === 'fuzzy') fuzzyCount++
    if (item.quantity_conflict_flag) quantityConflictCount++

    knownItems.push({
      catalog_code: matchedEntry.code,
      product_raw: item.product_raw,
      location: matchedEntry.location,
      sub_location: matchedEntry.sub_location,
      category: matchedEntry.category,
      product: matchedEntry.product,
      attribute: matchedEntry.attribute,
      official_name: matchedEntry.official_name,
      stocklist_name: matchedEntry.stocklist_name,
      navigation_guide: matchedEntry.navigation_guide,
      row_position: matchedEntry.row_position,
      quantity_raw: item.quantity_raw,
      quantity: item.quantity,
      quantity_conflict_flag: item.quantity_conflict_flag,
      confidence: item.confidence,
      catalog_match_status: matchStatus,
      notes: item.notes,
    })
  }

  const derivedConfidence = knownItems.some(i => i.confidence === 'low') ? 'low' :
    knownItems.some(i => i.confidence === 'medium') ? 'medium' : 'high'

  const finalPayload = {
    photo_id: `${now.getTime()}-${uploadedFile.name}`,
      mode,
    upload_date: isoNow,
    stock_date: normalizeStockDate(extracted.data.stock_date, stockDate),
    photo_url: null,
    total_items: knownItems.length,
    confidence_overall: derivedConfidence,
    items: knownItems,
  }

  const missingCatalogItems = catalog.filter(c => !matchedCatalogCodes.has(c.code))
  const reviewRequiredCount = unknownItems.length + fuzzyCount + quantityConflictCount

  const validated = parsedStockSchema.safeParse(finalPayload)
  if (!validated.success) {
    return NextResponse.json(
      {
        error: 'Failed to validate transformed stock output.',
        details: validated.error.flatten(),
      },
      { status: 502 }
    )
  }

  const eventInsert = await logGenerateEvent(auth.supabase, {
    user: {
      userId: auth.user.id,
    },
    inputFileName: uploadedFile.name,
    catalogVersion: catalogSource,
    outputFromModel: extracted.data,
    finalOutput: validated.data,
    edited: false,
    stockMode: mode,
  })

  if (eventInsert.error) {
    return NextResponse.json(
      {
        error: 'Failed to log generate event.',
        details: eventInsert.error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
        message: 'Photo parsed successfully with OCR extraction.',
      data: validated.data,
      uid_generate: eventInsert.data?.uid_generate ?? null,
      unknown_items: unknownItems,
      missing_catalog_items: missingCatalogItems,
      review_required_count: reviewRequiredCount,
      catalog_source: catalogSource,
      catalog_item_count: catalog.length,
      matching_mode: 'two-pass-weighted',
    },
    { status: 200 }
  )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected parse error.'

    if (message.includes('Request body size')) {
      return NextResponse.json(
        {
          error: 'Uploaded image is too large for the parser request.',
          details: message,
        },
        { status: 413 }
      )
    }

    return NextResponse.json(
      {
        error: 'Unexpected parse failure.',
        details: message,
      },
      { status: 500 }
    )
  }
}
