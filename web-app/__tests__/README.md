# Integration Tests

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm test:watch
```

## Test Coverage

### Save-to-History Sync Integration Test
**File:** `__tests__/integration/save-to-history-sync.test.ts`

This is a regression test for the bug where transcription history showed raw OCR data instead of staff-edited validated data.

#### What It Tests

1. **Edited payload persistence**: Verifies that when staff edits quantities, metadata, and resolves conflicts, those edits are merged into the payload saved to Snowflake AND synced back to `event_generate.final_output`

2. **Event record update**: Confirms that the `save-to-snowflake` API route calls the Supabase update to set `event_generate.final_output` and `edited=true` when a `uid_generate` is present

3. **History reload**: Ensures the client-side `saveToSnowflake()` function triggers `loadTranscriptionHistory()` after successful save, so the UI reflects corrected data immediately

4. **Error handling**: Tests that if history sync fails (network error, permission issue), the Snowflake save still succeeds but returns a warning so users are informed

5. **Data integrity**: Validates that individual field edits (quantities, metadata, conflict flags) are preserved through the save-to-history flow

#### The Bug

**Before fix:**
- User parses photo → OCR extraction stored in `event_generate.final_output`
- User edits quantities/metadata → State in React component (unsaved)
- User validates → Payload sent to `/api/save-to-snowflake`
- Save writes to Snowflake (correct data) but did NOT update `event_generate.final_output`
- History endpoint reads `event_generate.final_output` → returns raw OCR, not edits

**After fix:**
- Save route now merges edited items into a persisted final output
- Updates `event_generate.final_output` with edited data when `uid_generate` exists
- Client reloads history after save
- History endpoint returns edited data ✓

#### Running Just This Test

```bash
npx jest save-to-history-sync.test.ts
```

#### Example Scenario Tested

1. OCR parses: "Granny Smith Apples, qty: 42"
2. Staff corrects: "Granny Smith Apples, qty: 38 (corrected by staff)"
3. Before fix: History shows qty 42
4. After fix: History shows qty 38 ✓

## Notes for Future Test Setup

When ready to add more tests:

- Use `jest --coverage` to check test coverage
- Tests can mock Supabase client using `@supabase/supabase-js` (see Jest docs for mocking)
- For API route tests, import the route handler directly and pass mock `Request`/`NextResponse`
- Keep integration tests focused on user workflows (parse → edit → validate → save → history)
