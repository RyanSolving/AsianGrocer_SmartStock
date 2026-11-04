/**
 * Squarified treemap used by the Daily Report summary photo.
 */

import { describe, expect, it } from '@jest/globals'

import { squarify } from '../../lib/treemap'

const values = [16, 9, 8, 6, 5, 5, 4, 4, 3, 3, 3, 2]

describe('squarify', () => {
  it('fills the box exactly with areas proportional to the values', () => {
    const rects = squarify(values, (v) => v, 400, 300)
    const total = values.reduce((sum, v) => sum + v, 0)

    expect(rects).toHaveLength(values.length)

    const area = rects.reduce((sum, r) => sum + r.width * r.height, 0)
    expect(area).toBeCloseTo(400 * 300, 3)

    for (const rect of rects) {
      expect(rect.width * rect.height).toBeCloseTo((rect.item / total) * 400 * 300, 3)
    }
  })

  it('keeps every rectangle inside the box', () => {
    for (const rect of squarify(values, (v) => v, 400, 300)) {
      expect(rect.x).toBeGreaterThanOrEqual(-1e-9)
      expect(rect.y).toBeGreaterThanOrEqual(-1e-9)
      expect(rect.x + rect.width).toBeLessThanOrEqual(400 + 1e-6)
      expect(rect.y + rect.height).toBeLessThanOrEqual(300 + 1e-6)
    }
  })

  it('places the largest value first', () => {
    const rects = squarify([3, 16, 9], (v) => v, 400, 300)

    expect(rects[0].item).toBe(16)
    expect(rects[0].x).toBe(0)
    expect(rects[0].y).toBe(0)
  })

  it('drops zero and negative values and handles an empty input', () => {
    expect(squarify([0, -2, 5], (v) => v, 100, 100)).toHaveLength(1)
    expect(squarify([], (v: number) => v, 100, 100)).toEqual([])
    expect(squarify([0], (v) => v, 100, 100)).toEqual([])
  })
})
