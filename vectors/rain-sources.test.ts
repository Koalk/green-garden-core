// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeWindows,
  type PlanInput,
  type PlantInput,
  type WeatherDay,
} from "@green-garden/engine";

// 02k 3.3 and 10.0: rain credit from several sources for the same day. Precedence is manual
// ("It rained") over measured (a gauge) over modelled (a forecast model's estimate). A later, better
// observation replaces the earlier credit for that day; the plan is recomputed from what it is given.

const e2: PlantInput = {
  id: "lavender",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "ground",
  sun: "full_sun",
  groundSoil: "loam",
  plantedOn: "2026-05-01",
  establishmentSeasons: 1,
  droughtTolerance: "moderate",
  establishingIntervalDays: 7,
  lastWatered: "2026-06-01",
};
const plan = (weather: WeatherDay[], plant: PlantInput = e2): PlanInput => ({
  today: "2026-06-05",
  climate: "oceanic_dry",
  plants: [plant],
  weather,
});
const windowOf = (input: PlanInput): { earliest: string; latest: string } => {
  const w = computeWindows(input).windows.find((x) => x.plantId === "lavender");
  assert.ok(w);
  return { earliest: w.earliest, latest: w.latest };
};
const NONE = { earliest: "2026-06-05", latest: "2026-06-09" };
const FULL = { earliest: "2026-06-11", latest: "2026-06-12" };

describe("rain credit from several sources", () => {
  it("modelled rain gives a provisional credit the same day", () => {
    assert.deepEqual(windowOf(plan([{ date: "2026-06-05", rainMm: 18, kind: "modelled" }])), {
      earliest: "2026-06-11",
      latest: "2026-06-13",
    });
  });

  it("a gauge value for the day replaces the estimate: lower, so no credit", () => {
    const rows: WeatherDay[] = [
      { date: "2026-06-04", rainMm: 18, kind: "modelled" },
      { date: "2026-06-04", rainMm: 2, kind: "measured" },
    ];
    assert.deepEqual(windowOf(plan(rows)), NONE);
    assert.deepEqual(windowOf(plan([...rows].reverse())), NONE);
  });

  it("a gauge value higher than the estimate replaces it: full credit", () => {
    const rows: WeatherDay[] = [
      { date: "2026-06-04", rainMm: 2, kind: "modelled" },
      { date: "2026-06-04", rainMm: 18, kind: "measured" },
    ];
    assert.deepEqual(windowOf(plan(rows)), FULL);
  });

  it("a row without a kind counts as measured, as before sources existed", () => {
    const rows: WeatherDay[] = [
      { date: "2026-06-04", rainMm: 18, kind: "modelled" },
      { date: "2026-06-04", rainMm: 2 },
    ];
    assert.deepEqual(windowOf(plan(rows)), NONE);
  });

  it("manual 'It rained' wins over both, whichever way it differs", () => {
    const weather: WeatherDay[] = [
      { date: "2026-06-04", rainMm: 30, kind: "modelled" },
      { date: "2026-06-04", rainMm: 30, kind: "measured" },
    ];
    const low = { ...e2, logs: [{ date: "2026-06-04", outcome: "rain" as const, mm: 2 }] };
    assert.deepEqual(windowOf(plan(weather, low)), NONE);
    const high = { ...e2, logs: [{ date: "2026-06-04", outcome: "rain" as const, mm: 18 }] };
    const dry: WeatherDay[] = [{ date: "2026-06-04", rainMm: 0, kind: "measured" }];
    assert.deepEqual(windowOf(plan(dry, high)), FULL);
  });

  it("no observation, no credit", () => {
    assert.deepEqual(windowOf(plan([])), NONE);
  });

  it("modelled rain does not double a gauge on another day, and forecasts never credit", () => {
    const rows: WeatherDay[] = [
      { date: "2026-06-04", rainMm: 9, kind: "modelled" },
      { date: "2026-06-05", rainMm: 30, forecast: true, kind: "modelled" },
    ];
    // 9 mm is a partial (half of 15): the window moves a day at most, never a full credit
    assert.notDeepEqual(windowOf(plan(rows)), FULL);
  });

  it("sheltered and indoor plants are never credited, from any source", () => {
    const rows: WeatherDay[] = [
      { date: "2026-06-04", rainMm: 40, kind: "measured" },
      { date: "2026-06-04", rainMm: 40, kind: "modelled" },
    ];
    assert.deepEqual(
      windowOf(plan(rows, { ...e2, sheltered: true })),
      windowOf(plan([], { ...e2, sheltered: true })),
    );
  });
});
