// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { merge, mergeInbox, type AppData } from "../../src/index.ts";
import { DEV_A, DEV_B, DEV_C, doc, log, plant, shared, st } from "./helpers.ts";

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEVICES = [DEV_A, DEV_B, DEV_C] as const;

/** A document a device could plausibly hold: some plants of a shared pool, edits and entries of its own. */
function generate(seed: number, who: 0 | 1 | 2): AppData {
  const r = rng(seed * 7 + who);
  const device = DEVICES[who] as string;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const plants = ["p1", "p2", "p3"]
    .filter(() => r() > 0.2)
    .map((id) => {
      const wall = 100 + Math.floor(r() * 50);
      const logs = Array.from({ length: Math.floor(r() * 4) }, (_, i) =>
        log(
          `${id}-${who}-${i}`,
          `2026-11-0${1 + Math.floor(r() * 9)}`,
          st(wall + i, device),
          pick(["done", "skipped", "still_wet"]),
          who,
        ),
      );
      const stamped = r() > 0.4;
      return plant(id, {
        ...(stamped
          ? {
              name: `${id}${pick(["a", "b", "c"])}`,
              stamps: {
                name: st(wall, device),
                ...(r() > 0.5 ? { deleted: st(wall + 1, device) } : {}),
              },
            }
          : {}),
        ...(stamped && r() > 0.7 ? { deleted: true } : {}),
        ...(r() > 0.5 ? { lastWatered: `2026-11-0${1 + Math.floor(r() * 9)}` } : {}),
        logs,
      });
    });
  const tombstones =
    r() > 0.6
      ? { [`${pick(["p1", "p2", "p3"])}-${pick([0, 1, 2])}-0`]: st(160, device) }
      : undefined;
  return doc({
    device,
    me: who,
    stamp: st(200 + who, device),
    plants,
    ...(tombstones === undefined ? {} : { tombstones }),
    seasonal: { snoozedUntil: { p1: `2026-12-0${1 + Math.floor(r() * 9)}` } },
  });
}

describe("merge: generated documents", () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}: idempotent, order independent, inbox equals in turn`, () => {
      const [a, b, c] = [generate(seed, 0), generate(seed, 1), generate(seed, 2)] as [
        AppData,
        AppData,
        AppData,
      ];
      const once = merge(a, b).doc;
      assert.deepEqual(merge(once, b).doc, once, "merging twice equals once");
      assert.deepEqual(merge(once, a).doc, once, "merging the local copy back changes nothing");

      const all = [a, b, c];
      const orders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ] as const;
      const results = orders.map(([x, y, z]) =>
        shared(merge(merge(all[x] as AppData, all[y] as AppData).doc, all[z] as AppData).doc),
      );
      for (const res of results) assert.deepEqual(res, results[0]);

      assert.deepEqual(mergeInbox(a, [b, c]).doc, merge(merge(a, b).doc, c).doc);
    });
  }
});
