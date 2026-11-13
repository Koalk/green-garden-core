// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EnvironmentAgency,
  GAUGE_RADIUS_KM,
  OpenMeteo,
  RAIN_SOURCES,
  combineGauges,
  dailyTotalsFromReadings,
  eaReadingsUrl,
  eaStationsUrl,
  haversineKm,
  mergeRain,
  openMeteoUrl,
  parseEaReadings,
  parseEaStations,
  parseOpenMeteo,
  rainReport,
  toWeatherDays,
  weightedMedian,
  type Fetcher,
  type GaugeProvider,
  type GaugeStation,
  type RainDay,
} from "../src/index.ts";

// Recorded from the live services on 2026-11-04 (the tests themselves never call out).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/weather/${name}`, import.meta.url), "utf8"));
const respond =
  (body: unknown, ok = true): Fetcher =>
  () =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
const NOW = "2026-11-04T21:00:00Z";
const EDINBURGH = { lat: 55.95, lon: -3.19 };
const LONDON = { lat: 51.5, lon: -0.12 };

const day = (
  date: string,
  rainMm: number,
  kind: "measured" | "modelled",
  forecast = false,
): RainDay => ({
  date,
  rainMm,
  forecast,
  provenance: {
    provider: kind === "modelled" ? "open-meteo" : "environment-agency",
    dataset: "d",
    day: date,
    boundary: "utc_day",
    retrievedAt: NOW,
    quality: kind === "modelled" ? "unknown" : "raw",
    kind,
    licenceId: "l",
    attribution: kind === "modelled" ? "Weather data by Open-Meteo.com" : "EA",
  },
});

describe("Open-Meteo", () => {
  it("asks the forecast API with past_days, not the ERA5 archive, and rounds the point to 2 decimals", () => {
    const url = openMeteoUrl({ lat: 51.500729, lon: -0.124625 }, 3, 3);
    assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.match(url, /latitude=51.5&longitude=-0.12/);
    assert.match(url, /daily=precipitation_sum,precipitation_probability_max/);
    assert.match(url, /past_days=3/);
    assert.match(url, /forecast_days=3/);
    assert.doesNotMatch(url, /archive/);
  });

  it("days up to today are modelled rain that may credit; later days are forecast with a probability", () => {
    const days = parseOpenMeteo(fixture("open-meteo.json"), "2026-11-04", NOW);
    assert.equal(days.length, 6);
    const nov3 = days.find((d) => d.date === "2026-11-03");
    assert.equal(nov3?.rainMm, 1.7);
    assert.equal(nov3.forecast, false);
    assert.equal(nov3.provenance.kind, "modelled");
    const today = days.find((d) => d.date === "2026-11-04");
    assert.equal(today?.forecast, false);
    const nov6 = days.find((d) => d.date === "2026-11-06");
    assert.equal(nov6?.forecast, true);
    assert.equal(nov6.probability, 10);
    assert.equal(nov6.provenance.attribution, "Weather data by Open-Meteo.com");
    assert.equal(nov6.provenance.licenceId, "CC-BY-4.0");
    assert.equal(nov6.provenance.retrievedAt, NOW);
  });

  it("a day with no number is left out, never read as zero", () => {
    const days = parseOpenMeteo(
      { daily: { time: ["2026-11-03", "2026-11-04"], precipitation_sum: [null, 0.4] } },
      "2026-11-04",
      NOW,
    );
    assert.deepEqual(
      days.map((d) => d.date),
      ["2026-11-04"],
    );
    assert.deepEqual(parseOpenMeteo({ nonsense: 1 }, "2026-11-04", NOW), []);
  });

  it("the adapter maps a failed call to unreachable and bad JSON to bad_response", async () => {
    const om = new OpenMeteo(respond({}, false), () => NOW);
    const r = await om.rain(EDINBURGH, "2026-11-04", 3, 3);
    assert.deepEqual(r, { ok: false, reason: "unreachable" });
    const bad = await new OpenMeteo(respond("x"), () => NOW).rain(EDINBURGH, "2026-11-04", 3, 3);
    assert.deepEqual(bad, { ok: false, reason: "bad_response" });
    const good = await new OpenMeteo(respond(fixture("open-meteo.json")), () => NOW).rain(
      EDINBURGH,
      "2026-11-04",
      3,
      3,
    );
    assert.equal(good.ok && good.value.length, 6);
  });
});

describe("Environment Agency gauges", () => {
  it("asks for rainfall stations within the radius of the rounded point", () => {
    const url = eaStationsUrl({ lat: 51.5012, lon: -0.1234 }, GAUGE_RADIUS_KM);
    assert.match(url, /^https:\/\/environment\.data\.gov\.uk\/flood-monitoring\/id\/stations\?/);
    assert.match(url, /parameter=rainfall/);
    assert.match(url, /lat=51\.5&long=-0\.12&dist=10/);
  });

  it("reads stations with their distance from the point, nearest first", () => {
    const st = parseEaStations(fixture("ea-stations.json"), LONDON);
    assert.equal(st.length, 3);
    assert.ok((st[0]?.id.length ?? 0) > 0);
    for (let i = 1; i < st.length; i += 1) {
      assert.ok((st[i]?.distanceKm ?? 0) >= (st[i - 1]?.distanceKm ?? 0));
    }
    assert.ok(st.every((s) => s.distanceKm < 15));
  });

  it("reads 15-minute readings, and a station with none gives none", () => {
    const r = parseEaReadings(fixture("ea-readings.json"));
    assert.equal(r.length, 274);
    assert.equal(parseEaReadings(fixture("ea-readings-empty.json")).length, 0);
    assert.match(
      eaReadingsUrl("246424TP", "2026-11-02T00:00:00Z"),
      /stations\/246424TP\/readings\?parameter=rainfall&since=2026-11-02T00:00:00Z/,
    );
  });

  it("sums only complete days; today is not complete yet, so it stays unknown", () => {
    const r = parseEaReadings(fixture("ea-readings.json"));
    const days = dailyTotalsFromReadings(r, "2026-11-02", "2026-11-04", NOW);
    const by = new Map(days.map((d) => [d.date, d.rainMm]));
    assert.equal(by.get("2026-11-02"), 0.6);
    assert.equal(by.get("2026-11-03"), 0.4);
    assert.equal(by.get("2026-11-04"), null);
    assert.ok(days.every((d) => d.quality === "raw" && d.boundary === "utc_day"));
  });

  it("a missing interval makes the day unknown, never zero rain", () => {
    const all = parseEaReadings(fixture("ea-readings.json"));
    const holed = all.filter((x) => x.dateTime !== "2026-11-03T06:00:00Z");
    const days = dailyTotalsFromReadings(holed, "2026-11-02", "2026-11-03", NOW);
    assert.equal(days.find((d) => d.date === "2026-11-03")?.rainMm, null);
    assert.equal(days.find((d) => d.date === "2026-11-02")?.rainMm, 0.6);
  });

  it("the adapter lists stations and fetches daily totals through the fetcher", async () => {
    const urls: string[] = [];
    const f: Fetcher = (url) => {
      urls.push(url);
      return respond(
        url.includes("/readings") ? fixture("ea-readings.json") : fixture("ea-stations.json"),
      )(url);
    };
    const ea = new EnvironmentAgency(f, () => NOW);
    const found = await ea.stationsNear(LONDON, 10);
    assert.ok(found.ok && found.value.length === 3);
    const st = found.value[0];
    assert.ok(st);
    const totals = await ea.dailyTotals(st, "2026-11-02", "2026-11-04", NOW);
    assert.ok(totals.ok && totals.value.length === 3);
    assert.equal(urls.length, 2);
    assert.equal(
      (await new EnvironmentAgency(respond({}, false), () => NOW).stationsNear(LONDON, 10)).ok,
      false,
    );
  });
});

describe("combining gauges", () => {
  const near = (id: string, km: number): GaugeStation => ({
    id,
    label: id,
    lat: 0,
    lon: 0,
    distanceKm: km,
  });
  const g = (
    date: string,
    rainMm: number | null,
  ): { date: string; rainMm: number | null; quality: "raw"; boundary: "utc_day" } => ({
    date,
    rainMm,
    quality: "raw",
    boundary: "utc_day",
  });

  it("the weighted median shrugs off one faulty station", () => {
    assert.equal(
      weightedMedian([
        { v: 4, w: 1 },
        { v: 5, w: 1 },
        { v: 90, w: 1 },
      ]),
      5,
    );
    assert.equal(weightedMedian([]), undefined);
    assert.equal(
      weightedMedian([
        { v: 3, w: 2 },
        { v: 9, w: 1 },
      ]),
      3,
    );
  });

  it("uses up to three nearest stations, ignoring stations that do not know the day", () => {
    const out = combineGauges([
      { station: near("a", 1), days: [g("d1", 4), g("d2", null)] },
      { station: near("b", 2), days: [g("d1", 5), g("d2", 7)] },
      { station: near("c", 3), days: [g("d1", 90), g("d2", 8)] },
      { station: near("d", 4), days: [g("d1", 0), g("d2", 0)] },
    ]);
    assert.equal(out.find((d) => d.date === "d1")?.rainMm, 5);
    assert.deepEqual(out.find((d) => d.date === "d1")?.stations, ["a", "b", "c"]);
    assert.equal(out.find((d) => d.date === "d2")?.rainMm, 7);
    assert.deepEqual(out.find((d) => d.date === "d2")?.stations, ["b", "c", "d"]);
  });

  it("a day no station knows is absent, not zero", () => {
    const out = combineGauges([{ station: near("a", 1), days: [g("d1", null)] }]);
    assert.deepEqual(out, []);
  });

  it("measured days replace modelled ones; unknown gauge days keep the estimate", () => {
    const merged = mergeRain(
      [
        day("2026-11-01", 6, "modelled"),
        day("2026-11-02", 6, "modelled"),
        day("2026-11-05", 9, "modelled", true),
      ],
      [day("2026-11-01", 0.4, "measured")],
    );
    const byDate = new Map(merged.map((d) => [d.date, d]));
    assert.equal(byDate.get("2026-11-01")?.rainMm, 0.4);
    assert.equal(byDate.get("2026-11-01")?.provenance.kind, "measured");
    assert.equal(byDate.get("2026-11-02")?.provenance.kind, "modelled");
    assert.equal(byDate.get("2026-11-05")?.forecast, true);
  });

  it("the engine gets kind and forecast per row", () => {
    const rows = toWeatherDays([
      day("2026-11-01", 0.4, "measured"),
      day("2026-11-02", 6, "modelled", true),
    ]);
    assert.deepEqual(rows, [
      { date: "2026-11-01", rainMm: 0.4, kind: "measured" },
      { date: "2026-11-02", rainMm: 6, kind: "modelled", forecast: true },
    ]);
  });

  it("haversine distance is about right", () => {
    assert.ok(Math.abs(haversineKm(LONDON, { lat: 51.6, lon: -0.12 }) - 11.1) < 0.3);
  });
});

describe("the rain report an app asks for", () => {
  const weather = {
    id: "w",
    rain: () =>
      Promise.resolve({
        ok: true as const,
        value: [
          day("2026-11-03", 6, "modelled"),
          day("2026-11-04", 6, "modelled"),
          day("2026-11-06", 9, "modelled", true),
        ],
      }),
  };
  const gauge: GaugeProvider = {
    id: "g",
    dataset: "ds",
    licenceId: "OGL-UK-3.0",
    attribution: "This uses Environment Agency rainfall data from the real-time data API (Beta)",
    stationsNear: () =>
      Promise.resolve({
        ok: true,
        value: [{ id: "s1", label: "s1", lat: 0, lon: 0, distanceKm: 2 }],
      }),
    dailyTotals: () =>
      Promise.resolve({
        ok: true,
        value: [
          { date: "2026-11-03", rainMm: 0.4, quality: "raw", boundary: "utc_day" },
          { date: "2026-11-04", rainMm: null, quality: "raw", boundary: "utc_day" },
        ],
      }),
  };

  it("replaces the estimate with the gauge where it knows the day and lists the attributions", async () => {
    const r = await rainReport({ weather, gauge }, LONDON, "2026-11-04", NOW);
    const by = new Map(r.days.map((d) => [d.date, d]));
    assert.equal(by.get("2026-11-03")?.rainMm, 0.4);
    assert.equal(by.get("2026-11-03")?.kind, "measured");
    assert.equal(by.get("2026-11-04")?.rainMm, 6);
    assert.equal(by.get("2026-11-04")?.kind, "modelled");
    assert.equal(by.get("2026-11-06")?.forecast, true);
    assert.ok(
      r.attributions.includes(
        "This uses Environment Agency rainfall data from the real-time data API (Beta)",
      ),
    );
    assert.equal(r.provenance.find((p) => p.day === "2026-11-03")?.stationId, "s1");
  });

  it("falls back to modelled rain when there is no gauge or the gauge fails", async () => {
    const none = await rainReport({ weather }, LONDON, "2026-11-04", NOW);
    assert.equal(none.days.find((d) => d.date === "2026-11-03")?.kind, "modelled");
    const broken: GaugeProvider = {
      ...gauge,
      stationsNear: () => Promise.resolve({ ok: false, reason: "unreachable" }),
    };
    const r = await rainReport({ weather, gauge: broken }, LONDON, "2026-11-04", NOW);
    assert.equal(r.days.find((d) => d.date === "2026-11-03")?.kind, "modelled");
  });

  it("no weather provider and no gauge gives no days", async () => {
    const dead = {
      id: "w",
      rain: () => Promise.resolve({ ok: false as const, reason: "unreachable" as const }),
    };
    const r = await rainReport({ weather: dead }, LONDON, "2026-11-04", NOW);
    assert.deepEqual(r.days, []);
  });
});

describe("source registry", () => {
  it("flags commercial use per source: EA and AEMET confirmed, SEPA pending, Open-Meteo free tier non-commercial", () => {
    const by = new Map(RAIN_SOURCES.map((s) => [s.id, s]));
    assert.equal(by.get("environment-agency")?.commercialUse, "confirmed");
    assert.equal(by.get("aemet")?.commercialUse, "confirmed");
    assert.equal(by.get("sepa")?.commercialUse, "pending");
    assert.equal(by.get("open-meteo")?.commercialUse, "no");
    assert.equal(by.get("environment-agency")?.built, true);
    assert.equal(by.get("aemet")?.built, true);
    assert.equal(by.get("sepa")?.built, true);
  });
});
