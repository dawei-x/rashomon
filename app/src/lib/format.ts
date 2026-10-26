// Number formatting helpers.

const MINUS = '−'

/** Fixed decimals with a typographic minus. */
export function fixed(v: number, dp: number): string {
  const s = v.toFixed(dp)
  return s.startsWith('-') ? (Number(s) === 0 ? s.slice(1) : MINUS + s.slice(1)) : s
}

/** Signed term for formulas: "+ 0.85" / "− 0.76". */
export function signedTerm(v: number, dp = 2): string {
  const s = fixed(Math.abs(v), dp)
  return Number(v.toFixed(dp)) < 0 ? `${MINUS} ${s}` : `+ ${s}`
}

/** Compact value for feature values and axis labels: integers stay integers, else up to 4 significant digits. */
export function num(v: number): string {
  if (Number.isInteger(v)) return fixed(v, 0)
  const a = Math.abs(v)
  const dp = a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 2 : 3
  return fixed(Number(v.toFixed(dp)), dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export function pct(v: number): string {
  return v === 0 || v === 100 ? String(v) : v.toFixed(1)
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
