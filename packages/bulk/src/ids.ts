// SPDX-License-Identifier: AGPL-3.0-only

/** Next free id of the form `prefix1`, `prefix2`, ... */
export function nextId(used: readonly string[], prefix: string): string {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(`${prefix}${String(n)}`)) n += 1;
  return `${prefix}${String(n)}`;
}
