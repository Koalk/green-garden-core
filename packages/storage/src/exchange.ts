// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Export/import format X5: versioned JSON, same shape in core and app. Import never loses data
 *: keys this build does not know are carried through and written back on export, and the
 * store load keeps a plant it cannot read, marked `invalid`. The version rule is in docs/data-format.md.
 */
import {
  parseDate,
  type Calibration,
  type LogEntry,
  type PinnedWatering,
  type LogOutcome,
  type PlacementEntry,
  type SunRange,
  type WateringStyle,
} from "@green-garden/engine";
import { migrate } from "./migrate.ts";
import {
  CLIMATES,
  COUNTRIES,
  DEFAULT_REMINDER_TIME,
  DORMANCIES,
  DROUGHT_TOLERANCES,
  ESTABLISHMENT_SEASONS,
  ROOT_DEPTHS,
  WINTER_MINS,
  emptyData,
  type AppData,
  type Household,
  type FieldSource,
  PLACEMENTS,
  PLANT_SIZES,
  SUNS,
  GROUND_SOILS,
  DRAUGHTS,
  POT_MATERIALS,
  SOIL_TYPES,
  SOURCED_FIELDS,
  type Plant,
  type PlantBatch,
  type PlantDraft,
  type PlantQuestionState,
  type ReminderSettings,
  type WeatherSettings,
  type Room,
  type Settings,
  type Space,
} from "./model.ts";
import { weatherSettings } from "./weather-settings.ts";

export const FORMAT = "green-garden-export";
export const VERSION = 9;

const STYLES: readonly WateringStyle[] = ["keep_moist", "let_top_dry", "let_fully_dry"];
const DRAINAGES = ["hole", "cachepot", "no_hole", "self_watering"] as const;
const GROWTH_CLASSES = ["fast", "medium", "slow"] as const;
const LIGHTS = ["low", "medium", "bright_indirect", "direct"] as const;
const MEASURES = ["mug", "glass", "jug", "cup", "none"] as const;
const AMOUNT_MODES = ["qualitative", "precise"] as const;
const WORDINGS = ["uk", "us"] as const;
const PETS = ["cat", "dog", "small_pet"] as const;
const FIELD_SOURCES: readonly FieldSource[] = ["catalogue", "default", "user", "learned"];
const OUTCOMES: readonly LogOutcome[] = [
  "done",
  "skipped",
  "still_wet",
  "dry_early",
  "rain",
  "looks_fine",
];

/** A problem found on import as a message code plus parameters; the UI words it per locale. */
export interface ImportIssue {
  readonly code: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface ImportResult {
  readonly data: AppData;
  /** Entries that were skipped or repaired, in plain English (for logs and developers). */
  readonly warnings: readonly string[];
  /** The same problems, one per warning, as codes for translated display. */
  readonly issues: readonly ImportIssue[];
  /** The file's `version`, when it had a usable one. */
  readonly version?: number;
}

export interface ImportOptions {
  /**
   * A store load (not a file import): a plant that fails validation is kept and marked `invalid`
   * instead of being skipped, so a load followed by a save never loses it.
   */
  readonly keepInvalid?: boolean;
}

type Warn = (code: string, text: string, params?: ImportIssue["params"]) => void;

export function exportData(data: AppData): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, ...data }, null, 2);
}

type Obj = Record<string, unknown>;

const TOP_KEYS = [
  "format",
  "version",
  "spaces",
  "plants",
  "rooms",
  "drafts",
  "pins",
  "questionState",
  "settings",
];
const PLANT_KEYS = [
  "id",
  "name",
  "style",
  "intervalDays",
  "logs",
  "lastWatered",
  "anchor",
  "notBefore",
  "adjustmentDays",
  "doneStreak",
  "restFactor",
  "dryTolDays",
  "wetTolDays",
  "potDiameterCm",
  "potHeightCm",
  "species",
  "roomId",
  "source",
  "reminderOnly",
  "spaceId",
  "calibration",
  "drainage",
  "growthClass",
  "lastRepotted",
  "placement",
  "potMaterial",
  "soilType",
  "plantSize",
  "sun",
  "groundSoil",
  "directSun",
  "placementHistory",
  "draught",
  "mulched",
  "sheltered",
  "plantedOn",
  "establishmentSeasons",
  "rootDepth",
  "droughtTolerance",
  "dormancy",
  "establishingIntervalDays",
  "unmatched",
  "addedOn",
  "addedOnEstimated",
  "batch",
  "fieldSources",
  "invalid",
];
const LOG_KEYS = ["date", "outcome", "mm"];
const ROOM_KEYS = ["id", "name", "light", "spaceId", "calibration", "haAreaId", "directSun"];
const SETTINGS_KEYS = [
  "hemisphere",
  "horizonDays",
  "latitude",
  "country",
  "climate",
  "winterMin",
  "locale",
  "measure",
  "amountMode",
  "wording",
  "household",
  "calibration",
  "reminders",
  "weather",
  "questions",
  "weekStart",
  "prefs",
];

/** The keys of `raw` this build does not know, as they came (carried through, never dropped). */
function unknownKeys(raw: Obj, known: readonly string[]): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(raw)) if (!known.includes(k)) out[k] = v;
  return out;
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function date(v: unknown): string | undefined {
  return typeof v === "string" && parseDate(v) !== undefined ? v : undefined;
}

function dateList(v: unknown, warn: Warn, what: string): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const d of v as unknown[]) {
    const ok = date(d);
    if (ok === undefined) warn("import.invalidAwayDate", `${what}: ignored invalid date`);
    else out.push(ok);
  }
  return out;
}

/** Placement history (02m 1.2): valid entries only, oldest first; an equal date keeps the later entry. */
function parsePlacementHistory(v: unknown): PlacementEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const entries: { entry: PlacementEntry; day: number; index: number }[] = [];
  (v as unknown[]).forEach((x, index) => {
    if (!isObj(x)) return;
    const on = date(x["on"]);
    const day = on === undefined ? undefined : parseDate(on);
    const placement = x["placement"];
    if (on === undefined || day === undefined) return;
    if (placement !== "indoor" && placement !== "outdoor_pot") return;
    const sheltered = placement === "outdoor_pot" && x["sheltered"] === true;
    entries.push({
      entry: { on, placement, ...(sheltered ? { sheltered: true } : {}) },
      day,
      index,
    });
  });
  entries.sort((a, b) => a.day - b.day || a.index - b.index);
  const out = entries.filter((e, i) => entries[i + 1]?.day !== e.day).map((e) => e.entry);
  return out.length === 0 ? undefined : out;
}

/** Direct-sun ranges (02m 3.2): whole hours, 0 <= from < to <= 24, sorted, merged, at most 3. [] is a real answer. */
function parseDirectSun(v: unknown): SunRange[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ranges: SunRange[] = [];
  for (const x of v as unknown[]) {
    if (!isObj(x)) continue;
    const from = x["from"];
    const to = x["to"];
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    if (from < 0 || to > 24 || from >= to) continue;
    ranges.push({ from, to });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: SunRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.from <= last.to)
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, r.to) };
    else merged.push(r);
  }
  return merged.slice(0, 3);
}

/** Parsed before migration: the space is whatever the file said, if anything. */
type RawPlant = Omit<Plant, "spaceId"> & { spaceId?: string };

function parsePlant(
  raw: unknown,
  index: number,
  warn: Warn,
  fromOlderFile: boolean,
  keepInvalid: boolean,
): RawPlant | undefined {
  if (!isObj(raw)) {
    warn("import.plantNotObject", `plant ${index + 1}: not an object, skipped`, { n: index + 1 });
    return keepInvalid ? invalidPlant(raw, index, "import.plantNotObject") : undefined;
  }
  const id = str(raw["id"]);
  const label = id ?? `plant ${index + 1}`;
  const style = STYLES.find((s) => s === raw["style"]);
  const interval = num(raw["intervalDays"]);
  if (id === undefined || style === undefined || interval === undefined || interval < 1) {
    warn("import.plantIncomplete", `${label}: needs id, style and intervalDays >= 1, skipped`, {
      label,
    });
    return keepInvalid ? invalidPlant(raw, index, "import.plantIncomplete") : undefined;
  }
  const logs: LogEntry[] = [];
  if (Array.isArray(raw["logs"])) {
    for (const l of raw["logs"] as unknown[]) {
      const d = isObj(l) ? date(l["date"]) : undefined;
      const o = isObj(l) ? OUTCOMES.find((x) => x === l["outcome"]) : undefined;
      if (d === undefined || o === undefined)
        warn("import.invalidLog", `${label}: ignored an invalid log entry`, { label });
      else {
        const mm = isObj(l) ? num(l["mm"]) : undefined;
        logs.push({
          ...(isObj(l) ? unknownKeys(l, LOG_KEYS) : {}),
          date: d,
          outcome: o,
          ...(mm !== undefined && mm >= 0 ? { mm } : {}),
        });
      }
    }
  }
  const p: { -readonly [K in keyof RawPlant]: RawPlant[K] } = {
    ...unknownKeys(raw, PLANT_KEYS),
    id,
    name: str(raw["name"]) ?? id,
    style,
    intervalDays: Math.round(interval),
    logs,
  };
  for (const k of ["lastWatered", "anchor", "notBefore"] as const) {
    const v = date(raw[k]);
    if (v !== undefined) p[k] = v;
    else if (raw[k] !== undefined)
      warn("import.invalidField", `${label}: ignored invalid ${k}`, { label, field: k });
  }
  for (const k of [
    "adjustmentDays",
    "doneStreak",
    "restFactor",
    "dryTolDays",
    "wetTolDays",
    "potDiameterCm",
    "potHeightCm",
  ] as const) {
    const v = num(raw[k]);
    if (v !== undefined) p[k] = v;
  }
  for (const k of ["species", "roomId", "source"] as const) {
    const v = str(raw[k]);
    if (v !== undefined) p[k] = v;
  }
  if (raw["reminderOnly"] === true) p.reminderOnly = true;
  const spaceId = str(raw["spaceId"]);
  if (spaceId !== undefined) p.spaceId = spaceId;
  const calibration = parseCalibration(raw["calibration"]);
  if (calibration !== undefined) p.calibration = calibration;
  const drainage = DRAINAGES.find((x) => x === raw["drainage"]);
  if (drainage !== undefined) p.drainage = drainage;
  const growthClass = GROWTH_CLASSES.find((x) => x === raw["growthClass"]);
  if (growthClass !== undefined) p.growthClass = growthClass;
  const repotted = date(raw["lastRepotted"]);
  if (repotted !== undefined) p.lastRepotted = repotted;
  const placement = PLACEMENTS.find((x) => x === raw["placement"]);
  if (placement !== undefined) p.placement = placement;
  const potMaterial = POT_MATERIALS.find((x) => x === raw["potMaterial"]);
  if (potMaterial !== undefined) p.potMaterial = potMaterial;
  const soilType = SOIL_TYPES.find((x) => x === raw["soilType"]);
  if (soilType !== undefined) p.soilType = soilType;
  const plantSize = PLANT_SIZES.find((x) => x === raw["plantSize"]);
  if (plantSize !== undefined) p.plantSize = plantSize;
  const sun = SUNS.find((x) => x === raw["sun"]);
  if (sun !== undefined) p.sun = sun;
  const groundSoil = GROUND_SOILS.find((x) => x === raw["groundSoil"]);
  if (groundSoil !== undefined) p.groundSoil = groundSoil;
  const directSun = parseDirectSun(raw["directSun"]);
  if (directSun !== undefined) p.directSun = directSun;
  const history = parsePlacementHistory(raw["placementHistory"]);
  if (history !== undefined) p.placementHistory = history;
  const draught = DRAUGHTS.find((x) => x === raw["draught"]);
  if (draught !== undefined) p.draught = draught;
  // care facts for plants outdoors; every key is optional and junk is dropped.
  if (typeof raw["mulched"] === "boolean") p.mulched = raw["mulched"];
  if (typeof raw["sheltered"] === "boolean") p.sheltered = raw["sheltered"];
  const plantedOn = date(raw["plantedOn"]);
  if (plantedOn !== undefined) p.plantedOn = plantedOn;
  const seasons = ESTABLISHMENT_SEASONS.find((x) => x === raw["establishmentSeasons"]);
  if (seasons !== undefined) p.establishmentSeasons = seasons;
  const rootDepth = ROOT_DEPTHS.find((x) => x === raw["rootDepth"]);
  if (rootDepth !== undefined) p.rootDepth = rootDepth;
  const tolerance = DROUGHT_TOLERANCES.find((x) => x === raw["droughtTolerance"]);
  if (tolerance !== undefined) p.droughtTolerance = tolerance;
  const dormancy = DORMANCIES.find((x) => x === raw["dormancy"]);
  if (dormancy !== undefined) p.dormancy = dormancy;
  const establishing = num(raw["establishingIntervalDays"]);
  if (establishing !== undefined && establishing >= 1) {
    p.establishingIntervalDays = Math.round(establishing);
  }
  if (raw["unmatched"] === true) p.unmatched = true;
  const addedOn = date(raw["addedOn"]);
  if (addedOn !== undefined) {
    p.addedOn = addedOn;
    if (raw["addedOnEstimated"] === true) p.addedOnEstimated = true;
  }
  const batch = parseBatch(raw["batch"]);
  if (batch !== undefined) p.batch = batch;
  const fieldSources = parseFieldSources(raw["fieldSources"]);
  if (fieldSources !== undefined) p.fieldSources = fieldSources;
  else if (fromOlderFile && /^catalogue\b/i.test(p.source ?? "")) {
    // Version 6 and older: the free-text source tells where the care values came from (01i section 7.3).
    p.fieldSources = {
      intervalDays: "catalogue",
      style: "catalogue",
      ...(p.species === undefined ? {} : { species: "catalogue" as const }),
    };
  }
  return p;
}

/** A plant that failed validation, kept as it was with a mark saying why (store load only). */
function invalidPlant(raw: unknown, index: number, code: string): RawPlant {
  const o: Obj = isObj(raw) ? raw : { raw };
  const id = str(o["id"]) ?? `invalid-${index + 1}`;
  return {
    ...o,
    id,
    name: str(o["name"]) ?? id,
    logs: Array.isArray(o["logs"]) ? (o["logs"] as LogEntry[]) : [],
    invalid: [code],
  } as unknown as RawPlant;
}

/** Question pacing per plant: only well-formed entries survive; an empty result is no state at all. */
function parseQuestionState(v: unknown): AppData["questionState"] {
  if (!isObj(v)) return undefined;
  const out: Record<string, PlantQuestionState> = {};
  const record = <T>(
    r: unknown,
    keep: (x: unknown) => T | undefined,
  ): Record<string, T> | undefined => {
    if (!isObj(r)) return undefined;
    const m: Record<string, T> = {};
    for (const [k, x] of Object.entries(r)) {
      const kept = keep(x);
      if (kept !== undefined) m[k] = kept;
    }
    return Object.keys(m).length === 0 ? undefined : m;
  };
  for (const [id, e] of Object.entries(v)) {
    if (!isObj(e)) continue;
    const lastAskedOn = date(e["lastAskedOn"]);
    const snoozedUntil = record(e["snoozedUntil"], date);
    const snoozes = record(e["snoozes"], (x) =>
      typeof x === "number" && Number.isInteger(x) && x > 0 ? x : undefined,
    );
    const never = record(e["never"], (x) => (x === true ? (true as const) : undefined));
    const entry: PlantQuestionState = {
      ...(lastAskedOn === undefined ? {} : { lastAskedOn }),
      ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
      ...(snoozes === undefined ? {} : { snoozes }),
      ...(never === undefined ? {} : { never }),
      ...(e["neverPlant"] === true ? { neverPlant: true } : {}),
    };
    if (Object.keys(entry).length > 0) out[id] = entry;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The "added together" group of a plant; anything malformed is dropped. */
function parseBatch(v: unknown): PlantBatch | undefined {
  if (!isObj(v)) return undefined;
  const id = str(v["id"]);
  if (id === undefined) return undefined;
  const split = Array.isArray(v["split"])
    ? (v["split"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const filled: Record<string, NonNullable<PlantBatch["filled"]>[string]> = {};
  if (isObj(v["filled"])) {
    for (const [q, e] of Object.entries(v["filled"])) {
      if (!isObj(e) || str(e["from"]) === undefined || !isObj(e["before"])) continue;
      const before = e["before"];
      const fields: Record<string, string | number | null> = {};
      if (isObj(before["fields"])) {
        for (const [k, x] of Object.entries(before["fields"])) {
          if (x === null || typeof x === "string" || typeof x === "number") fields[k] = x;
        }
      }
      const sources: Record<string, FieldSource | null> = {};
      if (isObj(before["sources"])) {
        for (const [k, x] of Object.entries(before["sources"])) {
          const src = FIELD_SOURCES.find((y) => y === x);
          if (x === null) sources[k] = null;
          else if (src !== undefined) sources[k] = src;
        }
      }
      filled[q] = { from: e["from"] as string, before: { fields, sources } };
    }
  }
  return {
    id,
    ...(split.length === 0 ? {} : { split }),
    ...(Object.keys(filled).length === 0 ? {} : { filled }),
  };
}

/** Known fields with a known source; anything else is dropped (a missing entry already reads as `user`). */
function parseFieldSources(v: unknown): Plant["fieldSources"] {
  if (!isObj(v)) return undefined;
  const out: { -readonly [F in (typeof SOURCED_FIELDS)[number]]?: FieldSource } = {};
  for (const f of SOURCED_FIELDS) {
    const src = FIELD_SOURCES.find((x) => x === v[f]);
    if (src !== undefined) out[f] = src;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function parseDrafts(
  raw: unknown,
  warn: Warn,
): (Omit<PlantDraft, "spaceId"> & { spaceId?: string })[] {
  const out: (Omit<PlantDraft, "spaceId"> & { spaceId?: string })[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? (raw as unknown[]) : []) {
    const id = isObj(r) ? str(r["id"]) : undefined;
    const savedOn = isObj(r) ? str(r["savedOn"]) : undefined;
    const f = isObj(r) ? r["fields"] : undefined;
    const fields: Record<string, string> = {};
    let ok = id !== undefined && savedOn !== undefined && isObj(f) && !seen.has(id);
    if (ok && isObj(f)) {
      for (const [k, v] of Object.entries(f)) {
        if (typeof v === "string") fields[k] = v;
        else ok = false;
      }
    }
    if (!ok || id === undefined || savedOn === undefined) {
      warn("import.badDraft", "ignored a malformed draft");
      continue;
    }
    seen.add(id);
    const plantId = isObj(r) ? str(r["plantId"]) : undefined;
    const spaceId = isObj(r) ? str(r["spaceId"]) : undefined;
    out.push({
      id,
      savedOn,
      fields,
      ...(plantId === undefined ? {} : { plantId }),
      ...(spaceId === undefined ? {} : { spaceId }),
    });
  }
  return out;
}

/** A positive factor, or a positive measured amount in ml (the amount wins when both are there). */
function parseCalibration(v: unknown): Calibration | undefined {
  if (!isObj(v)) return undefined;
  const ml = num(v["measuredMl"]);
  if (ml !== undefined && ml > 0) return { measuredMl: ml };
  const factor = num(v["factor"]);
  return factor !== undefined && factor > 0 ? { factor } : undefined;
}

function parseSpaces(raw: unknown, warn: Warn): Space[] {
  if (!Array.isArray(raw)) return [];
  const out: Space[] = [];
  const seen = new Set<string>();
  for (const r of raw as unknown[]) {
    const id = isObj(r) ? str(r["id"]) : undefined;
    if (id === undefined || seen.has(id)) {
      warn("import.badSpace", "ignored a malformed or duplicate space");
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name: (isObj(r) ? str(r["name"]) : undefined) ?? id,
      awayDates: dateList(isObj(r) ? r["awayDates"] : undefined, warn, "away days"),
    });
  }
  return out;
}

function parsePins(raw: unknown, warn: Warn): PinnedWatering[] {
  if (!Array.isArray(raw)) return [];
  const out: PinnedWatering[] = [];
  for (const p of raw as unknown[]) {
    const plantId = isObj(p) ? str(p["plantId"]) : undefined;
    const when = isObj(p) ? date(p["date"]) : undefined;
    if (plantId === undefined || when === undefined) {
      warn("import.badPin", "ignored a malformed pinned watering");
    } else out.push({ plantId, date: when });
  }
  return out;
}

const SECURES = ["tls", "starttls", "none"] as const;

/** Reminder settings, or undefined without a usable address and SMTP host. No password is ever read. */
function parseReminders(raw: unknown): ReminderSettings | undefined {
  if (!isObj(raw)) return undefined;
  const email = str(raw["email"]);
  const smtp = raw["smtp"];
  const host = isObj(smtp) ? str(smtp["host"]) : undefined;
  if (email === undefined || !isObj(smtp) || host === undefined) return undefined;
  const t = raw["time"];
  const time =
    typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : DEFAULT_REMINDER_TIME;
  const port = num(smtp["port"]);
  const user = str(smtp["user"]);
  const from = str(smtp["from"]);
  const secure = SECURES.find((x) => x === smtp["secure"]);
  return {
    enabled: raw["enabled"] === true,
    time,
    email,
    smtp: {
      host,
      ...(port !== undefined && Number.isInteger(port) && port > 0 && port < 65536 ? { port } : {}),
      ...(user === undefined ? {} : { user }),
      ...(secure === undefined ? {} : { secure }),
      ...(from === undefined ? {} : { from }),
    },
  };
}

/** The weather block: the switch must be a boolean; a point needs both numbers in range and is rounded to 2 decimals. */
function parseWeather(raw: unknown): WeatherSettings | undefined {
  if (!isObj(raw) || typeof raw["enabled"] !== "boolean") return undefined;
  return weatherSettings(raw["enabled"], num(raw["lat"]), num(raw["lon"]));
}

function parseSettings(raw: unknown, warn: Warn): Settings {
  const base = emptyData().settings;
  if (!isObj(raw)) return base;
  const prefsRaw = isObj(raw["prefs"]) ? raw["prefs"] : {};
  const weekdays = (v: unknown): number[] =>
    Array.isArray(v)
      ? (v as unknown[]).filter(
          (x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 6,
        )
      : [];
  const horizon = num(raw["horizonDays"]);
  const locale = str(raw["locale"]);
  const weekStart = num(raw["weekStart"]);
  const measure = MEASURES.find((x) => x === raw["measure"]);
  const amountMode = AMOUNT_MODES.find((x) => x === raw["amountMode"]);
  const wording = WORDINGS.find((x) => x === raw["wording"]);
  const questions =
    raw["questions"] === "off" ? "off" : raw["questions"] === "on" ? "on" : undefined;
  const globalCalibration = parseCalibration(raw["calibration"]);
  const reminders = parseReminders(raw["reminders"]);
  const weather = parseWeather(raw["weather"]);
  const rawLatitude = num(raw["latitude"]);
  const latitude =
    rawLatitude !== undefined && Math.abs(rawLatitude) <= 90 ? Math.abs(rawLatitude) : undefined;
  const country = COUNTRIES.find((c) => c === raw["country"]);
  const climate = CLIMATES.find((c) => c === raw["climate"]);
  const winterMin = WINTER_MINS.find((c) => c === raw["winterMin"]);
  const hh = raw["household"];
  const pets =
    isObj(hh) && Array.isArray(hh["pets"])
      ? PETS.filter((p) => (hh["pets"] as unknown[]).includes(p))
      : [];
  const household: Household | undefined = isObj(hh)
    ? { pets, ...(hh["children"] === true ? { children: true } : {}) }
    : undefined;
  return {
    ...unknownKeys(raw, SETTINGS_KEYS),
    hemisphere: raw["hemisphere"] === "south" ? "south" : "north",
    horizonDays: horizon !== undefined && horizon >= 1 ? Math.round(horizon) : base.horizonDays,
    ...(latitude === undefined ? {} : { latitude }),
    ...(country === undefined ? {} : { country }),
    ...(climate === undefined ? {} : { climate }),
    ...(winterMin === undefined ? {} : { winterMin }),
    ...(locale === undefined ? {} : { locale }),
    ...(measure === undefined ? {} : { measure }),
    ...(amountMode === undefined ? {} : { amountMode }),
    ...(wording === undefined ? {} : { wording }),
    ...(household === undefined ? {} : { household }),
    ...(globalCalibration === undefined ? {} : { calibration: globalCalibration }),
    ...(reminders === undefined ? {} : { reminders }),
    ...(weather === undefined ? {} : { weather }),
    ...(questions === undefined ? {} : { questions }),
    ...(weekStart !== undefined && Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6
      ? { weekStart }
      : {}),
    prefs: {
      preferredWeekdays: weekdays(prefsRaw["preferredWeekdays"]),
      unavailableWeekdays: weekdays(prefsRaw["unavailableWeekdays"]),
      unavailableDates: dateList(prefsRaw["unavailableDates"], warn, "away days"),
      preLeaveWatering: prefsRaw["preLeaveWatering"] !== false,
    },
  };
}

/** Parses an export. Never throws: a broken file gives empty data and a warning. */
export function importData(text: string, options: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const issues: ImportIssue[] = [];
  const warn: Warn = (code, text, params = {}) => {
    warnings.push(text);
    issues.push({ code, params });
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    warn("import.notJson", "not valid JSON, nothing imported");
    return { data: emptyData(), warnings, issues };
  }
  if (!isObj(raw) || raw["format"] !== FORMAT) {
    warn("import.notExport", `not a ${FORMAT} file, nothing imported`, { format: FORMAT });
    return { data: emptyData(), warnings, issues };
  }
  const version = num(raw["version"]);
  if (version === undefined || version > VERSION) {
    warn(
      "import.newerVersion",
      `file version ${String(raw["version"])} is newer than ${VERSION}; reading what is known`,
      { version: String(raw["version"]), supported: VERSION },
    );
  }
  const plants: RawPlant[] = [];
  const seen = new Set<string>();
  const list: unknown[] = Array.isArray(raw["plants"]) ? raw["plants"] : [];
  const keepInvalid = options.keepInvalid === true;
  list.forEach((r, i) => {
    const p = parsePlant(r, i, warn, version !== undefined && version < 7, keepInvalid);
    if (p === undefined) return;
    if (seen.has(p.id)) {
      warn("import.duplicateId", `${p.id}: duplicate id, skipped`, { id: p.id });
      if (keepInvalid) {
        let n = 2;
        while (seen.has(`${p.id}~${n}`)) n++;
        const id = `${p.id}~${n}`;
        seen.add(id);
        plants.push({ ...p, id, invalid: ["import.duplicateId"] });
      }
    } else {
      seen.add(p.id);
      plants.push(p);
    }
  });
  const rooms: (Omit<Room, "spaceId"> & { spaceId?: string })[] = [];
  const roomList: unknown[] = Array.isArray(raw["rooms"]) ? raw["rooms"] : [];
  for (const r of roomList) {
    const id = isObj(r) ? str(r["id"]) : undefined;
    if (isObj(r) && id !== undefined) {
      const light = LIGHTS.find((x) => x === r["light"]);
      const spaceId = str(r["spaceId"]);
      const calibration = parseCalibration(r["calibration"]);
      const haAreaId = str(r["haAreaId"]);
      const directSun = parseDirectSun(r["directSun"]);
      rooms.push({
        ...unknownKeys(r, ROOM_KEYS),
        id,
        name: str(r["name"]) ?? id,
        ...(light === undefined ? {} : { light }),
        ...(spaceId === undefined ? {} : { spaceId }),
        ...(calibration === undefined ? {} : { calibration }),
        ...(haAreaId === undefined ? {} : { haAreaId }),
        ...(directSun === undefined ? {} : { directSun }),
      });
    } else warn("import.roomNoId", "ignored a room without id");
  }
  const drafts = parseDrafts(raw["drafts"], warn);
  const pins = parsePins(raw["pins"], warn);
  const questionState = parseQuestionState(raw["questionState"]);
  const spaces = parseSpaces(raw["spaces"], warn);
  const known = new Set(spaces.map((x) => x.id));
  for (const item of [...plants, ...rooms, ...drafts]) {
    if (item.spaceId !== undefined && !known.has(item.spaceId)) {
      warn(
        "import.unknownSpace",
        `${item.id}: unknown space ${item.spaceId}, moved to the first space`,
        {
          id: item.id,
          space: item.spaceId,
        },
      );
    }
  }
  return {
    ...(version === undefined ? {} : { version }),
    data: migrate(
      {
        ...unknownKeys(raw, TOP_KEYS),
        ...(spaces.length === 0 ? {} : { spaces }),
        plants,
        rooms,
        ...(drafts.length === 0 ? {} : { drafts }),
        ...(pins.length === 0 ? {} : { pins }),
        ...(questionState === undefined ? {} : { questionState }),
        settings: parseSettings(raw["settings"], warn),
      },
      version,
    ),
    warnings,
    issues,
  };
}
