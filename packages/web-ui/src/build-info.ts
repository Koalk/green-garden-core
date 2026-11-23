// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which build this is. The page sets `globalThis.__GG_BUILD__` before the app loads (the local server
 * and `scripts/build-static.mjs` both do); without it the label is "dev".
 */
export function buildLabel(): string {
  const b = (globalThis as { __GG_BUILD__?: { commit?: unknown; date?: unknown } }).__GG_BUILD__;
  return typeof b?.commit === "string" && typeof b.date === "string"
    ? `${b.commit} (${b.date})`
    : "dev";
}
