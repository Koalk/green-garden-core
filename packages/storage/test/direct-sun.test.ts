// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPACE_ID,
  VERSION,
  buildPlanInput,
  emptyData,
  exportData,
  importData,
  type AppData,
  type Plant,
} from "../src/index.ts";

// `directSun` ranges on a plant and on a room travel in the export. Additive optional
// keys: the format stays 8.

const plant: Plant = {
  id: "p",
  spaceId: DEFAULT_SPACE_ID,
  name: "Pelargonium",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "outdoor_pot",
  directSun: [
    { from: 7, to: 11 },
    { from: 15, to: 18 },
  ],
  fieldSources: { directSun: "user" },
};

const data = (): AppData => ({
  ...emptyData(),
  plants: [plant],
  rooms: [
    {
      id: "r",
      name: "Kitchen",
      spaceId: DEFAULT_SPACE_ID,
      directSun: [{ from: 8, to: 12 }],
    },
  ],
});

describe("directSun in the export", () => {
  it("stays format 8 and round-trips on plants and rooms", () => {
    assert.equal(VERSION, 9);
    const back = importData(exportData(data()));
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.data.plants[0]?.directSun, plant.directSun);
    assert.deepEqual(back.data.rooms[0]?.directSun, [{ from: 8, to: 12 }]);
    assert.equal(back.data.plants[0]?.fieldSources?.directSun, "user");
  });

  it("an empty list (the user said none) survives", () => {
    const d = data();
    const none: AppData = { ...d, plants: [{ ...plant, directSun: [] }] };
    assert.deepEqual(importData(exportData(none)).data.plants[0]?.directSun, []);
  });

  it("drops junk ranges, sorts, merges overlaps and keeps at most 3", () => {
    const raw = JSON.parse(exportData(data())) as Record<string, unknown>;
    const plants = raw["plants"] as Record<string, unknown>[];
    plants[0] = {
      ...plants[0],
      directSun: [
        { from: 15, to: 18 },
        { from: 9, to: 9 },
        { from: -1, to: 4 },
        { from: 7, to: 11 },
        { from: 10, to: 12 },
        { from: "x", to: 3 },
        { from: 20, to: 25 },
        { from: 13, to: 14 },
        { from: 19.5, to: 22 },
      ],
    };
    const back = importData(JSON.stringify(raw));
    assert.deepEqual(back.data.plants[0]?.directSun, [
      { from: 7, to: 12 },
      { from: 13, to: 14 },
      { from: 15, to: 18 },
    ]);
  });

  it("a plant with no answer has no key after a round trip", () => {
    const plain = Object.fromEntries(
      Object.entries(plant).filter(([k]) => k !== "directSun"),
    ) as unknown as Plant;
    const back = importData(exportData({ ...emptyData(), plants: [plain] }));
    assert.equal("directSun" in (back.data.plants[0] ?? {}), false);
  });
});

describe("directSun reaches the plan (per room indoors, per plant outdoors)", () => {
  const indoor: Plant = {
    id: "i",
    spaceId: DEFAULT_SPACE_ID,
    name: "Basil",
    style: "let_top_dry",
    intervalDays: 7,
    roomId: "r",
    fieldSources: { intervalDays: "catalogue" },
    // the plant's own hours are for outdoor use only: indoors the room's answer counts
    directSun: [{ from: 0, to: 1 }],
  };
  const room = {
    id: "r",
    name: "Kitchen",
    spaceId: DEFAULT_SPACE_ID,
    directSun: [{ from: 8, to: 12 }],
  };
  const d = (plants: Plant[], country?: "GB" | "ES"): AppData => {
    const base = emptyData();
    return {
      ...base,
      plants,
      rooms: [room],
      settings: { ...base.settings, ...(country === undefined ? {} : { country }) },
    };
  };

  it("an indoor plant takes its room's hours, not its own", () => {
    const input = buildPlanInput(d([indoor]), "2026-06-21");
    assert.deepEqual(input.plants?.[0]?.directSun, [{ from: 8, to: 12 }]);
  });

  it("an indoor plant in a room with no answer has none", () => {
    const bare = d([indoor]);
    const r = Object.fromEntries(
      Object.entries(room).filter(([k]) => k !== "directSun"),
    ) as unknown as typeof room;
    const input = buildPlanInput({ ...bare, rooms: [r] }, "2026-06-21");
    assert.equal(input.plants?.[0]?.directSun, undefined);
  });

  it("an interval the user typed takes no indoor sun hours", () => {
    const typed: Plant = { ...indoor, fieldSources: { intervalDays: "user" } };
    assert.equal(buildPlanInput(d([typed]), "2026-06-21").plants?.[0]?.directSun, undefined);
  });

  it("an outdoor plant keeps its own hours", () => {
    const pot: Plant = { ...indoor, placement: "outdoor_pot", directSun: [{ from: 9, to: 13 }] };
    const input = buildPlanInput(d([pot]), "2026-06-21");
    assert.deepEqual(input.plants?.[0]?.directSun, [{ from: 9, to: 13 }]);
  });

  it("the home country goes to the engine for the clock time of solar noon", () => {
    assert.equal(buildPlanInput(d([indoor], "ES"), "2026-06-21").country, "ES");
    assert.equal(buildPlanInput(d([indoor]), "2026-06-21").country, undefined);
  });
});
