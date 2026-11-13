// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Direct sun by time of day: the hours of a plant's or room's sun
 * ranges that fall between sunrise and sunset, and the factors those hours give. Pure. Clip only: no
 * weighting by sun height, because the rest-season factor already stands for winter's weaker light.
 * Every constant is `PROVISIONAL`: textbook solar geometry plus guesses for the clock.
 */
import { parseDate, type Day } from "./dates.ts";
import type { Hemisphere, SunRange } from "./types.ts";

/** Where the home is, as far as the sun cares. Latitude is a magnitude; the hemisphere says which side. */
export interface SunPlace {
  readonly hemisphere?: Hemisphere;
  readonly latitude?: number;
  /** ISO 3166 alpha-2: decides the clock time of solar noon. */
  readonly country?: string;
}

const DEFAULT_LATITUDE: Record<Hemisphere, number> = { north: 55, south: 40 };
const SOLSTICE_DECLINATION = 23.44;
/** Clock time of local solar noon over the year, in hours (BST/CEST and the zone meridian; a guess, up to an hour off). */
const SOLAR_NOON: Readonly<Record<string, number>> = { GB: 12.5, ES: 13.5 };
const DEFAULT_SOLAR_NOON = 12;

const rad = (deg: number): number => (deg * Math.PI) / 180;

function dayOfYear(day: Day): number {
  const d = new Date(day * 86_400_000);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1) / 86_400_000;
  return day - start + 1;
}

/** Sunrise and sunset in local clock hours on a day (24 h clock, may be 0 to 24 for polar edges). */
function daylight(day: Day, place: SunPlace): { rise: number; set: number } {
  const hemisphere = place.hemisphere ?? "north";
  const lat0 =
    place.latitude === undefined || !Number.isFinite(place.latitude)
      ? DEFAULT_LATITUDE[hemisphere]
      : Math.min(90, Math.abs(place.latitude));
  const lat = hemisphere === "north" ? lat0 : -lat0;
  const declination = SOLSTICE_DECLINATION * Math.sin((2 * Math.PI * (dayOfYear(day) - 81)) / 365);
  const x = -Math.tan(rad(lat)) * Math.tan(rad(declination));
  const length = x <= -1 ? 24 : x >= 1 ? 0 : (2 * Math.acos(x) * 180) / Math.PI / 15;
  const noon = SOLAR_NOON[(place.country ?? "").toUpperCase()] ?? DEFAULT_SOLAR_NOON;
  return { rise: noon - length / 2, set: noon + length / 2 };
}

/**
 * Hours of direct sun on a day: the ranges (local clock, whole hours) clipped to daylight, added up.
 * An empty list is a real answer, "none", and gives 0. A bad date gives 0.
 */
export function directSunHours(
  ranges: readonly SunRange[],
  date: string,
  place: SunPlace = {},
): number {
  const day = parseDate(date);
  if (day === undefined || ranges.length === 0) return 0;
  const { rise, set } = daylight(day, place);
  let hours = 0;
  for (const r of ranges) {
    const from = Math.max(r.from, rise);
    const to = Math.min(r.to, set);
    if (to > from) hours += to - from;
  }
  return hours;
}

/** Piecewise linear through 0 h, 3 h and 6 h (the garden-book thresholds). */
function byHours(hours: number, shade: number, part: number, full: number): number {
  const h = Math.max(0, hours);
  if (h <= 3) return shade + ((part - shade) * h) / 3;
  if (h <= 6) return part + ((full - part) * (h - 3)) / 3;
  return full;
}

/** Factor on an outdoor pot's interval from direct-sun hours: 0.85 at 0 h, 0.70 at 3 h, 0.50 from 6 h. */
export const potExposureByHours = (hours: number): number => byHours(hours, 0.85, 0.7, 0.5);
/** Factor on an in-ground plant's interval from direct-sun hours: 1.20 at 0 h, 1.00 at 3 h, 0.85 from 6 h. */
export const groundSunByHours = (hours: number): number => byHours(hours, 1.2, 1, 0.85);

/** Hours at which indoor direct sun has fully pulled the light factor to the `direct` one. */
export const INDOOR_SUN_SATURATION_HOURS = 4;
/** `f = f0 - (f0 - direct) x min(1, h / 4)`. */
export function lightByHours(base: number, direct: number, hours: number): number {
  const w = Math.min(1, Math.max(0, hours) / INDOOR_SUN_SATURATION_HOURS);
  return base - (base - direct) * w;
}
