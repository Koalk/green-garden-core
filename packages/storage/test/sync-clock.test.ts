// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZERO_STAMP,
  compareStamps,
  createClock,
  derivedId,
  formatStamp,
  newId,
  parseStamp,
} from "../src/index.ts";

const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";

describe("hybrid logical clock", () => {
  it("ticks forward with the wall clock and counts within one millisecond", () => {
    const c = createClock(A);
    const s1 = parseStamp(c.tick(1000));
    const s2 = parseStamp(c.tick(1000));
    const s3 = parseStamp(c.tick(2000));
    assert.deepEqual([s1.wall, s1.counter, s1.device], [1000, 0, A]);
    assert.deepEqual([s2.wall, s2.counter], [1000, 1]);
    assert.deepEqual([s3.wall, s3.counter], [2000, 0]);
  });

  it("never goes backwards when the wall clock does", () => {
    const c = createClock(A);
    const first = c.tick(5000);
    const second = c.tick(1000);
    const third = c.tick(1000);
    assert.ok(compareStamps(second, first) > 0);
    assert.ok(compareStamps(third, second) > 0);
    assert.equal(parseStamp(second).wall, 5000);
  });

  it("orders by wall, then counter, then device ID, as a total order on the string form", () => {
    const mk = (wall: number, counter: number, device: string): string =>
      formatStamp({ wall, counter, device });
    const ordered = [
      ZERO_STAMP,
      mk(1, 0, A),
      mk(1, 0, B),
      mk(1, 1, A),
      mk(2, 0, A),
      mk(10_000_000_000_000, 0, A),
    ];
    for (const [i, a] of ordered.entries())
      for (const [j, b] of ordered.entries()) {
        assert.equal(Math.sign(compareStamps(a, b)), Math.sign(i - j));
      }
    // The string form itself sorts the same way, so a plain sort of the JSON values works.
    assert.deepEqual([...ordered].reverse().sort(), ordered);
  });

  it("breaks an exact tie with the device ID", () => {
    const x = formatStamp({ wall: 7, counter: 2, device: A });
    const y = formatStamp({ wall: 7, counter: 2, device: B });
    assert.ok(compareStamps(y, x) > 0);
  });

  it("round-trips the string form, and stamp 0 is older than anything", () => {
    const s = formatStamp({ wall: 1_700_000_000_123, counter: 5, device: A });
    assert.deepEqual(parseStamp(s), { wall: 1_700_000_000_123, counter: 5, device: A });
    assert.equal(formatStamp(parseStamp(ZERO_STAMP)), ZERO_STAMP);
    assert.ok(compareStamps(ZERO_STAMP, s) < 0);
    assert.ok(compareStamps(s, ZERO_STAMP) > 0);
  });

  it("observe moves past a remote stamp from the future and keeps going", () => {
    const c = createClock(A);
    const remote = formatStamp({ wall: 9000, counter: 3, device: B });
    const seen = c.observe(remote, 1000);
    assert.ok(compareStamps(seen, remote) > 0);
    const next = c.tick(1000);
    assert.ok(compareStamps(next, seen) > 0);
  });

  it("observe of an older remote stamp still moves the clock forward", () => {
    const c = createClock(A);
    const mine = c.tick(5000);
    const seen = c.observe(formatStamp({ wall: 100, counter: 0, device: B }), 5000);
    assert.ok(compareStamps(seen, mine) > 0);
  });

  it("restores from the last stamp saved, so a restart never goes back", () => {
    const c1 = createClock(A);
    const last = c1.tick(8000);
    const c2 = createClock(A, last);
    assert.ok(compareStamps(c2.tick(10), last) > 0);
  });
});

describe("ids", () => {
  it("makes 8-byte random IDs as 16 hex digits", () => {
    const a = newId();
    const b = newId();
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.notEqual(a, b);
  });

  it("derives the same 8-byte ID from the same parts, and another from other parts", () => {
    assert.match(derivedId("p1", "2026-10-01", "done", 0), /^[0-9a-f]{16}$/);
    assert.equal(
      derivedId("p1", "2026-10-01", "done", 0),
      derivedId("p1", "2026-10-01", "done", 0),
    );
    const variants = [
      derivedId("p1", "2026-10-01", "done", 0),
      derivedId("p2", "2026-10-01", "done", 0),
      derivedId("p1", "2026-10-02", "done", 0),
      derivedId("p1", "2026-10-01", "skipped", 0),
      derivedId("p1", "2026-10-01", "done", 1),
    ];
    assert.equal(new Set(variants).size, variants.length);
  });

  it("does not confuse parts that run together", () => {
    assert.notEqual(derivedId("ab", "c"), derivedId("a", "bc"));
  });
});
