// SPDX-License-Identifier: AGPL-3.0-only

import { formatDate, parseDate, yearOf, type Day } from "./dates.ts";
import { restWeight } from "./season.ts";
import type { Hemisphere, PlantInput, WeatherDay } from "./types.ts";

// Seasonal bring-in and put-out cards for tender pot plants (02m section 1.4). Pure: the screens
// show the cards and the move sheet (`recordMove`) does the moving; nothing here moves a plant.

/**
 * PROVISIONAL `from knowledge, verify`: lower edge of each RHS hardiness band, in C (the RHS
 * page returned 404; re-tried three guessed URLs on 2026-11-11, all 404, so the edges are still
 * unconfirmed and no vector changed). H7 is "below -20", so -20 stands in for it.
 */
const SAFE_MIN_C: Readonly<Record<string, number>> = {
  H1a: 15,
  H1b: 10,
  H1c: 5,
  H2: 1,
  H3: -5,
  H4: -10,
  H5: -15,
  H6: -20,
  H7: -20,
};
const RANK = ["H1a", "H1b", "H1c", "H2", "H3", "H4", "H5", "H6", "H7"];
/** Margin above the safe minimum at which a forecast triggers a card (`guess`, 02m 1.4). */
const MARGIN_C = 3;
/** Safe minimum for a plant the catalogue only tags `tender`: H2, the tender class (`guess`). */
const TENDER_TAG_MIN_C = 1;
/** Rest-ramp weight at which the calendar fallback brings plants in (about 12 October at 55 N). */
const BRING_IN_WEIGHT = 0.33;
/** Days of no rest weight before the calendar fallback puts plants out (14 May at 55 N, `guess`). */
export const PUT_OUT_QUIET_DAYS = 45;
/** The same with a forecast to confirm it. */
const PUT_OUT_QUIET_DAYS_WEATHER = 30;
const BRING_IN_LOOKAHEAD = 3;
const PUT_OUT_LOOKAHEAD = 7;
export const SNOOZE_DAYS = 7;

/** The catalogue facts the cards read. */
export interface SeasonalSpecies {
  readonly tags: readonly string[];
  /** RHS class (H1a to H7). */
  readonly hardiness?: string;
}

/** App state of the cards, keyed by plant id: a day (`YYYY-MM-DD`) before which the card stays away. */
export interface SeasonalState {
  readonly snoozedUntil?: Readonly<Record<string, string>>;
  readonly leftOutUntil?: Readonly<Record<string, string>>;
}

export interface SeasonalHome {
  readonly hemisphere: Hemisphere;
  readonly latitude?: number;
  /** RHS class of the home's winter cold; absent when Q-K0 is unanswered. */
  readonly winterMin?: string;
}

export interface SeasonalPrompt {
  readonly plantId: string;
  readonly kind: "bring_in" | "put_out";
  /** What triggered it: a forecast minimum, or the calendar fallback. */
  readonly basis: "forecast" | "calendar";
}

export interface SeasonalInput {
  readonly plants: readonly PlantInput[];
  readonly speciesOf: (plant: PlantInput) => SeasonalSpecies | undefined;
  readonly home: SeasonalHome;
  readonly weather: readonly WeatherDay[];
  readonly today: string;
  readonly state: SeasonalState;
}

/** Lowest safe temperature for an RHS class, or undefined if the class is unknown. */
export function safeMinC(hardiness: string): number | undefined {
  return SAFE_MIN_C[hardiness];
}

/** "Not yet": the card stays away for 7 days. */
export function snoozeUntil(today: string): string {
  const d = parseDate(today);
  return d === undefined ? today : formatDate(d + SNOOZE_DAYS);
}

/** "Leave it out": until the next 1 July in the north, 1 January in the south. */
export function leaveOutUntil(today: string, hemisphere: Hemisphere): string {
  const d = parseDate(today);
  if (d === undefined) return today;
  const y = yearOf(d);
  const month = hemisphere === "north" ? "07" : "01";
  const thisYear = `${String(y).padStart(4, "0")}-${month}-01`;
  const t = parseDate(thisYear);
  return t !== undefined && t > d ? thisYear : `${String(y + 1).padStart(4, "0")}-${month}-01`;
}

/** Safe minimum for a plant: its class, else the tender-tag default. */
function plantSafeMin(s: SeasonalSpecies | undefined): number {
  const fromClass = s?.hardiness === undefined ? undefined : SAFE_MIN_C[s.hardiness];
  return fromClass ?? TENDER_TAG_MIN_C;
}

/** Tender for this home: class more tender than the home's winter class, else the tag. */
function tenderForHome(s: SeasonalSpecies | undefined, winterMin: string | undefined): boolean {
  if (s === undefined) return false;
  const rank = s.hardiness === undefined ? -1 : RANK.indexOf(s.hardiness);
  const homeRank = winterMin === undefined ? -1 : RANK.indexOf(winterMin);
  if (rank >= 0 && homeRank >= 0) return rank < homeRank;
  return s.tags.includes("tender");
}

function wasOutdoorsEarlierYear(p: PlantInput, today: Day): boolean {
  const y = yearOf(today);
  return (p.placementHistory ?? []).some((e) => {
    const on = parseDate(e.on);
    return e.placement === "outdoor_pot" && on !== undefined && yearOf(on) < y;
  });
}

function quietDays(today: Day, home: SeasonalHome, days: number): boolean {
  for (let i = 0; i < days; i++) {
    if (restWeight(today - i, home.hemisphere, home.latitude) > 0) return false;
  }
  return true;
}

/** Forecast minimums from today to `days` days ahead; empty when weather is off. */
function forecastMins(weather: readonly WeatherDay[], today: Day, days: number): number[] {
  const out: number[] = [];
  for (const w of weather) {
    if (w.forecast !== true || w.tMinC === undefined) continue;
    const d = parseDate(w.date);
    if (d !== undefined && d >= today && d <= today + days) out.push(w.tMinC);
  }
  return out;
}

/** The cards to show today, in plant order. Nothing is shown for a plant that is snoozed or left out. */
export function seasonalPrompts(input: SeasonalInput): SeasonalPrompt[] {
  const today = parseDate(input.today);
  if (today === undefined) return [];
  const { home, state } = input;
  const out: SeasonalPrompt[] = [];
  for (const p of input.plants) {
    const hold = [state.snoozedUntil?.[p.id], state.leftOutUntil?.[p.id]];
    if (hold.some((h) => h !== undefined && input.today < h)) continue;
    const s = input.speciesOf(p);
    if (p.placement === "outdoor_pot") {
      if (!tenderForHome(s, home.winterMin)) continue;
      const mins = forecastMins(input.weather, today, BRING_IN_LOOKAHEAD);
      if (mins.length > 0) {
        if (Math.min(...mins) <= plantSafeMin(s) + MARGIN_C)
          out.push({ plantId: p.id, kind: "bring_in", basis: "forecast" });
      } else if (restWeight(today, home.hemisphere, home.latitude) >= BRING_IN_WEIGHT) {
        out.push({ plantId: p.id, kind: "bring_in", basis: "calendar" });
      }
    } else if (p.placement === undefined || p.placement === "indoor") {
      const summering =
        s !== undefined &&
        s.tags.includes("tender") &&
        s.tags.includes("indoor") &&
        s.tags.includes("outdoor_pot");
      if (!summering && !wasOutdoorsEarlierYear(p, today)) continue;
      const mins = forecastMins(input.weather, today, PUT_OUT_LOOKAHEAD);
      if (mins.length > 0) {
        if (
          Math.min(...mins) > plantSafeMin(s) + MARGIN_C &&
          quietDays(today, home, PUT_OUT_QUIET_DAYS_WEATHER)
        )
          out.push({ plantId: p.id, kind: "put_out", basis: "forecast" });
      } else if (quietDays(today, home, PUT_OUT_QUIET_DAYS)) {
        out.push({ plantId: p.id, kind: "put_out", basis: "calendar" });
      }
    }
  }
  return out;
}
