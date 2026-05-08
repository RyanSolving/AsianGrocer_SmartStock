/**
 * Returns today's date as a YYYY-MM-DD string in the user's **local** timezone.
 *
 * Unlike `new Date().toISOString().slice(0, 10)` which returns the UTC date
 * (and can be off by one day for timezones ahead of UTC, e.g. AEST UTC+10),
 * this function uses the local calendar date so 9 AM May 7 AEST correctly
 * returns "2026-05-07" instead of "2026-05-06".
 */
export function getLocalTodayDate(): string {
	const now = new Date()
	const year = now.getFullYear()
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}
