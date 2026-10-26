import { describe, expect, it } from 'vitest'
import {
  computeActiveMask,
  describeOp,
  isMonotone,
  modelsInRect,
  referenceModel,
  withRemovedLater,
  type FilterOp,
  type MonotoneOp,
} from '../src/lib/constraints'
import { tiny } from './helpers'

const mono = (feature: string, direction: 'up' | 'down', enabled = true): MonotoneOp => ({
  id: `${feature}${direction}`,
  kind: 'monotone',
  feature,
  direction,
  enabled,
  createdAt: '',
})
const filt = (feature: string, mode: 'keep' | 'exclude', modelIdx: number[], enabled = true): FilterOp => ({
  id: `f${feature}${mode}`,
  kind: 'filter',
  feature,
  mode,
  xRange: [0, 1],
  yRange: [-1, 1],
  modelIdx,
  enabled,
  createdAt: '',
})

describe('monotone predicate', () => {
  it('tolerates 1e-9', () => {
    expect(isMonotone([0, 1, 1 - 5e-10], 'up')).toBe(true)
    expect(isMonotone([0, 1, 0.99], 'up')).toBe(false)
    expect(isMonotone([1, 0, 1e-10], 'down')).toBe(true)
    expect(isMonotone([0.3], 'down')).toBe(true)
  })

  it('selects the expected fixture models', () => {
    const ds = tiny()
    // A: m0 [-.5,.5] up, m1 [.4,-.4] down, m2 [-.3,.6] up; B: m0 [0,1] up, m1 [0,.9] up, m2 [.5,-.5] down
    expect(computeActiveMask(ds, [mono('A', 'up')])).toEqual([true, false, true])
    expect(computeActiveMask(ds, [mono('A', 'down')])).toEqual([false, true, false])
    expect(computeActiveMask(ds, [mono('B', 'up')])).toEqual([true, true, false])
    expect(computeActiveMask(ds, [mono('B', 'down')])).toEqual([false, false, true])
    expect(computeActiveMask(ds, [mono('A', 'up'), mono('B', 'up')])).toEqual([true, false, false])
    expect(computeActiveMask(ds, [mono('A', 'up', false)])).toEqual([true, true, true])
  })
})

describe('filter predicate', () => {
  const ds = tiny()
  it('keeps or excludes the stored model list', () => {
    expect(computeActiveMask(ds, [filt('A', 'keep', [0, 2])])).toEqual([true, false, true])
    expect(computeActiveMask(ds, [filt('A', 'exclude', [0, 2])])).toEqual([false, true, false])
  })

  it('re-activates a model when the constraint hiding it is disabled', () => {
    // monotone up on A hides m1; a rectangle on B matches m1 and m2 (computed over all loaded models)
    const idx = modelsInRect(ds, 1, [0, 1], { x0: 0.6, x1: 1, y0: -0.6, y1: 0.95 })
    expect(idx).toEqual([1, 2])
    const keep = filt('B', 'keep', idx)
    expect(computeActiveMask(ds, [mono('A', 'up'), keep])).toEqual([false, false, true])
    expect(computeActiveMask(ds, [mono('A', 'up', false), keep])).toEqual([false, true, true])
  })
})

describe('modelsInRect', () => {
  const ds = tiny()
  it('matches on segments', () => {
    expect(modelsInRect(ds, 0, [5, 12], { x0: 6, x1: 8, y0: -0.6, y1: -0.4 })).toEqual([0])
  })
  it('matches on risers', () => {
    // m2 is hit only by its riser at x = 10 (from -0.3 to 0.6); m1's riser tops out at 0.4
    expect(modelsInRect(ds, 0, [5, 12], { x0: 9.9, x1: 10.1, y0: 0.45, y1: 0.55 })).toEqual([0, 2])
  })
  it('respects the plotted domain', () => {
    // with a domain right of the threshold only bin 1 is drawn
    expect(modelsInRect(ds, 0, [11, 12], { x0: 11, x1: 12, y0: -0.6, y1: -0.25 })).toEqual([1])
  })
})

describe('misc', () => {
  it('picks the lowest-loss active model, ties to the lowest index', () => {
    expect(referenceModel([0.3, 0.2, 0.2], [0, 1, 2])).toBe(1)
    expect(referenceModel([0.3, 0.2, 0.2], [0, 2])).toBe(2)
    expect(referenceModel([0.3], [])).toBe(null)
  })

  it('describes ops', () => {
    expect(describeOp(mono('age', 'up'))).toBe('monotone up: age')
    const f: FilterOp = { ...filt('sod', 'keep', Array.from({ length: 12 }, (_, i) => i)), xRange: [120, 135], yRange: [-2.1, 0] }
    expect(describeOp(f)).toBe('filter keep: sod — 12 models · x 120–135 · w −2.10–0.00')
  })

  it('truncates for remove-later', () => {
    const ops = [mono('A', 'up'), mono('B', 'up'), filt('A', 'keep', [0])]
    expect(withRemovedLater(ops, 'Bup').map((o) => o.id)).toEqual(['Aup', 'Bup'])
    expect(withRemovedLater(ops, 'initial')).toEqual([])
  })
})
