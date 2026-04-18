import { buildSnowflakeStagingRecord } from '../../lib/stock-schema'
import { buildSupabaseStockCheckUpsertRow, toSupabaseMirrorItemData } from '../../lib/stock-check-save'

describe('Stock check save overwrite integration', () => {
  it('uses a stable overwrite key (user_id + date + mode) for repeated saves', () => {
    const userId = 'user-123'
    const stockDate = '2026-04-12'

    const firstRecord = buildSnowflakeStagingRecord({
      parsedData: {
        photo_id: 'stock-check-a',
        mode: 'stock-closing',
        upload_date: '2026-04-12T10:00:00Z',
        stock_date: stockDate,
        photo_url: null,
        total_items: 1,
        confidence_overall: 'high',
        items: [
          {
            catalog_code: 'APP-GRN-STD',
            product_raw: 'Granny Smith Apples',
            location: 'Inside Coolroom',
            sub_location: 'Apples',
            category: 'Apples',
            product: 'Apple',
            attribute: 'Granny Smith',
            official_name: 'Granny Smith Apples',
            stocklist_name: 'Granny Smith Apples',
            navigation_guide: '',
            row_position: 'single',
            quantity_raw: '8',
            quantity: 8,
            quantity_conflict_flag: false,
            confidence: 'high',
            catalog_match_status: 'exact',
            notes: null,
          },
        ],
      },
      forcedValidated: 'yes',
    })

    const secondRecord = buildSnowflakeStagingRecord({
      parsedData: {
        photo_id: 'stock-check-b',
        mode: 'stock-closing',
        upload_date: '2026-04-12T10:05:00Z',
        stock_date: stockDate,
        photo_url: null,
        total_items: 1,
        confidence_overall: 'high',
        items: [
          {
            catalog_code: 'APP-GRN-STD',
            product_raw: 'Granny Smith Apples',
            location: 'Inside Coolroom',
            sub_location: 'Apples',
            category: 'Apples',
            product: 'Apple',
            attribute: 'Granny Smith',
            official_name: 'Granny Smith Apples',
            stocklist_name: 'Granny Smith Apples',
            navigation_guide: '',
            row_position: 'single',
            quantity_raw: '3',
            quantity: 3,
            quantity_conflict_flag: false,
            confidence: 'high',
            catalog_match_status: 'exact',
            notes: null,
          },
        ],
      },
      forcedValidated: 'yes',
    })

    const firstUpsert = buildSupabaseStockCheckUpsertRow({
      userId,
      stockDate: firstRecord.stock_date,
      itemData: toSupabaseMirrorItemData(firstRecord),
    })

    const secondUpsert = buildSupabaseStockCheckUpsertRow({
      userId,
      stockDate: secondRecord.stock_date,
      itemData: toSupabaseMirrorItemData(secondRecord),
    })

    // Key fields must match, so upsert targets the same logical row.
    expect(firstUpsert.user_id).toBe(secondUpsert.user_id)
    expect(firstUpsert.date).toBe(secondUpsert.date)
    expect(firstUpsert.mode).toBe(secondUpsert.mode)
    expect(firstUpsert.mode).toBe('closing_check')
    expect(firstUpsert.record_name).toBe(`stock-check-${stockDate}`)
    expect(secondUpsert.record_name).toBe(`stock-check-${stockDate}`)

    // Edited stock values can differ and should replace previous item_data.
    expect(firstUpsert.item_data.items[0].quantity).toBe(8)
    expect(secondUpsert.item_data.items[0].quantity).toBe(3)
    expect(firstUpsert.item_data.items[0].quantity).not.toBe(secondUpsert.item_data.items[0].quantity)
  })

  it('maps unknown items and red_marked notes correctly for Supabase', () => {
    const record = buildSnowflakeStagingRecord({
      parsedData: {
        photo_id: 'stock-check-unknown',
        mode: 'stock-closing',
        upload_date: '2026-04-12T11:00:00Z',
        stock_date: '2026-04-12',
        photo_url: null,
        total_items: 1,
        confidence_overall: 'high',
        items: [
          {
            catalog_code: null,
            product_raw: 'Mystery Fruit',
            location: 'Unknown',
            sub_location: 'Unknown',
            category: 'Unknown',
            product: 'Unknown',
            attribute: '',
            official_name: 'Mystery Fruit',
            stocklist_name: 'Mystery Fruit',
            navigation_guide: '',
            row_position: 'single',
            quantity_raw: '2',
            quantity: 2,
            quantity_conflict_flag: false,
            confidence: 'high',
            catalog_match_status: 'unknown',
            notes: 'manual check | red_marked=true',
          },
        ],
      },
      forcedValidated: 'yes',
    })

    const itemData = toSupabaseMirrorItemData(record)

    expect(itemData.validated).toBe(true)
    expect(itemData.items.length).toBe(0)
    expect(itemData.unknown_items.length).toBe(1)
    expect(itemData.unknown_items[0].user_input).toBe('Mystery Fruit')
    expect(itemData.unknown_items[0].red_marked).toBe(true)
    expect(itemData.unknown_items[0].notes).toBe('manual check')
  })

  it('preserves null as untouched and zero as explicit stock-out', () => {
    const record = buildSnowflakeStagingRecord({
      parsedData: {
        photo_id: 'stock-check-null-vs-zero',
        mode: 'stock-closing',
        upload_date: '2026-04-12T12:00:00Z',
        stock_date: '2026-04-12',
        photo_url: null,
        total_items: 3,
        confidence_overall: 'high',
        items: [
          {
            catalog_code: 'APP-GRN-STD',
            product_raw: 'Granny Smith Apples',
            location: 'Inside Coolroom',
            sub_location: 'Apples',
            category: 'Apples',
            product: 'Apple',
            attribute: 'Granny Smith',
            official_name: 'Granny Smith Apples',
            stocklist_name: 'Granny Smith Apples',
            navigation_guide: '',
            row_position: 'single',
            quantity_raw: null,
            quantity: null,
            quantity_conflict_flag: false,
            confidence: 'high',
            catalog_match_status: 'exact',
            notes: null,
          },
          {
            catalog_code: 'CIT-LEM-STD',
            product_raw: 'Lemons',
            location: 'Inside Coolroom',
            sub_location: 'Citrus',
            category: 'Citrus',
            product: 'Lemon',
            attribute: '',
            official_name: 'Lemons',
            stocklist_name: 'Lemons',
            navigation_guide: '',
            row_position: 'single',
            quantity_raw: '0',
            quantity: 0,
            quantity_conflict_flag: false,
            confidence: 'high',
            catalog_match_status: 'exact',
            notes: null,
          },
          {
            catalog_code: null,
            product_raw: 'Mystery Fruit',
            location: 'Unknown',
            sub_location: 'Unknown',
            category: 'Unknown',
            product: 'Unknown',
            attribute: '',
            official_name: 'Mystery Fruit',
            stocklist_name: 'Mystery Fruit',
            navigation_guide: '',
            row_position: 'single',
            quantity_raw: null,
            quantity: null,
            quantity_conflict_flag: false,
            confidence: 'high',
            catalog_match_status: 'unknown',
            notes: null,
          },
        ],
      },
      forcedValidated: 'yes',
    })

    const itemData = toSupabaseMirrorItemData(record)

    expect(itemData.items).toHaveLength(2)
    expect(itemData.items[0].quantity).toBeNull()
    expect(itemData.items[1].quantity).toBe(0)
    expect(itemData.unknown_items).toHaveLength(1)
    expect(itemData.unknown_items[0].quantity).toBeNull()
  })
})
