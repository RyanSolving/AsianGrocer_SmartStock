/** True when a Supabase query failed because the table is missing (its migration has not run yet). */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '')
}
