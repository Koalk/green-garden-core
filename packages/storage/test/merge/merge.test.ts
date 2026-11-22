// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { merge, mergeInbox, resolve, type AppData } from "../../src/index.ts";
import { DEV_A, DEV_B, DEV_C, doc, log, plant, plantOf, shared, st } from "./helpers.ts";

type Loose = Record<string, unknown>;
const logsOf = (d: AppData, id: string): Loose[] => plantOf(d, id)["logs"] as Loose[];
const idsOf = (d: AppData, id: string): unknown[] => logsOf(d, id).map((l) => l["id"]);

describe("merge: events by union", () => {
  it("unites the log entries of two devices", () => {
    const a = doc({
      device: DEV_A,
      me: 0,
      plants: [plant("p1", { logs: [log("e1", "2026-11-01", st(10))] })],
    });
    const b = doc({
      device: DEV_B,
      me: 1,
      plants: [
        plant("p1", {
          logs: [
            log("e2", "2026-11-01", st(11, DEV_B), "done", 1),
            log("e3", "2026-11-03", st(12, DEV_B), "skipped", 1),
          ],
        }),
      ],
    });
    const { doc: out } = merge(a, b);
    assert.deepEqual(idsOf(out, "p1"), ["e1", "e2", "e3"]);
  });

  it("an Undo tombstone removes the entry and keeps it out", () => {
    const a = doc({
      device: DEV_A,
      me: 0,
      plants: [plant("p1", { logs: [log("e1", "2026-11-01", st(10))] })],
    });
    const b = doc({
      device: DEV_B,
      me: 1,
      plants: [plant("p1", { logs: [log("e1", "2026-11-01", st(10))] })],
      tombstones: { e1: st(20, DEV_B) },
    });
    const once = merge(a, b).doc;
    assert.deepEqual(idsOf(once, "p1"), []);
    // The entry arriving again later stays out.
    assert.deepEqual(idsOf(merge(once, a).doc, "p1"), []);
  });

  it("unites away days and honours a later removal", () => {
    const spaceA = {
      id: "space1",
      name: "Home",
      awayDates: ["2026-12-24"],
      awayStamps: { "2026-12-24": st(5) },
    };
    const spaceB = {
      id: "space1",
      name: "Home",
      awayDates: ["2026-12-25"],
      awayStamps: { "2026-12-25": st(6, DEV_B) },
      awayTombstones: { "2026-12-24": st(9, DEV_B) },
    };
    const { doc: out } = merge(
      doc({ device: DEV_A, me: 0, spaces: [spaceA] }),
      doc({ device: DEV_B, me: 1, spaces: [spaceB] }),
    );
    assert.deepEqual(out.spaces[0]?.awayDates, ["2026-12-25"]);
  });

  it("keeps the later seasonal choice per plant", () => {
    const a = doc({ device: DEV_A, me: 0, seasonal: { snoozedUntil: { p1: "2026-11-10" } } });
    const b = doc({
      device: DEV_B,
      me: 1,
      seasonal: { snoozedUntil: { p1: "2026-11-20", p2: "2026-11-01" } },
    });
    assert.deepEqual(merge(a, b).doc.seasonal, {
      snoozedUntil: { p1: "2026-11-20", p2: "2026-11-01" },
    });
  });
});

describe("merge: fields, last writer wins", () => {
  const withName = (device: string, me: number, name: string, stamp: string): AppData =>
    doc({ device, me, plants: [plant("p1", { name, stamps: { name: stamp } })] });

  it("the later stamp wins whichever side is local", () => {
    const a = withName(DEV_A, 0, "Fern", st(10));
    const b = withName(DEV_B, 1, "Boston fern", st(20, DEV_B));
    assert.equal(plantOf(merge(a, b).doc, "p1")["name"], "Boston fern");
    assert.equal(plantOf(merge(b, a).doc, "p1")["name"], "Boston fern");
  });

  it("an exact tie goes to the greater device ID, the same on both sides", () => {
    const a = withName(DEV_A, 0, "Fern", st(10, DEV_A));
    const b = withName(DEV_B, 1, "Boston fern", st(10, DEV_B));
    assert.equal(plantOf(merge(a, b).doc, "p1")["name"], "Boston fern");
    assert.equal(plantOf(merge(b, a).doc, "p1")["name"], "Boston fern");
  });

  it("different fields changed on each side both survive", () => {
    const a = doc({
      device: DEV_A,
      me: 0,
      plants: [plant("p1", { name: "Fern2", stamps: { name: st(10) } })],
    });
    const b = doc({
      device: DEV_B,
      me: 1,
      plants: [plant("p1", { intervalDays: 9, stamps: { intervalDays: st(11, DEV_B) } })],
    });
    const p = plantOf(merge(a, b).doc, "p1");
    assert.equal(p["name"], "Fern2");
    assert.equal(p["intervalDays"], 9);
  });

  it("replay seed fields are not merged field by field", () => {
    const a = doc({
      device: DEV_A,
      me: 0,
      plants: [plant("p1", { lastWatered: "2026-11-01", anchor: "2026-11-05", doneStreak: 1 })],
    });
    const b = doc({
      device: DEV_B,
      me: 1,
      plants: [plant("p1", { lastWatered: "2026-11-03", anchor: "2026-11-07", doneStreak: 4 })],
    });
    const ab = plantOf(merge(a, b).doc, "p1");
    const ba = plantOf(merge(b, a).doc, "p1");
    assert.deepEqual(ab, ba);
    assert.equal(ab["lastWatered"], "2026-11-03");
    assert.equal(ab["anchor"], "2026-11-07");
  });
});

describe("merge: deletes", () => {
  const deleted = (stamp: string): AppData =>
    doc({
      device: DEV_A,
      me: 0,
      plants: [
        plant("p1", {
          deleted: true,
          stamps: { deleted: stamp },
          logs: [log("e1", "2026-11-01", st(5))],
        }),
      ],
    });
  const watered = (at: string): AppData =>
    doc({
      device: DEV_B,
      me: 1,
      plants: [
        plant("p1", {
          logs: [log("e1", "2026-11-01", st(5)), log("e2", "2026-11-09", at, "done", 1)],
        }),
      ],
    });

  it("a watering stamped later than the delete brings the plant back, in either order", () => {
    const a = deleted(st(10));
    const b = watered(st(20, DEV_B));
    assert.notEqual(plantOf(merge(a, b).doc, "p1")["deleted"], true);
    assert.notEqual(plantOf(merge(b, a).doc, "p1")["deleted"], true);
  });

  it("a watering stamped earlier leaves it deleted with its logs kept, in either order", () => {
    const a = deleted(st(30));
    const b = watered(st(20, DEV_B));
    for (const out of [merge(a, b).doc, merge(b, a).doc]) {
      assert.equal(plantOf(out, "p1")["deleted"], true);
      assert.deepEqual(idsOf(out, "p1"), ["e1", "e2"]);
    }
  });
});

describe("merge: laws", () => {
  const a = doc({
    device: DEV_A,
    me: 0,
    stamp: st(10),
    plants: [
      plant("p1", { name: "A", stamps: { name: st(10) }, logs: [log("e1", "2026-11-01", st(10))] }),
    ],
  });
  const b = doc({
    device: DEV_B,
    me: 1,
    stamp: st(12, DEV_B),
    plants: [
      plant("p1", {
        intervalDays: 6,
        stamps: { intervalDays: st(12, DEV_B) },
        logs: [log("e2", "2026-11-02", st(12, DEV_B), "done", 1)],
      }),
      plant("p2"),
    ],
  });
  const c = doc({
    device: DEV_C,
    me: 2,
    stamp: st(14, DEV_C),
    plants: [
      plant("p1", {
        name: "C",
        stamps: { name: st(14, DEV_C) },
        logs: [log("e3", "2026-11-03", st(14, DEV_C), "skipped", 2)],
      }),
    ],
    tombstones: { e1: st(15, DEV_C) },
  });

  it("merging twice equals merging once", () => {
    const once = merge(a, b).doc;
    assert.deepEqual(merge(once, b).doc, once);
    assert.deepEqual(merge(once, once).doc, once);
  });

  it("A, B and C in all six orders give the same document", () => {
    const docs = [a, b, c];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ] as const;
    const results = orders.map(([x, y, z]) => {
      const first = docs[x] as AppData;
      return shared(merge(merge(first, docs[y] as AppData).doc, docs[z] as AppData).doc);
    });
    for (const r of results) assert.deepEqual(r, results[0]);
  });

  it("an inbox merged first equals merging each in turn", () => {
    const local = doc({ device: DEV_A, me: 0, stamp: st(9), plants: [plant("p1")] });
    const inTurn = merge(merge(local, b).doc, c).doc;
    assert.deepEqual(mergeInbox(local, [b, c]).doc, inTurn);
    assert.deepEqual(mergeInbox(local, [c, b]).doc, inTurn);
  });

  it("an empty inbox changes nothing", () => {
    assert.deepEqual(mergeInbox(a, []).doc, a);
  });

  it("another household is ignored", () => {
    const other = doc({ device: DEV_B, me: 0, household: "ffffffffffffffff" });
    const r = merge(a, other);
    assert.equal(r.ignored, "other-household");
    assert.deepEqual(r.doc, a);
  });
});

describe("merge: conflicts", () => {
  const named = (
    device: string,
    me: number,
    name: string,
    stamp: string,
    seen: Record<string, string>,
  ): AppData =>
    doc({ device, me, stamp, seen, plants: [plant("p1", { name, stamps: { name: stamp } })] });

  it("the same field changed on both since last seen is a conflict; the later stamp already won", () => {
    const a = named(DEV_A, 0, "Fern", st(10), { "1": st(5, DEV_B) });
    const b = named(DEV_B, 1, "Boston", st(12, DEV_B), { "0": st(5) });
    const r = merge(a, b);
    assert.equal(plantOf(r.doc, "p1")["name"], "Boston");
    assert.equal(r.conflicts.length, 1);
    assert.deepEqual(r.conflicts[0], {
      kind: "plant",
      id: "p1",
      field: "name",
      mine: "Fern",
      theirs: "Boston",
      mineStamp: st(10),
      theirsStamp: st(12, DEV_B),
    });
  });

  it("an ordinary update, where only they changed since last seen, is not a conflict", () => {
    const a = named(DEV_A, 0, "Fern", st(3), { "1": st(5, DEV_B) });
    const b = named(DEV_B, 1, "Boston", st(12, DEV_B), { "0": st(8) });
    const r = merge(a, b);
    assert.equal(plantOf(r.doc, "p1")["name"], "Boston");
    assert.deepEqual(r.conflicts, []);
  });

  it("events never conflict", () => {
    const a = doc({
      device: DEV_A,
      me: 0,
      seen: { "1": st(1, DEV_B) },
      plants: [plant("p1", { logs: [log("e1", "2026-11-01", st(10))] })],
    });
    const b = doc({
      device: DEV_B,
      me: 1,
      seen: { "0": st(1) },
      plants: [plant("p1", { logs: [log("e2", "2026-11-01", st(11, DEV_B), "done", 1)] })],
    });
    assert.deepEqual(merge(a, b).conflicts, []);
  });

  it("resolve re-stamps the chosen value so it wins everywhere", () => {
    const a = named(DEV_A, 0, "Fern", st(10), { "1": st(5, DEV_B) });
    const b = named(DEV_B, 1, "Boston", st(12, DEV_B), { "0": st(5) });
    const r = merge(a, b);
    const mine = resolve(
      r.doc,
      r.conflicts[0] as NonNullable<(typeof r.conflicts)[0]>,
      "mine",
      100,
    );
    assert.equal(plantOf(mine, "p1")["name"], "Fern");
    const stamps = plantOf(mine, "p1")["stamps"] as Record<string, string>;
    assert.ok((stamps["name"] as string) > st(12, DEV_B));
    assert.equal(plantOf(merge(b, mine).doc, "p1")["name"], "Fern");
    const theirs = resolve(
      r.doc,
      r.conflicts[0] as NonNullable<(typeof r.conflicts)[0]>,
      "theirs",
      100,
    );
    assert.equal(plantOf(theirs, "p1")["name"], "Boston");
  });
});

describe("merge: ID collision", () => {
  const made = (device: string, me: number, name: string, created: string): AppData =>
    doc({
      device,
      me,
      rooms: [{ id: "r1", name: "Hall", stamps: { created, name: created }, createdBy: me }],
      plants: [
        plant("p1", {
          name,
          roomId: "r1",
          createdBy: me,
          stamps: { created, name: created },
          logs: [log(`e-${name}`, "2026-11-01", created, "done", me)],
        }),
      ],
    });

  it("the lower (member index, stamp) keeps the ID; the other is re-minted; both phones agree", () => {
    const a = made(DEV_A, 0, "Fern", st(10));
    const b = made(DEV_B, 1, "Cactus", st(9, DEV_B));
    const ab = merge(a, b);
    const ba = merge(b, a);
    assert.equal(ab.remaps.length, 2);
    assert.deepEqual(ab.remaps, ba.remaps);
    assert.deepEqual(shared(ab.doc), shared(ba.doc));
    assert.equal(plantOf(ab.doc, "p1")["name"], "Fern");
    const moved = ab.remaps.find((r) => r.kind === "plant");
    assert.ok(moved !== undefined && moved.to !== "p1");
    const kept = plantOf(ab.doc, (moved as { to: string }).to);
    assert.equal(kept["name"], "Cactus");
    assert.deepEqual(idsOf(ab.doc, (moved as { to: string }).to), ["e-Cactus"]);
    // The re-minted plant follows its re-minted room.
    const roomRemap = ab.remaps.find((r) => r.kind === "room") as { to: string };
    assert.equal(kept["roomId"], roomRemap.to);
    assert.equal(plantOf(ab.doc, "p1")["roomId"], "r1");
  });

  it("the same record seen twice is not a collision", () => {
    const a = made(DEV_A, 0, "Fern", st(10));
    assert.deepEqual(merge(a, a).remaps, []);
  });
});

describe("merge: checkpoints and old tombstones", () => {
  it("the later cutoff wins and entries before it are ignored", () => {
    const a = doc({
      device: DEV_A,
      me: 0,
      plants: [
        plant("p1", {
          checkpoint: { cutoff: "2026-10-01", seed: { lastWatered: "2026-09-30" } },
          logs: [log("e1", "2026-10-02", st(10)), log("e0", "2026-09-30", st(1))],
        }),
      ],
    });
    const b = doc({
      device: DEV_B,
      me: 1,
      plants: [
        plant("p1", {
          checkpoint: { cutoff: "2026-10-15", seed: { lastWatered: "2026-10-14" } },
          logs: [
            log("e1", "2026-10-02", st(10)),
            log("e2", "2026-10-20", st(20, DEV_B), "done", 1),
          ],
        }),
      ],
    });
    for (const out of [merge(a, b).doc, merge(b, a).doc]) {
      assert.equal((plantOf(out, "p1")["checkpoint"] as { cutoff: string }).cutoff, "2026-10-15");
      assert.deepEqual(idsOf(out, "p1"), ["e2"]);
    }
  });

  const DAY = 86_400_000;
  const tombDoc = (device: string, me: number, seen: Record<string, string>): AppData =>
    doc({ device, me, seen, stamp: st(200 * DAY, device), tombstones: { e1: st(10 * DAY) } });

  it("drops a tombstone older than 180 days once every member has seen past it", () => {
    const everyone = { "0": st(100 * DAY), "1": st(100 * DAY), "2": st(100 * DAY) };
    const out = merge(tombDoc(DEV_A, 0, everyone), tombDoc(DEV_B, 1, everyone), {
      now: 200 * DAY,
    }).doc;
    assert.equal((out.sync as { tombstones?: unknown }).tombstones, undefined);
  });

  it("keeps it while a member has not seen past it, or while it is young", () => {
    const behind = { "0": st(100 * DAY), "1": st(100 * DAY), "2": st(5 * DAY) };
    const kept = merge(tombDoc(DEV_A, 0, behind), tombDoc(DEV_B, 1, behind), {
      now: 200 * DAY,
    }).doc;
    assert.ok(
      (kept.sync as { tombstones?: Record<string, string> }).tombstones?.["e1"] !== undefined,
    );
    const everyone = { "0": st(100 * DAY), "1": st(100 * DAY), "2": st(100 * DAY) };
    const young = merge(tombDoc(DEV_A, 0, everyone), tombDoc(DEV_B, 1, everyone), {
      now: 100 * DAY,
    }).doc;
    assert.ok(
      (young.sync as { tombstones?: Record<string, string> }).tombstones?.["e1"] !== undefined,
    );
  });
});
