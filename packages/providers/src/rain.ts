// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Putting rain sources together: several nearby gauges aggregated by a
 * distance-weighted median, a day no gauge fully covers staying unknown (never zero), the gauge replacing
 * the modelled estimate for a day it knows, and the provenance and credit lines kept with every day.
 */
import type { WeatherDay } from "@green-garden/engine";
import {
  toWeatherDays,
  type GaugeDay,
  type GaugeProvider,
  type GaugeStation,
  type GeoPoint,
  type Provenance,
  type RainDay,
  type WeatherProvider,
} from "./weather.ts";

/** Stations are looked for within this radius, and at most this many count per day. PROVISIONAL. */
export const GAUGE_RADIUS_KM = 10;
export const MAX_STATIONS = 3;
/** Stations whose readings are fetched; some are silent, so more than the number used. PROVISIONAL. */
const CANDIDATE_STATIONS = 5;
/** Days of recent rain asked for, and of forecast. PROVISIONAL. */
export const PAST_DAYS = 7;
export const FORECAST_DAYS = 3;

/** The smallest value whose cumulative weight reaches half the total; undefined for no values. */
export function weightedMedian(items: readonly { v: number; w: number }[]): number | undefined {
  if (items.length === 0) return undefined;
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const half = sorted.reduce((s, x) => s + x.w, 0) / 2;
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= half) return x.v;
  }
  return sorted[sorted.length - 1]?.v;
}

export interface StationDays {
  readonly station: GaugeStation;
  readonly days: readonly GaugeDay[];
}

export interface CombinedDay {
  readonly date: string;
  readonly rainMm: number;
  /** The stations that counted, nearest first. */
  readonly stations: readonly string[];
  readonly nearestKm: number;
  readonly quality: "raw" | "validated";
  readonly boundary: GaugeDay["boundary"];
}

/**
 * Per day: the nearest `MAX_STATIONS` stations that know it, aggregated by a distance-weighted median
 * (weight 1 / (km + 1)). A day no station fully covers is left out.
 */
export function combineGauges(perStation: readonly StationDays[]): CombinedDay[] {
  const near = [...perStation].sort((a, b) => a.station.distanceKm - b.station.distanceKm);
  const dates = new Set(near.flatMap((s) => s.days.map((d) => d.date)));
  const out: CombinedDay[] = [];
  for (const date of [...dates].sort()) {
    const known = near.flatMap((s) => {
      const d = s.days.find((x) => x.date === date);
      return d !== undefined && d.rainMm !== null ? [{ s, d, mm: d.rainMm }] : [];
    });
    const used = known.slice(0, MAX_STATIONS);
    const mm = weightedMedian(used.map((u) => ({ v: u.mm, w: 1 / (u.s.station.distanceKm + 1) })));
    const first = used[0];
    if (mm === undefined || first === undefined) continue;
    out.push({
      date,
      rainMm: mm,
      stations: used.map((u) => u.s.station.id),
      nearestKm: first.s.station.distanceKm,
      quality: used.every((u) => u.d.quality === "validated") ? "validated" : "raw",
      boundary: first.d.boundary,
    });
  }
  return out;
}

/** Measured days replace modelled ones for the same day; forecast days and other days stay. */
export function mergeRain(modelled: readonly RainDay[], measured: readonly RainDay[]): RainDay[] {
  const known = new Map(measured.filter((d) => !d.forecast).map((d) => [d.date, d]));
  const kept = modelled.filter((d) => d.forecast || !known.has(d.date));
  return [...kept, ...known.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export interface RainReport {
  /** What the engine takes, oldest first. */
  readonly days: readonly WeatherDay[];
  /** Where each day came from, for the "estimated" and "measured" marks and the attribution line. */
  readonly provenance: readonly Provenance[];
  /** The credit lines to show, once each. */
  readonly attributions: readonly string[];
}

/**
 * Recent rain and the forecast for a point: the weather provider's modelled days, with the gauge's
 * measured total in place of the estimate for each day the gauge fully covers. A failed gauge or no
 * gauge leaves the estimates; a failed weather provider with a gauge still gives the gauge's days.
 */
export async function rainReport(
  sources: { weather: WeatherProvider; gauge?: GaugeProvider },
  point: GeoPoint,
  today: string,
  nowIso: string,
): Promise<RainReport> {
  const modelled = await sources.weather.rain(point, today, PAST_DAYS, FORECAST_DAYS);
  const measured =
    sources.gauge === undefined ? [] : await gaugeDays(sources.gauge, point, today, nowIso);
  const days = mergeRain(modelled.ok ? modelled.value : [], measured);
  return {
    days: toWeatherDays(days),
    provenance: days.map((d) => d.provenance),
    attributions: [...new Set(days.map((d) => d.provenance.attribution))],
  };
}

async function gaugeDays(
  gauge: GaugeProvider,
  point: GeoPoint,
  today: string,
  nowIso: string,
): Promise<RainDay[]> {
  const found = await gauge.stationsNear(point, GAUGE_RADIUS_KM);
  if (!found.ok) return [];
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - PAST_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const fetched = await Promise.all(
    found.value.slice(0, CANDIDATE_STATIONS).map(async (station) => {
      const r = await gauge.dailyTotals(station, from, today, nowIso);
      return r.ok ? [{ station, days: r.value }] : [];
    }),
  );
  const labels = new Map(fetched.flat().map((f) => [f.station.id, f.station.label]));
  return combineGauges(fetched.flat()).map((c): RainDay => ({
    date: c.date,
    rainMm: c.rainMm,
    forecast: false,
    provenance: {
      provider: gauge.id,
      dataset: gauge.dataset,
      stationId: c.stations.join(","),
      ...stationLabel(labels.get(c.stations[0] ?? "")),
      distanceKm: c.nearestKm,
      day: c.date,
      boundary: c.boundary,
      retrievedAt: nowIso,
      quality: c.quality,
      kind: "measured",
      licenceId: gauge.licenceId,
      attribution: gauge.attribution,
    },
  }));
}

function stationLabel(label: string | undefined): { stationLabel?: string } {
  return label === undefined ? {} : { stationLabel: label };
}
