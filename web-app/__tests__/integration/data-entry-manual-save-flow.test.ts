import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockGetAuthContext = jest.fn()
const mockSnowflakeCreateConnection = jest.fn(() => {
  throw new Error('Snowflake should not be initialized during persist-only saves.')
})

jest.mock('../../lib/supabase/route-auth', () => ({
  getAuthContext: mockGetAuthContext,
}))

jest.mock('snowflake-sdk', () => ({
  __esModule: true,
  default: {
    createConnection: mockSnowflakeCreateConnection,
  },
  createConnection: mockSnowflakeCreateConnection,
}))

import { POST } from '../../app/api/save-to-snowflake/route'

function buildPersistOnlyPayload(quantity: number, uidGenerate?: string) {
  const payload: Record<string, unknown> = {
    data: {
      photo_id: 'stock-in-photo-001',
      mode: 'stock-in' as const,
      upload_date: '2026-04-13T09:00:00.000Z',
      stock_date: '2026-04-13',
      photo_url: null,
      total_items: 1,
      confidence_overall: 'high' as const,
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
          row_position: 'single' as const,
          quantity_raw: String(quantity),
          quantity,
          quantity_conflict_flag: false,
          confidence: 'high' as const,
          catalog_match_status: 'exact' as const,
          notes: null,
        },
      ],
    },
    validated: 'no' as const,
    unknown_items: [],
    missing_catalog_items: [],
    persist_only: true,
  }

  if (uidGenerate) {
    payload.uid_generate = uidGenerate
  }

  return payload
}

describe('Data Entry manual save flow', () => {
  const updateCalls: Array<Record<string, unknown>> = []
  const insertCalls: Array<Record<string, unknown>> = []

  beforeEach(() => {
    updateCalls.length = 0
    insertCalls.length = 0
    mockSnowflakeCreateConnection.mockClear()
    mockGetAuthContext.mockReset()

    let updateEqCallCount = 0

    const updateChain = {
      eq: jest.fn(() => {
        updateEqCallCount += 1
        if (updateEqCallCount >= 2) {
          return Promise.resolve({ error: null })
        }

        return updateChain
      }),
    }

    const insertChain = {
      select: jest.fn(() => insertChain),
      single: jest.fn(() => Promise.resolve({ data: { uid_generate: 'manual-draft-uid' }, error: null })),
    }

    const mockSupabase = {
      from: jest.fn(() => ({
        update: jest.fn((payload: Record<string, unknown>) => {
          updateCalls.push(payload)
          updateEqCallCount = 0
          return updateChain
        }),
        insert: jest.fn((payload: Record<string, unknown>) => {
          insertCalls.push(payload)
          return insertChain
        }),
      })),
    }

    mockGetAuthContext.mockResolvedValue({
      user: { id: 'user-123', email: 'staff@example.com' },
      roles: ['staff'],
      supabase: mockSupabase,
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('saves edited stock-in drafts to Supabase and keeps later edits on the same record', async () => {
    const firstResponse = await POST(
      new Request('http://localhost/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPersistOnlyPayload(4, 'uid-data-entry-001')),
      }),
    )

    const secondResponse = await POST(
      new Request('http://localhost/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPersistOnlyPayload(9, 'uid-data-entry-001')),
      }),
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockSnowflakeCreateConnection).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(2)

    expect(updateCalls[0]).toMatchObject({
      final_output: {
        photo_id: 'stock-in-photo-001',
        mode: 'stock-in',
        items: [
          {
            official_name: 'Granny Smith Apples',
            quantity: 4,
          },
        ],
      },
      edited: true,
    })

    expect(updateCalls[1]).toMatchObject({
      final_output: {
        photo_id: 'stock-in-photo-001',
        mode: 'stock-in',
        items: [
          {
            official_name: 'Granny Smith Apples',
            quantity: 9,
          },
        ],
      },
      edited: true,
    })

    const firstJson = await firstResponse.json()
    const secondJson = await secondResponse.json()

    expect(firstJson).toMatchObject({
      success: true,
      uid_generate: 'uid-data-entry-001',
      message: 'Saved to Supabase. You can keep editing before loading to Snowflake.',
    })

    expect(secondJson).toMatchObject({
      success: true,
      uid_generate: 'uid-data-entry-001',
      message: 'Saved to Supabase. You can keep editing before loading to Snowflake.',
    })
  })

  it('creates a manual draft row when no uid exists, then updates the same row on later saves', async () => {
    const firstResponse = await POST(
      new Request('http://localhost/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPersistOnlyPayload(5)),
      }),
    )

    const firstJson = await firstResponse.json()

    const secondResponse = await POST(
      new Request('http://localhost/api/save-to-snowflake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildPersistOnlyPayload(11),
          uid_generate: firstJson.uid_generate,
        }),
      }),
    )

    const secondJson = await secondResponse.json()

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockSnowflakeCreateConnection).not.toHaveBeenCalled()
    expect(insertCalls).toHaveLength(1)
    expect(updateCalls).toHaveLength(1)

    expect(insertCalls[0]).toMatchObject({
      user_id: 'user-123',
      input_file_name: expect.stringMatching(/^manual-entry-stock-/),
      catalog_version: 'manual',
      edited: true,
      stock_mode: 'arrival_entry',
    })

    expect(updateCalls[0]).toMatchObject({
      final_output: {
        photo_id: 'stock-in-photo-001',
        mode: 'stock-in',
        items: [
          {
            official_name: 'Granny Smith Apples',
            quantity: 11,
          },
        ],
      },
      edited: true,
    })

    expect(firstJson).toMatchObject({
      success: true,
      uid_generate: 'manual-draft-uid',
      message: 'Saved to Supabase. You can keep editing before loading to Snowflake.',
    })

    expect(secondJson).toMatchObject({
      success: true,
      uid_generate: 'manual-draft-uid',
      message: 'Saved to Supabase. You can keep editing before loading to Snowflake.',
    })
  })
})