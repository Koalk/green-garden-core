// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Environment Agency rainfall API adapter (England). About 1,000 tipping-bucket gauges,
 * 15-minute totals in mm, readings kept for about four weeks, Open Government Licence 3.0, no key.
 * Required credit: "This uses Environment Agency rainfall data from the real-time data API (Beta)".
 * Station positions are rounded to a 100 m grid by the service. The real-time API gives raw readings
 * only, so every day is `raw`. Days follow the readings' UTC timestamps (`utc_day`).
 * Endpoints (from knowledge, checked against live responses on 2026-11-04):
 *   stations: /flood-monitoring/id/stations?parameter=rainfall&lat=&long=&dist=<km>
 *   readings: /flood-monitoring/id/stations/<ref>/readings?parameter=rainfall&since=<ISO>&_sorted&_limit=<n>
 */
import { isObj, str, type Fetcher } from "./http.ts";
import {
  haversineKm,
  roundPoint,
  type GaugeDay,
  type GaugeProvider,
  type GaugeStation,
  type GeoPoint,
  type ProviderResult,
} from "./weather.ts";

const BASE = "https://environment.data.gov.uk/flood-monitoring/id/stations";
export const EA_ATTRIBUTION =
  "This uses Environment Agency rainfall data from the real-time data API (Beta)";
const SLOTS_PER_DAY = 96;
const DAY_MS = 86_400_000;

export function eaStationsUrl(point: GeoPoint, radiusKm: number): string {
  const p = roundPoint(point);
  return `${BASE}?parameter=rainfall&lat=${String(p.lat)}&long=${String(p.lon)}&dist=${String(radiusKm)}`;
}

export function eaReadingsUrl(stationId: string, sinceIso: string, limit = 500): string {
  return `${BASE}/${encodeURIComponent(stationId)}/readings?parameter=rainfall&since=${sinceIso}&_sorted&_limit=${String(limit)}`;
}

/** Stations with a position, nearest first. */
export function parseEaStations(json: unknown, from: GeoPoint): GaugeStation[] {
  if (!isObj(json) || !Array.isArray(json["items"])) return [];
  const out: GaugeStation[] = [];
  for (const it of json["items"] as unknown[]) {
    if (!isObj(it)) continue;
    const id = str(it["stationReference"]);
    const lat = it["lat"];
    const lon = it["long"];
    if (id === undefined || typeof lat !== "number" || typeof lon !== "number") continue;
    out.push({
      id,
      label: str(it["label"]) ?? id,
      lat,
      lon,
      distanceKm: Math.round(haversineKm(from, { lat, lon }) * 10) / 10,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

export interface EaReading {
  readonly dateTime: string;
  readonly value: number;
}

export function parseEaReadings(json: unknown): EaReading[] {
  if (!isObj(json) || !Array.isArray(json["items"])) return [];
  const out: EaReading[] = [];
  for (const it of json["items"] as unknown[]) {
    if (!isObj(it)) continue;
    const dateTime = str(it["dateTime"]);
    const value = it["value"];
    if (dateTime !== undefined && typeof value === "number" && Number.isFinite(value)) {
      out.push({ dateTime, value });
    }
  }
  return out;
}

const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/**
 * Daily totals for `from` to `to` (inclusive). A day is a total only when it has ended and every one of
 * its 96 quarter-hour readings is there; otherwise it is `null`: a missing interval is not zero rain.
 */
export function dailyTotalsFromReadings(
  readings: readonly EaReading[],
  from: string,
  to: string,
  nowIso: string,
): GaugeDay[] {
  const now = Date.parse(nowIso);
  const bySlot = new Map<number, number>();
  for (const r of readings) bySlot.set(Date.parse(r.dateTime), r.value);
  const out: GaugeDay[] = [];
  for (let t = dayStart(from); t <= dayStart(to); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    let sum = 0;
    let slots = 0;
    for (let s = 1; s <= SLOTS_PER_DAY; s += 1) {
      // A reading is stamped with the end of its 15 minutes, so a day holds 00:15 to 24:00.
      const v = bySlot.get(t + s * 900_000);
      if (v !== undefined) {
        sum += v;
        slots += 1;
      }
    }
    const finished = t + DAY_MS <= now;
    out.push({
      date,
      rainMm: finished && slots === SLOTS_PER_DAY ? Math.round(sum * 100) / 100 : null,
      quality: "raw",
      boundary: "utc_day",
    });
  }
  return out;
}

export class EnvironmentAgency implements GaugeProvider {
  readonly id = "environment-agency";
  readonly dataset = "Rainfall readings, real-time data API (Beta)";
  readonly licenceId = "OGL-UK-3.0";
  readonly attribution = EA_ATTRIBUTION;
  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher, _now: () => string = () => new Date().toISOString()) {
    this.fetcher = fetcher;
  }

  private async get(url: string): Promise<ProviderResult<unknown>> {
    let res;
    try {
      res = await this.fetcher(url);
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };
    try {
      return { ok: true, value: await res.json() };
    } catch {
      return { ok: false, reason: "bad_response" };
    }
  }

  async stationsNear(point: GeoPoint, radiusKm: number): Promise<ProviderResult<GaugeStation[]>> {
    const r = await this.get(eaStationsUrl(point, radiusKm));
    return r.ok ? { ok: true, value: parseEaStations(r.value, point) } : r;
  }

  async dailyTotals(
    station: GaugeStation,
    from: string,
    to: string,
    nowIso: string,
  ): Promise<ProviderResult<GaugeDay[]>> {
    const days = Math.round((dayStart(to) - dayStart(from)) / DAY_MS) + 1;
    const r = await this.get(
      eaReadingsUrl(station.id, `${from}T00:00:00Z`, days * SLOTS_PER_DAY + 50),
    );
    return r.ok
      ? { ok: true, value: dailyTotalsFromReadings(parseEaReadings(r.value), from, to, nowIso) }
      : r;
  }
}
