export function normalizeSubLocation(value: string) {
  if (value.toLowerCase() === 'all year') return 'All Year'
  return value
}

export function normalizeInsideSectionLabel(category: string, subLocation: string) {
  const raw = (category || subLocation || 'Unknown').trim()
  if (!raw) return 'Unknown'
  return normalizeSubLocation(raw)
}

export function formatSheetDate(value?: string) {
  if (!value) return '-'
  const parts = value.split('-')
  if (parts.length !== 3) return value
  const [y, m, d] = parts
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][
    Number(m) - 1
  ]
  return `${d} ${month ?? m} ${y.slice(-2)}`
}
