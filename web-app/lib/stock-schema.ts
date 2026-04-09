import { z } from 'zod'

export const stockModeSchema = z.enum(['stock-in', 'stock-closing'])

export const catalogLocationOptions = ['Inside Coolroom', 'Outside Coolroom'] as const
export const catalogSubLocationInsideOptions = ['Apples', 'Citrus', 'Asian', 'Melon', 'All Year', 'Seasonal', 'Stonefruit'] as const
export const catalogSubLocationOutsideOptions = ['Outside Coolroom'] as const
export const catalogCategoryOptions = ['Apples', 'Citrus', 'Asian', 'Melon', 'All Year', 'Seasonal', 'Stonefruit', 'Banana', 'Papaya', 'Mango', 'Watermelon', 'Pineapple', 'Tropical', 'Coconut', 'Pears', 'Grape', 'Nut', 'Berries', 'Kiwi', 'Avocado', 'Persimmon', 'Other'] as const
export const catalogRowPositionOptions = ['left', 'right', 'single'] as const

const catalogTextSchema = z.string().trim()

export const catalogItemSchema = z.object({
  code: catalogTextSchema.min(1, 'Item code is required'),
  location: z.enum(catalogLocationOptions).default('Inside Coolroom'),
  sub_location: catalogTextSchema.min(1, 'Sub-location is required').default('Apples'),
  category: z.enum(catalogCategoryOptions).default('Apples'),
  product: catalogTextSchema.default(''),
  attribute: catalogTextSchema.default(''),
  official_name: catalogTextSchema.min(1, 'Official name is required'),
  stocklist_name: catalogTextSchema.min(1, 'Name on stocklist is required'),
  navigation_guide: catalogTextSchema.default(''),
  row_position: z.enum(catalogRowPositionOptions).default('single'),
}).superRefine((value, context) => {
  const validSubLocations: string[] = value.location === 'Outside Coolroom'
    ? [...catalogSubLocationOutsideOptions]
    : [...catalogSubLocationInsideOptions]

  if (!validSubLocations.includes(value.sub_location)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sub_location'],
      message: value.location === 'Outside Coolroom'
        ? 'Outside Coolroom must use the Outside Coolroom sub-location.'
        : 'Select a valid sub-location for the chosen location.',
    })
  }
})

export const catalogEntrySchema = z.object({
  id: z.number(),
  code: z.string(),
  location: z.string(),
  sub_location: z.string(),
  category: z.string(),
  product: z.string(),
  attribute: z.string(),
  official_name: z.string(),
  stocklist_name: z.string(),
  navigation_guide: z.string(),
  // row_position parsed from guide
  row_position: z.enum(catalogRowPositionOptions).optional(),
})

export const itemSchema = z.object({
  catalog_code: z.string().nullable().default(null),
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
  mode: stockModeSchema.default('stock-in'),
  upload_date: z.string().datetime(),
  stock_date: z.string().date(),
  photo_url: z.string().url().nullable().default(null),
  total_items: z.number().int().nonnegative(),
  confidence_overall: z.enum(['high', 'medium', 'low']).default('medium'),
  items: z.array(itemSchema),
})

export const snowflakeStagingRecordSchema = z.object({
  photo_id: z.string().min(1),
  mode: stockModeSchema.default('stock-in'),
  validated: z.enum(['yes', 'no']).default('no'),
  upload_date: z.string().datetime(),
  stock_date: z.string().date(),
  photo_url: z.string().url().nullable().default(null),
  total_items: z.number().int().nonnegative(),
  confidence_overall: z.enum(['high', 'medium', 'low']).default('medium'),
  item_data: z.array(itemSchema),
})

export type CatalogEntry = z.infer<typeof catalogEntrySchema>
export type ParsedStock = z.infer<typeof parsedStockSchema>
export type StockItem = z.infer<typeof itemSchema>
export type SnowflakeStagingRecord = z.infer<typeof snowflakeStagingRecordSchema>
export type StockMode = z.infer<typeof stockModeSchema>
export type CatalogItem = z.infer<typeof catalogItemSchema>
