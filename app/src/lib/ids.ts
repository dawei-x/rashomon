// Short op ids and a fast string hash. Pure apart from the random source.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A 6-char id from [a-z0-9] not in `taken`. */
export function newId(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = ''
    for (let i = 0; i < 6; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)]
    if (!taken.has(id)) return id
  }
}

/** cyrb53: fast 53-bit non-cryptographic hash, returned as hex. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}
