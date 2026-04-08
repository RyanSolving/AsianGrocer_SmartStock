import { z } from 'zod'

export const catalogEntrySchema = z.object({
  id: z.number(),
  code: z.string().optional(),
  location: z.string(),
  sub_location: z.string(),
  category: z.string(),
  product: z.string(),
  attribute: z.string(),
  official_name: z.string(),
  stocklist_name: z.string(),
  navigation_guide: z.string(),
  // row_position parsed from guide
  row_position: z.enum(['left', 'right', 'single']).optional(),
})

export const itemSchema = z.object({
  catalog_id: z.number().nullable().default(null),
  item_code: z.string().nullable().default(null),
  product_raw: z.string().min(1),
  
  // Populated from catalog if matched, otherwise left to AI inference
  location: z.string().default('Unknown'),
  sub_location: z.string().default('Unknown'),
  category: z.string().default('Unknown'),
  product: z.string().default('Unknown'),
  attribute: z.string().default(''),
  official_name: z.string().default('Unknown'),
  stocklist_name: z.string().optional(),
  navigation_guide: z.string().optional(),

  row_position: z.enum(['left', 'right', 'single']).default('single'),
  
  quantity_raw: z.string().nullable().default(null),
  quantity: z.number().int().nullable().default(null),
  quantity_conflict_flag: z.boolean().default(false),
  
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  catalog_match_status: z.enum(['exact', 'fuzzy', 'unknown']).optional(),
  notes: z.string().nullable().default(null),
})

export const parsedStockSchema = z.object({
  photo_id: z.string().min(1),
  parse_mode: z.enum(['stock-closing', 'stock-in']).default('stock-closing'),
  upload_date: z.string().datetime(),
  stock_date: z.string().date(),
  photo_url: z.string().url().nullable().default(null),
  total_items: z.number().int().nonnegative(),
  confidence_overall: z.enum(['high', 'medium', 'low']).default('medium'),
  items: z.array(itemSchema),
})

export type CatalogEntry = z.infer<typeof catalogEntrySchema>
export type ParsedStock = z.infer<typeof parsedStockSchema>
export type StockItem = z.infer<typeof itemSchema>
