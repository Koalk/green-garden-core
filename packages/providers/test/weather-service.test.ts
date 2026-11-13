// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WeatherService,
  aemetKeyStatus,
  candidateGauges,
  type CacheStore,
  type GaugeProvider,
  type GaugeStation,
  type Provenance,
  type RainDay,
  type WeatherProvider,
} from "../src/index.ts";

const NOW = new Date("2026-11-07T10:00:00Z");
const TODAY = "2026-11-07";
const EDINBURGH = { lat: 55.95, lon: -3.19 };
const LONDON = { lat: 51.5, lon: -0.12 };
const MADRID = { lat: 40.42, lon: -3.7 };

function memoryStore(): CacheStore & { saved: number } {
  let blob: unknown;
  const s = {
    saved: 0,
    load: () => Promise.resolve(blob),
    save: (v: unknown) => {
      blob = JSON.parse(JSON.stringify(v));
      s.saved += 1;
      return Promise.resolve();
    },
  };
  return s;
}

const prov = (kind: "measured" | "modelled", date: string): Provenance => ({
  provider: kind === "modelled" ? "open-meteo" : "g",
  dataset: "d",
  day: date,
  boundary: "utc_day",
  retrievedAt: NOW.toISOString(),
  quality: "raw",
  kind,
  licenceId: "l",
  attribution: kind === "modelled" ? "Weather data by Open-Meteo.com" : "Gauge credit",
});

function weather(): WeatherProvider & { calls: number } {
  const w = {
    id: "open-meteo",
    calls: 0,
    rain: (): Promise<{ ok: true; value: RainDay[] }> => {
      w.calls += 1;
      return Promise.resolve({
        ok: true,
        value: [
          {
            date: "2026-11-06",
            rainMm: 2,
            forecast: false,
            provenance: prov("modelled", "2026-11-06"),
          },
          {
            date: "2026-11-07",
            rainMm: 1,
            forecast: false,
            provenance: prov("modelled", "2026-11-07"),
          },
          {
            date: "2026-11-08",
            rainMm: 4,
            forecast: true,
            provenance: prov("modelled", "2026-11-08"),
          },
        ],
      });
    },
  };
  return w;
}

const station: GaugeStation = {
  id: "s1",
  label: "Blackford Hill",
  lat: 55.92,
  lon: -3.19,
  distanceKm: 3.1,
};
function gauge(id: string, found: boolean): GaugeProvider & { calls: number } {
  const g = {
    id,
    dataset: "d",
    licenceId: "l",
    attribution: "Gauge credit",
    calls: 0,
    stationsNear: () => {
      g.calls += 1;
      return Promise.resolve({ ok: true as const, value: found ? [station] : [] });
    },
    dailyTotals: () =>
      Promise.resolve({
        ok: true as const,
        value: [
          {
            date: "2026-11-06",
            rainMm: 3.2,
            quality: "raw" as const,
            boundary: "utc_day" as const,
          },
        ],
      }),
  };
  return g;
}

function jwt(expSeconds: number): string {
  const b = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b({ exp: expSeconds })}.sig`;
}

describe("which gauge serves a point", () => {
  it("picks AEMET in Spain, SEPA in Scotland, the Environment Agency in England", () => {
    assert.deepEqual(candidateGauges(MADRID), ["aemet"]);
    assert.deepEqual(candidateGauges({ lat: 28.1, lon: -15.4 }), ["aemet"]);
    assert.deepEqual(candidateGauges(EDINBURGH), ["sepa"]);
    assert.deepEqual(candidateGauges(LONDON), ["environment-agency"]);
  });

  it("tries both near the border, and none away from all three", () => {
    assert.deepEqual(candidateGauges({ lat: 55.2, lon: -3.0 }), ["sepa", "environment-agency"]);
    assert.deepEqual(candidateGauges({ lat: 55.2, lon: -1.8 }), ["environment-agency", "sepa"]);
    assert.deepEqual(candidateGauges({ lat: 48.85, lon: 2.35 }), []);
    assert.deepEqual(candidateGauges({ lat: -33.9, lon: 151.2 }), []);
  });
});

describe("AEMET key expiry (decoded without a model)", () => {
  const now = NOW.getTime();
  const day = 86_400;
  it("reads the exp claim", () => {
    const s = aemetKeyStatus(jwt(now / 1000 + 60 * day), now);
    assert.equal(s.state, "valid");
    assert.equal(s.daysLeft, 60);
  });
  it("warns with under 3 weeks left", () => {
    const s = aemetKeyStatus(jwt(now / 1000 + 20 * day), now);
    assert.equal(s.state, "expiring");
    assert.equal(s.daysLeft, 20);
    assert.equal(aemetKeyStatus(jwt(now / 1000 + 21 * day), now).state, "valid");
  });
  it("says expired once the time has passed", () => {
    const s = aemetKeyStatus(jwt(now / 1000 - 1), now);
    assert.equal(s.state, "expired");
  });
  it("tells missing and unreadable keys apart", () => {
    assert.equal(aemetKeyStatus(undefined, now).state, "missing");
    assert.equal(aemetKeyStatus("", now).state, "missing");
    assert.equal(aemetKeyStatus("not-a-jwt", now).state, "unreadable");
    const noExp = `a.${Buffer.from("{}").toString("base64url")}.c`;
    assert.equal(aemetKeyStatus(noExp, now).state, "unreadable");
  });
});

describe("weather service: fetch, cache, notices", () => {
  const make = (
    w: WeatherProvider,
    gauges: Record<string, GaugeProvider | undefined>,
    store = memoryStore(),
    opts: { aemetKey?: string; now?: () => Date } = {},
  ): WeatherService =>
    new WeatherService({
      weather: w,
      gauges,
      store,
      now: opts.now ?? (() => NOW),
      ...(opts.aemetKey === undefined ? {} : { aemetKey: opts.aemetKey }),
    });

  it("gives days, provenance with the station name, and credits", async () => {
    const svc = make(weather(), { sepa: gauge("sepa", true) });
    const r = await svc.report(EDINBURGH, TODAY);
    const measured = r.provenance.find((p) => p.kind === "measured");
    assert.equal(measured?.stationLabel, "Blackford Hill");
    assert.equal(measured.distanceKm, 3.1);
    assert.deepEqual([...r.attributions].sort(), [
      "Gauge credit",
      "Weather data by Open-Meteo.com",
    ]);
    assert.equal(r.days.find((d) => d.date === "2026-11-06")?.kind, "measured");
    assert.equal(r.fetchedAt, NOW.toISOString());
    assert.deepEqual(r.notices, []);
  });

  it("fetches each point at most once an hour, from the store", async () => {
    const w = weather();
    const g = gauge("sepa", true);
    const store = memoryStore();
    let t = NOW.getTime();
    const svc = make(w, { sepa: g }, store, { now: () => new Date(t) });
    await svc.report(EDINBURGH, TODAY);
    t += 59 * 60_000;
    await svc.report(EDINBURGH, TODAY);
    assert.equal(w.calls, 1);
    assert.equal(g.calls, 1);
    // a new service on the same store (a restart) still uses the cache
    const again = make(w, { sepa: g }, store, { now: () => new Date(t) });
    await again.report(EDINBURGH, TODAY);
    assert.equal(w.calls, 1);
    t += 2 * 60_000;
    await again.report(EDINBURGH, TODAY);
    assert.equal(w.calls, 2);
  });

  it("rounds the point before it is used as a cache key", async () => {
    const w = weather();
    const svc = make(w, {});
    await svc.report({ lat: 51.501, lon: -0.1246 }, TODAY);
    await svc.report({ lat: 51.504, lon: -0.119 }, TODAY);
    assert.equal(w.calls, 1);
  });

  it("falls to the next gauge when the first has no stations near", async () => {
    const sepa = gauge("sepa", false);
    const ea = gauge("environment-agency", true);
    const svc = make(weather(), { sepa, "environment-agency": ea });
    const r = await svc.report({ lat: 55.2, lon: -3.0 }, TODAY);
    assert.equal(sepa.calls, 1);
    assert.equal(ea.calls, 1);
    assert.ok(r.provenance.some((p) => p.kind === "measured"));
  });

  it("keeps serving the last answer when the sources fail after the hour", async () => {
    let fail = false;
    const ok = weather();
    const w: WeatherProvider = {
      id: "open-meteo",
      rain: (...args) =>
        fail ? Promise.resolve({ ok: false, reason: "unreachable" }) : ok.rain(...args),
    };
    let t = NOW.getTime();
    const svc = make(w, {}, memoryStore(), { now: () => new Date(t) });
    const first = await svc.report(LONDON, TODAY);
    assert.ok(first.days.length > 0);
    fail = true;
    t += 2 * 3_600_000;
    const second = await svc.report(LONDON, TODAY);
    assert.deepEqual(second.days, first.days);
    assert.equal(second.stale, true);
  });

  it("an empty answer with nothing cached is not cached", async () => {
    const dead: WeatherProvider = {
      id: "w",
      rain: () => Promise.resolve({ ok: false, reason: "unreachable" }),
    };
    const store = memoryStore();
    const r = await make(dead, {}, store).report(LONDON, TODAY);
    assert.deepEqual(r.days, []);
    assert.equal(store.saved, 0);
  });

  it("AEMET without a key: no call, a notice", async () => {
    const aemet = gauge("aemet", true);
    const r = await make(weather(), { aemet }).report(MADRID, TODAY);
    assert.equal(aemet.calls, 0);
    assert.deepEqual(
      r.notices.map((n) => n.code),
      ["aemet_no_key"],
    );
    assert.ok(r.days.length > 0);
  });

  it("AEMET with an expired key: no failed fetch, an 'expired' notice", async () => {
    const aemet = gauge("aemet", true);
    const key = jwt(NOW.getTime() / 1000 - 3600);
    const svc = make(weather(), { aemet }, memoryStore(), { aemetKey: key });
    const r = await svc.report(MADRID, TODAY);
    assert.equal(aemet.calls, 0);
    assert.deepEqual(
      r.notices.map((n) => n.code),
      ["aemet_key_expired"],
    );
  });

  it("AEMET with under 3 weeks left: fetches and warns; the warning stays current on cache hits", async () => {
    const aemet = gauge("aemet", true);
    const key = jwt(NOW.getTime() / 1000 + 10 * 86_400);
    let t = NOW.getTime();
    const svc = make(weather(), { aemet }, memoryStore(), {
      aemetKey: key,
      now: () => new Date(t),
    });
    const a = await svc.report(MADRID, TODAY);
    assert.equal(aemet.calls, 1);
    assert.deepEqual(a.notices, [{ code: "aemet_key_expiring", daysLeft: 10 }]);
    t += 30 * 60_000;
    const b = await svc.report(MADRID, TODAY);
    assert.equal(aemet.calls, 1);
    assert.deepEqual(b.notices, [{ code: "aemet_key_expiring", daysLeft: 9 }]);
  });

  it("the key never appears in what is stored or returned", async () => {
    const store = memoryStore();
    const key = jwt(NOW.getTime() / 1000 + 90 * 86_400);
    const svc = make(weather(), { aemet: gauge("aemet", true) }, store, { aemetKey: key });
    const r = await svc.report(MADRID, TODAY);
    assert.ok(!JSON.stringify(r).includes(key));
    assert.ok(!JSON.stringify(await store.load()).includes(key));
  });
});
