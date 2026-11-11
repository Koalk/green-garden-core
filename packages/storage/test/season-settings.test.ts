// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWindows } from "@green-garden/engine";
import {
  COUNTRIES,
  COUNTRY_LATITUDE,
  DEFAULT_SPACE_ID,
  VERSION,
  buildPlanInput,
  emptyData,
  exportData,
  homeLatitude,
  importData,
  type AppData,
  type Plant,
} from "../src/index.ts";

const pothos: Plant = {
  id: "p1",
  spaceId: DEFAULT_SPACE_ID,
  name: "Pothos",
  style: "let_top_dry",
  intervalDays: 7,
  restFactor: 1.5,
  lastWatered: "2026-10-17",
  logs: [],
};

function dataWith(settings: Partial<AppData["settings"]>): AppData {
  const d = emptyData();
  return { ...d, plants: [pothos], settings: { ...d.settings, ...settings } };
}

describe("home latitude and country", () => {
  it("the export is version 9, with the two new optional settings", () => {
    assert.equal(VERSION, 9);
    const text = exportData(dataWith({ latitude: 41.4, country: "ES" }));
    const parsed = JSON.parse(text) as { version: number; settings: Record<string, unknown> };
    assert.equal(parsed.version, 9);
    assert.equal(parsed.settings["latitude"], 41.4);
    assert.equal(parsed.settings["country"], "ES");
  });

  it("round-trips, and an older file without them reads as unset", () => {
    const back = importData(exportData(dataWith({ latitude: 41.4, country: "ES" }))).data;
    assert.equal(back.settings.latitude, 41.4);
    assert.equal(back.settings.country, "ES");
    const v7 = JSON.stringify({ ...JSON.parse(exportData(dataWith({}))), version: 7 });
    const old = importData(v7);
    assert.equal(old.warnings.length, 0);
    assert.equal("latitude" in old.data.settings, false);
    assert.equal("country" in old.data.settings, false);
  });

  it("drops junk: a latitude outside 0 to 90, text, an unknown country", () => {
    const raw = JSON.parse(exportData(dataWith({}))) as { settings: Record<string, unknown> };
    for (const [latitude, country] of [
      [120, "XX"],
      ["far north", "gb"],
      [Number.NaN, 7],
    ] as const) {
      const text = JSON.stringify({ ...raw, settings: { ...raw.settings, latitude, country } });
      const s = importData(text).data.settings;
      assert.equal("latitude" in s, false, String(latitude));
      assert.equal("country" in s, false, String(country));
    }
  });

  it("a negative latitude is read as its magnitude (the hemisphere says which side)", () => {
    const raw = JSON.parse(exportData(dataWith({}))) as { settings: Record<string, unknown> };
    const text = JSON.stringify({ ...raw, settings: { ...raw.settings, latitude: -37.8 } });
    assert.equal(importData(text).data.settings.latitude, 37.8);
  });

  it("the latitude wins over the country, the country over nothing", () => {
    assert.deepEqual(COUNTRIES, ["GB", "ES"]);
    assert.equal(COUNTRY_LATITUDE.GB, 55);
    assert.equal(COUNTRY_LATITUDE.ES, 40);
    assert.equal(homeLatitude({ latitude: 48, country: "ES" }), 48);
    assert.equal(homeLatitude({ country: "ES" }), 40);
    assert.equal(homeLatitude({}), undefined);
  });

  it("buildPlanInput hands the latitude to the engine, and the ramp follows", () => {
    assert.equal(buildPlanInput(dataWith({ country: "ES" }), "2026-10-18").latitude, 40);
    assert.equal(buildPlanInput(dataWith({}), "2026-10-18").latitude, undefined);
    const uk = computeWindows(buildPlanInput(dataWith({ country: "GB" }), "2026-10-18"));
    const es = computeWindows(buildPlanInput(dataWith({ country: "ES" }), "2026-10-18"));
    assert.equal(uk.windows[0]?.latest, "2026-10-28"); // halfway up the ramp: 9 days
    assert.equal(es.windows[0]?.latest, "2026-10-26"); // still growth: 7 days
  });
});
