export const STATUS = {
  SAVED: '✅ Saved!',
  DRAFT_RECOVERED: 'Draft recovered — continue where you left off.',
  STARTING_FRESH: 'Starting fresh.',
  OFFLINE_QUEUED: 'Saved offline — will sync when connected.',
  RECORD_LOADED: 'Record loaded for editing.',
  READY_MANUAL: 'Ready — add items below.',
  VALIDATION_OK: 'All checked ✓',
  VALIDATION_CONFLICTS: (n: number) => `${n} item${n > 1 ? 's' : ''} need review.`,
  SYNCED: (n: number) => `${n} offline save${n > 1 ? 's' : ''} synced.`,
  ITEM_ADDED: (name: string, qty: number) => `${name} added — ${qty} boxes`,
} as const
