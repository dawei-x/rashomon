// modelset.v1 types and validation (spec §4). Pure; mirrored by prep/validate.py.

export type FeatureType = 'continuous' | 'binary'

export interface Feature {
  name: string
  type: FeatureType
  thresholds: number[]
  unit?: string
  range?: [number, number]
}

export interface ModelSet {
  schema: 'modelset.v1'
  name?: string
  target?: { name: string; positive_label?: unknown; label_names?: Record<string, string> }
  features: Feature[]
  models: {
    intercepts: number[]
    weights: number[][]
    loss: number[]
    metrics?: Record<string, number[]>
    ids?: string[]
  }
  data: { columns: string[]; rows: number[][]; y?: number[]; ids?: string[] }
  meta?: Record<string, unknown>
  session?: unknown
}

export type ValidationResult =
  | { ok: true; value: ModelSet; warnings: string[] }
  | { ok: false; problems: string[] }

const MAX_PROBLEMS = 5

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validate(input: unknown): ValidationResult {
  const problems: string[] = []
  const add = (msg: string) => {
    problems.push(msg)
    return problems.length >= MAX_PROBLEMS
  }
  const done = (): ValidationResult => ({ ok: false, problems: problems.slice(0, MAX_PROBLEMS) })

  if (!isObj(input)) return { ok: false, problems: ['top level is not a JSON object'] }
  if (input.schema !== 'modelset.v1') {
    if (add(`schema must be "modelset.v1" (got ${JSON.stringify(input.schema)})`)) return done()
  }

  // --- features
  const features = input.features
  let totalBins = 0
  let featureNames: string[] = []
  let binaryCols: number[] = []
  let featuresOk = false
  if (!Array.isArray(features) || features.length < 1) {
    if (add('features must be a non-empty array')) return done()
  } else {
    featuresOk = true
    const seen = new Set<string>()
    for (let j = 0; j < features.length; j++) {
      const f = features[j]
      const where = `features[${j}]`
      if (!isObj(f)) {
        featuresOk = false
        if (add(`${where} is not an object`)) return done()
        continue
      }
      if (typeof f.name !== 'string' || f.name === '') {
        featuresOk = false
        if (add(`${where}.name must be a non-empty string`)) return done()
      } else if (seen.has(f.name)) {
        featuresOk = false
        if (add(`${where}.name "${f.name}" is duplicated`)) return done()
      } else seen.add(f.name)
      if (f.type !== 'continuous' && f.type !== 'binary') {
        featuresOk = false
        if (add(`${where}.type must be "continuous" or "binary"`)) return done()
      }
      const t = f.thresholds
      if (!Array.isArray(t) || !t.every(isNum)) {
        featuresOk = false
        if (add(`${where}.thresholds must be an array of finite numbers`)) return done()
      } else {
        for (let k = 1; k < t.length; k++) {
          if (!(t[k] > t[k - 1])) {
            featuresOk = false
            if (add(`${where}.thresholds are not strictly increasing`)) return done()
            break
          }
        }
        if (f.type === 'binary' && !(t.length === 1 && t[0] === 0.5)) {
          featuresOk = false
          if (add(`${where} is binary, so thresholds must be exactly [0.5]`)) return done()
        }
        totalBins += t.length + 1
      }
      if (f.range !== undefined) {
        const r = f.range
        if (!Array.isArray(r) || r.length !== 2 || !isNum(r[0]) || !isNum(r[1]) || !(r[0] < r[1])) {
          if (add(`${where}.range must be [min, max] with min < max`)) return done()
        }
      }
      if (f.unit !== undefined && typeof f.unit !== 'string') {
        if (add(`${where}.unit must be a string`)) return done()
      }
    }
    featureNames = features.map((f) => (isObj(f) ? (f.name as string) : ''))
    binaryCols = features.flatMap((f, j) => (isObj(f) && f.type === 'binary' ? [j] : []))
  }

  // --- models
  const models = input.models
  if (!isObj(models)) {
    if (add('models must be an object')) return done()
  } else {
    const intercepts = models.intercepts
    const N = Array.isArray(intercepts) ? intercepts.length : -1
    if (N < 1) {
      if (add('models.intercepts must be a non-empty array')) return done()
    } else {
      if (!(intercepts as unknown[]).every(isNum)) if (add('models.intercepts must contain only finite numbers')) return done()
      const checkLen = (name: string, arr: unknown, needNum = true) => {
        if (!Array.isArray(arr)) return add(`${name} must be an array of length ${N}`)
        if (arr.length !== N) return add(`${name} has length ${arr.length}, expected ${N}`)
        if (needNum && !arr.every(isNum)) return add(`${name} must contain only finite numbers`)
        return false
      }
      if (checkLen('models.loss', models.loss)) return done()
      if (models.metrics !== undefined) {
        if (!isObj(models.metrics)) {
          if (add('models.metrics must be an object of arrays')) return done()
        } else {
          for (const [k, v] of Object.entries(models.metrics)) {
            if (checkLen(`models.metrics.${k}`, v)) return done()
          }
        }
      }
      if (models.ids !== undefined) {
        if (checkLen('models.ids', models.ids, false)) return done()
        const ids = models.ids as unknown[]
        if (Array.isArray(ids) && ids.length === N) {
          if (!ids.every((s) => typeof s === 'string')) {
            if (add('models.ids must be strings')) return done()
          } else if (new Set(ids).size !== N) {
            if (add('models.ids must be unique')) return done()
          }
        }
      }
      const weights = models.weights
      if (!Array.isArray(weights) || weights.length !== N) {
        if (add(`models.weights must be an array of ${N} rows`)) return done()
      } else if (featuresOk) {
        for (let m = 0; m < N; m++) {
          const row = weights[m]
          if (!Array.isArray(row) || row.length !== totalBins) {
            if (add(`models.weights[${m}] has length ${Array.isArray(row) ? row.length : 'n/a'}, expected ${totalBins}`))
              return done()
          } else if (!row.every(isNum)) {
            if (add(`models.weights[${m}] contains a non-finite value`)) return done()
          }
        }
      }
    }
  }

  // --- data
  const data = input.data
  if (!isObj(data)) {
    if (add('data must be an object')) return done()
  } else {
    const cols = data.columns
    if (!Array.isArray(cols) || (featuresOk && (cols.length !== featureNames.length || cols.some((c, j) => c !== featureNames[j])))) {
      if (add('data.columns must equal features[].name in the same order')) return done()
    }
    const rows = data.rows
    const n = Array.isArray(rows) ? rows.length : 0
    if (!Array.isArray(rows) || n < 1) {
      if (add('data.rows must contain at least one row')) return done()
    } else if (featuresOk) {
      const J = featureNames.length
      for (let i = 0; i < n; i++) {
        const r = rows[i]
        if (!Array.isArray(r) || r.length !== J) {
          if (add(`data.rows[${i}] must have ${J} values`)) return done()
          continue
        }
        for (let j = 0; j < J; j++) {
          if (!isNum(r[j])) {
            if (add(`data.rows[${i}][${j}] is not a finite number`)) return done()
            break
          }
        }
        for (const j of binaryCols) {
          if (r[j] !== 0 && r[j] !== 1) {
            if (add(`data.rows[${i}]: binary feature "${featureNames[j]}" must be 0 or 1`)) return done()
            break
          }
        }
      }
    }
    if (data.y !== undefined) {
      if (!Array.isArray(data.y) || data.y.length !== n) {
        if (add(`data.y must have length ${n}`)) return done()
      } else if (!data.y.every(isNum)) {
        if (add('data.y must contain only finite numbers')) return done()
      }
    }
    if (data.ids !== undefined) {
      const ids = data.ids
      if (!Array.isArray(ids) || ids.length !== n) {
        if (add(`data.ids must have length ${n}`)) return done()
      } else if (!ids.every((s) => typeof s === 'string')) {
        if (add('data.ids must be strings')) return done()
      } else if (new Set(ids).size !== n) {
        if (add('data.ids must be unique')) return done()
      }
    }
  }

  if (problems.length > 0) return done()

  const ms = input as unknown as ModelSet
  const warnings: string[] = []
  if (ms.models.intercepts.length > 300) warnings.push(`${ms.models.intercepts.length} models (> 300) may be slow`)
  if (ms.data.rows.length > 2000) warnings.push(`${ms.data.rows.length} instances (> 2000) may be slow`)
  return { ok: true, value: ms, warnings }
}
