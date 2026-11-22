// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Data without what format 11 adds on load (the `sync` block, stamps, log entry `id` and `at`), so older
 * tests can keep comparing the shape they were written for. The format 11 tests look at the additions.
 */
export function plain<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (typeof v !== "object" || v === null) return v;
    const inLogs = "date" in v && "outcome" in v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => {
          if (["sync", "stamps", "awayStamps", "awayTombstones"].includes(k)) return false;
          return !(inLogs && (k === "id" || k === "at"));
        })
        .map(([k, x]) => [k, walk(x)]),
    );
  };
  return walk(value) as T;
}
