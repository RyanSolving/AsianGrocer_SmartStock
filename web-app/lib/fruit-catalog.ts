import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'
import { catalogInnerUnitOptions } from './stock-schema'
import type { CatalogEntry, StockMode } from './stock-schema'
import type { Section } from './sections'

function normalizeLegacyTypo(value: string) {
  return value.replace(/avocada/gi, 'Avocado')
}

function parseInnerQuantity(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInnerUnit(value: string | undefined): CatalogEntry['inner_unit'] {
  const trimmed = value?.trim() ?? ''
  return catalogInnerUnitOptions.includes(trimmed as CatalogEntry['inner_unit'])
    ? trimmed as CatalogEntry['inner_unit']
    : 'box'
}

export function normalizeCatalogEntry(entry: CatalogEntry): CatalogEntry {
  return {
    ...entry,
    code: entry.code,
    product: normalizeLegacyTypo(entry.product),
    attribute: normalizeLegacyTypo(entry.attribute),
    origin: entry.origin ?? '',
    inner_quantity: entry.inner_quantity ?? null,
    inner_unit: entry.inner_unit ?? 'box',
    official_name: normalizeLegacyTypo(entry.official_name),
    stocklist_name: normalizeLegacyTypo(entry.stocklist_name),
    is_visible: entry.is_visible ?? true,
  }
}

export function parseCSVCatalog(csvText: string): CatalogEntry[] {
  const result = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length) {
    throw new Error(`CSV parsing error: ${result.errors[0].message}`)
  }

  const entries: CatalogEntry[] = []

  for (const row of result.data) {
    if (!row.ID || !row.Location || !row['Sub-location'] || !row.Product || !row['Official Name']) {
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

    entries.push(normalizeCatalogEntry({
      id: Number.parseInt(row.ID, 10),
      code: (row.Code || row.CODE || row.code || '').trim(),
      location: row.Location.trim(),
      sub_location: row['Sub-location'].trim(),
      category: row.Category?.trim() || '',
      product: row.Product.trim(),
      attribute: row.Attribute?.trim() || '',
      origin: row.Origin?.trim() || '',
      inner_quantity: parseInnerQuantity(row['Inner Quantity']),
      inner_unit: parseInnerUnit(row['Inner Unit']),
      official_name: row['Official Name'].trim(),
      stocklist_name: row['Name on Stocklist']?.trim() || '',
      navigation_guide: guide.trim(),
      row_position: rowPosition,
      is_visible: true,
    }))
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

export function buildCatalogPrompt(catalog: CatalogEntry[], mode: StockMode, section: Section = 'fruit') {
  let catalogText = ''
  for (const item of catalog) {
    catalogText += `- [CODE: ${item.code}] "${item.stocklist_name}" (${item.official_name}) → ${item.navigation_guide}\n`
  }

  const sheetKind = mode === 'stock-closing' ? 'closing stock sheet' : 'stock-in sheet'
  if (section === 'vegies') return buildVegiesPrompt(catalogText, mode, sheetKind)

  return `You are an expert document-vision extraction agent for a fruit store stocklist form.
Your task is to extract ALL visibly present stock records from a photographed ${sheetKind} into strict JSON.
The current mode is: ${mode}.

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
Below is the MASTER CATALOG mapped by CODE. Use the "Navigation Guide" to spatially locate the printed text on the physical page.
For every item you extract from the image, try to confidently match it to a CODE from this catalogue based on what is printed on the page and its location. If you are very confident, provide its \`catalog_code\`. If unsure, leave \`catalog_code\` null.

MASTER CATALOG:
${catalogText}

## Output — Strict JSON Format (return only this, no extra text)
{
  "mode": "stock-in|stock-closing",
  "stock_date": "YYYY-MM-DD or null if not found",
  "confidence_overall": "high|medium|low",
  "items": [
    {
      "catalog_code": "<string code from catalog or null>",
      "product_raw": "<exact PRINTED text from form>",
      "quantity_raw": "<quantity string exactly as written, or null>",
      "quantity": <number or null>,
      "quantity_conflict_flag": <true | false (true if ambiguous or unreadable)>,
      "confidence": "<high | medium | low>",
      "notes": "<sell_marker=true if red circle found, else null>"
    }
  ]
}`
}


/**
 * The prompt for the vegies sheet. It is a different form from the fruit one: a grid of up to four
 * "name + count" cells per row, qualifier-only cells (15KG, LOOSE, PP), counts that are sums, ticks
 * or have a letter after them, a handwritten date, and an ORDERS block with no counts at all.
 */
function buildVegiesPrompt(catalogText: string, mode: StockMode, sheetKind: string) {
  return `You are an expert document-vision extraction agent for a vegetable store stocklist form.
Your task is to extract ALL visibly present stock records from a photographed ${sheetKind} into strict JSON.
The current mode is: ${mode}.

This form contains:
- printed product names laid out as a grid, with handwritten counts (black or blue ink) written after each name
- a handwritten date after "DATE:" near the top, written day/month/year (Australian). Example: 9/11/26 is 9 November 2026, so return "2026-11-09"
- a LEFT half and a RIGHT half of the page. Each printed row has up to two cells per half (a few rows have three), side by side
- blocks separated by grey bands: the main block of fresh vegetables first, then a block of roots, onions, potatoes, sweet potato and pumpkin (counted in sacks and bags), then an ORDERS block of herbs and leaves that is mostly a printed list with no counts
- a few completely handwritten extra items (name and count both handwritten) in empty rows near the bottom of the main block
- empty rows: ignore them

Core Extraction Principle:
Extract ALL items. Extract every printed product (even if its count is empty) AND every completely handwritten extra product.
Do not infer missing items. If a printed product has nothing written beside it, still extract the product but set quantity to null.

## Cells and counts
A cell is one printed name plus the number written right after it, before the next printed name.
Each number belongs ONLY to the cell it is written in. Never copy a number to the neighbouring cell. When two numbers sit close together, give each to the printed name that comes immediately before it.

## Qualifier cells (IMPORTANT)
Many second cells print only a short qualifier such as 15KG, 20KG, LOOSE, PP, PREPACK, BIG SIZE, RED or SAVOY. It means the SAME product as the first cell of that row, with that variation:
- row "WASH POT 5KG | 15KG" is Wash Pot 5kg and Wash Pot 15kg
- row "BROWN ONION 2KG | LOOSE" is Brown Onion 2kg and Brown Onion Loose
- row "PLAIN CABBAGE | RED | SAVOY" is three different cabbages
Each catalog line below lists the printed cells of its row and which cell it is. Use that to choose the right CODE.
For a qualifier cell, write product_raw as the first cell's text plus the qualifier, for example "WASH POT 15KG" or "BROWN ONION LOOSE".

## Reading the handwriting
- Counts are whole numbers. In this handwriting a 2 often looks like a "Z", a 4 like "Y", "H" or "Ч", a 1 like "l" or "|", and a 7 has a bar across it.
- A 0 may be written as "0", "O" or an empty oval. An empty oval or an O written in the count place IS zero: quantity 0, not null.
- Read BOTH digits of a two-digit number (for example 42, 36, 52, 46). Never drop a digit. If a digit is unclear, still give your best reading and set quantity_conflict_flag=true.
- Only a RED circle or loop is the buyer's marker. A black or blue ring drawn around a number is just the writer emphasising it: the number inside is still the count.
- A number that is crossed out is cancelled. Ignore it and use the number written beside or over it. If there is no replacement, set quantity to null and quantity_conflict_flag=true.
- A tick (✓) written instead of a number: quantity null, quantity_raw "✓", quantity_conflict_flag=true, notes "check: tick, no count".
- A number followed by a letter, for example "1P": quantity is the number, quantity_raw is exactly what was written ("1P"), quantity_conflict_flag=true, notes "check: written 1P".
- A sum such as "2+6": quantity is the total (8), quantity_raw "2+6", notes "sum 2+6".
- Nothing written: quantity null. A written zero: quantity 0. Never turn blank into 0.

## Product extraction formats
For printed items, keep product_raw close to the printed text on the sheet.
For completely handwritten extra products, transcribe the handwritten name into product_raw as accurately as possible. If a catalog item clearly is that product (for example Huai San, Kumato, Snacking Capsicum), give its code; otherwise leave catalog_code null.
Weights printed in a name (5KG, 15KG, 2KG) are part of the product name, not the count.

## Catalog Association
Below is the MASTER CATALOG for this sheet, mapped by CODE. Each line shows the block, the half of the page, the row and its printed cells, and which cell the item is.
For every item you extract, match it to a CODE from this catalog based on the printed text and its position. If you are very confident, provide catalog_code. If unsure, leave catalog_code null.
Each CODE may be used ONCE. Do not output the same code twice.

MASTER CATALOG:
${catalogText}

## Output — Strict JSON Format (return only this, no extra text)
{
  "mode": "stock-in|stock-closing",
  "stock_date": "YYYY-MM-DD or null if not found",
  "confidence_overall": "high|medium|low",
  "items": [
    {
      "catalog_code": "<string code from catalog or null>",
      "product_raw": "<printed text from the form (qualifier cells: first cell text + qualifier)>",
      "quantity_raw": "<count exactly as written, or null>",
      "quantity": <whole number or null>,
      "quantity_conflict_flag": <true | false (true if ambiguous, unreadable, or not a plain number)>,
      "confidence": "<high | medium | low>",
      "notes": "<sell_marker=true for a red mark; 'check: ...' as described above; join several with ' | '; else null>"
    }
  ]
}`
}
