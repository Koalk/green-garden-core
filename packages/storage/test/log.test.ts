// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  earlierWateringRange,
  emptyData,
  logOutcome,
  logWateredEarlier,
  makePlan,
  pinPreLeave,
  type AppData,
} from "../src/index.ts";

const data: AppData = {
  ...emptyData(),
  plants: [
    { id: "p1", spaceId: "space1", name: "Fern", style: "keep_moist", intervalDays: 4, logs: [] },
  ],
};

describe("logging an outcome, shared by the UI and the Home Assistant bridge", () => {
  it("appends the outcome to the plant's log and leaves other plants alone", () => {
    const next = logOutcome(data, "p1", "done", "2026-11-02");
    assert.deepEqual(next.plants[0]?.logs, [{ date: "2026-11-02", outcome: "done" }]);
    assert.deepEqual(data.plants[0]?.logs, []);
  });
  it("ignores an unknown plant id", () => {
    assert.deepEqual(logOutcome(data, "nope", "done", "2026-11-02").plants, data.plants);
  });
});

const TODAY = "2026-11-02";

/** The engine's pinned-watering scenario: p1 is watered early on 11-04 before seven away days. */
function world(): AppData {
  const base = emptyData();
  return {
    ...base,
    plants: [
      {
        id: "p0",
        spaceId: "space1",
        name: "Moist",
        style: "keep_moist",
        intervalDays: 3,
        lastWatered: "2026-10-29",
      },
      {
        id: "p1",
        spaceId: "space1",
        name: "Top",
        style: "let_top_dry",
        intervalDays: 5,
        lastWatered: "2026-11-01",
      },
    ],
    spaces: [
      {
        id: "space1",
        name: "Home",
        awayDates: [5, 6, 7, 8, 9, 10, 11].map((d) => `2026-11-${String(d).padStart(2, "0")}`),
      },
    ],
    settings: { ...base.settings, prefs: { preLeaveWatering: true } },
  };
}

const preLeave = (d: AppData, id: string): string[] =>
  (makePlan(d, TODAY).plants.find((p) => p.plantId === id)?.waterings ?? [])
    .filter((w) => w.reason === "pre_leave")
    .map((w) => w.date);

describe("pre-leave pins in logOutcome and pinPreLeave", () => {
  it("logging another plant keeps the pre-leave watering the user was shown", () => {
    const d = world();
    assert.deepEqual(preLeave(d, "p1"), ["2026-11-04"]);
    const after = logOutcome(d, "p0", "dry_early", TODAY);
    assert.deepEqual(preLeave(after, "p1"), ["2026-11-04"]);
    assert.deepEqual(after.pins, [{ plantId: "p1", date: "2026-11-04" }]);
  });

  it("a pin is ignored once the away days that justified it are gone, and back when they return", () => {
    const pinned = logOutcome(world(), "p0", "dry_early", TODAY);
    const days = pinned.spaces[0]?.awayDates ?? [];
    const free = { ...pinned, spaces: [{ id: "space1", name: "Home", awayDates: [] }] };
    assert.deepEqual(preLeave(free, "p1"), [], "no away stretch, so no early watering");
    const back = { ...free, spaces: [{ id: "space1", name: "Home", awayDates: days }] };
    assert.deepEqual(preLeave(back, "p1"), ["2026-11-04"]);
  });

  it("turning pre-leave watering off ignores the pins", () => {
    const pinned = logOutcome(world(), "p0", "dry_early", TODAY);
    const off = { ...pinned, settings: { ...pinned.settings, prefs: { preLeaveWatering: false } } };
    assert.deepEqual(preLeave(off, "p1"), []);
  });

  it("with nothing to pin no pins field is added", () => {
    const d = { ...world(), spaces: [{ id: "space1", name: "Home", awayDates: [] }] };
    assert.equal(logOutcome(d, "p0", "done", TODAY).pins, undefined);
  });

  it("pinPreLeave returns the same object when the pins already match", () => {
    const pinned = pinPreLeave(world(), TODAY);
    assert.equal(pinPreLeave(pinned, TODAY), pinned);
  });
});

const fern = data.plants[0] ?? assert.fail("fixture");
const only = (d: AppData) => d.plants[0] ?? assert.fail("fixture");

describe("Watered it earlier?", () => {
  const plant = (over: object) => ({
    ...data,
    plants: [{ ...fern, ...over }],
  });
  it("offers days after the last watering up to today, never the future", () => {
    const d = plant({ logs: [{ date: "2026-10-25", outcome: "done" }] });
    assert.deepEqual(earlierWateringRange(only(d), "2026-11-02"), {
      min: "2026-10-26",
      max: "2026-11-02",
    });
  });
  it("counts lastWatered when there is no done log, and ignores skips and dry-early logs", () => {
    const d = plant({
      lastWatered: "2026-10-20",
      logs: [{ date: "2026-10-30", outcome: "skipped" }],
    });
    assert.equal(earlierWateringRange(only(d), "2026-11-02")?.min, "2026-10-21");
  });
  it("has no minimum bound problem for a plant never watered: the window opens a year back", () => {
    assert.equal(earlierWateringRange(fern, "2026-11-02")?.min, "2025-11-02");
  });
  it("offers nothing when the plant was watered today", () => {
    const d = plant({ logs: [{ date: "2026-11-02", outcome: "done" }] });
    assert.equal(earlierWateringRange(only(d), "2026-11-02"), undefined);
  });
  it("logs a done on that date and refuses a future, too-early or invalid date", () => {
    const d = plant({ logs: [{ date: "2026-10-25", outcome: "done" }] });
    const ok = logWateredEarlier(d, "p1", "2026-10-30", "2026-11-02");
    assert.deepEqual(ok?.plants[0]?.logs?.at(-1), { date: "2026-10-30", outcome: "done" });
    assert.equal(logWateredEarlier(d, "p1", "2026-11-03", "2026-11-02"), undefined);
    assert.equal(logWateredEarlier(d, "p1", "2026-10-25", "2026-11-02"), undefined);
    assert.equal(logWateredEarlier(d, "p1", "nonsense", "2026-11-02"), undefined);
    assert.equal(logWateredEarlier(d, "nope", "2026-10-30", "2026-11-02"), undefined);
  });
  it("the schedule counts from that date: due again an interval after it, not after today", () => {
    const d = {
      ...data,
      plants: [{ ...fern, logs: [{ date: "2026-10-20", outcome: "done" as const }] }],
    };
    const late = makePlan(d, "2026-11-02").plants[0]?.waterings[0]?.date;
    const after = logWateredEarlier(d, "p1", "2026-10-31", "2026-11-02");
    assert.ok(after !== undefined);
    const next = makePlan(after, "2026-11-02").plants[0]?.waterings[0]?.date;
    assert.ok(late !== undefined && next !== undefined);
    assert.ok(next > "2026-11-02" && next <= "2026-11-07", `next watering ${next}`);
  });
});
