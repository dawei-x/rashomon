// Short op ids. Pure apart from the random source.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A 6-char id from [a-z0-9] not in `taken`. */
export function newId(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = ''
    for (let i = 0; i < 6; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)]
    if (!taken.has(id)) return id
  }
}
