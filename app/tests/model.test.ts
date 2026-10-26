import { describe, expect, it } from 'vitest'
import { bin, computeFlips, computeRanks, computeSpread, contributions, prepare } from '../src/lib/model'
import { tiny } from './helpers'

// Expected values computed by hand from tests/fixtures/tiny.json:
//        i0 (12,1)  i1 (5,0)   i2 (10,0)  i3 (8,1)
// m0     0.622459   0.182426   0.377541   0.377541
// m1     0.425557   0.401312   0.231475   0.622459
// m2     0.249740   0.268941   0.475021   0.119203
const EXPECTED_P = [
  [0.622459, 0.182426, 0.377541, 0.377541],
  [0.425557, 0.401312, 0.231475, 0.622459],
  [0.24974, 0.268941, 0.475021, 0.119203],
]

describe('bin', () => {
  const t = [10, 20, 30]
  it('follows the [t[k-1], t[k]) convention', () => {
    expect(bin(t, 9.99)).toBe(0)
    expect(bin(t, 10)).toBe(1)
    expect(bin(t, 19.99)).toBe(1)
    expect(bin(t, 30)).toBe(3)
    expect(bin(t, 1e9)).toBe(3)
    expect(bin([0.5], 0)).toBe(0)
    expect(bin([0.5], 1)).toBe(1)
    expect(bin([], 5)).toBe(0)
  })
})

describe('prepare (tiny fixture)', () => {
  const p = prepare(tiny())

  it('computes predictions for all models', () => {
    expect(p.N).toBe(3)
    expect(p.n).toBe(4)
    for (let m = 0; m < 3; m++)
      for (let i = 0; i < 4; i++) expect(p.P[m * 4 + i]).toBeCloseTo(EXPECTED_P[m][i], 5)
  })

  it('bins the threshold value into the upper bin', () => {
    // row 2 has A = 10 = threshold
    expect(p.binIndex[2 * 2 + 0]).toBe(1)
    expect(p.binCounts).toEqual([
      [2, 2],
      [2, 2],
    ])
  })

  it('computes contributions', () => {
    expect(contributions(tiny(), p.offsets, p.binIndex, 0, 0)).toEqual([0.5, 1])
    expect(contributions(tiny(), p.offsets, p.binIndex, 2, 1)).toEqual([-0.3, 0.5])
  })

  it('computes importance and orders features by lower-bound importance', () => {
    // VI: m0 A .5 B .5; m1 A .4 B .45; m2 A .45 B .5 → min A .4, min B .45
    expect(Array.from(p.VI)).toEqual([0.5, 0.5, 0.4, 0.45, 0.45, 0.5].map((v) => expect.closeTo(v, 10)))
    expect(p.featureOrder).toEqual([1, 0])
  })

  it('uses the sample range when no range is given', () => {
    expect(p.xDomain).toEqual([
      [5, 12],
      [0, 1],
    ])
    expect(p.modelIds).toEqual(['m0', 'm1', 'm2'])
    expect(p.instanceIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('widens a degenerate domain', () => {
    const ds = tiny()
    ds.data.rows = ds.data.rows.map((r) => [7, r[1]])
    expect(prepare(ds).xDomain[0]).toEqual([6, 8])
  })
})

describe('spread, flips, ranks', () => {
  const p = prepare(tiny())

  it('computes min/max roles over all active models', () => {
    const s = computeSpread(p.P, 4, [0, 1, 2], 0)
    expect(Array.from(s.minModel)).toEqual([2, 0, 1, 2])
    expect(Array.from(s.maxModel)).toEqual([0, 1, 2, 1])
    expect(s.pMin[0]).toBeCloseTo(0.24974, 5)
    expect(s.pMax[3]).toBeCloseTo(0.622459, 5)
    expect(Array.from(computeFlips(s, 0.5))).toEqual([1, 0, 0, 1])
    expect(Array.from(computeFlips(s, 0.4))).toEqual([1, 1, 1, 1])
  })

  it('gives zero spread with one model', () => {
    const s = computeSpread(p.P, 4, [1], 1)
    expect(Array.from(s.minModel)).toEqual([1, 1, 1, 1])
    expect(Array.from(s.maxModel)).toEqual([1, 1, 1, 1])
    expect(Array.from(computeFlips(s, 0.5))).toEqual([0, 0, 0, 0])
  })

  it('ranks by pRef, ties by row index', () => {
    const s = computeSpread(p.P, 4, [0, 1, 2], 0)
    const r = computeRanks(s.pRef)
    expect(Array.from(r.byRank)).toEqual([1, 2, 3, 0])
    expect(Array.from(r.rankOf)).toEqual([4, 1, 2, 3])
  })
})
