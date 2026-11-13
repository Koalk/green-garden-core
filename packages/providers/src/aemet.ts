// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AEMET OpenData adapter (Spain, including the islands). Free API key by registration,
 * sent as the `api_key` header; reuse under Ley 18/2015 with the credit "© AEMET". Without a key the
 * adapter is off (`no_key`) and calls nothing. Keep the key on the server (the self-hosted server or a bridge).
 *
 * The OpenData two-step: the first request answers an envelope `{estado, datos: <url>, metadatos}`; the
 * data itself is at the `datos` URL (no key needed there).
 *   stations: /opendata/api/valores/climatologicos/inventarioestaciones/todasestaciones
 *   daily:    /opendata/api/valores/climatologicos/diarios/datos/fechaini/<d>T00:00:00UTC/fechafin/<d>T23:59:59UTC/estacion/<id>
 * Shapes were first written from the published OpenAPI specification (read 2026-11-06), then checked
 * against the live API on 2026-11-07: `test/fixtures/weather/aemet-*-live.json` are recorded
 * answers; the other `aemet-*.json` are spec-written and cover Ip, Acum and the error envelope. The data
 * is ISO-8859-15, so station names may lose accents through `json()`; ids and numbers are ASCII. Daily
 * values lag about 2 to 3 days.
 * Daily values: `prec` is a string with a decimal comma, "Ip" means under 0.1 mm (counted as 0), "Acum"
 * or a missing field means no total for the day (unknown, never zero). Days are UTC days. A range request
 * is limited to about 31 days.
 */
import { isObj, str, type Fetcher } from "./http.ts";
import {
  haversineKm,
  type GaugeDay,
  type GaugeProvider,
  type GaugeStation,
  type GeoPoint,
  type ProviderResult,
} from "./weather.ts";

const BASE = "https://opendata.aemet.es/opendata/api/valores/climatologicos";
export const AEMET_ATTRIBUTION = "© AEMET";
const DAY_MS = 86_400_000;

export function aemetStationsUrl(): string {
  return `${BASE}/inventarioestaciones/todasestaciones`;
}

export function aemetDailyUrl(stationId: string, from: string, to: string): string {
  return `${BASE}/diarios/datos/fechaini/${from}T00:00:00UTC/fechafin/${to}T23:59:59UTC/estacion/${encodeURIComponent(stationId)}`;
}

function dms(s: string, degDigits: number, negative: string): number | undefined {
  const m = new RegExp(`^(\\d{${String(degDigits)}})(\\d{2})(\\d{2})([NSEW])$`).exec(s.trim());
  if (m === null) return undefined;
  const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  return Math.round((m[4] === negative ? -v : v) * 1e6) / 1e6;
}

/** AEMET writes positions as DDMMSS plus a hemisphere letter: "402500N", "034041W". */
export function aemetCoord(lat: string, lon: string): GeoPoint | undefined {
  const la = dms(lat, 2, "S");
  const lo = dms(lon, 2, "W");
  return la === undefined || lo === undefined ? undefined : { lat: la, lon: lo };
}

/** The `datos` URL of an envelope, or `undefined` for an error envelope (bad key, no data, limit). */
export function parseAemetEnvelope(json: unknown): string | undefined {
  if (!isObj(json) || json["estado"] !== 200) return undefined;
  return str(json["datos"]);
}

/** Stations with a position, nearest first (the inventory lists every station, also non-rain ones). */
export function parseAemetStations(json: unknown, from: GeoPoint): GaugeStation[] {
  if (!Array.isArray(json)) return [];
  const out: GaugeStation[] = [];
  for (const it of json as unknown[]) {
    if (!isObj(it)) continue;
    const id = str(it["indicativo"]);
    const la = str(it["latitud"]);
    const lo = str(it["longitud"]);
    const p = la === undefined || lo === undefined ? undefined : aemetCoord(la, lo);
    if (id === undefined || p === undefined) continue;
    out.push({
      id,
      label: str(it["nombre"]) ?? id,
      lat: p.lat,
      lon: p.lon,
      distanceKm: Math.round(haversineKm(from, p) * 10) / 10,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

function precip(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "Ip") return 0;
  if (!/^\d+([.,]\d+)?$/.test(s)) return null;
  return Number(s.replace(",", "."));
}

/**
 * One station's daily totals for `from` to `to` (inclusive). A day is a total only when it has ended and
 * the station reported a number for it; `Acum` (accumulated over several days) and a missing `prec` are
 * `null`. AEMET's daily climatological values are not marked validated, so every day is `raw`.
 */
export function parseAemetDaily(
  json: unknown,
  from: string,
  to: string,
  nowIso: string,
): GaugeDay[] {
  const now = Date.parse(nowIso);
  const byDate = new Map<string, number | null>();
  if (Array.isArray(json)) {
    for (const it of json as unknown[]) {
      if (!isObj(it)) continue;
      const date = str(it["fecha"]);
      if (date !== undefined) byDate.set(date, precip(it["prec"]));
    }
  }
  const out: GaugeDay[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    const v = byDate.get(date) ?? null;
    out.push({
      date,
      rainMm: t + DAY_MS <= now ? v : null,
      quality: "raw",
      boundary: "utc_day",
    });
  }
  return out;
}

export class Aemet implements GaugeProvider {
  readonly id = "aemet";
  readonly dataset = "Valores climatológicos diarios (OpenData)";
  readonly licenceId = "AEMET-reuse";
  readonly attribution = AEMET_ATTRIBUTION;
  private readonly fetcher: Fetcher;
  private readonly key: string | undefined;
  /** The whole-country inventory, fetched once; distances are measured from each call's point. */
  private inventory: unknown[] | undefined;

  /** `key` is `GREEN_GARDEN_AEMET_KEY`; unset (or blank) turns the adapter off. */
  constructor(fetcher: Fetcher, key: string | undefined) {
    this.fetcher = fetcher;
    this.key = key === undefined || key.trim() === "" ? undefined : key.trim();
  }

  private async getJson(
    url: string,
    headers?: Record<string, string>,
  ): Promise<ProviderResult<unknown>> {
    let res;
    try {
      res = await this.fetcher(url, headers === undefined ? undefined : { headers });
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

  /** The two steps: the envelope (with the key), then the data it points to. */
  private async twoStep(url: string): Promise<ProviderResult<unknown>> {
    if (this.key === undefined) return { ok: false, reason: "no_key" };
    const env = await this.getJson(url, { api_key: this.key });
    if (!env.ok) return env;
    const dataUrl = parseAemetEnvelope(env.value);
    if (dataUrl === undefined) return { ok: false, reason: "bad_response" };
    return this.getJson(dataUrl);
  }

  async stationsNear(point: GeoPoint, radiusKm: number): Promise<ProviderResult<GaugeStation[]>> {
    if (this.key === undefined) return { ok: false, reason: "no_key" };
    if (this.inventory === undefined) {
      const r = await this.twoStep(aemetStationsUrl());
      if (!r.ok) return r;
      if (!Array.isArray(r.value)) return { ok: false, reason: "bad_response" };
      this.inventory = r.value as unknown[];
    }
    const near = parseAemetStations(this.inventory, point).filter((s) => s.distanceKm <= radiusKm);
    return { ok: true, value: near };
  }

  async dailyTotals(
    station: GaugeStation,
    from: string,
    to: string,
    nowIso: string,
  ): Promise<ProviderResult<GaugeDay[]>> {
    const r = await this.twoStep(aemetDailyUrl(station.id, from, to));
    return r.ok ? { ok: true, value: parseAemetDaily(r.value, from, to, nowIso) } : r;
  }
}
