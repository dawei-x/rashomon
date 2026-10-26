import { describe, expect, it } from 'vitest'
import { Session } from '../src/lib/session.svelte'
import { modelsInRect } from '../src/lib/constraints'
import { MemoryStorage, seq, tinyText } from './helpers'

function fresh(storage = new MemoryStorage()) {
  const s = new Session({ storage, random: seq(), now: () => '2026-01-01T00:00:00.000Z' })
  const r = s.loadText(tinyText(), 'tiny.json')
  expect(r.ok).toBe(true)
  return s
}

describe('session basics', () => {
  it('starts with all models active and the lowest-loss reference', () => {
    const s = fresh()
    expect(s.activeCount).toBe(3)
    expect(s.refModel).toBe(0)
    expect(s.flipCount).toBe(2)
    expect(s.flipPct).toBe(50)
    expect(s.visibleInstances).toEqual([1, 2, 3, 0])
  })

  it('rejects invalid uploads and keeps the current session', () => {
    const s = fresh()
    s.setMonotone('A', 'up')
    const r = s.loadText('{"schema":"nope"}', 'bad.json')
    expect(r.ok).toBe(false)
    expect(s.ops.length).toBe(1)
    expect(s.loadText('not json', 'bad.json').ok).toBe(false)
  })
})

describe('ops, undo/redo', () => {
  it('cycles monotone none → up → down → none, each undoable', () => {
    const s = fresh()
    s.cycleMonotone('A')
    expect(s.monotoneOf('A')).toBe('up')
    expect(s.activeModels).toEqual([0, 2])
    s.cycleMonotone('A')
    expect(s.monotoneOf('A')).toBe('down')
    expect(s.ops.length).toBe(1)
    s.cycleMonotone('A')
    expect(s.ops).toEqual([])
    s.undo()
    expect(s.monotoneOf('A')).toBe('down')
    s.undo()
    expect(s.monotoneOf('A')).toBe('up')
    s.redo()
    expect(s.monotoneOf('A')).toBe('down')
    s.cycleMonotone('B') // a new change clears redo
    expect(s.redoStack).toEqual([])
  })

  it('restores the same filter op after undo → redo and after reload', () => {
    const storage = new MemoryStorage()
    const s = fresh(storage)
    const idx = modelsInRect(s.dataset!, 0, s.prep!.xDomain[0], { x0: 9.9, x1: 10.1, y0: 0.45, y1: 0.55 })
    s.addFilter('A', 'keep', [10, 10.1], [0.45, 0.55], idx, 'why')
    const op = s.ops[0]
    expect(op.kind === 'filter' && op.modelIdx).toEqual([0, 2])
    expect(s.activeModels).toEqual([0, 2])
    s.undo()
    expect(s.activeModels).toEqual([0, 1, 2])
    s.redo()
    expect(s.ops[0]).toEqual(op)
    expect(s.activeModels).toEqual([0, 2])
    const again = fresh(storage) // same file text → same hash → restored
    expect(again.ops).toEqual([op])
    expect(again.activeModels).toEqual([0, 2])
  })

  it('toggles, deletes, edits rationale, and removes later constraints', () => {
    const s = fresh()
    s.setMonotone('A', 'up')
    s.setMonotone('B', 'up')
    const [a, b] = s.ops.map((o) => o.id)
    expect(s.activeModels).toEqual([0])
    s.toggleOp(a)
    expect(s.activeModels).toEqual([0, 1])
    s.setRationale(b, 'clinical prior')
    expect(s.ops[1].rationale).toBe('clinical prior')
    s.removeLater(a)
    expect(s.ops.map((o) => o.id)).toEqual([a])
    expect(s.ops[0].enabled).toBe(false) // remove-later does not restore earlier flags
    s.removeLater('initial')
    expect(s.ops).toEqual([])
    s.undo()
    s.undo()
    expect(s.ops.map((o) => o.id)).toEqual([a, b])
    s.deleteOp(a)
    expect(s.ops.map((o) => o.id)).toEqual([b])
    expect(new Set([a, b]).size).toBe(2)
    expect(a).toMatch(/^[a-z0-9]{6}$/)
  })
})

describe('transition rules', () => {
  it('clears the selected model when it is hidden', () => {
    const s = fresh()
    s.toggleSelectedModel(1)
    s.setMonotone('A', 'up') // hides m1
    expect(s.selectedModel).toBe(null)
    s.toggleSelectedModel(2)
    s.setMonotone('B', 'up') // hides m2 as well
    expect(s.selectedModel).toBe(null)
  })

  it('resets a rank zoom with a toast when the reference model changes', () => {
    const s = fresh()
    s.setRankRange(2, 3)
    expect(s.visibleInstances).toEqual([2, 3])
    s.setMonotone('B', 'up') // m0 stays reference
    expect(s.instanceFilter.kind).toBe('rankRange')
    s.setMonotone('A', 'down') // only m1 survives → reference changes
    expect(s.refModel).toBe(1)
    expect(s.instanceFilter.kind).toBe('none')
    expect(s.toast).toBe('Ordering changed — zoom reset')
  })

  it('handles zero active models without NaN', () => {
    const s = fresh()
    s.setMonotone('A', 'up')
    s.setMonotone('B', 'down') // A-up {0,2} ∩ B-down {2} = {2}
    expect(s.activeModels).toEqual([2])
    expect(s.flipCount).toBe(0)
    s.setMonotone('A', 'down') // {1} ∩ {2} = ∅
    expect(s.activeCount).toBe(0)
    expect(s.refModel).toBe(null)
    expect(s.flipCount).toBe(undefined)
    expect(s.flipPct).toBe(undefined)
    expect(s.exportObject()).toBe(null)
    s.undo()
    expect(s.activeCount).toBe(1)
  })

  it('flips-only and rank brush replace each other; reset clears; selection survives', () => {
    const s = fresh()
    s.selectInstance(1)
    s.setFlipsOnly(true)
    expect(s.visibleInstances).toEqual([3, 0])
    s.setRankRange(1, 2)
    expect(s.instanceFilter.kind).toBe('rankRange')
    expect(s.visibleInstances).toEqual([1, 2])
    s.setFlipsOnly(true)
    expect(s.instanceFilter.kind).toBe('flippedOnly')
    expect(s.selectedInstance).toBe(1) // not visible, but kept
    s.setThreshold(0.7)
    expect(s.nVisible).toBe(0)
    s.resetInstanceFilter()
    expect(s.nVisible).toBe(4)
  })
})

describe('export / import', () => {
  it('round-trips a one-model subset as a new baseline', () => {
    const s = fresh()
    s.addLabel('A', 'revisit')
    s.setNote('B', 'binary flag')
    s.setThreshold(0.42)
    s.setMonotone('B', 'down') // only m2
    const out = s.exportObject()!
    const t = new Session({ storage: new MemoryStorage(), random: seq(7) })
    const r = t.loadText(JSON.stringify(out), 'subset.json')
    expect(r.ok).toBe(true)
    expect(t.prep!.N).toBe(1)
    expect(t.prep!.modelIds).toEqual(['m2'])
    expect(t.prep!.P[0]).toBeCloseTo(0.24974, 5)
    expect(t.prep!.P[3]).toBeCloseTo(0.119203, 5)
    expect(t.dataset!.models.metrics).toEqual({ auc: [0.6] })
    expect(t.labels).toEqual({ A: ['revisit'] })
    expect(t.notes).toEqual({ B: 'binary flag' })
    expect(t.threshold).toBe(0.42)
    expect(t.ops).toEqual([])
    expect(t.undoStack).toEqual([])
    expect(t.provenance).toEqual([
      { description: 'monotone down: B', rationale: undefined, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', fromFile: 'tiny.json' },
    ])
    expect((out.session as any).kept_model_indices).toEqual([2])
  })

  it('clear session resets to the file and forgets the saved entry', () => {
    const storage = new MemoryStorage()
    const s = fresh(storage)
    s.setMonotone('A', 'up')
    s.addLabel('A', 'exclude')
    expect(storage.map.size).toBe(1)
    s.clearSession()
    expect(storage.map.size).toBe(0)
    expect(s.ops).toEqual([])
    expect(s.labels).toEqual({})
    expect(fresh(storage).ops).toEqual([])
  })
})
