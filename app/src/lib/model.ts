// Binning, predictions, contributions, importance (spec §3, §5.2). Pure.
import type { ModelSet } from './schema'

/** Bin index of x given strictly increasing thresholds t: the number of thresholds ≤ x. */
export function bin(t: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

/** Per-feature bin counts B_j and the offset of feature j's first bin in a weights row. */
export function binLayout(ds: ModelSet): { B: number[]; offsets: number[] } {
  const B = ds.features.map((f) => f.thresholds.length + 1)
  const offsets: number[] = []
  let acc = 0
  for (const b of B) {
    offsets.push(acc)
    acc += b
  }
  return { B, offsets }
}

/** binIndex[i*J + j] = bin of row i, feature j. */
export function computeBinIndex(ds: ModelSet): Int16Array {
  const J = ds.features.length
  const rows = ds.data.rows
  const out = new Int16Array(rows.length * J)
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < J; j++) out[i * J + j] = bin(ds.features[j].thresholds, rows[i][j])
  }
  return out
}

/** binCounts[j][k] = number of instances in bin k of feature j. */
export function computeBinCounts(binIndex: Int16Array, B: number[], n: number): number[][] {
  const J = B.length
  const counts = B.map((b) => new Array<number>(b).fill(0))
  for (let i = 0; i < n; i++) for (let j = 0; j < J; j++) counts[j][binIndex[i * J + j]]++
  return counts
}

/** Linear score z[m][i] for one model and one instance. */
export function score(ds: ModelSet, offsets: number[], binIndex: Int16Array, m: number, i: number): number {
  const J = offsets.length
  const w = ds.models.weights[m]
  let z = ds.models.intercepts[m]
  for (let j = 0; j < J; j++) z += w[offsets[j] + binIndex[i * J + j]]
  return z
}

/** P[m*n + i] = predicted probability of model m for instance i, for all models. */
export function computePredictions(ds: ModelSet, offsets: number[], binIndex: Int16Array): Float32Array {
  const N = ds.models.intercepts.length
  const n = ds.data.rows.length
  const P = new Float32Array(N * n)
  for (let m = 0; m < N; m++) for (let i = 0; i < n; i++) P[m * n + i] = sigmoid(score(ds, offsets, binIndex, m, i))
  return P
}

/** Contribution of each feature (in feature index order) to instance i under model m. */
export function contributions(ds: ModelSet, offsets: number[], binIndex: Int16Array, m: number, i: number): number[] {
  const J = offsets.length
  const w = ds.models.weights[m]
  return offsets.map((o, j) => w[o + binIndex[i * J + j]])
}

/** VI[m*J + j] = Σ_k (n_jk / n) · |w[m][j][k]|. */
export function computeVI(ds: ModelSet, B: number[], offsets: number[], binCounts: number[][], n: number): Float64Array {
  const N = ds.models.intercepts.length
  const J = B.length
  const VI = new Float64Array(N * J)
  for (let m = 0; m < N; m++) {
    const w = ds.models.weights[m]
    for (let j = 0; j < J; j++) {
      let s = 0
      for (let k = 0; k < B[j]; k++) s += (binCounts[j][k] / n) * Math.abs(w[offsets[j] + k])
      VI[m * J + j] = s
    }
  }
  return VI
}

/** Feature indices sorted descending by min_m VI[m][j] (ties keep file order). */
export function computeFeatureOrder(VI: Float64Array, N: number, J: number): number[] {
  const lower = new Array<number>(J).fill(Infinity)
  for (let m = 0; m < N; m++) for (let j = 0; j < J; j++) lower[j] = Math.min(lower[j], VI[m * J + j])
  return [...Array(J).keys()].sort((a, b) => lower[b] - lower[a] || a - b)
}

/** Plot x-domain per feature: range if given, else the sample's [min, max]; degenerate → [v−1, v+1]. */
export function computeXDomain(ds: ModelSet): [number, number][] {
  return ds.features.map((f, j) => {
    let lo: number, hi: number
    if (f.range) [lo, hi] = f.range
    else {
      lo = Infinity
      hi = -Infinity
      for (const r of ds.data.rows) {
        if (r[j] < lo) lo = r[j]
        if (r[j] > hi) hi = r[j]
      }
    }
    return hi - lo === 0 ? [lo - 1, hi + 1] : [lo, hi]
  })
}

/** Weights of feature j in model m. */
export function featureWeights(ds: ModelSet, B: number[], offsets: number[], m: number, j: number): number[] {
  return ds.models.weights[m].slice(offsets[j], offsets[j] + B[j])
}

/** Largest |w| of feature j over all models (floor 0.1), for a symmetric y-domain. */
export function maxAbsWeight(ds: ModelSet, B: number[], offsets: number[], j: number): number {
  let mx = 0.1
  for (const w of ds.models.weights) for (let k = 0; k < B[j]; k++) mx = Math.max(mx, Math.abs(w[offsets[j] + k]))
  return mx
}

export interface Prepared {
  N: number
  n: number
  J: number
  B: number[]
  offsets: number[]
  binIndex: Int16Array
  binCounts: number[][]
  P: Float32Array
  VI: Float64Array
  featureOrder: number[]
  xDomain: [number, number][]
  yMax: number[]
  modelIds: string[]
  instanceIds: string[]
}

/** Everything that is computed once per loaded dataset. */
export function prepare(ds: ModelSet): Prepared {
  const N = ds.models.intercepts.length
  const n = ds.data.rows.length
  const J = ds.features.length
  const { B, offsets } = binLayout(ds)
  const binIndex = computeBinIndex(ds)
  const binCounts = computeBinCounts(binIndex, B, n)
  const P = computePredictions(ds, offsets, binIndex)
  const VI = computeVI(ds, B, offsets, binCounts, n)
  return {
    N,
    n,
    J,
    B,
    offsets,
    binIndex,
    binCounts,
    P,
    VI,
    featureOrder: computeFeatureOrder(VI, N, J),
    xDomain: computeXDomain(ds),
    yMax: ds.features.map((_, j) => maxAbsWeight(ds, B, offsets, j)),
    modelIds: ds.models.ids ?? ds.models.intercepts.map((_, m) => `m${m}`),
    instanceIds: ds.data.ids ?? ds.data.rows.map((_, i) => String(i)),
  }
}

export interface SpreadStats {
  pRef: Float32Array
  pMin: Float32Array
  pMax: Float32Array
  minModel: Int32Array
  maxModel: Int32Array
}

/** Per-instance reference/min/max predictions over the active models (ties → lowest model index). */
export function computeSpread(P: Float32Array, n: number, active: number[], ref: number): SpreadStats {
  const pRef = new Float32Array(n)
  const pMin = new Float32Array(n).fill(Infinity)
  const pMax = new Float32Array(n).fill(-Infinity)
  const minModel = new Int32Array(n).fill(-1)
  const maxModel = new Int32Array(n).fill(-1)
  pRef.set(P.subarray(ref * n, ref * n + n))
  for (const m of active) {
    const base = m * n
    for (let i = 0; i < n; i++) {
      const p = P[base + i]
      if (p < pMin[i]) {
        pMin[i] = p
        minModel[i] = m
      }
      if (p > pMax[i]) {
        pMax[i] = p
        maxModel[i] = m
      }
    }
  }
  return { pRef, pMin, pMax, minModel, maxModel }
}

/** flips[i] = pMin < τ ≤ pMax. */
export function computeFlips(s: SpreadStats, tau: number): Uint8Array {
  const n = s.pMin.length
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = s.pMin[i] < tau && s.pMax[i] >= tau ? 1 : 0
  return out
}

/** rankOf[i] ∈ 1..n by ascending pRef (ties by row index), and the rows in rank order. */
export function computeRanks(pRef: Float32Array): { rankOf: Int32Array; byRank: Int32Array } {
  const n = pRef.length
  const byRank = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => pRef[a] - pRef[b] || a - b)
  const rankOf = new Int32Array(n)
  for (let r = 0; r < n; r++) rankOf[byRank[r]] = r + 1
  return { rankOf, byRank }
}
