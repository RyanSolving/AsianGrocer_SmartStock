import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'
import type { CatalogEntry } from './stock-schema'

type ParseMode = 'stock-closing' | 'stock-in'

export function parseCSVCatalog(csvText: string): CatalogEntry[] {
  const result = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length) {
    throw new Error(`CSV parsing error: ${result.errors[0].message}`)
  }

  const entries: CatalogEntry[] = []

  for (let index = 0; index < result.data.length; index += 1) {
    const row = result.data[index]
    const rawId = row.ID || row['No.'] || row.No || ''

    if (!rawId || !row.Location || !row['Sub-location'] || !row.Product || !row['Official Name']) {
      continue // Skip malformed rows
    }

    const guide = row['Nagivation Guide'] || row['Navigation Guide'] || ''
    
    // Auto-parse row_position from guide text
    const guideLower = guide.toLowerCase()
    let rowPosition: 'left' | 'right' | 'single' = 'single'
    if (guideLower.includes('left')) {
      rowPosition = 'left'
    } else if (guideLower.includes('right')) {
      rowPosition = 'right'
    }

    entries.push({
      id: Number.parseInt(rawId, 10) || index + 1,
      code: row.Code?.trim() || '',
      location: row.Location.trim(),
      sub_location: row['Sub-location'].trim(),
      category: row.Category?.trim() || '',
      product: row.Product.trim(),
      attribute: row.Attribute?.trim() || '',
      official_name: row['Official Name'].trim(),
      stocklist_name: row['Name on Stocklist']?.trim() || '',
      navigation_guide: guide.trim(),
      row_position: rowPosition,
    })
  }

  return entries
}

export function loadDefaultCatalog(): CatalogEntry[] {
  try {
    const csvPath = path.join(process.cwd(), 'public', 'catalog_v2.csv')
    const csvText = fs.readFileSync(csvPath, 'utf8')
    return parseCSVCatalog(csvText)
  } catch (error) {
    console.error('Failed to load default catalog:', error)
    return []
  }
}

export function buildCatalogPrompt(catalog: CatalogEntry[], parseMode: ParseMode = 'stock-closing') {
  let catalogText = ''
  for (const item of catalog) {
    catalogText += `- [ID: ${item.id}] "${item.stocklist_name}" (${item.official_name}) \u2192 ${item.navigation_guide}\n`
  }

  if (parseMode === 'stock-in') {
    return `You are an expert OCR extraction agent for fruit stock-in notes.
Your task is to extract every visibly listed stock-in line into strict JSON.

Input note characteristics:
- mostly free-form text lines, often "item: qty"
- sometimes missing colon, e.g. "Autumn crisp loose 96"
- occasional spacing or typo issues from OCR/handwriting
- arrival header usually contains date like "Arrival stocks 30 Mar 2026"

Rules:
1. Extract only visibly present lines; do not infer unseen rows.
2. For each line, parse product_raw and quantity.
3. Tolerate missing separators and parse trailing numeric quantity when present.
4. Keep product_raw close to handwritten text, but normalize obvious OCR spacing noise.
5. Try to match against MASTER CATALOG first by label and context.
6. If confidently matched, set catalog_id. If uncertain, set catalog_id to null.
7. quantity_conflict_flag=true when quantity is ambiguous/unreadable.
8. Use notes for important parse hints only (for example: "from_missing_colon=true").
9. Return strict JSON only.

MASTER CATALOG:
${catalogText}

Output JSON:
{
  "stock_date": "YYYY-MM-DD or null",
  "confidence_overall": "high|medium|low",
  "items": [
    {
      "catalog_id": <number or null>,
      "product_raw": "<line item text>",
      "quantity_raw": "<raw quantity text or null>",
      "quantity": <integer or null>,
      "quantity_conflict_flag": <true|false>,
      "confidence": "<high|medium|low>",
      "notes": "<string or null>"
    }
  ]
}`
  }

  return `You are an expert document-vision extraction agent for a fruit store stocklist form.
Your task is to extract ALL visibly present stock records from a photographed stock sheet into strict JSON.

This form contains:
- printed product names
- handwritten stock quantities (black/blue ink)
- completely handwritten new product entries (both name and quantity handwritten) usually added to the bottom of sections
- red annotation marks (circles or loops)
- two side-by-side product entries in many rows
- multiple labelled sections

Core Extraction Principle:
Extract ALL items. Extract both printed products (even if their quantity is empty/null) AND completely handwritten extra products.
Do not infer missing items. If a printed product has no visibly written quantity beside it, still extract the product but set quantity to null.

## Quantity Cell Ownership
Many printed rows contain UP TO 2 product entries side-by-side:
- LEFT product + LEFT quantity cell
- RIGHT product + RIGHT quantity cell
Extract each as a separate item.
Never assign a handwritten number to both products. Each number belongs ONLY to its respective cell.

## Red Circle / Annotation Marks (CRITICAL)
Some items have red circles or loops drawn next to or around their quantity cell.
These are markings for the stock buyer indicating the item is selling well.
1. DO NOT TREAT A RED CIRCLE AS A "0".
2. DO NOT TREAT A RED CIRCLE AS A NUMBER.
3. If there is ONLY a red circle with no visible handwritten number inside or near it, set quantity to null and notes to "sell_marker=true".
4. If there is a red circle AND a visible handwritten number (e.g. a red circle drawn around the number 2), extract the handwritten number as the quantity, and add "sell_marker=true" to notes.

## Product Extraction Formats
For printed items, keep \`product_raw\` EXACTLY same as the printed text on the sheet.
For completely handwritten products, transcribe the handwritten product name into \`product_raw\` as accurately as possible.
Do not copy pack size quantities (like "12kg", "3kg") into the \`quantity\` field. Pack sizes belong strictly to the product name.

## Catalog Association
Below is the MASTER CATALOG mapped by ID. Use the "Navigation Guide" to spatially locate the printed text on the physical page. 
For every item you extract from the image, try to confidently match it to an ID from this catalogue based on what is printed on the page and its location. If you are very confident, provide its \`catalog_id\`. If unsure, leave \`catalog_id\` null.

MASTER CATALOG:
${catalogText}

## Output \u2014 Strict JSON Format (return only this, no extra text)
{
  "stock_date": "YYYY-MM-DD or null if not found",
  "confidence_overall": "high|medium|low",
  "items": [
    {
      "catalog_id": <number or null>,
      "product_raw": "<exact PRINTED text from form>",
      "quantity_raw": "<quantity string exactly as written, or null>",
      "quantity": <integer or null>,
      "quantity_conflict_flag": <true | false (true if ambiguous or unreadable)>,
      "confidence": "<high | medium | low>",
      "notes": "<sell_marker=true if red circle found, else null>"
    }
  ]
}`
}
