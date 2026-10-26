import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ModelSet } from '../src/lib/schema'

export const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
export const tinyText = () => readFileSync(fixturePath('tiny.json'), 'utf8')
export const tiny = (): ModelSet => JSON.parse(tinyText())

/** In-memory localStorage stand-in. */
export class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

/** Deterministic random source for op ids. */
export function seq(seed = 1) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}
