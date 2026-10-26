// The single session store: state, derived values, mutations and transition rules (spec §5, §7.6).
import { validate, type ModelSet } from './schema'
import { computeFlips, computeRanks, computeSpread, prepare } from './model'
import {
  computeActiveMask,
  describeOp,
  referenceModel,
  withDeleted,
  withMonotone,
  withRationale,
  withRemovedLater,
  withToggled,
  type FilterOp,
  type Op,
  type ProvenanceEntry,
} from './constraints'
import { hashString, newId } from './ids'

export type InstanceFilter = { kind: 'none' } | { kind: 'rankRange'; lo: number; hi: number } | { kind: 'flippedOnly' }
export interface TooltipState {
  x: number
  y: number
  html: string
}
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export type LoadResult = { ok: true; warnings: string[] } | { ok: false; problems: string[] }

/** Annotations carried by an imported file's `session` block. */
interface FileSession {
  labels: Record<string, string[]>
  notes: Record<string, string>
  threshold: number
  provenance: ProvenanceEntry[]
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clampTau = (v: number) => Math.min(0.99, Math.max(0.01, Math.round(v * 100) / 100))

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function pickStrings<T>(src: unknown, names: Set<string>, ok: (v: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {}
  if (!isObj(src)) return out
  for (const [k, v] of Object.entries(src)) {
    const val = names.has(k) ? ok(v) : undefined
    if (val !== undefined) out[k] = val
  }
  return out
}
const asLabels = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined)
const asNote = (v: unknown) => (typeof v === 'string' ? v : undefined)

function readFileSession(raw: unknown, names: Set<string>): FileSession | null {
  if (!isObj(raw)) return null
  const from = typeof raw.source_name === 'string' ? raw.source_name : 'imported file'
  const entry = (c: any, fromFile: string): ProvenanceEntry | null =>
    isObj(c)
      ? {
          description: String(c.description ?? ''),
          rationale: typeof c.rationale === 'string' ? c.rationale : undefined,
          enabled: c.enabled !== false,
          createdAt: String(c.createdAt ?? ''),
          fromFile: typeof c.fromFile === 'string' ? c.fromFile : fromFile,
        }
      : null
  const inherited = (Array.isArray(raw.inherited) ? raw.inherited : []).map((c: any) => entry(c, from))
  const constraints = (Array.isArray(raw.constraints) ? raw.constraints : []).map((c: any) => entry({ ...c, fromFile: from }, from))
  return {
    labels: pickStrings(raw.labels, names, asLabels),
    notes: pickStrings(raw.notes, names, asNote),
    threshold: typeof raw.threshold === 'number' && raw.threshold > 0 && raw.threshold < 1 ? clampTau(raw.threshold) : 0.5,
    provenance: [...inherited, ...constraints].filter((e): e is ProvenanceEntry => e !== null),
  }
}

export class Session {
  // --- state (§5.1)
  dataset = $state.raw<ModelSet | null>(null)
  datasetHash = $state<string | null>(null)
  sourceName = $state('')
  ops = $state.raw<Op[]>([])
  undoStack = $state.raw<Op[][]>([])
  redoStack = $state.raw<Op[][]>([])
  provenance = $state.raw<ProvenanceEntry[]>([])
  labels = $state.raw<Record<string, string[]>>({})
  notes = $state.raw<Record<string, string>>({})
  threshold = $state(0.5)
  selectedInstance = $state<number | null>(null)
  selectedModel = $state<number | null>(null)
  instanceFilter = $state.raw<InstanceFilter>({ kind: 'none' })
  filterModeFeature = $state<string | null>(null)
  historyOpen = $state(false)
  helpOpen = $state(false)
  toast = $state<string | null>(null)
  tooltip = $state.raw<TooltipState | null>(null)
  /** Problems from the last rejected upload, shown until dismissed. */
  uploadProblems = $state.raw<string[] | null>(null)

  // --- derived (§5.2)
  prep = $derived(this.dataset ? prepare(this.dataset) : null)
  activeMask = $derived(this.dataset ? computeActiveMask(this.dataset, this.ops) : [])
  activeModels = $derived(this.activeMask.flatMap((a, m) => (a ? [m] : [])))
  activeCount = $derived(this.activeModels.length)
  refModel = $derived(this.dataset ? referenceModel(this.dataset.models.loss, this.activeModels) : null)
  spread = $derived(
    this.prep && this.refModel !== null ? computeSpread(this.prep.P, this.prep.n, this.activeModels, this.refModel) : null,
  )
  flips = $derived(this.spread ? computeFlips(this.spread, this.threshold) : null)
  ranks = $derived(this.spread ? computeRanks(this.spread.pRef) : null)
  flipCount = $derived(this.flips ? this.flips.reduce((s, f) => s + f, 0) : undefined)
  flipPct = $derived(this.flipCount !== undefined && this.prep ? (100 * this.flipCount) / this.prep.n : undefined)
  /** Visible row indices in rank order (row order when there is no reference model). */
  visibleInstances = $derived.by((): number[] => {
    if (!this.prep) return []
    const f = this.instanceFilter
    if (!this.ranks || !this.flips) return f.kind === 'none' ? [...Array(this.prep.n).keys()] : []
    const order = Array.from(this.ranks.byRank)
    if (f.kind === 'rankRange') return order.filter((i) => this.ranks!.rankOf[i] >= f.lo && this.ranks!.rankOf[i] <= f.hi)
    if (f.kind === 'flippedOnly') return order.filter((i) => this.flips![i] === 1)
    return order
  })
  nVisible = $derived(this.visibleInstances.length)

  private storage: StorageLike | null
  private random: () => number
  private now: () => string
  private fileSession: FileSession | null = null
  private toastTimer: ReturnType<typeof setTimeout> | undefined

  constructor(opts: { storage?: StorageLike | null; random?: () => number; now?: () => string } = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage
    this.random = opts.random ?? Math.random
    this.now = opts.now ?? (() => new Date().toISOString())
  }

  // --- loading (§7.6)

  loadText(text: string, sourceName: string): LoadResult {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      return { ok: false, problems: [`not valid JSON: ${(e as Error).message}`] }
    }
    const v = validate(parsed)
    if (!v.ok) return v
    this.dataset = v.value
    this.datasetHash = hashString(text)
    this.sourceName = sourceName
    this.fileSession = readFileSession(v.value.session, new Set(v.value.features.map((f) => f.name)))
    this.resetSession(true)
    return { ok: true, warnings: v.warnings }
  }

  /** Back to what a fresh load of the current file gives; optionally restore the saved session. */
  private resetSession(restoreSaved: boolean) {
    this.ops = []
    this.undoStack = []
    this.redoStack = []
    this.selectedInstance = null
    this.selectedModel = null
    this.instanceFilter = { kind: 'none' }
    this.filterModeFeature = null
    this.labels = this.fileSession?.labels ?? {}
    this.notes = this.fileSession?.notes ?? {}
    this.threshold = this.fileSession?.threshold ?? 0.5
    this.provenance = this.fileSession?.provenance ?? []
    if (restoreSaved) this.restoreSaved()
  }

  /** Remove the saved entry and reset the session for the loaded file. */
  clearSession() {
    if (this.datasetHash) this.storageCall((s) => s.removeItem(this.storageKey))
    this.resetSession(false)
  }

  private get storageKey() {
    return `modelset:${this.datasetHash}`
  }

  private storageCall<T>(fn: (s: StorageLike) => T): T | undefined {
    if (!this.storage) return undefined
    try {
      return fn(this.storage)
    } catch {
      return undefined
    }
  }

  private persist() {
    if (!this.datasetHash) return
    const body = JSON.stringify({ ops: this.ops, labels: this.labels, notes: this.notes, threshold: this.threshold })
    this.storageCall((s) => s.setItem(this.storageKey, body))
  }

  private restoreSaved() {
    const ds = this.dataset!
    const raw = this.storageCall((s) => s.getItem(this.storageKey))
    if (!raw) return
    let saved: any
    try {
      saved = JSON.parse(raw)
    } catch {
      return
    }
    if (!isObj(saved)) return
    const names = new Set(ds.features.map((f) => f.name))
    const N = ds.models.intercepts.length
    const okOp = (o: any): o is Op =>
      isObj(o) &&
      typeof o.id === 'string' &&
      names.has(o.feature) &&
      ((o.kind === 'monotone' && (o.direction === 'up' || o.direction === 'down')) ||
        (o.kind === 'filter' && Array.isArray(o.modelIdx) && o.modelIdx.every((m: unknown) => Number.isInteger(m) && (m as number) >= 0 && (m as number) < N)))
    if (Array.isArray(saved.ops)) this.ops = saved.ops.filter(okOp)
    if (isObj(saved.labels)) this.labels = pickStrings(saved.labels, names, asLabels)
    if (isObj(saved.notes)) this.notes = pickStrings(saved.notes, names, asNote)
    if (typeof saved.threshold === 'number') this.threshold = clampTau(saved.threshold)
  }

  // --- constraint ops (§5.4), each undoable

  private takenIds(): Set<string> {
    return new Set([...this.ops, ...this.undoStack.flat(), ...this.redoStack.flat()].map((o) => o.id))
  }

  /** Swap in a new ops list and apply the §5.5 transition rules. */
  private setOps(next: Op[]) {
    const prevRef = this.refModel
    this.ops = next
    if (this.selectedModel !== null && !this.activeMask[this.selectedModel]) this.selectedModel = null
    if (this.refModel !== prevRef && this.instanceFilter.kind === 'rankRange') {
      this.instanceFilter = { kind: 'none' }
      this.showToast('Ordering changed — zoom reset')
    }
    this.persist()
  }

  private commit(next: Op[]) {
    this.undoStack = [...this.undoStack, this.ops]
    this.redoStack = []
    this.setOps(next)
  }

  undo() {
    const prev = this.undoStack.at(-1)
    if (!prev) return
    this.undoStack = this.undoStack.slice(0, -1)
    this.redoStack = [...this.redoStack, this.ops]
    this.setOps(prev)
  }

  redo() {
    const next = this.redoStack.at(-1)
    if (!next) return
    this.redoStack = this.redoStack.slice(0, -1)
    this.undoStack = [...this.undoStack, this.ops]
    this.setOps(next)
  }

  monotoneOf(feature: string): 'up' | 'down' | null {
    const op = this.ops.find((o) => o.kind === 'monotone' && o.feature === feature)
    return op && op.kind === 'monotone' ? op.direction : null
  }

  setMonotone(feature: string, direction: 'up' | 'down' | null) {
    this.commit(withMonotone(this.ops, feature, direction, newId(this.takenIds(), this.random), this.now()))
  }

  /** none → up → down → none */
  cycleMonotone(feature: string) {
    const cur = this.monotoneOf(feature)
    this.setMonotone(feature, cur === null ? 'up' : cur === 'up' ? 'down' : null)
  }

  addFilter(
    feature: string,
    mode: 'keep' | 'exclude',
    xRange: [number, number],
    yRange: [number, number],
    modelIdx: number[],
    rationale?: string,
  ) {
    const op: FilterOp = {
      id: newId(this.takenIds(), this.random),
      kind: 'filter',
      feature,
      mode,
      xRange,
      yRange,
      modelIdx: [...modelIdx],
      enabled: true,
      createdAt: this.now(),
      ...(rationale ? { rationale } : {}),
    }
    this.commit([...this.ops, op])
  }

  toggleOp(id: string) {
    this.commit(withToggled(this.ops, id))
  }
  deleteOp(id: string) {
    this.commit(withDeleted(this.ops, id))
  }
  removeLater(id: string | 'initial') {
    this.commit(withRemovedLater(this.ops, id))
  }
  setRationale(id: string, text: string) {
    const cur = this.ops.find((o) => o.id === id)
    if (!cur || (cur.rationale ?? '') === text) return
    this.commit(withRationale(this.ops, id, text))
  }

  // --- annotations and view state (not undoable)

  addLabel(feature: string, label: string) {
    const l = label.trim()
    const cur = this.labels[feature] ?? []
    if (!l || cur.includes(l)) return
    this.labels = { ...this.labels, [feature]: [...cur, l] }
    this.persist()
  }

  removeLabel(feature: string, label: string) {
    const next = (this.labels[feature] ?? []).filter((x) => x !== label)
    const { [feature]: _, ...rest } = this.labels
    this.labels = next.length ? { ...rest, [feature]: next } : rest
    this.persist()
  }

  setNote(feature: string, text: string) {
    const { [feature]: _, ...rest } = this.notes
    this.notes = text.trim() ? { ...rest, [feature]: text } : rest
    this.persist()
  }

  setThreshold(v: number) {
    this.threshold = clampTau(v)
    this.persist()
  }

  selectInstance(i: number | null) {
    this.selectedInstance = i
  }

  /** Clicking the selected model again clears it. */
  toggleSelectedModel(m: number | null) {
    this.selectedModel = m === null || m === this.selectedModel ? null : m
  }

  setRankRange(lo: number, hi: number) {
    this.instanceFilter = { kind: 'rankRange', lo, hi }
  }

  setFlipsOnly(on: boolean) {
    this.instanceFilter = on ? { kind: 'flippedOnly' } : { kind: 'none' }
  }

  resetInstanceFilter() {
    this.instanceFilter = { kind: 'none' }
  }

  toggleFilterMode(feature: string | null) {
    this.filterModeFeature = feature === null || this.filterModeFeature === feature ? null : feature
  }

  showToast(msg: string) {
    this.toast = msg
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      if (this.toast === msg) this.toast = null
    }, 4000)
  }

  // --- export (§7.6)

  /** A valid modelset.v1 holding only the active models plus a session block; null when nothing is active. */
  exportObject(): Record<string, unknown> | null {
    const ds = this.dataset
    const prep = this.prep
    if (!ds || !prep || this.activeCount === 0) return null
    const keep = this.activeModels
    const pick = <T>(arr: T[]) => keep.map((m) => arr[m])
    const models: ModelSet['models'] = {
      intercepts: pick(ds.models.intercepts),
      weights: pick(ds.models.weights),
      loss: pick(ds.models.loss),
      ids: pick(prep.modelIds),
    }
    if (ds.models.metrics) {
      models.metrics = Object.fromEntries(Object.entries(ds.models.metrics).map(([k, v]) => [k, pick(v)]))
    }
    const { session: _old, ...rest } = ds
    return {
      ...rest,
      models,
      session: {
        schema: 'modelset-session.v1',
        exported_at: this.now(),
        source_name: this.sourceName,
        threshold: this.threshold,
        labels: this.labels,
        notes: this.notes,
        constraints: this.ops.map((op) => ({ description: describeOp(op), ...op })),
        inherited: this.provenance,
        kept_model_indices: keep,
      },
    }
  }
}

export const session = new Session()
