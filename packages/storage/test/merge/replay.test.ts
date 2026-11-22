// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWindows } from "@green-garden/engine";
import {
  buildPlanInput,
  checkNextDates,
  merge,
  nextDateChecks,
  undoLog,
  type AppData,
} from "../../src/index.ts";
import { DEV_A, DEV_B, doc, log, plant, plantOf, st } from "./helpers.ts";

type Loose = Record<string, unknown>;
const TODAY = "2026-11-02";
const logsOf = (d: AppData, id: string): Loose[] => plantOf(d, id)["logs"] as Loose[];
const windowOf = (d: AppData, id: string) => {
  const w = computeWindows(buildPlanInput(d, TODAY)).windows.find((x) => x.plantId === id);
  assert.ok(w);
  return w;
};
const mk = (logs: Loose[]): AppData =>
  doc({ device: DEV_A, me: 0, plants: [plant("p1", { style: "let_top_dry", logs })] });

describe("undo by event ID", () => {
  const two = [log("e1", "2026-11-01", st(10)), log("e2", "2026-11-01", st(11, DEV_B), "done", 1)];

  it("removes only that entry; the other member's entry for the day stands", () => {
    const out = undoLog(mk(two), "p1", "e1");
    assert.deepEqual(
      logsOf(out, "p1").map((l) => l["id"]),
      ["e2"],
    );
    assert.deepEqual(windowOf(out, "p1"), windowOf(mk([two[1] as Loose]), "p1"));
  });

  it("the schedule still moves once after one of two is undone, and not at all after both", () => {
    const one = undoLog(mk(two), "p1", "e1");
    const none = undoLog(one, "p1", "e2");
    assert.notDeepEqual(windowOf(one, "p1"), windowOf(none, "p1"));
    assert.deepEqual(windowOf(none, "p1"), windowOf(mk([]), "p1"));
  });

  it("records a tombstone when given a stamp, so a merge keeps the entry out", () => {
    const a = mk(two);
    const undone = undoLog(a, "p1", "e1", st(20));
    const sync = undone.sync as unknown as { tombstones?: Record<string, string> };
    assert.equal(sync.tombstones?.["e1"], st(20));
    // the other phone still holds e1; merging cannot bring it back
    const { doc: out } = merge(undone, a);
    assert.deepEqual(
      logsOf(out, "p1").map((l) => l["id"]),
      ["e2"],
    );
  });

  it("leaves the data alone for an unknown plant or entry", () => {
    const a = mk(two);
    assert.equal(undoLog(a, "nope", "e1"), a);
    assert.equal(undoLog(a, "p1", "nope"), a);
  });
});

describe("two phones, one watering: merged logs replay like one", () => {
  it("done by two members on one day moves the schedule once", () => {
    const a = mk([log("e1", "2026-11-01", st(10))]);
    const b = doc({
      device: DEV_B,
      me: 1,
      plants: [
        plant("p1", {
          style: "let_top_dry",
          logs: [log("e2", "2026-11-01", st(11, DEV_B), "done", 1)],
        }),
      ],
    });
    const { doc: out } = merge(a, b);
    assert.equal(logsOf(out, "p1").length, 2);
    assert.deepEqual(windowOf(out, "p1"), windowOf(a, "p1"));
  });
});

describe("the next-date check", () => {
  const data = mk([log("e1", "2026-11-01", st(10))]);

  it("one check per plant, and the same data agrees with itself", () => {
    const mine = nextDateChecks(data, TODAY);
    assert.deepEqual(Object.keys(mine), ["p1"]);
    assert.deepEqual(checkNextDates(data, TODAY, mine), []);
  });

  it("a value that differs comes back as engine-mismatch data", () => {
    const mine = nextDateChecks(data, TODAY);
    const theirs = { p1: ((mine["p1"] as number) + 1) % 0x10000 };
    assert.deepEqual(checkNextDates(data, TODAY, theirs), [
      { kind: "engine-mismatch", plantId: "p1", mine: mine["p1"], theirs: theirs.p1 },
    ]);
  });

  it("plants the other side does not know, or sends no value for, are not a mismatch", () => {
    assert.deepEqual(checkNextDates(data, TODAY, { other: 7 }), []);
    assert.deepEqual(checkNextDates(data, TODAY, {}), []);
  });

  it("another plan for the same logs gives another check", () => {
    const later = mk([log("e1", "2026-11-02", st(10))]);
    assert.notDeepEqual(nextDateChecks(later, TODAY), nextDateChecks(data, TODAY));
  });
});
