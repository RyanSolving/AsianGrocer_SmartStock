/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk). Lays out values as rectangles
 * that fill the given box, with areas proportional to the values and aspect ratios
 * kept close to square so labels stay readable.
 */

export type TreemapRect<T> = {
  item: T
  x: number
  y: number
  width: number
  height: number
}

type Box = { x: number; y: number; width: number; height: number }

function worstAspect(areas: number[], side: number) {
  const sum = areas.reduce((total, area) => total + area, 0)
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const sideSq = side * side
  const sumSq = sum * sum
  return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min))
}

function layoutRow<T>(row: Array<{ item: T; area: number }>, box: Box, out: TreemapRect<T>[]): Box {
  const rowArea = row.reduce((total, entry) => total + entry.area, 0)

  if (box.width >= box.height) {
    // Lay the row out as a vertical strip on the left.
    const stripWidth = rowArea / box.height
    let y = box.y
    for (const entry of row) {
      const height = entry.area / stripWidth
      out.push({ item: entry.item, x: box.x, y, width: stripWidth, height })
      y += height
    }
    return { x: box.x + stripWidth, y: box.y, width: box.width - stripWidth, height: box.height }
  }

  // Lay the row out as a horizontal strip on top.
  const stripHeight = rowArea / box.width
  let x = box.x
  for (const entry of row) {
    const width = entry.area / stripHeight
    out.push({ item: entry.item, x, y: box.y, width, height: stripHeight })
    x += width
  }
  return { x: box.x, y: box.y + stripHeight, width: box.width, height: box.height - stripHeight }
}

export function squarify<T>(
  items: T[],
  valueOf: (item: T) => number,
  width: number,
  height: number,
): TreemapRect<T>[] {
  const positive = items
    .map((item) => ({ item, value: valueOf(item) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = positive.reduce((sum, entry) => sum + entry.value, 0)
  if (total <= 0 || width <= 0 || height <= 0) return []

  const scale = (width * height) / total
  const queue = positive.map((entry) => ({ item: entry.item, area: entry.value * scale }))
  const out: TreemapRect<T>[] = []
  let box: Box = { x: 0, y: 0, width, height }
  let row: typeof queue = []

  while (queue.length > 0) {
    const next = queue[0]
    const side = Math.min(box.width, box.height)

    if (row.length === 0 || worstAspect([...row.map((r) => r.area), next.area], side) <= worstAspect(row.map((r) => r.area), side)) {
      row.push(next)
      queue.shift()
    } else {
      box = layoutRow(row, box, out)
      row = []
    }
  }

  if (row.length > 0) layoutRow(row, box, out)

  return out
}
