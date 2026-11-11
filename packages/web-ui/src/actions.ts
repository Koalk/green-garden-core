// SPDX-License-Identifier: AGPL-3.0-only

/** Pure edits of the app data: every function returns a new `AppData`, nothing is mutated. */
import { formatDate, parseDate } from "@green-garden/engine";
import type { Calibration } from "@green-garden/engine";
import {
  COUNTRIES,
  activeSpaceId,
  logOutcome,
  withPins,
  type AppData,
  type Plant,
  type Room,
  type Settings,
} from "@green-garden/storage";

// The logging rules live in storage so the Home Assistant bridge shares them.
export { logOutcome, pinPreLeave } from "@green-garden/storage";
import { nextId } from "@green-garden/bulk";
import { canLogRain } from "./outdoor.ts";
export { nextId };

/** Longest away range the form accepts (PROVISIONAL: guards against a typo in the year). */
export const MAX_AWAY_DAYS = 120;

/** A new plant goes into the active space (the one the UI shows). */
export function addPlant(
  data: AppData,
  plant: Omit<Plant, "id" | "spaceId">,
  today?: string,
): AppData {
  const id = nextId(
    data.plants.map((p) => p.id),
    "p",
  );
  const addedOn = plant.addedOn ?? today;
  return {
    ...data,
    plants: [
      ...data.plants,
      { ...plant, ...(addedOn === undefined ? {} : { addedOn }), id, spaceId: activeSpaceId(data) },
    ],
  };
}

/** Replaces a plant; it stays in the space it was in. */
export function updatePlant(
  data: AppData,
  plant: Omit<Plant, "spaceId"> & { spaceId?: string },
): AppData {
  return {
    ...data,
    plants: data.plants.map((p) =>
      p.id === plant.id ? { ...plant, spaceId: plant.spaceId ?? p.spaceId } : p,
    ),
  };
}

export function deletePlant(data: AppData, id: string): AppData {
  const { questionState, ...others } = data;
  const kept = Object.fromEntries(Object.entries(questionState ?? {}).filter(([k]) => k !== id));
  const base: AppData =
    Object.keys(kept).length === 0 ? others : { ...others, questionState: kept };
  return withPins(
    { ...base, plants: data.plants.filter((p) => p.id !== id) },
    (data.pins ?? []).filter((p) => p.plantId !== id),
  );
}

export function addRoom(data: AppData, name: string): AppData {
  const clean = name.trim();
  if (clean === "") return data;
  const id = nextId(
    data.rooms.map((r) => r.id),
    "r",
  );
  const room: Room = { id, name: clean, spaceId: activeSpaceId(data) };
  return { ...data, rooms: [...data.rooms, room] };
}

/** Deleting a room keeps its plants; they just lose the room. */
export function deleteRoom(data: AppData, id: string): AppData {
  const plants = data.plants.map((p) => {
    if (p.roomId !== id) return p;
    return Object.fromEntries(Object.entries(p).filter(([k]) => k !== "roomId")) as Plant;
  });
  return { ...data, rooms: data.rooms.filter((r) => r.id !== id), plants };
}

/**
 * "It rained": logs `mm` of rain on `date` for every listed plant that rain reaches (outdoors, not
 * sheltered). Indoor and sheltered plants are left alone.
 */
export function logRain(
  data: AppData,
  plantIds: readonly string[],
  mm: number,
  date: string,
): AppData {
  const reached = new Set(data.plants.filter(canLogRain).map((p) => p.id));
  return plantIds.reduce(
    (acc, id) => (reached.has(id) ? logOutcome(acc, id, "rain", date, mm) : acc),
    data,
  );
}

/** "Water all": logs done for every plant listed (the ones due today and not yet snoozed or skipped). */
export function waterAll(data: AppData, plantIds: readonly string[], date: string): AppData {
  return plantIds.reduce((acc, id) => logOutcome(acc, id, "done", date), data);
}

/**
 * "Can't water today": today becomes an away day for this plan, so the engine replans around it.
 * Undo by removing the date in Holidays. A date that is already away is left alone.
 */
export function cantWaterToday(data: AppData, date: string): AppData {
  return addAwayRange(data, date, date) ?? data;
}

function withPrefs(data: AppData, prefs: Settings["prefs"]): AppData {
  return { ...data, settings: { ...data.settings, prefs } };
}

/** Away days belong to a space; these edit the active one. */
function withAwayDates(data: AppData, dates: readonly string[]): AppData {
  const active = activeSpaceId(data);
  return {
    ...data,
    spaces: data.spaces.map((sp) => (sp.id === active ? { ...sp, awayDates: dates } : sp)),
  };
}

const activeAwayDates = (data: AppData): readonly string[] =>
  data.spaces.find((sp) => sp.id === activeSpaceId(data))?.awayDates ?? [];

/** Adds every date from `from` to `to` (inclusive) to the away days. Returns undefined if invalid. */
export function addAwayRange(data: AppData, from: string, to: string): AppData | undefined {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === undefined || b === undefined || b < a || b - a + 1 > MAX_AWAY_DAYS) return undefined;
  const dates = new Set(activeAwayDates(data));
  for (let d = a; d <= b; d += 1) dates.add(formatDate(d));
  return withAwayDates(data, [...dates].sort());
}

export function removeAwayDate(data: AppData, date: string): AppData {
  return withAwayDates(
    data,
    activeAwayDates(data).filter((d) => d !== date),
  );
}

export function setPrefs(data: AppData, prefs: Partial<Settings["prefs"]>): AppData {
  return withPrefs(data, { ...data.settings.prefs, ...prefs });
}

export function setSettings(
  data: AppData,
  s: Partial<Pick<Settings, "hemisphere" | "horizonDays">>,
): AppData {
  return { ...data, settings: { ...data.settings, ...s } };
}

/** The home country: UK or Spain stands for a typical latitude; "auto", undefined or anything else clears it. */
export function setHome(data: AppData, country: string | undefined): AppData {
  const rest: Record<string, unknown> = { ...data.settings };
  delete rest["country"];
  const known = COUNTRIES.find((c) => c === country);
  return {
    ...data,
    settings: {
      ...(rest as unknown as AppData["settings"]),
      ...(known === undefined ? {} : { country: known }),
    },
  };
}

/** Language settings; an `undefined` value clears the setting (follow the device / the language). */
export function setLanguage(
  data: AppData,
  s: { readonly locale?: string | undefined; readonly weekStart?: number | undefined },
): AppData {
  const rest: Record<string, unknown> = { ...data.settings };
  delete rest["locale"];
  delete rest["weekStart"];
  return {
    ...data,
    settings: {
      ...(rest as unknown as AppData["settings"]),
      ...(s.locale === undefined || s.locale === "auto" ? {} : { locale: s.locale }),
      ...(s.weekStart === undefined ? {} : { weekStart: s.weekStart }),
    },
  };
}

export interface DisplayChoices {
  readonly measure: NonNullable<Settings["measure"]>;
  readonly amountMode: NonNullable<Settings["amountMode"]>;
  readonly wording: NonNullable<Settings["wording"]>;
  readonly pets: readonly ("cat" | "dog" | "small_pet")[];
  readonly children: boolean;
}

/** How amounts are shown and who lives with the plants. Defaults and an empty household are not stored. */
export function setDisplay(data: AppData, c: DisplayChoices): AppData {
  const dropped = new Set(["measure", "amountMode", "wording", "household"]);
  const rest = Object.fromEntries(Object.entries(data.settings).filter(([k]) => !dropped.has(k)));
  return {
    ...data,
    settings: {
      ...(rest as unknown as Settings),
      ...(c.measure === "mug" ? {} : { measure: c.measure }),
      ...(c.amountMode === "qualitative" ? {} : { amountMode: c.amountMode }),
      ...(c.wording === "uk" ? {} : { wording: c.wording }),
      ...(c.pets.length === 0 && !c.children
        ? {}
        : { household: { pets: c.pets, ...(c.children ? { children: true } : {}) } }),
    },
  };
}

/** Qualitative light of one room (D-04); `undefined` clears it. An unknown room id changes nothing. */
export function setRoomLight(
  data: AppData,
  roomId: string,
  light: Room["light"] | undefined,
): AppData {
  if (!data.rooms.some((r) => r.id === roomId)) return data;
  return {
    ...data,
    rooms: data.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const rest = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "light")) as Room;
      return light === undefined ? rest : { ...rest, light };
    }),
  };
}

export type CalibrationTarget =
  | { readonly kind: "global" }
  | { readonly kind: "room"; readonly id: string }
  | { readonly kind: "plant"; readonly id: string };

const without = <T extends object>(o: T, key: string): T =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as T;

/** Sets (or, with `undefined`, resets) the calibration at one level. An unknown id changes nothing. */
export function setCalibration(
  data: AppData,
  target: CalibrationTarget,
  cal: Calibration | undefined,
): AppData {
  const put = <T extends object>(o: T): T =>
    cal === undefined ? without(o, "calibration") : { ...o, calibration: cal };
  if (target.kind === "global") return { ...data, settings: put(data.settings) };
  if (target.kind === "room") {
    if (!data.rooms.some((r) => r.id === target.id)) return data;
    return { ...data, rooms: data.rooms.map((r) => (r.id === target.id ? put(r) : r)) };
  }
  if (!data.plants.some((p) => p.id === target.id)) return data;
  return { ...data, plants: data.plants.map((p) => (p.id === target.id ? put(p) : p)) };
}
