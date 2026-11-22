// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENGINE_VERSION,
  computeWindows,
  nextDateCheck,
  type LogEntry,
  type PlanInput,
  type PlantInput,
} from "@green-garden/engine";

// Replay of logs two people made. Interval 7, let_top_dry, no rest factor, no start facts. The window
// barely moves when the ideal date is stepped twice, so the vectors start from a plant that has learned
// a 2-day adjustment with a streak of 1: a third `done` in a row decays the adjustment by a day, and
// that shows in the window. Counting a watering twice is therefore visible; counting it once is not.

const base: PlantInput = { id: "p", style: "let_top_dry", intervalDays: 7 };
const learned: Partial<PlantInput> = { adjustmentDays: 2, doneStreak: 1 };
const entry = (
  date: string,
  outcome: LogEntry["outcome"] = "done",
  extra: Partial<LogEntry> = {},
): LogEntry => ({ date, outcome, ...extra });
const withLogs = (logs: readonly LogEntry[], extra: Partial<PlantInput> = {}): PlantInput => ({
  ...base,
  ...extra,
  logs,
});
const windowOf = (plant: PlantInput, today = "2026-11-05") => {
  const input: PlanInput = { today, plants: [plant] };
  const w = computeWindows(input).windows.find((x) => x.plantId === plant.id);
  assert.ok(w, "a window for the plant");
  return w;
};

describe("one watering per (day, outcome)", () => {
  it("two done on one day move the schedule once", () => {
    const once = windowOf(withLogs([entry("2026-11-01")], learned));
    const twice = windowOf(
      withLogs(
        [
          entry("2026-11-01", "done", { id: "aaaaaaaaaaaaaaa1", by: 0, at: "1" }),
          entry("2026-11-01", "done", { id: "aaaaaaaaaaaaaaa2", by: 1, at: "2" }),
        ],
        learned,
      ),
    );
    assert.deepEqual(twice, once);
  });

  it("three done on one day still move it once", () => {
    const once = windowOf(withLogs([entry("2026-11-01")], learned));
    const thrice = windowOf(
      withLogs([entry("2026-11-01"), entry("2026-11-01"), entry("2026-11-01")], learned),
    );
    assert.deepEqual(thrice, once);
  });

  it("done on two different days still moves it twice", () => {
    const one = windowOf(withLogs([entry("2026-11-02")], learned));
    const two = windowOf(withLogs([entry("2026-10-26"), entry("2026-11-02")], learned));
    assert.notDeepEqual(two, one);
  });

  it("different outcomes on one day each count", () => {
    const done = windowOf(withLogs([entry("2026-11-01")], learned));
    const both = windowOf(
      withLogs([entry("2026-11-01"), entry("2026-11-01", "still_wet")], learned),
    );
    assert.notDeepEqual(both, done);
  });

  it("two identical still_wet on one day snooze once", () => {
    const once = windowOf(withLogs([entry("2026-11-01"), entry("2026-11-04", "still_wet")]));
    const twice = windowOf(
      withLogs([
        entry("2026-11-01"),
        entry("2026-11-04", "still_wet"),
        entry("2026-11-04", "still_wet"),
      ]),
    );
    assert.deepEqual(twice, once);
  });
});

describe("a checkpoint seeds the replay", () => {
  // The plant starts with a learned 2-day adjustment and a streak of 1, then three weekly waterings:
  // the second of them is the third in a row, so the adjustment decays to 1 and the streak restarts.
  // State after 17 Oct: last 17 Oct, anchor 29 Oct, adjustment 1, streak 1. Two more waterings on
  // 24 and 31 Oct: the second is the third in a row again, so the adjustment decays to 0.
  const old = [entry("2026-10-03"), entry("2026-10-10"), entry("2026-10-17")];
  const newer = [entry("2026-10-24"), entry("2026-10-31")];
  const seed = {
    lastWatered: "2026-10-17",
    anchor: "2026-10-29",
    adjustmentDays: 1,
    doneStreak: 1,
  };
  const full = windowOf(withLogs([...old, ...newer], learned));
  const flat = windowOf(withLogs([...old, ...newer], { adjustmentDays: 2, doneStreak: 0 }));

  it("the state the seed stands for matters (the check below is sensitive)", () => {
    assert.notDeepEqual(full, flat);
  });

  it("replaying from the seed gives what replaying every entry gives", () => {
    const seeded = windowOf(withLogs(newer, { checkpoint: { cutoff: "2026-10-20", seed } }));
    assert.deepEqual(seeded, full);
  });

  it("entries before the cutoff are ignored, kept or not", () => {
    const kept = windowOf(
      withLogs([...old, ...newer], { checkpoint: { cutoff: "2026-10-20", seed } }),
    );
    assert.deepEqual(kept, full);
    // an entry that would change the result if it counted: a still_wet before the cutoff
    const noisy = windowOf(
      withLogs([entry("2026-10-18", "still_wet"), ...newer], {
        checkpoint: { cutoff: "2026-10-20", seed },
      }),
    );
    assert.deepEqual(noisy, full);
  });

  it("an entry on the cutoff day still counts", () => {
    const on = windowOf(
      withLogs([entry("2026-10-20", "still_wet"), ...newer], {
        checkpoint: { cutoff: "2026-10-20", seed },
      }),
    );
    assert.notDeepEqual(on, full);
  });

  it("the seed replaces the plant's own replay fields", () => {
    const stale = windowOf(
      withLogs(newer, {
        lastWatered: "2026-01-01",
        anchor: "2026-01-08",
        adjustmentDays: 3,
        doneStreak: 0,
        checkpoint: { cutoff: "2026-10-20", seed },
      }),
    );
    assert.deepEqual(stale, full);
  });

  it("a move dated before the cutoff is already in the seed", () => {
    const moved = (history: NonNullable<PlantInput["placementHistory"]>) =>
      windowOf(
        withLogs([], {
          placementHistory: history,
          checkpoint: {
            cutoff: "2026-10-20",
            seed: { lastWatered: "2026-10-17", anchor: "2026-10-26", adjustmentDays: 2 },
          },
        }),
      );
    const one = moved([{ on: "2026-01-01", placement: "indoor" }]);
    const two = moved([
      { on: "2026-01-01", placement: "indoor" },
      { on: "2026-10-18", placement: "indoor" },
    ]);
    assert.deepEqual(two, one);
  });

  it("a checkpoint with an unreadable cutoff is ignored", () => {
    const plain = windowOf(withLogs([...old, ...newer], learned));
    const bad = windowOf(
      withLogs([...old, ...newer], { ...learned, checkpoint: { cutoff: "last week", seed } }),
    );
    assert.deepEqual(bad, plain);
  });
});

describe("the next-date check value", () => {
  it("is a small whole number that is the same every time", () => {
    const n = nextDateCheck("p", "2026-11-07");
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffff);
    assert.equal(nextDateCheck("p", "2026-11-07"), n);
  });

  it("changes with the plant, the date and the engine version", () => {
    const n = nextDateCheck("p", "2026-11-07");
    assert.notEqual(nextDateCheck("q", "2026-11-07"), n);
    assert.notEqual(nextDateCheck("p", "2026-11-08"), n);
    assert.notEqual(nextDateCheck("p", "2026-11-07", ENGINE_VERSION + 1), n);
  });
});
