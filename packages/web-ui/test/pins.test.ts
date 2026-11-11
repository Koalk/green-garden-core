// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, type AppData } from "@green-garden/storage";
import {
  addAwayRange,
  cantWaterToday,
  deletePlant,
  logOutcome,
  makePlan,
  removeAwayDate,
  setPrefs,
  waterAll,
} from "../src/index.ts";

const TODAY = "2026-11-02";

/** The engine's pinned-watering scenario as app data: p1 is watered early on 11-04 before six away days. */
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
        awayDates: [
          "2026-11-05",
          "2026-11-06",
          "2026-11-07",
          "2026-11-08",
          "2026-11-09",
          "2026-11-10",
          "2026-11-11",
        ],
      },
    ],
    settings: { ...base.settings, prefs: { preLeaveWatering: true } },
  };
}

const preLeave = (d: AppData, id: string): string[] =>
  (makePlan(d, TODAY).plants.find((p) => p.plantId === id)?.waterings ?? [])
    .filter((w) => w.reason === "pre_leave")
    .map((w) => w.date);

describe("pre-leave pins in the actions", () => {
  it("logging another plant keeps the pre-leave watering the user was shown", () => {
    const d = world();
    assert.deepEqual(preLeave(d, "p1"), ["2026-11-04"]);
    const after = logOutcome(d, "p0", "dry_early", TODAY);
    assert.deepEqual(preLeave(after, "p1"), ["2026-11-04"]);
    assert.deepEqual(after.pins, [{ plantId: "p1", date: "2026-11-04" }]);
  });

  it("water all keeps it too", () => {
    assert.deepEqual(preLeave(waterAll(world(), ["p0"], TODAY), "p1"), ["2026-11-04"]);
  });

  it("a pin is ignored once the away days that justified it are gone, and back when they return", () => {
    const pinned = logOutcome(world(), "p0", "dry_early", TODAY);
    const days = pinned.spaces[0]?.awayDates ?? [];
    let free = pinned;
    for (const day of days) free = removeAwayDate(free, day);
    assert.deepEqual(preLeave(free, "p1"), [], "no away stretch, so no early watering");
    assert.deepEqual(preLeave(addAwayRange(free, days[0] ?? "", days.at(-1) ?? "") ?? free, "p1"), [
      "2026-11-04",
    ]);
  });

  it("turning pre-leave watering off ignores the pins", () => {
    const pinned = logOutcome(world(), "p0", "dry_early", TODAY);
    assert.deepEqual(preLeave(setPrefs(pinned, { preLeaveWatering: false }), "p1"), []);
  });

  it("can't-water-today and its undo leave the plan as it was", () => {
    const pinned = logOutcome(world(), "p0", "dry_early", TODAY);
    const back = removeAwayDate(cantWaterToday(pinned, TODAY), TODAY);
    assert.deepEqual(makePlan(back, TODAY), makePlan(pinned, TODAY));
  });

  it("deleting a plant drops its pins", () => {
    const pinned = logOutcome(world(), "p0", "dry_early", TODAY);
    assert.equal(deletePlant(pinned, "p1").pins, undefined);
  });

  it("with nothing to pin no pins field is added", () => {
    const d = { ...world(), spaces: [{ id: "space1", name: "Home", awayDates: [] }] };
    assert.equal(logOutcome(d, "p0", "done", TODAY).pins, undefined);
  });
});

describe("app.ts pins what it shows", () => {
  it("re-pins on every render and saves when the pins changed", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
    assert.match(src, /pinPreLeave\(data, today\)/);
  });
});
