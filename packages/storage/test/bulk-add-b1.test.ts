// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWindows } from "@green-garden/engine";
import {
  DEFAULT_SPACE_ID,
  VERSION,
  assumedMarginDays,
  buildPlanInput,
  exportData,
  fieldSource,
  importData,
  type AppData,
  type Plant,
} from "../src/index.ts";

const base: Plant = {
  id: "p1",
  spaceId: DEFAULT_SPACE_ID,
  name: "Monstera",
  style: "let_top_dry",
  intervalDays: 7,
  lastWatered: "2026-11-02",
  addedOn: "2026-10-01",
  logs: [],
};

function dataWith(plant: Plant): AppData {
  return {
    spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
    plants: [plant],
    rooms: [],
    settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
  };
}

const full: Plant = {
  ...base,
  placement: "indoor",
  potMaterial: "terracotta",
  soilType: "gritty",
  plantSize: "large",
  unmatched: true,
  drainage: "hole",
  fieldSources: {
    placement: "default",
    potMaterial: "user",
    soilType: "catalogue",
    plantSize: "default",
    drainage: "default",
    intervalDays: "catalogue",
  },
};

describe("bulk add B1: new plant fields and sources", () => {
  it("the export version is 9", () => {
    assert.equal(VERSION, 9);
    assert.equal((JSON.parse(exportData(dataWith(full))) as { version: number }).version, 9);
  });

  it("round-trips placement, potMaterial, soilType, plantSize, unmatched and fieldSources", () => {
    const { data, warnings } = importData(exportData(dataWith(full)));
    assert.deepEqual(warnings, []);
    assert.deepEqual(data.plants[0], full);
  });

  it("drops values outside the allowed sets and keeps the rest", () => {
    const raw = JSON.parse(exportData(dataWith(full))) as { plants: Record<string, unknown>[] };
    raw.plants[0] = {
      ...raw.plants[0],
      placement: "moon",
      potMaterial: 4,
      plantSize: "huge",
      unmatched: "yes",
      fieldSources: { drainage: "guess", soilType: "learned", "": "user", intervalDays: 7 },
    };
    const p = importData(JSON.stringify(raw)).data.plants[0];
    assert.equal(p?.placement, undefined);
    assert.equal(p?.potMaterial, undefined);
    assert.equal(p?.plantSize, undefined);
    assert.equal(p?.unmatched, undefined);
    assert.equal(p?.soilType, "gritty");
    assert.deepEqual(p.fieldSources, { soilType: "learned" });
  });

  it("an old file (version 6) loads with every field read as user", () => {
    const old = JSON.parse(exportData(dataWith(base))) as { version: number };
    old.version = 6;
    const p = importData(JSON.stringify(old)).data.plants[0];
    assert.ok(p);
    assert.equal(p.fieldSources, undefined);
    assert.equal(fieldSource(p, "drainage"), "user");
    assert.equal(fieldSource(p, "potDiameterCm"), "user");
    assert.equal(assumedMarginDays(p), 0);
  });

  it("an old file whose free-text source names a catalogue origin reads as catalogue", () => {
    for (const source of ["catalogue:monstera-deliciosa", "catalogue"]) {
      const old = JSON.parse(exportData(dataWith({ ...base, source }))) as { version: number };
      old.version = 6;
      const p = importData(JSON.stringify(old)).data.plants[0];
      assert.ok(p);
      assert.equal(fieldSource(p, "intervalDays"), "catalogue", source);
      assert.equal(fieldSource(p, "lastWatered"), "user", source);
    }
  });

  it("a version 7 file without fieldSources is all user, whatever the source text says", () => {
    const p = importData(exportData(dataWith({ ...base, source: "catalogue:x" }))).data.plants[0];
    assert.ok(p);
    assert.equal(fieldSource(p, "intervalDays"), "user");
  });
});

describe("assumedMarginDays (ranks 3 to 7, cap 3)", () => {
  const withSources = (fieldSources: NonNullable<Plant["fieldSources"]>): Plant => ({
    ...base,
    fieldSources,
  });

  it("counts drainage, lastWatered, light, potDiameterCm and potMaterial that are not user", () => {
    assert.equal(assumedMarginDays(withSources({ drainage: "default" })), 1);
    assert.equal(
      assumedMarginDays(
        withSources({ drainage: "default", lastWatered: "default", light: "catalogue" }),
      ),
      3,
    );
  });

  it("learned counts as assumed; user does not", () => {
    assert.equal(assumedMarginDays(withSources({ potMaterial: "learned" })), 1);
    assert.equal(assumedMarginDays(withSources({ potMaterial: "user", drainage: "user" })), 0);
  });

  it("is capped at 3 even when all five are assumed", () => {
    const all = withSources({
      drainage: "default",
      lastWatered: "default",
      light: "default",
      potDiameterCm: "default",
      potMaterial: "default",
    });
    assert.equal(assumedMarginDays(all), 3);
  });

  it("ignores fields outside ranks 3 to 7", () => {
    const outside = withSources({
      placement: "default",
      soilType: "default",
      plantSize: "default",
      intervalDays: "catalogue",
    });
    assert.equal(assumedMarginDays(outside), 0);
  });
});

describe("the plan uses the margin", () => {
  it("buildPlanInput passes the margin and the window ends later", () => {
    const sure = dataWith(base);
    const unsure = dataWith({
      ...base,
      fieldSources: { drainage: "default", potMaterial: "default" },
    });
    const a = computeWindows(buildPlanInput(sure, "2026-11-02")).windows[0];
    const b = computeWindows(buildPlanInput(unsure, "2026-11-02")).windows[0];
    assert.equal(a?.wording, "exact");
    assert.equal(b?.wording, "around");
    assert.equal(b.marginDays, 2);
    assert.equal(b.earliest, a.earliest);
    assert.equal(b.latest, "2026-11-13");
    assert.equal(a.latest, "2026-11-11");
  });
});
