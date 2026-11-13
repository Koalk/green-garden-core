// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
// check-no-network: fixture-urls
import { afterEach, describe, it } from "node:test";
import { setLocale, t } from "@green-garden/i18n";
import { RAIN_SOURCES, type WeatherReply } from "@green-garden/providers";
import { DEFAULT_SPACE_ID, emptyData, type AppData, type Plant } from "@green-garden/storage";
import { todayOutdoorHtml } from "../src/outdoor.ts";
import { loadWeather, parseWeatherReply } from "../src/weather-client.ts";
import {
  dataSourcesHtml,
  rainDetailHtml,
  saveWeather,
  weatherDays,
  weatherPoint,
  weatherSettingsHtml,
  type WeatherState,
} from "../src/weather-view.ts";
import { makePlan } from "../src/view.ts";

afterEach(() => {
  setLocale("en-GB");
});

const TODAY = "2026-11-07";

const reply: WeatherReply = {
  days: [
    { date: "2026-11-04", rainMm: 0, kind: "measured" },
    { date: "2026-11-05", rainMm: 1.25, kind: "modelled" },
    { date: "2026-11-06", rainMm: 3.24, kind: "measured" },
    { date: "2026-11-07", rainMm: 0.6, kind: "modelled" },
    { date: "2026-11-08", rainMm: 9, kind: "modelled", forecast: true },
  ],
  provenance: [
    prov("2026-11-04", "measured", "Blackford Hill", 3.14),
    prov("2026-11-05", "modelled"),
    prov("2026-11-06", "measured", "Blackford Hill", 3.14),
    prov("2026-11-07", "modelled"),
    prov("2026-11-08", "modelled"),
  ],
  attributions: ["Weather data by Open-Meteo.com", "Gauge credit <b>"],
  notices: [],
  fetchedAt: "2026-11-07T10:00:00.000Z",
};

function prov(
  day: string,
  kind: "measured" | "modelled",
  stationLabel?: string,
  distanceKm?: number,
): WeatherReply["provenance"][number] {
  return {
    provider: kind === "measured" ? "sepa" : "open-meteo",
    dataset: "d",
    day,
    boundary: "utc_day",
    retrievedAt: "2026-11-07T10:00:00.000Z",
    quality: "raw",
    kind,
    licenceId: "l",
    attribution: "a",
    ...(stationLabel === undefined ? {} : { stationLabel }),
    ...(distanceKm === undefined ? {} : { distanceKm }),
  };
}

const ready: WeatherState = { reply };

describe("asking the server for rain", () => {
  const fetcherFor =
    (
      status: number,
      body: unknown,
      seen: { url?: string; headers?: Record<string, string> | undefined } = {},
    ): Parameters<typeof loadWeather>[0] =>
    (url, init) => {
      seen.url = url;
      seen.headers = init?.headers;
      return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    };
  const point = { lat: 51.5, lon: -0.12 };

  it("asks the same origin when no server is chosen", async () => {
    const seen: { url?: string } = {};
    const r = await loadWeather(fetcherFor(200, reply, seen), undefined, point, TODAY);
    assert.equal(seen.url, "/api/weather?lat=51.5&lon=-0.12&today=2026-11-07");
    assert.ok(r.ok);
  });

  it("asks the chosen server with the bearer token", async () => {
    const seen: { url?: string; headers?: Record<string, string> | undefined } = {};
    const cfg = { url: "http://192.168.1.20:8080/", token: "tok" };
    await loadWeather(fetcherFor(200, reply, seen), cfg, point, TODAY);
    assert.equal(
      seen.url,
      "http://192.168.1.20:8080/api/weather?lat=51.5&lon=-0.12&today=2026-11-07",
    );
    assert.equal(seen.headers?.["authorization"], "Bearer tok");
  });

  it("rounds the point to 2 decimals before it leaves", async () => {
    const seen: { url?: string } = {};
    await loadWeather(
      fetcherFor(200, reply, seen),
      undefined,
      { lat: 51.500729, lon: -0.124625 },
      TODAY,
    );
    assert.match(seen.url ?? "", /lat=51\.5&lon=-0.12&/);
  });

  it("names why it failed", async () => {
    const why = (status: number, body: unknown = {}): ReturnType<typeof loadWeather> =>
      loadWeather(fetcherFor(status, body), undefined, point, TODAY);
    assert.deepEqual(await why(401), { ok: false, reason: "unauthorised" });
    assert.deepEqual(await why(503), { ok: false, reason: "not_configured" });
    assert.deepEqual(await why(500), { ok: false, reason: "unreachable" });
    assert.deepEqual(await why(200, { nonsense: true }), { ok: false, reason: "bad_response" });
    const down = await loadWeather(
      () => Promise.reject(new Error("offline")),
      undefined,
      point,
      TODAY,
    );
    assert.deepEqual(down, { ok: false, reason: "unreachable" });
  });

  it("parses a reply and refuses junk", () => {
    assert.deepEqual(parseWeatherReply(JSON.parse(JSON.stringify(reply))), reply);
    assert.equal(parseWeatherReply(null), undefined);
    assert.equal(parseWeatherReply({ days: [{ date: 1 }] }), undefined);
    const noise = { ...reply, notices: [{ code: "other" }, { code: "aemet_key_expired" }] };
    assert.deepEqual(parseWeatherReply(noise)?.notices, [{ code: "aemet_key_expired" }]);
  });
});

describe("weather in the plan", () => {
  it("gives the engine no days while weather is off or has no point", () => {
    const d = emptyData();
    assert.deepEqual(weatherDays(d, ready), []);
    const on: AppData = { ...d, settings: { ...d.settings, weather: { enabled: true } } };
    assert.deepEqual(weatherDays(on, ready), []);
    assert.equal(weatherPoint(on), undefined);
  });

  it("gives the days once it is on with a point", () => {
    const d = emptyData();
    const on: AppData = {
      ...d,
      settings: { ...d.settings, weather: { enabled: true, lat: 51.5, lon: -0.12 } },
    };
    assert.equal(weatherDays(on, ready).length, 5);
    assert.deepEqual(weatherPoint(on), { lat: 51.5, lon: -0.12 });
    assert.deepEqual(weatherDays(on, {}), []);
  });

  it("a live forecast turns on the forecast hint for a plant that is due", () => {
    const d = emptyData();
    const plant: Plant = {
      id: "lav",
      spaceId: DEFAULT_SPACE_ID,
      name: "Lavender",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "outdoor_pot",
      logs: [{ date: "2026-10-30", outcome: "done" }],
    };
    const data: AppData = {
      ...d,
      plants: [plant],
      settings: { ...d.settings, climate: "oceanic_wet", winterMin: "H4" },
    };
    const wet = [{ date: "2026-11-08", rainMm: 12, forecast: true as const }];
    const none = makePlan(data, TODAY);
    const live = makePlan(data, TODAY, undefined, wet);
    assert.deepEqual(none.rainForecastFor, []);
    assert.deepEqual(live.rainForecastFor, ["lav"]);
  });
});

describe("rain marks and credits", () => {
  it("marks each day measured or estimated, with the station and distance for measured", () => {
    const html = rainDetailHtml(ready, TODAY);
    assert.match(html, /2026-11-06/);
    assert.match(html, /3\.2 mm/);
    assert.match(html, /Blackford Hill/);
    assert.match(html, /3\.1 km/);
    assert.match(html, /mark-measured/);
    assert.match(html, /mark-estimated/);
    assert.match(html, new RegExp(t("weather.mark.estimated")));
  });

  it("leaves out dry days and forecast days", () => {
    const html = rainDetailHtml(ready, TODAY);
    assert.doesNotMatch(html, /2026-11-04/);
    assert.doesNotMatch(html, /2026-11-08/);
  });

  it("shows every credit line, escaped, once", () => {
    const html = rainDetailHtml(ready, TODAY);
    assert.match(html, /Weather data by Open-Meteo\.com/);
    assert.match(html, /Gauge credit &#60;b&#62;/);
    assert.doesNotMatch(html, /<b>/);
  });

  it("says when the answer is the last good one", () => {
    const html = rainDetailHtml({ reply: { ...reply, stale: true } }, TODAY);
    assert.match(html, new RegExp(t("weather.rain.stale")));
  });

  it("shows nothing without a reply", () => {
    assert.equal(rainDetailHtml({}, TODAY), "");
  });

  it("sits in the Outdoors block next to the rain buttons", () => {
    const d = emptyData();
    const data: AppData = {
      ...d,
      plants: [
        {
          id: "lav",
          spaceId: DEFAULT_SPACE_ID,
          name: "Lavender",
          style: "let_top_dry",
          intervalDays: 7,
          placement: "ground",
          logs: [],
        },
      ],
      settings: { ...d.settings, climate: "oceanic_wet", winterMin: "H4" },
    };
    const html = todayOutdoorHtml(makePlan(data, TODAY), data, rainDetailHtml(ready, TODAY));
    assert.match(html, /Blackford Hill/);
    assert.match(html, /data-action="rain-all"/);
  });
});

describe("Settings: weather and data sources", () => {
  const off = emptyData();
  const on: AppData = {
    ...off,
    settings: { ...off.settings, weather: { enabled: true, lat: 51.5, lon: -0.12 } },
  };

  it("is off by default, with a switch, two coordinates and a locate button", () => {
    const html = weatherSettingsHtml(off, {});
    assert.match(html, /data-form="weather"/);
    assert.match(html, /name="enabled"(?![^>]*checked)/);
    assert.match(html, /name="lat"/);
    assert.match(html, /name="lon"/);
    assert.match(html, /data-action="weather-locate"/);
  });

  it("shows what is saved", () => {
    const html = weatherSettingsHtml(on, ready);
    assert.match(html, /name="enabled"[^>]*checked/);
    assert.match(html, /value="51.5"/);
    assert.match(html, /value="-0.12"/);
  });

  it("asks for a point when it is on without one", () => {
    const d: AppData = { ...off, settings: { ...off.settings, weather: { enabled: true } } };
    assert.match(weatherSettingsHtml(d, {}), new RegExp(t("weather.status.noPoint").slice(0, 20)));
  });

  it("says why the server could not be reached", () => {
    const html = weatherSettingsHtml(on, { failure: "unreachable" });
    assert.match(html, new RegExp(t("weather.status.unreachable").slice(0, 20)));
  });

  it("warns about the AEMET key under 3 weeks left and once expired", () => {
    const soon = weatherSettingsHtml(on, {
      reply: { ...reply, notices: [{ code: "aemet_key_expiring", daysLeft: 9 }] },
    });
    assert.match(soon, /9 days/);
    assert.match(soon, /opendata\.aemet\.es/);
    const gone = weatherSettingsHtml(on, {
      reply: { ...reply, notices: [{ code: "aemet_key_expired" }] },
    });
    assert.match(gone, /AEMET key expired, renew it at opendata\.aemet\.es/);
  });

  it("lists every source with its credit line, in a Data sources block", () => {
    const html = dataSourcesHtml();
    assert.match(html, new RegExp(t("weather.sources.heading")));
    for (const s of RAIN_SOURCES) {
      assert.match(html, new RegExp(s.licenceId), s.id);
    }
    assert.match(html, /© AEMET/);
    assert.match(html, /Contains SEPA data © Scottish Environment Protection Agency/);
    assert.match(html, /database right 2026/);
    assert.match(html, /Weather data by Open-Meteo\.com/);
    assert.match(html, /Environment Agency rainfall data/);
    assert.match(weatherSettingsHtml(off, {}), new RegExp(t("weather.sources.heading")));
  });

  it("saves the switch and the point rounded to 2 decimals, and nothing else", () => {
    const form = new URLSearchParams({ enabled: "on", lat: "51.500729", lon: "-0.124625" });
    const saved = saveWeather(off, form);
    assert.deepEqual(saved.settings.weather, { enabled: true, lat: 51.5, lon: -0.12 });
    assert.deepEqual(
      { ...saved, settings: { ...saved.settings, weather: undefined } },
      {
        ...off,
        settings: { ...off.settings, weather: undefined },
      },
    );
  });

  it("an unchecked switch with no point removes the setting", () => {
    assert.equal(
      saveWeather(on, new URLSearchParams({ lat: "", lon: "" })).settings.weather,
      undefined,
    );
  });

  it("has Spanish and Italian wording for it", () => {
    for (const tag of ["es", "it"]) {
      setLocale(tag);
      assert.notEqual(t("weather.enable"), "weather.enable");
      assert.notEqual(t("weather.mark.measured"), t("weather.mark.estimated"));
      setLocale("en-GB");
      assert.notEqual(t("weather.heading"), "weather.heading");
    }
  });
});
