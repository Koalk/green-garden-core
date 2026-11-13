// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDays } from "@green-garden/engine";
import {
  CLIMATES,
  DEFAULT_SPACE_ID,
  VERSION,
  WINTER_MINS,
  buildPlanInput,
  emptyData,
  exportData,
  importData,
  logOutcome,
  makePlan,
  migrate,
  type AppData,
  type Plant,
} from "../src/index.ts";

// the in-ground fields, the `climate` and `winterMin` settings and the rain log reach the engine,
// the export keeps them, and format 8 stays (additive optional keys).

const lavender: Plant = {
  id: "lav",
  spaceId: DEFAULT_SPACE_ID,
  name: "Lavender",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "ground",
  sun: "full_sun",
  groundSoil: "loam",
  mulched: false,
  sheltered: false,
  plantedOn: "2026-05-01",
  establishmentSeasons: 1,
  rootDepth: "medium",
  droughtTolerance: "moderate",
  dormancy: "winter",
  establishingIntervalDays: 7,
  lastWatered: "2026-06-01",
  addedOn: "2026-04-01",
  logs: [{ date: "2026-06-04", outcome: "rain", mm: 18 }],
};

function dataWith(plant: Plant, settings: Partial<AppData["settings"]> = {}): AppData {
  const d = emptyData();
  return { ...d, plants: [plant], settings: { ...d.settings, ...settings } };
}

describe("in-ground fields, climate and rain in the export", () => {
  it("stays format 8 and round-trips every new key", () => {
    assert.equal(VERSION, 9);
    const back = importData(
      exportData(dataWith(lavender, { climate: "oceanic_dry", winterMin: "H4" })),
    );
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.data.plants[0], lavender);
    assert.equal(back.data.settings.climate, "oceanic_dry");
    assert.equal(back.data.settings.winterMin, "H4");
  });

  it("an older file without them reads as unset, with no warning", () => {
    const d = dataWith({ ...lavender, logs: [] });
    const old = JSON.parse(exportData(d)) as { plants: Record<string, unknown>[] };
    for (const k of ["mulched", "sheltered", "plantedOn", "rootDepth", "droughtTolerance"]) {
      delete old.plants[0]?.[k];
    }
    const back = importData(JSON.stringify({ ...old, version: 7 }));
    assert.deepEqual(back.warnings, []);
    assert.equal("mulched" in (back.data.plants[0] ?? {}), false);
    assert.equal("climate" in back.data.settings, false);
    assert.equal("winterMin" in back.data.settings, false);
  });

  it("drops junk values and keeps the rest of the plant", () => {
    const raw = JSON.parse(exportData(dataWith(lavender, { climate: "oceanic_dry" }))) as {
      plants: Record<string, unknown>[];
      settings: Record<string, unknown>;
    };
    Object.assign(raw.plants[0] ?? {}, {
      rootDepth: "huge",
      droughtTolerance: 3,
      dormancy: "spring",
      establishmentSeasons: 7,
      plantedOn: "last year",
      establishingIntervalDays: "often",
      mulched: "yes",
    });
    Object.assign(raw.plants[0] ?? {}, { logs: [{ date: "2026-06-04", outcome: "rain" }] });
    Object.assign(raw.settings, { climate: "tropical", winterMin: "H9" });
    const back = importData(JSON.stringify(raw)).data;
    const p = back.plants[0];
    for (const k of [
      "rootDepth",
      "droughtTolerance",
      "dormancy",
      "establishmentSeasons",
      "plantedOn",
      "establishingIntervalDays",
      "mulched",
    ]) {
      assert.equal(k in (p ?? {}), false, k);
    }
    assert.equal(p?.name, "Lavender");
    assert.equal("climate" in back.settings, false);
    assert.equal("winterMin" in back.settings, false);
    // a rain log with no amount is kept (it credits nothing)
    assert.deepEqual(p.logs, [{ date: "2026-06-04", outcome: "rain" }]);
  });

  it("accepts the looks_fine outcome", () => {
    const d = dataWith({ ...lavender, logs: [{ date: "2026-06-04", outcome: "looks_fine" }] });
    const back = importData(exportData(d));
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.data.plants[0]?.logs, [{ date: "2026-06-04", outcome: "looks_fine" }]);
  });

  it("lists the climate classes and the winter minimums", () => {
    assert.equal(CLIMATES.length, 7);
    assert.deepEqual(WINTER_MINS, ["H1c", "H2", "H3", "H4", "H5", "H6"]);
  });

  it("migrate keeps the new keys and invents no climate", () => {
    const d = dataWith(lavender, { climate: "mountain", winterMin: "H5", country: "ES" });
    const m = migrate(d);
    assert.equal(m.settings.climate, "mountain");
    assert.equal(m.plants[0]?.plantedOn, "2026-05-01");
    const bare = migrate(dataWith(lavender, { country: "GB" }));
    assert.equal("climate" in bare.settings, false);
  });
});

describe("the plan input carries them to the engine", () => {
  const settings = { climate: "oceanic_dry" as const };

  it("passes climate and the outdoor fields, so a rain log moves the window", () => {
    const d = dataWith({ ...lavender, droughtTolerance: "moderate" }, settings);
    const input = buildPlanInput(d, "2026-06-05");
    assert.equal(input.climate, "oceanic_dry");
    assert.equal(input.plants?.[0]?.placement, "ground");
    const plan = makePlan(d, "2026-06-05");
    // interval 6, full credit on 06-04: the next watering is 06-11 to 06-12, so nothing is due before it
    assert.equal(plan.plants[0]?.waterings[0]?.windowEarliest, "2026-06-11");
  });

  it("no climate setting leaves the key out", () => {
    assert.equal("climate" in buildPlanInput(dataWith(lavender), "2026-06-05"), false);
  });

  it("hands weather rows to the engine when the caller has them", () => {
    const d = dataWith({ ...lavender, logs: [] }, settings);
    const rows = [{ date: "2026-06-04", rainMm: 18 }];
    assert.deepEqual(buildPlanInput(d, "2026-06-05", undefined, rows).weather, rows);
    assert.equal("weather" in buildPlanInput(d, "2026-06-05"), false);
    const credited = makePlan(d, "2026-06-05", undefined, rows);
    assert.equal(credited.plants[0]?.waterings[0]?.windowEarliest, "2026-06-11");
  });

  it("a rain-fed plant has no watering day and shows in rainFed", () => {
    const d = dataWith(
      { ...lavender, plantedOn: "2023-03-01", droughtTolerance: "high", logs: [] },
      { climate: "mediterranean" },
    );
    const plan = makePlan(d, "2026-07-20");
    assert.deepEqual(plan.days, []);
    assert.deepEqual(
      plan.rainFed.map((r) => r.plantId),
      ["lav"],
    );
  });

  it("logOutcome records rain with its amount", () => {
    const d = dataWith({ ...lavender, logs: [] }, settings);
    const next = logOutcome(d, "lav", "rain", "2026-06-04", 18);
    assert.deepEqual(next.plants[0]?.logs, [{ date: "2026-06-04", outcome: "rain", mm: 18 }]);
    const fine = logOutcome(d, "lav", "looks_fine", "2026-06-04");
    assert.deepEqual(fine.plants[0]?.logs, [{ date: "2026-06-04", outcome: "looks_fine" }]);
  });

  it("indoor plans do not change", () => {
    const indoor: Plant = {
      id: "i",
      spaceId: DEFAULT_SPACE_ID,
      name: "Pothos",
      style: "let_top_dry",
      intervalDays: 7,
      lastWatered: "2026-06-01",
      logs: [],
    };
    const d = dataWith(indoor, settings);
    const viaStorage = makePlan(d, "2026-06-05");
    const direct = planDays({
      today: "2026-06-05",
      hemisphere: "north",
      horizonDays: 28,
      plants: [indoor],
      prefs: d.settings.prefs,
    });
    assert.deepEqual(viaStorage.days, direct.days);
  });
});
