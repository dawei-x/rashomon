// Constraint ops, predicates, activeMask, descriptions (spec §5.1, §5.3, §7.5). Pure.
import type { ModelSet } from './schema'
import { binLayout } from './model'
import { curveHitsRect, segments, type Rect } from './geometry'
import { fixed, num } from './format'

export interface MonotoneOp {
  id: string
  kind: 'monotone'
  feature: string
  direction: 'up' | 'down'
  enabled: boolean
  rationale?: string
  createdAt: string
}
export interface FilterOp {
  id: string
  kind: 'filter'
  feature: string
  mode: 'keep' | 'exclude'
  xRange: [number, number]
  yRange: [number, number]
  /** All loaded models inside the rectangle at creation time. */
  modelIdx: number[]
  enabled: boolean
  rationale?: string
  createdAt: string
}
export type Op = MonotoneOp | FilterOp

export interface ProvenanceEntry {
  description: string
  rationale?: string
  enabled: boolean
  createdAt: string
  fromFile: string
}

const EPS = 1e-9

export function isMonotone(w: ArrayLike<number>, direction: 'up' | 'down'): boolean {
  for (let k = 0; k + 1 < w.length; k++) {
    if (direction === 'up' ? w[k + 1] < w[k] - EPS : w[k + 1] > w[k] + EPS) return false
  }
  return true
}

/** Model predicate for one op. Monotone ops are evaluated from the weights; filter ops from modelIdx. */
export function opPredicate(ds: ModelSet, op: Op): (m: number) => boolean {
  if (op.kind === 'monotone') {
    const j = ds.features.findIndex((f) => f.name === op.feature)
    const { B, offsets } = binLayout(ds)
    return (m) => isMonotone(ds.models.weights[m].slice(offsets[j], offsets[j] + B[j]), op.direction)
  }
  const inside = new Set(op.modelIdx)
  return op.mode === 'keep' ? (m) => inside.has(m) : (m) => !inside.has(m)
}

/** All-true, then AND each enabled op's predicate in order. */
export function computeActiveMask(ds: ModelSet, ops: Op[]): boolean[] {
  const N = ds.models.intercepts.length
  const mask = new Array<boolean>(N).fill(true)
  for (const op of ops) {
    if (!op.enabled) continue
    const pred = opPredicate(ds, op)
    for (let m = 0; m < N; m++) if (mask[m] && !pred(m)) mask[m] = false
  }
  return mask
}

/** All loaded models (active or not) whose curve for feature j passes through the rectangle. */
export function modelsInRect(ds: ModelSet, j: number, xDomain: [number, number], rect: Rect): number[] {
  const { B, offsets } = binLayout(ds)
  const t = ds.features[j].thresholds
  const out: number[] = []
  ds.models.weights.forEach((row, m) => {
    if (curveHitsRect(segments(t, row.slice(offsets[j], offsets[j] + B[j]), xDomain), rect)) out.push(m)
  })
  return out
}

/** Index of the lowest-loss active model (ties → lowest index), or null. */
export function referenceModel(loss: number[], active: number[]): number | null {
  let best: number | null = null
  for (const m of active) if (best === null || loss[m] < loss[best]) best = m
  return best
}

export function describeOp(op: Op): string {
  if (op.kind === 'monotone') return `monotone ${op.direction}: ${op.feature}`
  const n = op.modelIdx.length
  return (
    `filter ${op.mode}: ${op.feature} — ${n} model${n === 1 ? '' : 's'}` +
    ` · x ${num(op.xRange[0])}–${num(op.xRange[1])}` +
    ` · w ${fixed(op.yRange[0], 2)}–${fixed(op.yRange[1], 2)}`
  )
}

// --- Pure op-list edits. The session store wraps each with an undo snapshot.

export function withMonotone(ops: Op[], feature: string, direction: 'up' | 'down' | null, id: string, now: string): Op[] {
  const rest = ops.filter((o) => !(o.kind === 'monotone' && o.feature === feature))
  if (direction === null) return rest
  return [...rest, { id, kind: 'monotone', feature, direction, enabled: true, createdAt: now }]
}

export function withToggled(ops: Op[], id: string): Op[] {
  return ops.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o))
}

export function withDeleted(ops: Op[], id: string): Op[] {
  return ops.filter((o) => o.id !== id)
}

/** Truncate ops so that the given op is the last one; 'initial' empties the list. */
export function withRemovedLater(ops: Op[], id: string | 'initial'): Op[] {
  if (id === 'initial') return []
  const at = ops.findIndex((o) => o.id === id)
  return at < 0 ? ops : ops.slice(0, at + 1)
}

export function withRationale(ops: Op[], id: string, text: string): Op[] {
  return ops.map((o) => (o.id === id ? { ...o, rationale: text || undefined } : o))
}
