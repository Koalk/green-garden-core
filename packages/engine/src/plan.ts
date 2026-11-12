// SPDX-License-Identifier: AGPL-3.0-only

import { formatDate, parseDate, weekday, type Day } from "./dates.ts";
import {
  applyLog,
  band,
  compute,
  initialState,
  intervalAt,
  makeConfig,
  type Computed,
  type Config,
  type State,
} from "./model.ts";
import {
  WINTER_SOAK_DAYS,
  applyCare,
  placementEntries,
  plantOn,
  rainEvents,
  resolveCare,
  type CareEnv,
  type ResolvedCare,
} from "./outdoor.ts";
import type { Climate } from "./season.ts";
import type {
  DormantPlant,
  LogEntry,
  Outlook,
  OutlookLevel,
  PlanInput,
  PlanResult,
  PlannedWatering,
  PlantInput,
  PlantPlan,
  RainFedPlant,
  WateringReason,
  Window,
  WindowsResult,
} from "./types.ts";

const DEFAULT_HORIZON = 28;
const MAX_ITERATIONS = 10_000;
const LEVELS: readonly OutlookLevel[] = ["thrive", "survive", "scrape_by", "decay"];

interface Context {
  readonly today: Day;
  readonly todayText: string;
  readonly climate: Climate;
  /** Outdoor care inputs: the climate class, with the hemisphere and latitude. */
  readonly care: CareEnv;
  readonly input: PlanInput;
  readonly issues: string[];
  /** Outdoor plants without a window today. */
  readonly rainFed: RainFedPlant[];
  readonly dormant: DormantPlant[];
}

interface Tracked {
  readonly cfg: Config;
  readonly initial: State;
  /** Largest rain forecast for today or tomorrow, in mm (a hint only). */
  readonly forecastMm: number;
  /** Day of the latest move in the story, for `justMoved`. */
  readonly movedOn?: Day;
  state: State;
  abandoned: boolean;
  readonly waterings: Watering[];
}

interface Watering {
  readonly day: Day;
  readonly earliest: Day;
  readonly latest: Day;
  readonly anchor: Day;
  readonly reason: WateringReason;
}

function context(input: PlanInput): Context | undefined {
  const today = parseDate(input.today);
  if (today === undefined) return undefined;
  return {
    today,
    todayText: input.today,
    climate: { hemisphere: input.hemisphere ?? "north", latitude: input.latitude },
    care: {
      hemisphere: input.hemisphere ?? "north",
      ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
      ...(input.country === undefined ? {} : { country: input.country }),
      ...(input.climate === undefined ? {} : { climate: input.climate }),
    },
    input,
    issues: [],
    rainFed: [],
    dormant: [],
  };
}

/** Reads plants, folds each plant's logs into its state, and collects problems as values. */
function track(input: PlanInput, ctx: Context): { tracked: Tracked[]; reminderOnly: string[] } {
  const tracked: Tracked[] = [];
  const reminderOnly: string[] = [];
  const seen = new Set<string>();
  const plants: readonly PlantInput[] = input.plants ?? [];
  for (const p of [...plants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(p.id)) {
      ctx.issues.push(`duplicate plant id ${p.id}`);
      continue;
    }
    seen.add(p.id);
    if (p.reminderOnly === true) {
      reminderOnly.push(p.id);
      continue;
    }
    if (!Number.isFinite(p.intervalDays) || p.intervalDays < 1) {
      ctx.issues.push(`${p.id}: intervalDays must be at least 1`);
      continue;
    }
    const dates = [p.lastWatered, p.anchor, p.notBefore].filter((d) => d !== undefined);
    if (dates.some((d) => parseDate(d) === undefined)) {
      ctx.issues.push(`${p.id}: invalid date`);
      continue;
    }
    // where the plant is today comes from its placement history, when it has one.
    const story = placementEntries(p).filter((e) => {
      const d = parseDate(e.on);
      return d !== undefined && d <= ctx.today;
    });
    const here = story.length === 0 ? p : plantOn(p, ctx.today);
    const care = resolveCare(here, ctx.todayText, ctx.care);
    if (care.mode !== "interval") {
      outdoorEntry(here, care, ctx);
      continue;
    }
    // One config per stay: the interval, the pot facts and the rain credit are the place's own.
    const stays = story.map((e, i) => {
      const next = story[i + 1];
      const nextDay = next === undefined ? undefined : parseDate(next.on);
      const day = nextDay === undefined ? ctx.today : nextDay - 1;
      const at = plantOn(p, parseDate(e.on) ?? day);
      const c = resolveCare(at, formatDate(day), ctx.care);
      return { from: parseDate(e.on) ?? 0, cfg: makeConfig(applyCare(at, c), c.creditMm) };
    });
    const cfgNow = makeConfig(applyCare(here, care), care.creditMm);
    const cfgOn = (day: Day): Config => {
      let cfg: Config | undefined;
      for (const s of stays) if (s.from <= day) cfg = s.cfg;
      return cfg ?? stays[0]?.cfg ?? cfgNow;
    };
    const cfg = stays.length === 0 ? cfgNow : cfgOn(ctx.today);
    const initial = initialState(p, parseDate);
    let state = initial;
    const logs: readonly LogEntry[] = p.logs ?? [];
    interface Event {
      readonly day: Day;
      readonly rank: number;
      readonly entry?: LogEntry;
      readonly moveTo?: Config;
    }
    const dated: Event[] = [];
    for (const entry of logs) {
      const day = parseDate(entry.date);
      if (day === undefined) ctx.issues.push(`${p.id}: invalid log date ${entry.date}`);
      // PROVISIONAL: a log dated after today is not part of the story yet (the user moved the
      // date back); it is kept in the data and counts again once today reaches it.
      else if (day <= ctx.today && entry.outcome !== "rain") dated.push({ day, rank: 1, entry });
    }
    // rain reports and observed weather become credit events (two partials in a row add up).
    // with a history the credit is the credit of where the plant was that day.
    const credit = stays.length === 0 ? care.creditMm : (day: Day): number => cfgOn(day).creditMm;
    for (const e of rainEvents(logs, ctx.input.weather ?? [], ctx.today, credit)) {
      dated.push({
        day: e.day,
        rank: 2,
        entry: { date: formatDate(e.day), outcome: "rain", mm: e.mm },
      });
    }
    // each move after the first entry is an event in time order (a move comes before the logs of
    // its day). A move the state snapshot already lies beyond is not replayed.
    let movedOn: Day | undefined;
    story.forEach((e, i) => {
      const day = parseDate(e.on);
      const to = stays[i]?.cfg;
      if (i === 0 || day === undefined || to === undefined) return;
      movedOn = day;
      if (initial.last !== undefined && day < initial.last) return;
      dated.push({ day, rank: 0, moveTo: to });
    });
    // A rain event sorts after anything a person logged the same day.
    dated.sort((a, b) => a.day - b.day || a.rank - b.rank);
    for (const ev of dated) {
      if (ev.moveTo !== undefined) {
        state = moved(ev.moveTo, state, ev.day, ctx.climate);
      } else if (ev.entry !== undefined) {
        state = applyLog(cfgOn(ev.day), state, ev.entry.outcome, ev.day, ctx.climate, ev.entry.mm);
      }
    }
    // PROVISIONAL: "skip" pressed today means not today. The plant waits until
    // tomorrow without learning anything, like a snooze that leaves the interval alone.
    if (dated.some((d) => d.day === ctx.today && d.entry?.outcome === "skipped")) {
      state = { ...state, notBefore: Math.max(state.notBefore ?? 0, ctx.today + 1) };
    }
    tracked.push({
      cfg,
      initial: state,
      forecastMm: care.creditMm > 0 ? forecastMm(ctx) : 0,
      ...(movedOn === undefined ? {} : { movedOn }),
      state,
      abandoned: false,
      waterings: [],
    });
  }
  return { tracked, reminderOnly };
}

/**
 * A move (02m 1.3): the last watering stays; the learned adjustment and streak start again (* Lean A), the snooze is cleared and the ideal schedule restarts at the last watering plus the new place's
 * interval. With no watering on record the plant stays due today.
 */
function moved(cfg: Config, st: State, day: Day, climate: Context["climate"]): State {
  const fresh: State = { ...st, adj: 0, streak: 0, notBefore: undefined };
  const anchor = st.last === undefined ? undefined : st.last + intervalAt(cfg, fresh, day, climate);
  return { ...fresh, anchor };
}

/** Largest forecast rain (mm) for today or tomorrow; forecast rows never credit, they only hint. */
function forecastMm(ctx: Context): number {
  let max = 0;
  for (const w of ctx.input.weather ?? []) {
    const day = parseDate(w.date);
    if (w.forecast === true && day !== undefined && day >= ctx.today && day <= ctx.today + 1) {
      if (Number.isFinite(w.rainMm)) max = Math.max(max, w.rainMm);
    }
  }
  return max;
}

/** Plants with a window open by tomorrow whose spot gets a full credit of rain forecast (a hint). */
function rainForecastFor(tracked: readonly Tracked[], ctx: Context): string[] {
  return tracked
    .filter((t) => {
      if (t.cfg.creditMm <= 0 || t.forecastMm < t.cfg.creditMm) return false;
      const w = clamp(compute(t.cfg, t.initial, ctx.today, ctx.climate), ctx.today);
      return w.earliest <= ctx.today + 1;
    })
    .map((t) => t.cfg.id);
}

/** The latest credited rain, watering or "looks fine", or undefined with no record. */
function lastCredit(p: PlantInput, care: ResolvedCare, ctx: Context): Day | undefined {
  let best: Day | undefined;
  const take = (d: Day | undefined): void => {
    if (d !== undefined && d <= ctx.today && (best === undefined || d > best)) best = d;
  };
  for (const e of rainEvents(p.logs ?? [], ctx.input.weather ?? [], ctx.today, care.creditMm)) {
    if (e.full) take(e.day);
  }
  for (const l of p.logs ?? []) {
    if (l.outcome === "done" || l.outcome === "looks_fine") take(parseDate(l.date));
  }
  return best;
}

/** Records an outdoor plant that has no window today: rain-fed with its drought check, or dormant. */
function outdoorEntry(p: PlantInput, care: ResolvedCare, ctx: Context): void {
  const last = lastCredit(p, care, ctx);
  const daysSinceCredit = last === undefined ? null : ctx.today - last;
  if (care.mode === "rain_fed") {
    ctx.rainFed.push({
      plantId: p.id,
      daysSinceCredit,
      checkDays: care.checkDays,
      droughtCheck: daysSinceCredit !== null && daysSinceCredit >= care.checkDays,
      assumed: care.assumed,
    });
    return;
  }
  const planted = p.plantedOn === undefined ? undefined : parseDate(p.plantedOn);
  const young = planted !== undefined && ctx.today - planted >= 0 && ctx.today - planted < 365;
  ctx.dormant.push({
    plantId: p.id,
    until: care.until ?? null,
    daysSinceCredit,
    winterSoak:
      daysSinceCredit !== null &&
      daysSinceCredit >= WINTER_SOAK_DAYS &&
      (p.dormancy === "none" || young),
    assumed: care.assumed,
  });
}

/** Moved in the last 3 days while a window is open (02m 1.3 item 4). */
function justMoved(t: Tracked, earliest: Day, ctx: Context): boolean {
  return t.movedOn !== undefined && ctx.today - t.movedOn <= 3 && earliest <= ctx.today;
}

function clamp(c: Computed, today: Day): { earliest: Day; latest: Day; overdue: number } {
  if (c.latest < today) return { earliest: today, latest: today, overdue: today - c.latest };
  return { earliest: Math.max(c.earliest, today), latest: c.latest, overdue: 0 };
}

export function computeWindows(input: PlanInput): WindowsResult {
  const ctx = context(input);
  if (ctx === undefined) {
    return {
      windows: [],
      reminderOnly: [],
      rainFed: [],
      dormant: [],
      rainForecastFor: [],
      issues: ["invalid today"],
    };
  }
  const { tracked, reminderOnly } = track(input, ctx);
  const windows: Window[] = tracked.map((t) => {
    const w = clamp(compute(t.cfg, t.state, ctx.today, ctx.climate), ctx.today);
    return {
      ...(justMoved(t, w.earliest, ctx) ? { justMoved: true as const } : {}),
      plantId: t.cfg.id,
      taskType: "water",
      earliest: formatDate(w.earliest),
      latest: formatDate(w.latest),
      overdueDays: w.overdue,
      marginDays: t.cfg.marginDays,
      wording: t.cfg.marginDays > 0 ? "around" : "exact",
    };
  });
  return {
    windows,
    reminderOnly,
    rainFed: ctx.rainFed,
    dormant: ctx.dormant,
    rainForecastFor: rainForecastFor(tracked, ctx),
    issues: ctx.issues,
  };
}

interface Availability {
  readonly isFree: (d: Day) => boolean;
  readonly isUnavailable: (d: Day) => boolean;
}

function availability(input: PlanInput, ctx: Context): Availability {
  const dates = new Set<Day>();
  for (const s of input.prefs?.unavailableDates ?? []) {
    const d = parseDate(s);
    if (d === undefined) ctx.issues.push(`invalid unavailable date ${s}`);
    else dates.add(d);
  }
  const weekdays = new Set(input.prefs?.unavailableWeekdays ?? []);
  const isUnavailable = (d: Day): boolean => dates.has(d) || weekdays.has(weekday(d));
  return { isFree: (d) => !isUnavailable(d), isUnavailable };
}

interface Candidate {
  readonly t: Tracked;
  readonly c: Computed;
  readonly earliest: Day;
  readonly latest: Day;
  readonly overdue: number;
}

function candidates(tracked: readonly Tracked[], ctx: Context): Candidate[] {
  return tracked
    .filter((t) => !t.abandoned)
    .map((t) => {
      const c = compute(t.cfg, t.state, ctx.today, ctx.climate);
      return { t, c, ...clamp(c, ctx.today) };
    });
}

function water(t: Tracked, cand: Candidate, day: Day, reason: WateringReason, ctx: Context): void {
  t.waterings.push({
    day,
    earliest: cand.earliest,
    latest: cand.latest,
    anchor: cand.c.anchor,
    reason,
  });
  t.state = applyLog(t.cfg, t.state, "done", day, ctx.climate);
  // PROVISIONAL: a watering an away stretch pushed past its window moves the whole
  // schedule: the next one is a full interval after this day and regroups with the other plants from
  // there (the old anchor would pull the plant back onto its original grid, a short gap later).
  if (reason === "away_days") {
    t.state = { ...t.state, anchor: day + intervalAt(t.cfg, t.state, day, ctx.climate) };
  }
}

export function planDays(input: PlanInput): PlanResult {
  const empty = (issues: readonly string[]): PlanResult => ({
    days: [],
    plants: [],
    summary: { naiveDays: 0, wateringDays: 0, savingPercent: 0 },
    reminderOnly: [],
    rainFed: [],
    dormant: [],
    rainForecastFor: [],
    issues,
  });
  const ctx = context(input);
  if (ctx === undefined) return empty(["invalid today"]);
  const { tracked, reminderOnly } = track(input, ctx);
  const forecastFor = rainForecastFor(tracked, ctx);
  const avail = availability(input, ctx);
  const preferred = new Set(input.prefs?.preferredWeekdays ?? []);
  const horizon = Math.max(1, Math.round(input.horizonDays ?? DEFAULT_HORIZON));
  const end = ctx.today + horizon - 1;
  // PROVISIONAL: on unless the preference is explicitly false.
  const preLeave = input.prefs?.preLeaveWatering !== false;

  // Ideal schedule per plant, before any combining, for the saving figure and the count rule.
  const ideal = new Map<string, Day[]>();
  for (const t of tracked) ideal.set(t.cfg.id, idealDays(t, ctx, end));

  const planned = new Map<Day, Set<string>>();
  const mark = (day: Day, id: string): void => {
    const set = planned.get(day) ?? new Set<string>();
    set.add(id);
    planned.set(day, set);
  };

  // PROVISIONAL: today stays a fixed watering day while something is
  // actually watered today (rule 22) or a plant that sets the day (window closes today, or today
  // is its ideal day) is still waiting for water. If every such plant is snoozed ("still wet")
  // or skipped and nothing was watered, the plants that only joined go back to their own days.
  const skippedToday = new Set(
    (input.plants ?? [])
      .filter((p) =>
        (p.logs ?? []).some((l) => l.outcome === "skipped" && parseDate(l.date) === ctx.today),
      )
      .map((p) => p.id),
  );
  const open = candidates(tracked, ctx).filter(
    (x) => x.earliest <= ctx.today && ctx.today <= x.latest,
  );
  const wateredToday = tracked.some((t) => t.state.last === ctx.today);
  const setterWaits = open.some(
    (x) =>
      x.t.state.last !== ctx.today &&
      !skippedToday.has(x.t.cfg.id) &&
      (x.latest === ctx.today || x.c.anchor <= ctx.today),
  );
  if (avail.isFree(ctx.today) && (wateredToday || setterWaits)) {
    for (const x of open) {
      if (x.t.state.last !== ctx.today && !skippedToday.has(x.t.cfg.id)) {
        mark(ctx.today, x.t.cfg.id);
        water(x.t, x, ctx.today, reasonFor(x, ctx.today, preferred), ctx);
      }
    }
  }

  // a pre-leave watering the user has been shown stays put when another
  // plant is logged. The caller passes the ones it has seen; each is honoured only while it still
  // makes sense for its plant, and stale pins are ignored.
  if (preLeave) {
    const pins = (input.pinned ?? [])
      .map((p) => ({ id: p.plantId, day: parseDate(p.date) }))
      .filter((p): p is { id: string; day: Day } => p.day !== undefined)
      .filter((p) => p.day >= ctx.today && p.day <= end && avail.isFree(p.day))
      .sort((a, b) => a.day - b.day);
    for (const pin of pins) {
      const x = candidates(tracked, ctx).find((c) => c.t.cfg.id === pin.id);
      if (x === undefined || !pinHolds(x, pin.day, avail, end)) continue;
      mark(pin.day, pin.id);
      water(x.t, x, pin.day, "pre_leave", ctx);
    }
  }

  for (let guard = 0; guard < MAX_ITERATIONS; guard += 1) {
    const cands = candidates(tracked, ctx);
    // PROVISIONAL: only windows that close inside the horizon trigger a watering day; later
    // ones wait for the next plan (02a 5.3 results need this).
    const active = cands.filter((x) => x.latest <= end);
    if (active.length === 0) break;
    const first = Math.min(...active.map((x) => x.latest));
    const urgent = active.filter((x) => x.latest === first);
    const lo = Math.max(...urgent.map((x) => x.earliest));

    const days: Day[] = [];
    for (let d = lo; d <= first; d += 1) if (avail.isFree(d)) days.push(d);

    if (days.length > 0) {
      // Greedy stabbing: the day covering most windows, preferred weekdays as a tie-break
      // (+1 against +2 per window), later day on a tie.
      let best = days[0] ?? lo;
      let bestScore = -1;
      for (const d of days) {
        const covered = cands.filter((x) => x.earliest <= d && d <= x.latest).length;
        const score = 2 * covered + (preferred.has(weekday(d)) ? 1 : 0);
        if (score > bestScore || (score === bestScore && d > best)) {
          best = d;
          bestScore = score;
        }
      }
      for (const x of cands) {
        if (x.earliest <= best && best <= x.latest) {
          mark(best, x.t.cfg.id);
          water(x.t, x, best, reasonFor(x, best, preferred), ctx);
        }
      }
      continue;
    }

    // PROVISIONAL: no available day inside the urgent windows. They are watered, late and
    // flagged, on the first available day after them (02a 5.4 only says: flag them). Everything
    // whose window has opened by then joins that day. With no such day left in the horizon they
    // are reported unserved.
    let after: Day | undefined;
    for (let d = first + 1; d <= end; d += 1) {
      if (avail.isFree(d)) {
        after = d;
        break;
      }
    }

    if (preLeave) {
      const before = lastFreeBefore(Math.min(...urgent.map((x) => x.earliest)), ctx.today, avail);
      if (before !== undefined) {
        const go = urgent.filter((x) => wantsPreLeave(x, before, after, ctx));
        if (go.length > 0) {
          for (const x of go) {
            mark(before, x.t.cfg.id);
            water(x.t, x, before, "pre_leave", ctx);
          }
          continue;
        }
      }
    }

    if (after === undefined) {
      for (const x of urgent) x.t.abandoned = true;
      continue;
    }
    for (const x of cands) {
      if (x.earliest <= after) {
        mark(after, x.t.cfg.id);
        water(x.t, x, after, x.latest < after ? "away_days" : reasonFor(x, after, preferred), ctx);
      }
    }
  }

  const days = [...planned.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, ids]) => ({ date: formatDate(day), plantIds: [...ids].sort() }));

  const plants: PlantPlan[] = tracked.map((t) =>
    planOf(t, ideal.get(t.cfg.id) ?? [], ctx, end, avail),
  );

  const naive = new Set<Day>();
  for (const list of ideal.values()) for (const d of list) naive.add(d);
  const naiveDays = naive.size;
  const savingPercent =
    naiveDays === 0 ? 0 : Math.round(((naiveDays - days.length) / naiveDays) * 100);

  return {
    days,
    plants,
    summary: { naiveDays, wateringDays: days.length, savingPercent },
    reminderOnly,
    rainFed: ctx.rainFed,
    dormant: ctx.dormant,
    rainForecastFor: forecastFor,
    issues: ctx.issues,
  };
}

function reasonFor(x: Candidate, day: Day, preferred: ReadonlySet<number>): WateringReason {
  if (x.overdue > 0) return "overdue";
  if (day === x.c.anchor) return "on_ideal_day";
  return preferred.has(weekday(day)) ? "preferred_day" : "joined_group";
}

function lastFreeBefore(limit: Day, today: Day, avail: Availability): Day | undefined {
  for (let d = limit - 1; d >= today; d -= 1) if (avail.isFree(d)) return d;
  return undefined;
}

// PROVISIONAL: pre-leave rule from 02b. Early by no more than the wet tolerance, earlier than
// waiting for the first free day, and not watered within the last third of the interval.
function wantsPreLeave(x: Candidate, before: Day, after: Day | undefined, ctx: Context): boolean {
  const early = x.earliest - before;
  if (early < 1 || early > x.t.cfg.wetTolDays) return false;
  if (after !== undefined && early > after - x.latest) return false;
  const interval = x.c.interval;
  const sinceLast = before - x.c.last;
  return sinceLast * 3 >= interval && ctx.today <= before;
}

// A pinned pre-leave watering still holds while some unavailable day lies after it in the plan (cancel
// every away day and the pin is ignored; add them back and it returns), the day is not past the plant's
// window, is no earlier than the wet tolerance allows, and is not within the last third of the interval
// after the last watering. The plan around it may change, which is why the group rule is not rechecked.
function pinHolds(x: Candidate, day: Day, avail: Availability, end: Day): boolean {
  if (day > x.latest || x.earliest - day > x.t.cfg.wetTolDays) return false;
  let away = false;
  for (let d = day + 1; d <= end; d += 1) if (!avail.isFree(d)) away = true;
  return away && (day - x.c.last) * 3 >= x.c.interval;
}

/** Ideal watering days in [today, end]: the anchor sequence, overdue anchors counted once today. */
function idealDays(t: Tracked, ctx: Context, end: Day): Day[] {
  const c = compute(t.cfg, t.initial, ctx.today, ctx.climate);
  const out: Day[] = [];
  let d = Math.max(c.anchor, ctx.today);
  let guard = 0;
  while (d <= end && guard < MAX_ITERATIONS) {
    out.push(d);
    d += intervalAt(t.cfg, t.initial, d, ctx.climate);
    guard += 1;
  }
  return out;
}

function planOf(
  t: Tracked,
  ideal: readonly Day[],
  ctx: Context,
  end: Day,
  avail: Availability,
): PlantPlan {
  const waterings: PlannedWatering[] = t.waterings.map((w) => ({
    date: formatDate(w.day),
    windowEarliest: formatDate(w.earliest),
    windowLatest: formatDate(w.latest),
    inWindow: w.earliest <= w.day && w.day <= w.latest,
    movedDays: w.day - w.anchor,
    reason: w.reason,
  }));
  return {
    plantId: t.cfg.id,
    waterings,
    wateringCount: waterings.length,
    idealCount: ideal.length,
    outlook: outlookOf(t, ctx, end, avail),
    ...(justMoved(
      t,
      clamp(compute(t.cfg, t.initial, ctx.today, ctx.climate), ctx.today).earliest,
      ctx,
    )
      ? { justMoved: true as const }
      : {}),
  };
}

// PROVISIONAL: outlook from the gaps between waterings (02a 5.4, 01b, 02b). A gap inside the
// band is thrive. Past the band: survive up to the dry tolerance past the ideal interval,
// scrape_by up to 1.5 x the tolerance, decay beyond. Too early by more than the wet tolerance
// is survive.
function outlookOf(t: Tracked, ctx: Context, end: Day, avail: Availability): Outlook {
  const reasons = new Set<string>();
  let worst = 0;
  const bump = (level: number): void => {
    worst = Math.max(worst, level);
  };
  let from: Day | undefined = t.initial.last;
  const stops: { day: Day; open: boolean; outside: boolean }[] = [
    ...t.waterings.map((w) => ({
      day: w.day,
      open: false,
      outside: (w.day < w.earliest || w.day > w.latest) && w.reason !== "pre_leave",
    })),
    { day: end, open: true, outside: false },
  ];
  let carried: State = t.initial;
  for (const stop of stops) {
    if (from !== undefined) {
      const interval = intervalAt(t.cfg, carried, from, ctx.climate);
      const b = band(t.cfg.style, interval);
      const gap = stop.day - from;
      // An assumed care fact stretches the window past the band (model.ts `compute`), so a watering the
      // planner put at the end of that window is on schedule, not past what the plant tolerates.
      if (gap > b.high + t.cfg.marginDays) {
        const pastIdeal = gap - interval;
        // the away stretch is the cause only when an unavailable day lies in the part of the gap
        // that is still ahead of today and after the band opened (an old `lastWatered` is overdue, not away).
        let awayCaused = false;
        for (let d = Math.max(from + b.low, ctx.today); d < stop.day; d += 1) {
          if (avail.isUnavailable(d)) {
            awayCaused = true;
            break;
          }
        }
        // PROVISIONAL: a gap the away days made that stays inside the dry tolerance is no warning:
        // the plant was watered as soon as someone could.
        if (!(awayCaused && !stop.open && pastIdeal <= t.cfg.dryTolDays)) {
          const level =
            pastIdeal <= t.cfg.dryTolDays
              ? 1
              : pastIdeal <= Math.floor(1.5 * t.cfg.dryTolDays)
                ? 2
                : 3;
          bump(level);
          reasons.add(stop.open ? "unserved" : "gap_exceeds_band");
          if (awayCaused) reasons.add("away_days");
        }
      } else if (!stop.open && b.low - gap > t.cfg.wetTolDays) {
        bump(1);
        reasons.add("too_early");
      } else if (stop.outside) {
        // PROVISIONAL: inside the band but off the ideal schedule: a soft note, not a health risk.
        bump(1);
        reasons.add("outside_window");
      }
    }
    if (!stop.open) {
      carried = applyLog(t.cfg, carried, "done", stop.day, ctx.climate);
      from = stop.day;
    }
  }
  if (t.abandoned) {
    // No free day left before the horizon ended: never silently unserved.
    bump(1);
    reasons.add("unserved");
  }
  return {
    level: LEVELS[worst] ?? "decay",
    severity: worst as 0 | 1 | 2 | 3,
    reasons: [...reasons].sort(),
  };
}
