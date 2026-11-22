// SPDX-License-Identifier: AGPL-3.0-only

/**
 * IDs for things that sync: 8 random bytes as 16 hex digits. No garden is ever pooled with others, so
 * 64 bits make a collision between a few household members practically impossible.
 */

type RandomSource = { getRandomValues(bytes: Uint8Array): Uint8Array };

/**
 * A new random 8-byte ID. Uses the platform's secure random source (browsers, Node and React Native with
 * a polyfill); `random` lets a host pass its own. Throws rather than fall back to a weak source.
 */
export function newId(random?: RandomSource): string {
  const source = random ?? (globalThis as unknown as { crypto?: RandomSource }).crypto;
  if (source === undefined) throw new Error("no secure random source for IDs");
  const bytes = new Uint8Array(8);
  source.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * A fixed 8-byte ID worked out from `parts`: the same parts always give the same ID, on any device.
 * Used for what exists before sync does (old log entries), so two phones that imported the same file
 * agree on every ID. Parts are length-prefixed so `("ab", "c")` and `("a", "bc")` differ.
 */
export function derivedId(...parts: readonly (string | number)[]): string {
  const text = parts
    .map((p) => String(p))
    .map((p) => `${p.length}:${p}`)
    .join("|");
  let h = FNV_OFFSET;
  // Hash the 16-bit code units (low byte, then high byte): the same on every platform, no encoder needed.
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    for (const byte of [unit & 0xff, unit >> 8]) {
      h ^= BigInt(byte);
      h = (h * FNV_PRIME) & MASK_64;
    }
  }
  return h.toString(16).padStart(16, "0");
}
