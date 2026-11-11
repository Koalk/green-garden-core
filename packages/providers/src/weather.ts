// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Weather and rain-gauge interfaces (02k 10 and 11). A `WeatherProvider` gives forecast days and
 * modelled recent rain; a `GaugeProvider` gives measured daily totals from stations near a point. Every
 * observation carries its provenance, so the screens can say where a number came from and the licence
 * obligations travel with the data. The engine only ever sees `WeatherDay` rows (`toWeatherDays`).
 */
import type { WeatherDay } from "@green-garden/engine";

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/** About 1 km: all a provider needs to pick stations, and nothing exact is kept (02k 11 Risks 14). */
export function roundPoint(p: GeoPoint): GeoPoint {
  const r = (x: number): number => Math.round(x * 100) / 100;
  return { lat: r(p.lat), lon: r(p.lon) };
}

/** Kilometres between two points (great circle). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where a day's boundaries fall: SEPA's daily totals run 09:00 to 09:00 GMT, others by UTC or local day. */
export type DayBoundary = "utc_day" | "civil_day" | "09_00_gmt";

export interface Provenance {
  readonly provider: string;
  readonly dataset: string;
  readonly stationId?: string;
  /** The nearest counted station's name, for "measured at ..." on the screens. */
  readonly stationLabel?: string;
  readonly distanceKm?: number;
  /** The observed (or forecast) day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly boundary: DayBoundary;
  /** When the number was fetched, ISO 8601. */
  readonly retrievedAt: string;
  readonly quality: "raw" | "validated" | "unknown";
  readonly kind: "measured" | "modelled" | "manual";
  readonly licenceId: string;
  /** The credit line to show next to the number. */
  readonly attribution: string;
}

/** One day of rain from one source. */
export interface RainDay {
  readonly date: string;
  readonly rainMm: number;
  readonly forecast: boolean;
  /** Chance of rain in percent, forecast days only. */
  readonly probability?: number;
  readonly provenance: Provenance;
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "unreachable" | "bad_response" | "no_key" };

export interface WeatherProvider {
  readonly id: string;
  /** Modelled rain for `pastDays` before `today`, today, and forecast days after it. */
  rain(
    point: GeoPoint,
    today: string,
    pastDays: number,
    forecastDays: number,
  ): Promise<ProviderResult<RainDay[]>>;
}

export interface GaugeStation {
  readonly id: string;
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  readonly distanceKm: number;
}

/** A station's total for one day; `null` means the day is not fully covered, never zero rain. */
export interface GaugeDay {
  readonly date: string;
  readonly rainMm: number | null;
  readonly quality: "raw" | "validated";
  readonly boundary: DayBoundary;
}

export interface GaugeProvider {
  readonly id: string;
  readonly dataset: string;
  readonly licenceId: string;
  readonly attribution: string;
  stationsNear(point: GeoPoint, radiusKm: number): Promise<ProviderResult<GaugeStation[]>>;
  dailyTotals(
    station: GaugeStation,
    from: string,
    to: string,
    nowIso: string,
  ): Promise<ProviderResult<GaugeDay[]>>;
}

/** What the engine takes: measured or modelled, forecast flagged (the provenance stays with the app). */
export function toWeatherDays(days: readonly RainDay[]): WeatherDay[] {
  return days.flatMap((d): WeatherDay[] =>
    d.provenance.kind === "manual"
      ? []
      : [
          {
            date: d.date,
            rainMm: d.rainMm,
            kind: d.provenance.kind,
            ...(d.forecast ? { forecast: true } : {}),
          },
        ],
  );
}
