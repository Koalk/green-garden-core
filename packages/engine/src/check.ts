// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The next-date check value: a small number two devices can compare to see whether their engines
 * replay the same logs to the same next date. It is not a security feature; a different value only
 * means "your engine and mine disagree" (most likely two app versions).
 */

/**
 * Raise this when a change to the replay rules or the schedule maths would move a next date for
 * data that did not change, so a device on the old rules can tell.
 */
export const ENGINE_VERSION = 1;

/**
 * A whole number from 0 to 65535 worked out from the plant's ID, its next date (`YYYY-MM-DD`) and
 * the engine version. The same inputs give the same number on every platform.
 */
export function nextDateCheck(
  plantId: string,
  nextDate: string,
  version: number = ENGINE_VERSION,
): number {
  const text = `${String(plantId.length)}:${plantId}|${nextDate}|${String(version)}`;
  // FNV-1a over the 16-bit code units, folded to 16 bits.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    for (const byte of [unit & 0xff, unit >> 8]) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
}
