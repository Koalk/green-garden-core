// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPACE_ID,
  VERSION,
  emptyData,
  exportData,
  importData,
  makePlan,
  type AppData,
  type Plant,
} from "../src/index.ts";

// 02m 1.2: `placementHistory` is a plain plant field, so it travels in the export. Additive optional
// key: the format stays 8 (the parser ignores unknown keys, 01i 7.3).

const cal: Plant = {
  id: "cal",
  spaceId: DEFAULT_SPACE_ID,
  name: "Calamondin",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "outdoor_pot",
  sun: "part_shade",
  lastWatered: "2026-10-10",
  addedOn: "2026-03-01",
  placementHistory: [
    { on: "2026-03-01", placement: "indoor" },
    { on: "2026-05-20", placement: "outdoor_pot", sheltered: true },
    { on: "2026-10-15", placement: "outdoor_pot" },
  ],
};

const dataWith = (plant: Plant): AppData => ({ ...emptyData(), plants: [plant] });
const roundTrip = (raw: unknown) => importData(JSON.stringify(raw));

describe("placementHistory in the export", () => {
  it("stays format 8 and round-trips", () => {
    assert.equal(VERSION, 9);
    const back = importData(exportData(dataWith(cal)));
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.data.plants[0]?.placementHistory, cal.placementHistory);
  });

  it("a plant without a history has no key after a round trip", () => {
    const plain = Object.fromEntries(
      Object.entries(cal).filter(([k]) => k !== "placementHistory"),
    ) as unknown as Plant;
    const back = importData(exportData(dataWith(plain)));
    assert.equal("placementHistory" in (back.data.plants[0] ?? {}), false);
  });

  it("drops junk entries, sorts by date, and lets an equal date keep the later entry", () => {
    const raw = JSON.parse(exportData(dataWith(cal))) as { plants: Record<string, unknown>[] };
    const p = raw.plants[0] ?? {};
    p["placementHistory"] = [
      { on: "2026-10-15", placement: "indoor" },
      { on: "2026-03-01", placement: "outdoor_pot", sheltered: "yes" },
      { on: "2026-06-01", placement: "ground" },
      { on: "nope", placement: "indoor" },
      { on: "2026-10-15", placement: "outdoor_pot", sheltered: true },
      "x",
      { placement: "indoor" },
      { on: "2026-02-01", placement: "indoor", sheltered: true },
    ];
    const back = roundTrip(raw);
    assert.deepEqual(back.data.plants[0]?.placementHistory, [
      { on: "2026-02-01", placement: "indoor" },
      { on: "2026-03-01", placement: "outdoor_pot" },
      { on: "2026-10-15", placement: "outdoor_pot", sheltered: true },
    ]);
  });

  it("an empty or non-list history is no history", () => {
    for (const bad of [[], "x", 3, {}]) {
      const raw = JSON.parse(exportData(dataWith(cal))) as { plants: Record<string, unknown>[] };
      (raw.plants[0] ?? {})["placementHistory"] = bad;
      assert.equal("placementHistory" in (roundTrip(raw).data.plants[0] ?? {}), false);
    }
  });
});

describe("the plan input carries the history to the engine", () => {
  it("the calamondin's rain while indoors does not count", () => {
    const indoorsFirst: Plant = {
      ...cal,
      placementHistory: [
        { on: "2026-03-01", placement: "indoor" },
        { on: "2026-10-15", placement: "outdoor_pot" },
      ],
    };
    const rows = [{ date: "2026-10-12", rainMm: 12 }];
    const plan = makePlan(dataWith(indoorsFirst), "2026-10-16", undefined, rows);
    // Indoors on 12 Oct: no credit. Moved out 15 Oct: interval 5 from the watering of 10 Oct, due by 16 Oct.
    // (If the rain had counted, the last watering would be 12 Oct and the window would close on 18 Oct.)
    assert.equal(plan.plants[0]?.waterings[0]?.windowLatest, "2026-10-16");
  });
});
