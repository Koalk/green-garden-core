// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-ground and outdoor care: a pure care resolver in front of the window
 * arithmetic, and the rain bookkeeping. Nothing here touches `band`, `compute` or the combiner: an
 * outdoor plant is turned into an indoor-shaped `PlantInput` (an interval in days), or into a rain-fed or
 * dormant entry that has no window. A plant without `placement`, or placed indoors, passes through
 * unchanged. Every constant is `PROVISIONAL` or `PROVISIONAL`: guesses until a field log exists.
 */
import { formatDate, monthOf, parseDate, type Day } from "./dates.ts";
import { restWeight } from "./season.ts";
import { directSunHours, groundSunByHours, potExposureByHours } from "./sun.ts";
import type {
  CareMode,
  ClimateClass,
  DroughtTolerance,
  Hemisphere,
  LogEntry,
  PlacementEntry,
  Placement,
  PlantInput,
  RootDepth,
  SunExposure,
  WeatherDay,
} from "./types.ts";

/** The seven climate classes of the home; `oceanic_wet` is assumed when the home has not said. */
export const CLIMATE_CLASSES: readonly ClimateClass[] = [
  "oceanic_wet",
  "oceanic_dry",
  "med_mild",
  "mediterranean",
  "semi_arid",
  "arid",
  "mountain",
];
export const DEFAULT_CLIMATE: ClimateClass = "oceanic_wet";

interface ClimateConstants {
  /** Factor on an outdoor pot's interval in the dry season. */
  readonly potSummer: number;
  /** Dry season months, north hemisphere (the south moves six months). */
  readonly dryMonths: readonly number[];
  /** Days without credited rain after which a rain-fed plant gets a drought check. */
  readonly droughtCheckDays: number;
  /** Whether an established plant of moderate drought tolerance lives on rain alone. */
  readonly rainFedModerate: boolean;
}

const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// PROVISIONAL: all guesses.
const CLIMATE: Readonly<Record<ClimateClass, ClimateConstants>> = {
  oceanic_wet: { potSummer: 1.0, dryMonths: [], droughtCheckDays: 28, rainFedModerate: true },
  oceanic_dry: {
    potSummer: 0.9,
    dryMonths: [6, 7, 8],
    droughtCheckDays: 21,
    rainFedModerate: true,
  },
  med_mild: { potSummer: 0.85, dryMonths: [7, 8, 9], droughtCheckDays: 21, rainFedModerate: false },
  mediterranean: {
    potSummer: 0.7,
    dryMonths: [6, 7, 8, 9],
    droughtCheckDays: 21,
    rainFedModerate: false,
  },
  semi_arid: {
    potSummer: 0.65,
    dryMonths: [5, 6, 7, 8, 9],
    droughtCheckDays: 14,
    rainFedModerate: false,
  },
  arid: { potSummer: 0.6, dryMonths: ALL_YEAR, droughtCheckDays: 14, rainFedModerate: false },
  mountain: { potSummer: 0.9, dryMonths: [7, 8], droughtCheckDays: 21, rainFedModerate: true },
};

// PROVISIONAL: guess.
const POT_EXPOSURE: Readonly<Record<SunExposure, number>> = {
  full_sun: 0.5,
  part_shade: 0.7,
  shade: 0.85,
};
const GROUND_SUN: Readonly<Record<SunExposure, number>> = {
  full_sun: 0.85,
  part_shade: 1.0,
  shade: 1.2,
};
const SOIL = { sandy: 0.7, loam: 1.0, clay: 1.3 } as const;
const MULCH = 1.25;
const DEFAULT_ESTABLISHING_DAYS = 7;
const MODERATE_ESTABLISHED = 2;
const NONE_ESTABLISHED = 1.5;
/** Sheltered, settled, drought-tolerant ground plants: the moderate rule, longer. PROVISIONAL guess. */
const SHELTERED_HIGH_ESTABLISHED = 3;
/** Rain (mm) that counts as a full watering, by root depth. */
const CREDIT_ESTABLISHED: Readonly<Record<RootDepth, number>> = {
  shallow: 10,
  medium: 15,
  deep: 20,
};
const CREDIT_ESTABLISHING: Readonly<Record<RootDepth, number>> = {
  shallow: 15,
  medium: 15,
  deep: 20,
};
const CREDIT_POT = 8;
/** Days without credited rain before the optional winter-soak prompt. */
export const WINTER_SOAK_DAYS = 28;
const SCAN_LIMIT = 420;

/** Round half up, immune to the last bits of a float product. */
const round = (x: number): number => Math.floor(Math.round(x * 1e6) / 1e6 + 0.5);

export interface CareEnv {
  readonly climate?: ClimateClass;
  readonly hemisphere?: Hemisphere;
  readonly latitude?: number;
  /** Country of the home, for the clock time of solar noon. */
  readonly country?: string;
}

export interface ResolvedCare {
  readonly mode: CareMode;
  /** The interval the window arithmetic uses (meaningful for `interval`). */
  readonly intervalDays: number;
  /** Rain in mm that counts as a full watering; 0 means rain is ignored (indoors, under cover). */
  readonly creditMm: number;
  /** Where the plant is in its establishment; null when it does not apply (indoors, in a pot). */
  readonly phase: "establishing" | "established" | null;
  /** Catalogue fields that were missing and replaced by a default, so the UI can say "assumed". */
  readonly assumed: readonly string[];
  /** Days without credited rain before a drought check (rain-fed) or winter soak prompt. */
  readonly checkDays: number;
  /** Hours of direct sun on the day when the plant (or its room) has `directSun`; absent otherwise. */
  readonly sunHours?: number;
  /** When `mode` is `suspended`: the first day it is not (absent if none within about a year). */
  readonly until?: string;
}

interface Resolver {
  readonly at: (day: Day) => Omit<ResolvedCare, "until" | "checkDays">;
  readonly suspended: (day: Day) => boolean;
}

const placementOf = (p: PlantInput) => p.placement ?? "indoor";

/** First day of the Nth rest season after planting: the day the Nth growth season is over. */
function establishedOn(planted: Day, seasons: number, env: Required<CareEnv>): Day {
  const full = (d: Day): boolean => restWeight(d, env.hemisphere, env.latitude) >= 1;
  let before = full(planted - 1);
  let seen = 0;
  for (let d = planted; d < planted + 366 * seasons + 400; d += 1) {
    const now = full(d);
    if (now && !before) {
      seen += 1;
      if (seen >= seasons) return d;
    }
    before = now;
  }
  return planted + 365 * seasons; // no rest season at this latitude
}

function inDryMonth(day: Day, c: ClimateConstants, hemisphere: Hemisphere): boolean {
  const m = monthOf(day);
  const north = hemisphere === "north" ? m : ((m + 5) % 12) + 1;
  return c.dryMonths.includes(north);
}

function resolver(p: PlantInput, env: Required<CareEnv>): Resolver {
  const c = CLIMATE[env.climate];
  const place = placementOf(p);
  /** Hours of direct sun on a day, when the place has an answer; the class is used otherwise. */
  const sunOn = (day: Day): number | undefined =>
    p.directSun === undefined
      ? undefined
      : directSunHours(p.directSun, formatDate(day), {
          hemisphere: env.hemisphere,
          latitude: env.latitude,
          country: env.country,
        });
  if (place === "indoor") {
    const at = (day: Day) => {
      const sunHours = sunOn(day);
      return {
        mode: "interval" as const,
        intervalDays: p.intervalDays,
        creditMm: 0,
        phase: null,
        assumed: [] as string[],
        ...(sunHours === undefined ? {} : { sunHours }),
      };
    };
    return { at, suspended: () => false };
  }

  const unknownSun: SunExposure = p.sun ?? "part_shade";
  const potExposure = (day: Day): number => {
    const h = sunOn(day);
    return h === undefined ? POT_EXPOSURE[unknownSun] : potExposureByHours(h);
  };
  const groundSun = (day: Day): number => {
    const h = sunOn(day);
    return h === undefined ? GROUND_SUN[unknownSun] : groundSunByHours(h);
  };
  if (place === "outdoor_pot") {
    const potAssumed = p.sheltered === undefined ? ["sheltered"] : [];
    const at = (day: Day) => {
      const summer = inDryMonth(day, c, env.hemisphere) ? c.potSummer : 1;
      return {
        mode: "interval" as const,
        intervalDays: Math.max(1, round(p.intervalDays * potExposure(day) * summer)),
        creditMm: p.sheltered === true ? 0 : CREDIT_POT,
        phase: null,
        assumed: potAssumed,
      };
    };
    return { at, suspended: () => false };
  }

  // In the ground.
  const assumed: string[] = [];
  const tolerance: DroughtTolerance = p.droughtTolerance ?? "moderate";
  const depth: RootDepth = p.rootDepth ?? "medium";
  const eid = p.establishingIntervalDays ?? DEFAULT_ESTABLISHING_DAYS;
  const planted = p.plantedOn === undefined ? undefined : parseDate(p.plantedOn);
  const sheltered = p.sheltered === true;
  if (p.sheltered === undefined) assumed.push("sheltered");
  if (p.droughtTolerance === undefined) assumed.push("droughtTolerance");
  if (p.rootDepth === undefined) assumed.push("rootDepth");
  if (p.establishingIntervalDays === undefined) assumed.push("establishingIntervalDays");
  if (planted === undefined) assumed.push("phase");
  const ends =
    planted === undefined ? undefined : establishedOn(planted, p.establishmentSeasons ?? 1, env);
  const soil = SOIL[p.groundSoil ?? "loam"];
  const mulch = p.mulched === true ? MULCH : 1;
  const dormancy = p.dormancy ?? "winter";
  const dormant = (day: Day): boolean => {
    if (dormancy === "summer") {
      const m = monthOf(day);
      return env.hemisphere === "north" ? m === 7 || m === 8 : m === 1 || m === 2;
    }
    return restWeight(day, env.hemisphere, env.latitude) >= 1;
  };
  const modeAt = (day: Day): { mode: CareMode; intervalDays: number; establishing: boolean } => {
    const establishing = ends !== undefined && day < ends;
    if (dormant(day)) return { mode: "suspended", intervalDays: p.intervalDays, establishing };
    if (establishing) {
      return {
        mode: "interval",
        intervalDays: Math.max(1, round(eid * soil * mulch * groundSun(day))),
        establishing,
      };
    }
    // Under cover nothing feeds the plant: never rain-fed.
    if (tolerance === "high" && !sheltered)
      return { mode: "rain_fed", intervalDays: p.intervalDays, establishing };
    if (tolerance === "moderate" || tolerance === "high") {
      if (c.rainFedModerate && !sheltered)
        return { mode: "rain_fed", intervalDays: p.intervalDays, establishing };
      if (!inDryMonth(day, c, env.hemisphere)) {
        return { mode: "suspended", intervalDays: p.intervalDays, establishing };
      }
      const factor = tolerance === "high" ? SHELTERED_HIGH_ESTABLISHED : MODERATE_ESTABLISHED;
      return {
        mode: "interval",
        intervalDays: Math.max(1, round(factor * eid * soil * mulch)),
        establishing,
      };
    }
    return {
      mode: "interval",
      intervalDays: Math.max(1, round(NONE_ESTABLISHED * eid * soil * mulch * groundSun(day))),
      establishing,
    };
  };
  const at = (day: Day) => {
    const m = modeAt(day);
    const credit =
      p.sheltered === true ? 0 : (m.establishing ? CREDIT_ESTABLISHING : CREDIT_ESTABLISHED)[depth];
    return {
      mode: m.mode,
      intervalDays: m.intervalDays,
      creditMm: credit,
      phase: m.establishing ? ("establishing" as const) : ("established" as const),
      assumed,
    };
  };
  return { at, suspended: (day) => modeAt(day).mode === "suspended" };
}

function fullEnv(env: CareEnv): Required<CareEnv> {
  return {
    climate: env.climate ?? DEFAULT_CLIMATE,
    hemisphere: env.hemisphere ?? "north",
    latitude: env.latitude ?? Number.NaN,
    country: env.country ?? "",
  };
}

/**
 * How a plant is cared for on a day: `interval` (the usual windows, with the resolved interval),
 * `rain_fed` (no window; a drought check prompt instead) or `suspended` (dormant; `until` says when it ends).
 * Indoor plants, and any plant with no `placement`, return their own values.
 */
export function resolveCare(plant: PlantInput, today: string, env: CareEnv = {}): ResolvedCare {
  const day = parseDate(today);
  const e = fullEnv(env);
  const r = resolver(plant, e);
  if (day === undefined) {
    return {
      mode: "interval",
      intervalDays: plant.intervalDays,
      creditMm: 0,
      phase: null,
      assumed: [],
      checkDays: 0,
    };
  }
  const { mode, intervalDays, creditMm, phase, assumed, sunHours } = r.at(day);
  const checkDays = CLIMATE[e.climate].droughtCheckDays;
  const sun = sunHours === undefined ? {} : { sunHours };
  if (mode !== "suspended")
    return { mode, intervalDays, creditMm, phase, assumed, checkDays, ...sun };
  let until: string | undefined;
  for (let d = day + 1; d <= day + SCAN_LIMIT; d += 1) {
    if (!r.suspended(d)) {
      until = formatDate(d);
      break;
    }
  }
  return {
    mode,
    intervalDays,
    creditMm,
    phase,
    assumed,
    checkDays,
    ...sun,
    ...(until === undefined ? {} : { until }),
  };
}

/** The plant as the window arithmetic sees it: the resolved interval, and no indoor-only facts outdoors. */
export function applyCare(p: PlantInput, care: ResolvedCare): PlantInput {
  const place = placementOf(p);
  if (place === "indoor")
    return care.sunHours === undefined ? p : { ...p, sunHours: care.sunHours };
  const drop = (...keys: string[]): PlantInput =>
    Object.fromEntries(
      Object.entries(p).filter(([k]) => !keys.includes(k)),
    ) as unknown as PlantInput;
  if (place === "outdoor_pot") return { ...drop("light"), intervalDays: care.intervalDays };
  return {
    ...drop("light", "potDiameterCm", "potMaterial"),
    intervalDays: care.intervalDays,
    restFactor: 1,
  };
}

export interface RainEvent {
  readonly day: Day;
  /** Rain counted for this event: the day's own, plus the previous day's if that was a partial. */
  readonly mm: number;
  /** Reaches the credit on its own or with the day before. */
  readonly full: boolean;
}

/**
 * Rain reports (log entries and observed weather rows) as credit events, oldest first. Two
 * partial rains on consecutive days add up. A forecast row never gets here.
 */
export function rainEvents(
  logs: readonly LogEntry[],
  weather: readonly WeatherDay[],
  today: Day,
  credit: number | ((day: Day) => number),
): RainEvent[] {
  // with a placement history the credit depends on where the plant was that day; a day with
  // credit 0 (indoors, under cover) drops its event.
  const creditOn = typeof credit === "number" ? () => credit : credit;
  if (typeof credit === "number" && credit <= 0) return [];
  // Per day the best source wins: manual logs, else measured rows, else modelled ones.
  const manual: { day: Day; mm: number }[] = [];
  for (const l of logs) {
    const day = parseDate(l.date);
    if (l.outcome === "rain" && day !== undefined && day <= today && Number.isFinite(l.mm)) {
      manual.push({ day, mm: l.mm ?? 0 });
    }
  }
  const byDay = new Map<Day, { measured?: number; modelled?: number }>();
  for (const w of weather) {
    const day = parseDate(w.date);
    if (w.forecast === true || day === undefined || day > today || !Number.isFinite(w.rainMm))
      continue;
    const slot = byDay.get(day) ?? {};
    // Several rows of one kind for a day: the last one is the later report.
    slot[w.kind === "modelled" ? "modelled" : "measured"] = w.rainMm;
    byDay.set(day, slot);
  }
  const manualDays = new Set(manual.map((m) => m.day));
  const items: { day: Day; mm: number }[] = [...manual];
  for (const [day, slot] of byDay) {
    if (manualDays.has(day)) continue;
    const mm = slot.measured ?? slot.modelled;
    if (mm !== undefined) items.push({ day, mm });
  }
  items.sort((a, b) => a.day - b.day);
  const out: RainEvent[] = [];
  let partial: { day: Day; mm: number } | undefined;
  for (const it of items) {
    if (!(it.mm > 0)) continue;
    const creditMm = creditOn(it.day);
    if (!(creditMm > 0)) continue;
    const mm = it.mm + (partial !== undefined && partial.day === it.day - 1 ? partial.mm : 0);
    const full = mm >= creditMm;
    out.push({ day: it.day, mm, full });
    partial = full ? undefined : it;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Placement history. A plant that moves in and out keeps dated entries; the
// engine reads where it was on any day. Without a history every function here is the identity.

/** The entries the engine trusts: valid date, a move target, oldest first; an equal date keeps the later. */
export function placementEntries(plant: PlantInput): readonly PlacementEntry[] {
  if (plant.placement === "ground") return [];
  const kept = (plant.placementHistory ?? []).filter(
    (e) =>
      parseDate(e.on) !== undefined &&
      ((e.placement as string) === "indoor" || (e.placement as string) === "outdoor_pot"),
  );
  const sorted = kept
    .map((e, i) => ({ e, i, d: parseDate(e.on) ?? 0 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.e);
  return sorted.filter((e, i) => sorted[i + 1]?.on !== e.on);
}

/** Where the plant was on a day: the last entry on or before it (the first one reaches back), else its own fields. */
export function placementOn(
  plant: PlantInput,
  day: Day,
): { readonly placement: Placement; readonly sheltered: boolean } {
  const entries = placementEntries(plant);
  const first = entries[0];
  if (first === undefined) {
    return { placement: placementOf(plant), sheltered: plant.sheltered === true };
  }
  let at: PlacementEntry = first;
  for (const e of entries) {
    const d = parseDate(e.on);
    if (d !== undefined && d <= day) at = e;
  }
  return {
    placement: at.placement,
    sheltered: at.placement === "indoor" ? false : at.sheltered === true,
  };
}

/** The plant as it was placed on a day. Without a history it is the plant itself. */
export function plantOn(plant: PlantInput, day: Day): PlantInput {
  if (placementEntries(plant).length === 0) return plant;
  const rest = Object.fromEntries(
    Object.entries(plant).filter(([k]) => k !== "placementHistory"),
  ) as unknown as PlantInput;
  const at = placementOn(plant, day);
  return { ...rest, placement: at.placement, sheltered: at.sheltered };
}

/** Rain in mm that counted as a full watering on a day: 0 indoors and under cover. */
export function creditMmOn(plant: PlantInput, day: Day, env: CareEnv = {}): number {
  const p = plantOn(plant, day);
  return resolver(p, fullEnv(env)).at(day).creditMm;
}

export interface Move {
  readonly on: string;
  readonly placement: "indoor" | "outdoor_pot";
  readonly sheltered?: boolean;
}

export type MoveResult =
  | {
      readonly ok: true;
      /** The new history, base entry included, ready to store. */
      readonly placementHistory: readonly PlacementEntry[];
      /** The plant's own fields after the move: they equal the last entry. */
      readonly placement: "indoor" | "outdoor_pot";
      /** Present for outdoor moves only; indoors the flag is left as it was. */
      readonly sheltered?: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid_date" | "future" | "before_previous" | "ground";
    };

/**
 * Appends a move to a plant's history. The date is never in the future and never before the
 * previous entry's; an equal date replaces that entry. The first move writes the base entry first:
 * `addedOn`, else the earliest log date, else the move date. A ground plant cannot move.
 */
export function recordMove(
  plant: PlantInput & { readonly addedOn?: string },
  move: Move,
  today: string,
): MoveResult {
  const on = parseDate(move.on);
  const now = parseDate(today);
  if (on === undefined || now === undefined) return { ok: false, reason: "invalid_date" };
  if (plant.placement === "ground") return { ok: false, reason: "ground" };
  if (on > now) return { ok: false, reason: "future" };
  const entry: PlacementEntry = {
    on: move.on,
    placement: move.placement,
    ...(move.placement === "outdoor_pot" && move.sheltered === true ? { sheltered: true } : {}),
  };
  let history = [...placementEntries(plant)];
  if (history.length === 0) {
    const logDays = (plant.logs ?? [])
      .map((l) => parseDate(l.date))
      .filter((d): d is Day => d !== undefined);
    const added = plant.addedOn === undefined ? undefined : parseDate(plant.addedOn);
    const base = added ?? (logDays.length === 0 ? on : Math.min(...logDays));
    const place = placementOf(plant);
    history = [
      {
        on: formatDate(Math.min(base, on - 1)),
        placement: place === "outdoor_pot" ? "outdoor_pot" : "indoor",
        ...(place === "outdoor_pot" && plant.sheltered === true ? { sheltered: true } : {}),
      },
    ];
  }
  const last = history[history.length - 1];
  const lastDay = last === undefined ? undefined : parseDate(last.on);
  if (lastDay !== undefined && on < lastDay) return { ok: false, reason: "before_previous" };
  if (last !== undefined && last.on === move.on) {
    // An equal date replaces that entry; a lone base entry moves back a day instead, so the history
    // still says where the plant was before.
    history.pop();
    if (history.length === 0) history.push({ ...last, on: formatDate(on - 1) });
  }
  history.push(entry);
  return {
    ok: true,
    placementHistory: history,
    placement: entry.placement,
    ...(entry.placement === "outdoor_pot" ? { sheltered: entry.sheltered === true } : {}),
  };
}
