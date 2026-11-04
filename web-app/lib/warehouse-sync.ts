/**
 * The BigQuery warehouse copy is paused (since 5 Nov 2026): no screen reads it, so saves go
 * to Supabase only. Set NEXT_PUBLIC_WAREHOUSE_SYNC=on (and restart the app) to resume the
 * background push after Stock In and Check Stock saves, and the History "Re-push" button.
 */
export const WAREHOUSE_SYNC_ENABLED = process.env.NEXT_PUBLIC_WAREHOUSE_SYNC === 'on'
