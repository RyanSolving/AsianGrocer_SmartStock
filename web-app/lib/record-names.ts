export function buildManualEntryRecordName(stockDate: string) {
	const normalizedDate = stockDate.trim()
	return `manual-entry-stock-${normalizedDate}`
}

export function buildStockCheckRecordName(stockDate: string) {
	const normalizedDate = stockDate.trim()
	return `stock-check-${normalizedDate}`
}
