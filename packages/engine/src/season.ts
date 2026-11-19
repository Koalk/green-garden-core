// SPDX-License-Identifier: AGPL-3.0-only

import { parseDate, yearOf, type Day } from "./dates.ts";
import type { Hemisphere } from "./types.ts";

// PROVISIONAL: the dates of the rest season are a guess by latitude. The shape is
// simple on purpose: full rest around the turn of the year, reached and left by a linear ramp.

/** Days the factor takes to move from growth to full rest, and back. */
export const RAMP_DAYS = 30;
/** Latitude assumed when the user has not said (UK, where the pilot garden is); south: temperate Chile, NZ, Australia. */
const DEFAULT_LATITUDE: Record<Hemisphere, number> = { north: 55, south: 40 };
/** Below this the light and temperature drop is too small to name a rest season. */
const NO_REST_BELOW = 30;
/** Half-width of full rest, in days around the centre: 60 at 55 N (1 November to the end of February), 31 at 40 N. */
const HALF_WIDTH_AT_55 = 60;
const HALF_WIDTH_PER_DEGREE = 29 / 15;
const HALF_WIDTH_MAX = 75;

/** Latitude in degrees from the equator: junk gives the default for the hemisphere, 90 at most. */
function magnitude(hemisphere: Hemisphere, latitude: number | undefined): number {
  if (latitude === undefined || !Number.isFinite(latitude)) return DEFAULT_LATITUDE[hemisphere];
  return Math.min(90, Math.abs(latitude));
}

/** Days either side of the centre at which the plant is at full rest. */
function halfWidth(lat: number): number {
  const w = Math.round(HALF_WIDTH_AT_55 + (lat - 55) * HALF_WIDTH_PER_DEGREE);
  return Math.min(HALF_WIDTH_MAX, Math.max(0, w));
}

/**
 * How far into the rest season a day is, from 0 (growth) to 1 (full rest), moving by at most 1/30 a day
 *. Full rest is centred on 31 December in the north and 1 July in the south, with a
 * half-width that shrinks towards the equator: 60 days at about 55 degrees (the UK), 31 at about 40
 * (Spain), none below 30. Latitude is a magnitude; the hemisphere says which side of the equator.
 */
export function restWeight(day: Day, hemisphere: Hemisphere, latitude?: number): number {
  const lat = magnitude(hemisphere, latitude);
  if (lat < NO_REST_BELOW) return 0;
  const half = halfWidth(lat);
  const y = yearOf(day);
  const centre = hemisphere === "north" ? "12-31" : "07-01";
  let dist = Infinity;
  for (const yy of [y - 1, y, y + 1]) {
    const c = parseDate(`${String(yy).padStart(4, "0")}-${centre}`);
    if (c !== undefined) dist = Math.min(dist, Math.abs(day - c));
  }
  return Math.min(1, Math.max(0, 1 - (dist - half) / RAMP_DAYS));
}

/** What the season needs from the plan input: which hemisphere and, optionally, how far from the equator. */
export interface Climate {
  readonly hemisphere: Hemisphere;
  readonly latitude: number | undefined;
}

/** The factor on the base interval on a day: 1 in growth, the plant's rest factor at full rest, between on the ramp. */
export function seasonFactor(day: Day, climate: Climate, restFactor: number): number {
  return 1 + restWeight(day, climate.hemisphere, climate.latitude) * (restFactor - 1);
}
