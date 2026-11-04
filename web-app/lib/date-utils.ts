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

/** "Tue 3 Nov" for a `YYYY-MM-DD` date, read as a local calendar day. */
export function formatDayLabel(isoDate: string): string {
	const [year, month, day] = isoDate.split('-').map(Number)
	if (!year || !month || !day) return isoDate
	return new Date(year, month - 1, day).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "9:12 am" for a timestamp, or "an earlier time" when it can't be read. */
export function formatTimeLabel(timestamp: string): string {
	const value = new Date(timestamp)
	return Number.isNaN(value.getTime()) ? 'an earlier time' : value.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}
