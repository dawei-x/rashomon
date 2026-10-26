import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validate } from '../src/lib/schema'
import { fixturePath, tiny } from './helpers'

describe('validate', () => {
  it('accepts the tiny fixture', () => {
    const r = validate(tiny())
    expect(r.ok).toBe(true)
  })

  // The same files are checked by prep/check_validate_parity.py.
  const dir = fixturePath('validation')
  for (const file of readdirSync(dir)) {
    it(`${file.startsWith('good-') ? 'accepts' : 'rejects'} ${file}`, () => {
      const r = validate(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')))
      expect(r.ok).toBe(file.startsWith('good-'))
    })
  }

  it('lists at most 5 problems', () => {
    const ds: any = tiny()
    ds.schema = 'x'
    ds.models.loss = [1]
    ds.models.ids = ['a', 'a', 'a']
    ds.data.rows = [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6]]
    const r = validate(ds)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.length).toBe(5)
  })

  it('rejects non-finite numbers and non-objects', () => {
    expect(validate(null).ok).toBe(false)
    const ds: any = tiny()
    ds.models.weights[1][2] = 'NaN'
    expect(validate(ds).ok).toBe(false)
  })

  it('warns on large files', () => {
    const ds: any = tiny()
    ds.models.intercepts = Array(301).fill(0)
    ds.models.loss = Array(301).fill(0.3)
    ds.models.weights = Array(301).fill([0, 0, 0, 0])
    delete ds.models.ids
    delete ds.models.metrics
    const r = validate(ds)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.length).toBe(1)
  })
})
