// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Open-Meteo adapter: free API, no key, non-commercial use while nothing is monetised;
 * data CC BY 4.0 with the credit "Weather data by Open-Meteo.com". The numbers come from the *forecast*
 * API with `past_days` (recent days from its forecast models, little delay), not the ERA5 archive.
 * Days up to today are modelled rain that may give a provisional credit; later days are forecast only.
 */
import { isObj, type Fetcher } from "./http.ts";
import {
  roundPoint,
  type GeoPoint,
  type ProviderResult,
  type RainDay,
  type WeatherProvider,
} from "./weather.ts";

const BASE = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com";

export function openMeteoUrl(point: GeoPoint, pastDays: number, forecastDays: number): string {
  const p = roundPoint(point);
  return (
    `${BASE}?latitude=${String(p.lat)}&longitude=${String(p.lon)}` +
    "&daily=precipitation_sum,precipitation_probability_max" +
    `&past_days=${String(pastDays)}&forecast_days=${String(forecastDays)}&timezone=auto`
  );
}

/** Days with a number; a day without one is left out, never read as zero rain. */
export function parseOpenMeteo(json: unknown, today: string, retrievedAt: string): RainDay[] {
  if (!isObj(json) || !isObj(json["daily"])) return [];
  const daily = json["daily"];
  const time = daily["time"];
  const sum = daily["precipitation_sum"];
  const chance = daily["precipitation_probability_max"];
  if (!Array.isArray(time) || !Array.isArray(sum)) return [];
  const out: RainDay[] = [];
  time.forEach((date: unknown, i) => {
    const mm: unknown = sum[i];
    if (typeof date !== "string" || typeof mm !== "number" || !Number.isFinite(mm)) return;
    const forecast = date > today;
    const p: unknown = Array.isArray(chance) ? chance[i] : undefined;
    out.push({
      date,
      rainMm: mm,
      forecast,
      ...(forecast && typeof p === "number" ? { probability: p } : {}),
      provenance: {
        provider: "open-meteo",
        dataset: "Forecast API, daily precipitation_sum",
        day: date,
        boundary: "civil_day",
        retrievedAt,
        quality: "unknown",
        kind: "modelled",
        licenceId: "CC-BY-4.0",
        attribution: OPEN_METEO_ATTRIBUTION,
      },
    });
  });
  return out;
}

export class OpenMeteo implements WeatherProvider {
  readonly id = "open-meteo";
  private readonly fetcher: Fetcher;
  private readonly now: () => string;

  constructor(fetcher: Fetcher, now: () => string = () => new Date().toISOString()) {
    this.fetcher = fetcher;
    this.now = now;
  }

  async rain(
    point: GeoPoint,
    today: string,
    pastDays: number,
    forecastDays: number,
  ): Promise<ProviderResult<RainDay[]>> {
    let res;
    try {
      res = await this.fetcher(openMeteoUrl(point, pastDays, forecastDays));
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, reason: "bad_response" };
    }
    const days = parseOpenMeteo(json, today, this.now());
    return days.length === 0 ? { ok: false, reason: "bad_response" } : { ok: true, value: days };
  }
}
