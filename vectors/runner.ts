// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bandTable,
  computeWindows,
  parseDate,
  planDays,
  restWeight,
  startMultipliers,
  wateringHint,
} from "@green-garden/engine";

/**
 * A vector names the engine function to call (`fn`, default `computeWindows`) and
 * the expected output. `expected` is a subset: only the keys and array elements it
 * lists are compared, so vectors stay short and ports may add fields.
 */
export interface Vector {
  readonly name: string;
  readonly description: string;
  readonly why?: string;
  readonly fn?:
    | "bandTable"
    | "computeWindows"
    | "planDays"
    | "restWeight"
    | "startMultipliers"
    | "wateringHint";
  readonly input: unknown;
  readonly expected: unknown;
}

const casesDir = join(fileURLToPath(new URL(".", import.meta.url)), "cases");

export function loadVectors(dir: string = casesDir): Vector[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Vector);
}

export function runVector(v: Vector): unknown {
  switch (v.fn ?? "computeWindows") {
    case "bandTable":
      return bandTable(v.input as Parameters<typeof bandTable>[0]);
    case "planDays":
      return planDays(v.input as Parameters<typeof planDays>[0]);
    case "restWeight": {
      const i = v.input as { date: string; hemisphere?: "north" | "south"; latitude?: number };
      const day = parseDate(i.date);
      if (day === undefined) throw new Error(`bad date in vector ${v.name}`);
      return { weight: restWeight(day, i.hemisphere ?? "north", i.latitude) };
    }
    case "startMultipliers":
      return startMultipliers(v.input as Parameters<typeof startMultipliers>[0]);
    case "wateringHint":
      return wateringHint(v.input as Parameters<typeof wateringHint>[0]);
    case "computeWindows":
      return computeWindows(v.input as Parameters<typeof computeWindows>[0]);
  }
}

/** Keeps from `actual` only what `expected` mentions, recursively. */
export function project(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return actual;
    return actual.slice(0, expected.length).map((a, i) => project(a, expected[i]));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return actual;
    const out: Record<string, unknown> = {};
    const have = actual as Record<string, unknown>;
    for (const [key, want] of Object.entries(expected)) out[key] = project(have[key], want);
    return out;
  }
  return actual;
}
