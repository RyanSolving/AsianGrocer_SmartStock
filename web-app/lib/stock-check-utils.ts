export function normalizeBlankStockCheckQuantities<T extends { quantity: number | null }>(rows: T[]) {
  return rows.map((row) => {
    if (row.quantity !== null) {
      return row
    }

    return {
      ...row,
      quantity: 0,
    }
  })
}