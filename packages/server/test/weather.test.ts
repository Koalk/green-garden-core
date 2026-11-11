// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  WeatherService,
  type GaugeProvider,
  type WeatherProvider,
  type RainDay,
} from "@green-garden/providers";
import { createApp, fileCacheStore, type App, type Reply } from "../src/index.ts";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const NOW = new Date("2026-11-07T10:00:00Z");
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-weather-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const day: RainDay = {
  date: "2026-11-06",
  rainMm: 2,
  forecast: false,
  provenance: {
    provider: "open-meteo",
    dataset: "d",
    day: "2026-11-06",
    boundary: "civil_day",
    retrievedAt: NOW.toISOString(),
    quality: "unknown",
    kind: "modelled",
    licenceId: "CC-BY-4.0",
    attribution: "Weather data by Open-Meteo.com",
  },
};

function service(calls: { n: number }): WeatherService {
  const weather: WeatherProvider = {
    id: "open-meteo",
    rain: () => {
      calls.n += 1;
      return Promise.resolve({ ok: true, value: [day] });
    },
  };
  const gauges: Record<string, GaugeProvider | undefined> = {};
  return new WeatherService({ weather, gauges, store: fileCacheStore(dir), now: () => NOW });
}

function app(weather?: WeatherService): App {
  return createApp({ dir, token: TOKEN, now: () => NOW, ...(weather ? { weather } : {}) });
}

const get = (a: App, path: string, headers: Record<string, string> = auth): Promise<Reply> =>
  a.handle({ method: "GET", path, headers });

describe("GET /api/weather", () => {
  it("needs the bearer token", async () => {
    const r = await get(app(service({ n: 0 })), "/api/weather?lat=51.5&lon=-0.12", {});
    assert.equal(r.status, 401);
  });

  it("says 503 when weather is not set up on this server", async () => {
    const r = await get(app(), "/api/weather?lat=51.5&lon=-0.12&today=2026-11-07");
    assert.equal(r.status, 503);
  });

  it("refuses a missing or out-of-range point and a bad date", async () => {
    const a = app(service({ n: 0 }));
    assert.equal((await get(a, "/api/weather?today=2026-11-07")).status, 400);
    assert.equal((await get(a, "/api/weather?lat=95&lon=0&today=2026-11-07")).status, 400);
    assert.equal((await get(a, "/api/weather?lat=x&lon=0&today=2026-11-07")).status, 400);
    assert.equal((await get(a, "/api/weather?lat=51.5&lon=-0.12&today=tomorrow")).status, 400);
    assert.equal((await get(a, "/api/weather?lat=51.5&lon=-0.12&today=2026-10-01")).status, 400);
  });

  it("returns the report, and the second ask is served from the file cache", async () => {
    const calls = { n: 0 };
    const a = app(service(calls));
    const r = await get(a, "/api/weather?lat=51.5012&lon=-0.1196&today=2026-11-07");
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { days: { date: string }[]; attributions: string[] };
    assert.equal(body.days[0]?.date, "2026-11-06");
    assert.deepEqual(body.attributions, ["Weather data by Open-Meteo.com"]);
    await get(a, "/api/weather?lat=51.5&lon=-0.12&today=2026-11-07");
    assert.equal(calls.n, 1);
    const stored = JSON.parse(readFileSync(join(dir, "cache", "weather.json"), "utf8")) as {
      entries: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(stored.entries), ["51.5,-0.12,2026-11-07,a"]);
  });

  it("keeps the cache file out of the list of spaces", async () => {
    const a = app(service({ n: 0 }));
    await get(a, "/api/weather?lat=51.5&lon=-0.12&today=2026-11-07");
    assert.deepEqual(await a.files.names(), []);
  });

  it("is not a route for writing", async () => {
    const r = await app(service({ n: 0 })).handle({
      method: "POST",
      path: "/api/weather?lat=1&lon=1&today=2026-11-07",
      headers: auth,
    });
    assert.equal(r.status, 405);
  });
});
