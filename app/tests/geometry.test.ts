import { describe, expect, it } from 'vitest'
import { curveHitsRect, segments, stepPoints } from '../src/lib/geometry'
import { bin } from '../src/lib/model'

const t = [2, 4, 6, 8]
const w = [0.1, 0.2, 0.3, 0.4, 0.5]

describe('segments', () => {
  it('splits the domain at interior thresholds', () => {
    const g = segments([10], [-0.5, 0.5], [5, 12])
    expect(g.segments).toEqual([
      { k: 0, lo: 5, hi: 10, w: -0.5 },
      { k: 1, lo: 10, hi: 12, w: 0.5 },
    ])
    expect(g.risers).toEqual([{ x: 10, y0: -0.5, y1: 0.5 }])
    expect(stepPoints(g.segments)).toEqual([
      [5, -0.5],
      [10, 0.5],
      [12, 0.5],
    ])
  })

  it('starts at the bin containing the left edge when thresholds lie outside the domain', () => {
    const g = segments(t, w, [5, 7])
    expect(g.segments[0].w).toBe(w[bin(t, 5)])
    expect(g.segments).toEqual([
      { k: 2, lo: 5, hi: 6, w: 0.3 },
      { k: 3, lo: 6, hi: 7, w: 0.4 },
    ])
    expect(g.risers).toEqual([{ x: 6, y0: 0.3, y1: 0.4 }])
  })

  it('handles domains entirely above or below the thresholds', () => {
    expect(segments(t, w, [9, 12]).segments).toEqual([{ k: 4, lo: 9, hi: 12, w: 0.5 }])
    expect(segments(t, w, [0, 1]).segments).toEqual([{ k: 0, lo: 0, hi: 1, w: 0.1 }])
    expect(segments(t, w, [9, 12]).risers).toEqual([])
  })

  it('handles domain edges exactly on thresholds', () => {
    const a = segments(t, w, [3, 6])
    expect(a.segments).toEqual([
      { k: 1, lo: 3, hi: 4, w: 0.2 },
      { k: 2, lo: 4, hi: 6, w: 0.3 },
    ])
    expect(a.risers.map((r) => r.x)).toEqual([4])
    const b = segments(t, w, [4, 6])
    expect(b.segments).toEqual([{ k: 2, lo: 4, hi: 6, w: 0.3 }])
    expect(b.risers).toEqual([])
  })

  it('handles a single-bin feature', () => {
    expect(segments([], [0.7], [0, 1]).segments).toEqual([{ k: 0, lo: 0, hi: 1, w: 0.7 }])
  })
})

describe('curveHitsRect', () => {
  const g = segments([10], [-0.5, 0.5], [5, 12])
  it('hits on a segment', () => {
    expect(curveHitsRect(g, { x0: 6, x1: 8, y0: -0.6, y1: -0.4 })).toBe(true)
    expect(curveHitsRect(g, { x0: 6, x1: 8, y0: 0.4, y1: 0.6 })).toBe(false)
  })
  it('hits on a riser', () => {
    expect(curveHitsRect(g, { x0: 9.9, x1: 10.1, y0: 0, y1: 0.1 })).toBe(true)
    expect(curveHitsRect(g, { x0: 10.5, x1: 11, y0: 0, y1: 0.1 })).toBe(false)
  })
  it('ignores bins outside the plotted domain', () => {
    const h = segments(t, w, [5, 7])
    // bin 0 (w = 0.1) is not drawn, so a rectangle at that height never matches
    expect(curveHitsRect(h, { x0: 5, x1: 5.5, y0: 0.05, y1: 0.15 })).toBe(false)
    expect(curveHitsRect(h, { x0: 5, x1: 5.5, y0: 0.25, y1: 0.35 })).toBe(true)
  })
})
