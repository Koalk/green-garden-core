// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, exportData, importData, type AppData } from "../src/index.ts";
import { setWeather } from "../src/index.ts";

const base = emptyData();

describe("weather settings", () => {
  it("are off by default and absent from a fresh export", () => {
    assert.equal(base.settings.weather, undefined);
    assert.equal(importData(exportData(base)).data.settings.weather, undefined);
  });

  it("setWeather rounds the home point to 2 decimals", () => {
    const d = setWeather(base, { enabled: true, lat: 55.953251, lon: -3.188267 });
    assert.deepEqual(d.settings.weather, { enabled: true, lat: 55.95, lon: -3.19 });
  });

  it("setWeather keeps the switch without a point, and drops a half point or a point out of range", () => {
    assert.deepEqual(setWeather(base, { enabled: true }).settings.weather, { enabled: true });
    assert.deepEqual(setWeather(base, { enabled: true, lat: 55.9 }).settings.weather, {
      enabled: true,
    });
    assert.deepEqual(setWeather(base, { enabled: true, lat: 95, lon: 0 }).settings.weather, {
      enabled: true,
    });
  });

  it("setWeather off with nothing else removes the setting", () => {
    const on = setWeather(base, { enabled: true, lat: 40.42, lon: -3.7 });
    assert.equal(setWeather(on, { enabled: false }).settings.weather, undefined);
    assert.deepEqual(setWeather(on, { enabled: false, lat: 40.42, lon: -3.7 }).settings.weather, {
      enabled: false,
      lat: 40.42,
      lon: -3.7,
    });
    assert.equal(setWeather(base, { enabled: false }).settings.weather, undefined);
  });

  it("round-trip through export and import, rounded again on the way in", () => {
    const d: AppData = {
      ...base,
      settings: { ...base.settings, weather: { enabled: true, lat: 40.4167, lon: -3.7038 } },
    };
    assert.deepEqual(importData(exportData(d)).data.settings.weather, {
      enabled: true,
      lat: 40.42,
      lon: -3.7,
    });
  });

  it("import ignores a malformed weather block", () => {
    const raw = JSON.parse(exportData(base)) as { settings: Record<string, unknown> };
    raw.settings["weather"] = { enabled: "yes", lat: "x", lon: 500 };
    assert.equal(importData(JSON.stringify(raw)).data.settings.weather, undefined);
  });
});
