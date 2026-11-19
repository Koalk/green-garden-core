// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SEPA Time Series API adapter (Scotland). KiWIS service, over 280 tipping-bucket
 * gauges. Licence: SEPA's data table lists the Time Series API and rainfall as OGL 3.0, its older general
 * terms (v3.1) say non-commercial; The maintainers asked SEPA in writing, so `RAIN_SOURCES` keeps `commercialUse:
 * "pending"` until the answer is in. Core only, for the self-hoster.
 *
 * Access (read 2026-11-06 at timeseriesdoc.sepa.org.uk): the API answers without a key under a standard
 * daily limit. `GREEN_GARDEN_SEPA_KEY` is optional and raises that limit: it is the Base64 access key SEPA
 * issues on request (hydrometry-requests@sepa.org.uk), exchanged by POST at `.../oidcServer/token`
 * (`Authorization: Basic <key>`, body `grant_type=client_credentials`) for a 24-hour bearer token.
 *
 * Daily rainfall is the series `1/<station>/RE/HDay.Total`, 09:00 to 09:00 GMT. A row is stamped with the
 * START of its day: checked on 2026-11-06 against the 15-minute series of station 15201, where 1.4 mm fell
 * between 09:45 and 12:45 on 3 Nov and the row stamped 2026-11-03T09:00 holds 1.4. So the day labelled D
 * runs from D 09:00 to D+1 09:00 (boundary `09_00_gmt`), and rain before 09:00 belongs to the day before.
 * Quality codes are not interpreted (254 on every row seen), so every day is `raw`.
 */
import { isObj, str, type Fetcher, type FetchInit } from "./http.ts";
import {
  haversineKm,
  type GaugeDay,
  type GaugeProvider,
  type GaugeStation,
  type GeoPoint,
  type ProviderResult,
} from "./weather.ts";

const KIWIS =
  "https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0";
const TOKEN_URL = "https://timeseries.sepa.org.uk/KiWebPortal/rest/auth/oidcServer/token";
const DAY_MS = 86_400_000;
const GMT = (date: string): number => Date.parse(`${date}T09:00:00Z`);
/** The credit line names the year of publication; for now a constant (2026), not the data's year. */
export const SEPA_ATTRIBUTION =
  "Contains SEPA data © Scottish Environment Protection Agency and database right 2026. All rights reserved";

export function sepaStationsUrl(): string {
  return `${KIWIS}&request=getStationList&stationparameter_name=Rain&flatten=true&returnfields=station_name,station_no,station_latitude,station_longitude&format=json`;
}

export function sepaDailyUrl(stationNo: string, from: string, to: string): string {
  return `${KIWIS}&request=getTimeseriesValues&ts_path=1/${encodeURIComponent(stationNo)}/RE/HDay.Total&from=${from}T09:00:00&to=${to}T09:00:00&returnfields=Timestamp,Value,Quality%20Code&format=json`;
}

/** The first row is the header (`station_name, station_no, ...`); the rest are strings. Nearest first. */
export function parseSepaStations(json: unknown, from: GeoPoint): GaugeStation[] {
  if (!Array.isArray(json)) return [];
  const out: GaugeStation[] = [];
  for (const row of (json as unknown[]).slice(1)) {
    if (!Array.isArray(row)) continue;
    const [name, no, la, lo] = row as unknown[];
    const lat = Number(la);
    const lon = Number(lo);
    const id = str(no);
    if (id === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id,
      label: str(name) ?? id,
      lat,
      lon,
      distanceKm: Math.round(haversineKm(from, { lat, lon }) * 10) / 10,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Daily totals for `from` to `to` (inclusive), keyed by the day each 09:00 stamp starts. A day with no
 * row, a missing or negative value (SEPA's -777 style sentinels), or one that has not ended is `null`.
 */
export function parseSepaDaily(
  json: unknown,
  from: string,
  to: string,
  nowIso: string,
): GaugeDay[] {
  const now = Date.parse(nowIso);
  const byDate = new Map<string, number | null>();
  const series = Array.isArray(json) ? (json as unknown[])[0] : undefined;
  const data = isObj(series) && Array.isArray(series["data"]) ? (series["data"] as unknown[]) : [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const [stamp, value] = row as unknown[];
    if (typeof stamp !== "string") continue;
    byDate.set(
      stamp.slice(0, 10),
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null,
    );
  }
  const out: GaugeDay[] = [];
  for (let t = GMT(from); t <= GMT(to); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({
      date,
      rainMm: t + DAY_MS <= now ? (byDate.get(date) ?? null) : null,
      quality: "raw",
      boundary: "09_00_gmt",
    });
  }
  return out;
}

export class Sepa implements GaugeProvider {
  readonly id = "sepa";
  readonly dataset = "Time Series Data Service, rainfall (HDay.Total)";
  readonly licenceId = "OGL-UK-3.0";
  readonly attribution = SEPA_ATTRIBUTION;
  private readonly fetcher: Fetcher;
  private readonly key: string | undefined;
  private readonly now: () => number;
  private token: { value: string; expires: number } | undefined;

  /** `key` is `GREEN_GARDEN_SEPA_KEY`, optional: without it the keyless daily limit applies. */
  constructor(fetcher: Fetcher, key: string | undefined, now: () => number = () => Date.now()) {
    this.fetcher = fetcher;
    this.key = key === undefined || key.trim() === "" ? undefined : key.trim();
    this.now = now;
  }

  private async bearer(): Promise<ProviderResult<string | undefined>> {
    if (this.key === undefined) return { ok: true, value: undefined };
    if (this.token !== undefined && this.token.expires > this.now()) {
      return { ok: true, value: this.token.value };
    }
    let res;
    try {
      res = await this.fetcher(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${this.key}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "bad_response" };
    }
    const value = isObj(body) ? str(body["access_token"]) : undefined;
    if (value === undefined) return { ok: false, reason: "bad_response" };
    const secs = isObj(body) && typeof body["expires_in"] === "number" ? body["expires_in"] : 3600;
    // Renew a minute early.
    this.token = { value, expires: this.now() + Math.max(0, secs - 60) * 1000 };
    return { ok: true, value };
  }

  private async get(url: string): Promise<ProviderResult<unknown>> {
    const t = await this.bearer();
    if (!t.ok) return t;
    const init: FetchInit | undefined =
      t.value === undefined ? undefined : { headers: { Authorization: `Bearer ${t.value}` } };
    let res;
    try {
      res = await this.fetcher(url, init);
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };
    try {
      const json = await res.json();
      // KiWIS answers errors as an object with 200; a list or a series is an array.
      return Array.isArray(json)
        ? { ok: true, value: json }
        : { ok: false, reason: "bad_response" };
    } catch {
      return { ok: false, reason: "bad_response" };
    }
  }

  async stationsNear(point: GeoPoint, radiusKm: number): Promise<ProviderResult<GaugeStation[]>> {
    const r = await this.get(sepaStationsUrl());
    return r.ok
      ? {
          ok: true,
          value: parseSepaStations(r.value, point).filter((s) => s.distanceKm <= radiusKm),
        }
      : r;
  }

  async dailyTotals(
    station: GaugeStation,
    from: string,
    to: string,
    nowIso: string,
  ): Promise<ProviderResult<GaugeDay[]>> {
    const r = await this.get(sepaDailyUrl(station.id, from, to));
    return r.ok ? { ok: true, value: parseSepaDaily(r.value, from, to, nowIso) } : r;
  }
}
