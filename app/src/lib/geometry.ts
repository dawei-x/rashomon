// Feature-curve segments clipped to a domain, and rectangle intersection (spec §5.3). Pure.
import { bin } from './model'

export interface Segment {
  k: number
  lo: number
  hi: number
  w: number
}
export interface Riser {
  x: number
  y0: number
  y1: number
}

/** Horizontal segments (one per bin visible in [xlo, xhi]) and vertical risers at interior thresholds. */
export function segments(
  t: ArrayLike<number>,
  w: ArrayLike<number>,
  [xlo, xhi]: [number, number],
): { segments: Segment[]; risers: Riser[] } {
  const B = t.length + 1
  const out: Segment[] = []
  let k = bin(t, xlo)
  for (;;) {
    const lo = out.length === 0 ? xlo : t[k - 1]
    const hi = k === B - 1 ? xhi : Math.min(t[k], xhi)
    out.push({ k, lo, hi, w: w[k] })
    if (k === B - 1 || hi >= xhi) break
    k += 1
  }
  const risers: Riser[] = []
  for (let r = 0; r < t.length; r++) {
    if (xlo < t[r] && t[r] < xhi) {
      risers.push({ x: t[r], y0: Math.min(w[r], w[r + 1]), y1: Math.max(w[r], w[r + 1]) })
    }
  }
  return { segments: out, risers }
}

/** Points for a step-after line through the segments: (lo, w) per segment, then (last.hi, last.w). */
export function stepPoints(segs: Segment[]): [number, number][] {
  const pts: [number, number][] = segs.map((s) => [s.lo, s.w])
  const last = segs[segs.length - 1]
  pts.push([last.hi, last.w])
  return pts
}

export interface Rect {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** True iff the curve passes through the rectangle (a segment or a riser overlaps it). */
export function curveHitsRect(geom: { segments: Segment[]; risers: Riser[] }, r: Rect): boolean {
  for (const s of geom.segments) {
    if (s.lo <= r.x1 && s.hi >= r.x0 && r.y0 <= s.w && s.w <= r.y1) return true
  }
  for (const v of geom.risers) {
    if (r.x0 <= v.x && v.x <= r.x1 && v.y0 <= r.y1 && v.y1 >= r.y0) return true
  }
  return false
}
