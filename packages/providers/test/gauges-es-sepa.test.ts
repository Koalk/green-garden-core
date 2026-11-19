// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AEMET_ATTRIBUTION,
  Aemet,
  RAIN_SOURCES,
  SEPA_ATTRIBUTION,
  Sepa,
  aemetCoord,
  aemetDailyUrl,
  aemetStationsUrl,
  parseAemetDaily,
  parseAemetEnvelope,
  parseAemetStations,
  parseSepaDaily,
  parseSepaStations,
  sepaDailyUrl,
  sepaStationsUrl,
  type Fetcher,
  type GaugeStation,
} from "../src/index.ts";

// SEPA fixtures: recorded from the live service on 2026-11-06. `aemet-*-live.json`: recorded with a key on
// 2026-11-07, trimmed. The other `aemet-*.json` are written from the OpenData specification; they
// stay for the cases the live week did not show (Ip, Acum, a missing prec, the error envelope).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/weather/${name}`, import.meta.url), "utf8"));
const reply = (body: unknown, ok = true, status = 200): ReturnType<Fetcher> =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

const NOW = "2026-11-06T20:00:00Z";
const EDINBURGH = { lat: 55.95, lon: -3.19 };
const MADRID = { lat: 40.42, lon: -3.7 };
const header = (init: Parameters<Fetcher>[1], name: string): string | undefined =>
  init?.headers?.[name];

describe("AEMET parsing", () => {
  it("reads degrees-minutes-seconds with a hemisphere letter", () => {
    assert.deepEqual(aemetCoord("402500N", "034041W"), { lat: 40.416667, lon: -3.678056 });
    const south = aemetCoord("380100S", "020000E");
    assert.ok(south !== undefined && south.lat < 0 && south.lon > 0);
    assert.equal(aemetCoord("bad", "034041W"), undefined);
  });

  it("lists stations nearest first, with distances", () => {
    const s = parseAemetStations(fixture("aemet-stations.json"), MADRID);
    assert.equal(s[0]?.id, "3195");
    assert.equal(s[0].label, "MADRID, RETIRO");
    assert.ok(s.every((x, i) => i === 0 || x.distanceKm >= (s[i - 1]?.distanceKm ?? 0)));
    assert.ok(s[0].distanceKm < 3);
  });

  it("reads the two-step envelope", () => {
    assert.ok(
      parseAemetEnvelope(fixture("aemet-envelope.json"))?.endsWith("/opendata/sh/0123456789abcdef"),
    );
    assert.equal(parseAemetEnvelope(fixture("aemet-envelope-error.json")), undefined);
    assert.equal(parseAemetEnvelope(null), undefined);
  });

  it("daily totals: decimal comma, Ip is dry, missing and Acum are unknown, never zero", () => {
    const d = parseAemetDaily(fixture("aemet-daily.json"), "2026-11-01", "2026-11-06", NOW);
    assert.deepEqual(
      d.map((x) => [x.date, x.rainMm]),
      [
        ["2026-11-01", 0],
        ["2026-11-02", 4.6],
        ["2026-11-03", 0],
        ["2026-11-04", null],
        ["2026-11-05", null],
        ["2026-11-06", null],
      ],
    );
    assert.ok(d.every((x) => x.boundary === "utc_day" && x.quality === "raw"));
  });

  it("a day that has not ended is unknown even if a row exists", () => {
    const d = parseAemetDaily(
      [{ fecha: "2026-11-06", prec: "1,0" }],
      "2026-11-06",
      "2026-11-06",
      NOW,
    );
    assert.equal(d[0]?.rainMm, null);
  });

  it("builds the endpoint URLs", () => {
    assert.ok(
      aemetStationsUrl().endsWith(
        "/opendata/api/valores/climatologicos/inventarioestaciones/todasestaciones",
      ),
    );
    assert.match(
      aemetDailyUrl("3195", "2026-11-01", "2026-11-05"),
      /fechaini\/2026-11-01T00:00:00UTC\/fechafin\/2026-11-05T23:59:59UTC\/estacion\/3195$/,
    );
  });
});

describe("AEMET parsing, recorded answers (2026-11-07)", () => {
  it("the real inventory: nearest Madrid stations first, accents intact, empty indsinop tolerated", () => {
    const s = parseAemetStations(fixture("aemet-stations-live.json"), MADRID);
    assert.deepEqual(
      s.slice(0, 3).map((x) => x.id),
      ["3195", "3194U", "3196"],
    );
    assert.equal(s[0]?.label, "MADRID, RETIRO");
    assert.equal(s[0].distanceKm, 2.1);
    assert.ok(s.some((x) => x.label === "POZUELO DE ALARCÓN"));
    assert.ok(s.some((x) => x.id === "3104Y"));
  });

  it("the real envelope has a datos URL", () => {
    assert.ok(parseAemetEnvelope(fixture("aemet-envelope-live.json")) !== undefined);
  });

  it("the real daily answer: a week of Retiro, the last day is two days before the request", () => {
    const d = parseAemetDaily(fixture("aemet-daily-live.json"), "2026-10-30", "2026-11-06", NOW);
    assert.deepEqual(
      d.map((x) => [x.date, x.rainMm]),
      [
        ["2026-10-30", 0],
        ["2026-10-31", 0],
        ["2026-11-01", 0],
        ["2026-11-02", 0],
        ["2026-11-03", 0],
        ["2026-11-04", 0],
        ["2026-11-05", null],
        ["2026-11-06", null],
      ],
    );
  });
});

describe("AEMET adapter", () => {
  const st: GaugeStation = { id: "3195", label: "x", lat: 40.4, lon: -3.7, distanceKm: 1 };

  it("is off with a clear reason when the key is unset, and calls nothing", async () => {
    let calls = 0;
    const a = new Aemet(() => {
      calls += 1;
      return reply({});
    }, undefined);
    assert.deepEqual(await a.stationsNear(MADRID, 10), { ok: false, reason: "no_key" });
    assert.deepEqual(await a.dailyTotals(st, "2026-11-01", "2026-11-02", NOW), {
      ok: false,
      reason: "no_key",
    });
    assert.equal(calls, 0);
  });

  it("follows the envelope to the data, sending the key on the first step only", async () => {
    const seen: { url: string; key?: string }[] = [];
    const f: Fetcher = (url, init) => {
      const key = header(init, "api_key");
      seen.push({ url, ...(key === undefined ? {} : { key }) });
      return reply(
        url.includes("/opendata/sh/")
          ? fixture("aemet-stations.json")
          : fixture("aemet-envelope.json"),
      );
    };
    const r = await new Aemet(f, "KEY").stationsNear(MADRID, 10);
    assert.ok(r.ok);
    assert.ok(r.value.length >= 1 && r.value.every((s) => s.distanceKm <= 10));
    assert.equal(r.value[0]?.id, "3195");
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.key, "KEY");
    assert.equal(seen[1]?.key, undefined);
  });

  it("daily totals come through both steps", async () => {
    const f: Fetcher = (url) =>
      reply(
        url.includes("/opendata/sh/")
          ? fixture("aemet-daily.json")
          : fixture("aemet-envelope.json"),
      );
    const r = await new Aemet(f, "KEY").dailyTotals(st, "2026-11-01", "2026-11-02", NOW);
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.map((d) => d.rainMm),
      [0, 4.6],
    );
  });

  it("a bad key, a 429 and a dead network are reported, not thrown", async () => {
    const bad = await new Aemet(() => reply(fixture("aemet-envelope-error.json")), "K").dailyTotals(
      st,
      "2026-11-01",
      "2026-11-02",
      NOW,
    );
    assert.deepEqual(bad, { ok: false, reason: "bad_response" });
    const limited = await new Aemet(() => reply({}, false, 429), "K").stationsNear(MADRID, 10);
    assert.deepEqual(limited, { ok: false, reason: "unreachable" });
    const down = await new Aemet(() => Promise.reject(new Error("net")), "K").stationsNear(
      MADRID,
      10,
    );
    assert.deepEqual(down, { ok: false, reason: "unreachable" });
  });

  it("carries its credit and id", () => {
    const a = new Aemet(() => reply({}), "K");
    assert.equal(a.attribution, AEMET_ATTRIBUTION);
    assert.equal(AEMET_ATTRIBUTION, "© AEMET");
    assert.equal(a.id, "aemet");
  });
});

describe("SEPA parsing", () => {
  it("lists stations nearest first from the header-row array", () => {
    const s = parseSepaStations(fixture("sepa-stations.json"), EDINBURGH);
    assert.ok(s.length >= 10);
    assert.ok(s.every((x, i) => i === 0 || x.distanceKm >= (s[i - 1]?.distanceKm ?? 0)));
    assert.ok(s[0] !== undefined && s[0].distanceKm < 10);
    assert.equal(typeof s[0].id, "string");
  });

  it("daily rows are stamped with the START of their 09:00 to 09:00 GMT day", () => {
    const d = parseSepaDaily(fixture("sepa-daily.json"), "2026-10-30", "2026-11-06", NOW);
    const by = new Map(d.map((x) => [x.date, x.rainMm]));
    assert.equal(by.get("2026-11-03"), 1.4); // the 15-minute rain fell 09:45 to 12:45 on 3 Nov
    assert.equal(by.get("2026-11-04"), 0.2);
    assert.equal(by.get("2026-11-05"), 0);
    assert.equal(by.get("2026-11-06"), null); // 09:00 on 6 Nov to 09:00 on 7 Nov has not ended
    assert.ok(d.every((x) => x.boundary === "09_00_gmt"));
    assert.equal(d.length, 8);
  });

  it("a day with no row is unknown, never zero", () => {
    const d = parseSepaDaily(fixture("sepa-daily.json"), "2026-10-25", "2026-10-27", NOW);
    assert.deepEqual(
      d.map((x) => x.rainMm),
      [null, null, null],
    );
  });

  it("a negative or missing value is unknown", () => {
    const j = [
      {
        data: [
          ["2026-11-01T09:00:00.000Z", -777, 255],
          ["2026-11-02T09:00:00.000Z", null, 254],
        ],
      },
    ];
    const d = parseSepaDaily(j, "2026-11-01", "2026-11-02", NOW);
    assert.deepEqual(
      d.map((x) => x.rainMm),
      [null, null],
    );
  });

  it("builds the KiWIS URLs", () => {
    assert.match(
      sepaStationsUrl(),
      /^https:\/\/timeseries\.sepa\.org\.uk\/KiWIS\/KiWIS\?service=kisters&type=queryServices&datasource=0&request=getStationList&stationparameter_name=Rain/,
    );
    const u = sepaDailyUrl("15201", "2026-11-01", "2026-11-06");
    assert.match(u, /request=getTimeseriesValues/);
    assert.match(u, /ts_path=1\/15201\/RE\/HDay\.Total/);
    assert.match(u, /from=2026-11-01T09:00:00/);
    assert.match(u, /format=json/);
  });
});

describe("SEPA adapter", () => {
  const stations = fixture("sepa-stations.json");
  const daily = fixture("sepa-daily.json");
  const f: Fetcher = (url) => reply(url.includes("getStationList") ? stations : daily);

  it("works without a key (the keyless daily limit applies) and sends none", async () => {
    let auth: string | undefined = "unset";
    const s = new Sepa((url, init) => {
      auth = header(init, "Authorization");
      return f(url, init);
    }, undefined);
    const r = await s.stationsNear(EDINBURGH, 10);
    assert.ok(r.ok && r.value.length > 0 && r.value.every((x) => x.distanceKm <= 10));
    assert.equal(auth, undefined);
  });

  it("with a key, exchanges it for a bearer token once and sends it", async () => {
    const calls: { url: string; method?: string; auth?: string }[] = [];
    const g: Fetcher = (url, init) => {
      const auth = header(init, "Authorization");
      calls.push({
        url,
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(auth === undefined ? {} : { auth }),
      });
      if (url.includes("oidcServer/token")) {
        return reply({ access_token: "TOK", token_type: "Bearer", expires_in: 86400 });
      }
      return f(url);
    };
    const s = new Sepa(g, "B64KEY");
    await s.stationsNear(EDINBURGH, 10);
    await s.stationsNear(EDINBURGH, 10);
    const token = calls.filter((c) => c.url.includes("oidcServer/token"));
    assert.equal(token.length, 1);
    assert.equal(token[0]?.method, "POST");
    assert.equal(token[0].auth, "Basic B64KEY");
    const data = calls.filter((c) => !c.url.includes("oidcServer/token"));
    assert.equal(data.length, 2);
    assert.ok(data.every((c) => c.auth === "Bearer TOK"));
  });

  it("a failed token exchange is reported", async () => {
    const r = await new Sepa(() => reply({}, false, 401), "K").stationsNear(EDINBURGH, 10);
    assert.deepEqual(r, { ok: false, reason: "unreachable" });
  });

  it("daily totals and the credit line", async () => {
    const st: GaugeStation = { id: "15201", label: "x", lat: 55.97, lon: -3.21, distanceKm: 2 };
    const s = new Sepa(f, undefined);
    const r = await s.dailyTotals(st, "2026-11-03", "2026-11-04", NOW);
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.map((d) => d.rainMm),
      [1.4, 0.2],
    );
    assert.equal(s.attribution, SEPA_ATTRIBUTION);
    assert.match(
      SEPA_ATTRIBUTION,
      /^Contains SEPA data © Scottish Environment Protection Agency and database right \d{4}/,
    );
  });
});

describe("registry", () => {
  it("marks AEMET and SEPA as built; SEPA stays pending until the written answer", () => {
    const by = new Map(RAIN_SOURCES.map((s) => [s.id, s]));
    assert.equal(by.get("aemet")?.built, true);
    assert.equal(by.get("sepa")?.built, true);
    assert.equal(by.get("sepa")?.commercialUse, "pending");
    assert.equal(by.get("sepa")?.needsKey, false); // optional: raises the daily limit
  });
});
