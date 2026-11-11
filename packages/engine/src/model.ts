// SPDX-License-Identifier: AGPL-3.0-only

import type { Day } from "./dates.ts";
import { startMultipliers } from "./multipliers.ts";
import { seasonFactor, type Climate } from "./season.ts";
import type { Band, LogEntry, PlantInput, WateringStyle } from "./types.ts";

// PROVISIONAL: placeholder band percentages from 02a 5.1, kept.
const PERCENT: Record<WateringStyle, { early: number; late: number }> = {
  keep_moist: { early: 25, late: 10 },
  let_top_dry: { early: 25, late: 25 },
  let_fully_dry: { early: 10, late: 35 },
};

/** Round half up of `percent` % of `days`, integer maths only. */
export function percentOf(percent: number, days: number): number {
  return Math.floor((percent * days + 50) / 100);
}

export function band(style: WateringStyle, intervalDays: number): Band {
  const p = PERCENT[style];
  const earlyDays = percentOf(p.early, intervalDays);
  const lateDays = percentOf(p.late, intervalDays);
  return {
    style,
    intervalDays,
    earlyDays,
    lateDays,
    low: intervalDays - earlyDays,
    high: intervalDays + lateDays,
  };
}

/** Plant settings that do not change when logs are applied. */
export interface Config {
  readonly id: string;
  readonly style: WateringStyle;
  readonly base: number;
  readonly restFactor: number;
  readonly dryTolDays: number;
  readonly wetTolDays: number;
  /** Days the end of the window is stretched for assumed care facts (0 to MAX_MARGIN_DAYS). */
  readonly marginDays: number;
  /** Rain in mm that counts as a full watering for an outdoor plant; 0 = rain is ignored. */
  readonly creditMm: number;
}

/** Cap on the uncertainty margin. */
export const MAX_MARGIN_DAYS = 3;

/** Plant state that logs and waterings change. Days are day numbers. */
export interface State {
  readonly last: Day | undefined;
  readonly anchor: Day | undefined;
  readonly adj: number;
  readonly streak: number;
  readonly notBefore: Day | undefined;
}

export interface Computed {
  readonly last: Day;
  readonly interval: number;
  readonly band: Band;
  readonly bandLow: Day;
  readonly bandHigh: Day;
  readonly anchor: Day;
  readonly missedCycles: number;
  readonly earliest: Day;
  readonly latest: Day;
}

export function makeConfig(p: PlantInput, creditMm = 0): Config {
  // the start multipliers turn the catalogue interval into this plant's working interval.
  const base = Math.max(1, Math.round(p.intervalDays * startMultipliers(p).factor));
  return {
    id: p.id,
    style: p.style,
    base,
    restFactor: p.restFactor !== undefined && p.restFactor > 0 ? p.restFactor : 1,
    // PROVISIONAL: tolerance defaults until supplies per-plant values.
    dryTolDays: p.dryTolDays ?? Math.ceil(base / 2),
    wetTolDays: p.wetTolDays ?? Math.max(1, percentOf(25, base)),
    marginDays:
      p.uncertaintyDays !== undefined && Number.isFinite(p.uncertaintyDays)
        ? Math.min(MAX_MARGIN_DAYS, Math.max(0, Math.floor(p.uncertaintyDays)))
        : 0,
    creditMm,
  };
}

/** Effective interval in days for a watering done on `day`: season factor, then learned adjustment. */
export function intervalAt(cfg: Config, st: State, day: Day, climate: Climate): number {
  // the rest factor ramps in over about 30 days and out again; the dates come from the latitude.
  const factor = seasonFactor(day, climate, cfg.restFactor);
  const seasonal = Math.floor(Math.round(cfg.base * factor * 1e6) / 1e6 + 0.5);
  return Math.max(1, seasonal + st.adj);
}

/**
 * Window for the next watering (02a 5.1 and 5.2): the band from the last watering,
 * intersected with the tolerance around the ideal schedule (anchor).
 * `ref` stands in for "today" when the plant has never been watered.
 */
export function compute(cfg: Config, st: State, ref: Day, climate: Climate): Computed {
  // PROVISIONAL: an unwatered plant is treated as due on `ref`.
  const last = st.last ?? ref - intervalAt(cfg, st, ref, climate);
  const interval = intervalAt(cfg, st, last, climate);
  const b = band(cfg.style, interval);
  const bandLow = last + b.low;
  const bandHigh = last + b.high;
  let anchor = st.anchor ?? last + interval;
  // PROVISIONAL: the ideal schedule restarts when the plant was watered earlier than its tolerance
  // allows. (It no longer restarts at a season change: the interval ramps, so nothing jumps.)
  if (anchor - b.earlyDays > bandHigh) anchor = last + interval;
  // PROVISIONAL: a cycle the plant went through unwatered is skipped, not owed.
  let missedCycles = 0;
  while (anchor + b.lateDays < bandLow) {
    anchor += interval;
    missedCycles += 1;
  }
  let earliest = Math.max(bandLow, anchor - b.earlyDays);
  // An assumed fact widens the window at its end only: a start that never moves cannot cause overwatering.
  let latest = Math.min(bandHigh, anchor + b.lateDays) + cfg.marginDays;
  if (st.notBefore !== undefined) {
    earliest = Math.max(earliest, st.notBefore);
    latest = Math.max(latest, earliest);
  }
  return {
    last,
    interval,
    band: b,
    bandLow,
    bandHigh,
    anchor,
    missedCycles,
    earliest,
    latest,
  };
}

export function initialState(p: PlantInput, parse: (s: string) => Day | undefined): State {
  const opt = (s: string | undefined): Day | undefined => (s === undefined ? undefined : parse(s));
  return {
    last: opt(p.lastWatered),
    anchor: opt(p.anchor),
    adj: Math.round(p.adjustmentDays ?? 0),
    streak: Math.max(0, Math.round(p.doneStreak ?? 0)),
    notBefore: opt(p.notBefore),
  };
}

/** Snooze size: 25% of the base interval, at least 1 day (02a 5.5). */
function snoozeStep(cfg: Config): number {
  return Math.max(1, percentOf(25, cfg.base));
}

/**
 * Applies one log entry and returns the new state. Pure: the input state is not changed.
 * `date` is the day number of the entry.
 */
export function applyLog(
  cfg: Config,
  st: State,
  outcome: LogEntry["outcome"],
  date: Day,
  climate: Climate,
  mm?: number,
): State {
  const c = compute(cfg, st, date, climate);
  switch (outcome) {
    case "done": {
      // The ideal schedule steps by one interval and never moves otherwise (02a 5.2).
      const anchor = c.anchor + intervalAt(cfg, st, date, climate);
      let adj = st.adj;
      let streak = st.streak + 1;
      // PROVISIONAL: after 3 waterings in a row the learned adjustment decays by 1 (02a 1.3).
      if (streak >= 3 && adj !== 0) {
        adj -= Math.sign(adj);
        streak = 0;
      }
      return { last: date, anchor, adj, streak, notBefore: undefined };
    }
    case "still_wet": {
      // PROVISIONAL: snooze later and learn a longer interval, capped by half the interval
      // and by the dry tolerance.
      const cap = Math.min(Math.ceil(cfg.base / 2), cfg.dryTolDays);
      const adj = Math.max(st.adj, Math.min(st.adj + snoozeStep(cfg), cap));
      return {
        last: c.last,
        anchor: c.anchor + (adj - st.adj),
        adj,
        streak: 0,
        notBefore: date + 1,
      };
    }
    case "dry_early": {
      // PROVISIONAL: bring forward and learn a shorter interval, capped by a quarter of the
      // interval (at least 1 day) and by the wet tolerance.
      const cap = Math.min(Math.max(1, Math.floor(cfg.base / 4)), cfg.wetTolDays);
      const adj = Math.min(st.adj, Math.max(st.adj - snoozeStep(cfg), -cap));
      return {
        last: c.last,
        anchor: c.anchor + (adj - st.adj),
        adj,
        streak: 0,
        notBefore: undefined,
      };
    }
    case "rain": {
      // rain is weather, not a person's decision, so it moves the schedule but teaches
      // nothing (adjustment and streak stay). Under cover, indoors, on the day of a watering or before it: ignored.
      if (cfg.creditMm <= 0 || mm === undefined || !(mm > 0)) return st;
      if (st.last !== undefined && date <= st.last) return st;
      if (mm >= cfg.creditMm) {
        const anchor = c.anchor + intervalAt(cfg, st, date, climate);
        return { last: date, anchor, adj: st.adj, streak: st.streak, notBefore: undefined };
      }
      if (mm >= cfg.creditMm / 2)
        return { ...st, notBefore: Math.max(st.notBefore ?? 0, date + 1) };
      return st;
    }
    case "skipped":
    case "looks_fine":
      return st;
  }
}
