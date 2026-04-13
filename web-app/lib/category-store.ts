import { z } from 'zod'

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

/**
 * Fetches all unique categories from the catalog_items table in the database
 * This is the source of truth for valid category values
 */
export async function getCategoriesFromDB(
  supabaseClient: any
): Promise<string[]> {
  try {
    const { data, error } = await supabaseClient
      .from('catalog_items')
      .select('category')
      .not('category', 'is', null)
      .order('category')

    if (error) {
      console.error('Failed to fetch categories from database:', error)
      return []
    }

    const unique = new Set<string>()
    for (const row of data || []) {
      const category = normalizeCategory((row as { category?: unknown }).category)
      if (category) {
        unique.add(category)
      }
    }

    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  } catch (err) {
    console.error('Error fetching categories:', err)
    return []
  }
}

/**
 * Creates a dynamic Zod schema validator for the category field
 * This factory accepts a list of allowed categories and returns a schema that validates against them
 */
export function createCategorySchema(allowedCategories: string[]) {
  if (allowedCategories.length === 0) {
    // Fallback to accepting any non-empty string if no categories are available
    return z.string().trim().min(1, 'Category is required')
  }

  // Create a union type from the allowed categories
  const categoryEnum = z.enum(allowedCategories as [string, ...string[]])
  return categoryEnum
}

/**
 * Validates a category value against the list of allowed categories from the database
 */
export function validateCategoryValue(
  category: unknown,
  allowedCategories: string[]
): boolean {
  const normalized = normalizeCategory(category)
  if (!normalized) return false
  return allowedCategories.includes(normalized)
}
