// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Recording what happened to a plant, shared by the web UI and the Home Assistant bridge so a
 * tap on a wall display follows the same rules as a tap in the app.
 */
import { formatDate, parseDate, type LogOutcome, type PinnedWatering } from "@green-garden/engine";
import { makePlan } from "./calendar.ts";
import type { AppData, Plant } from "./model.ts";

/** Sets the pins, leaving the field out when there are none. */
export function withPins(data: AppData, pins: readonly PinnedWatering[]): AppData {
  const rest = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "pins")) as AppData;
  return pins.length === 0 ? rest : { ...rest, pins };
}

const samePins = (a: readonly PinnedWatering[], b: readonly PinnedWatering[]): boolean =>
  a.length === b.length && a.every((p, i) => JSON.stringify(p) === JSON.stringify(b[i]));

/**
 * Pins the pre-leave waterings the plan shows now, so logging another plant does not
 * move them. Pins the engine no longer honours drop out. Returns `data` itself when nothing changes.
 */
export function pinPreLeave(data: AppData, today: string): AppData {
  const shown = makePlan(data, today)
    .plants.flatMap((p) =>
      p.waterings
        .filter((w) => w.reason === "pre_leave" && w.date >= today)
        .map((w) => ({ plantId: p.plantId, date: w.date })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.plantId < b.plantId ? -1 : 1));
  return samePins(data.pins ?? [], shown) ? data : withPins(data, shown);
}

/**
 * Records one outcome for one plant on `date`. The engine derives the new plan from the logs. `mm` is
 * the rain amount for the `rain` outcome.
 */
export function logOutcome(
  data: AppData,
  plantId: string,
  outcome: LogOutcome,
  date: string,
  mm?: number,
): AppData {
  const pinned = pinPreLeave(data, date);
  return {
    ...pinned,
    plants: pinned.plants.map((p) =>
      p.id === plantId
        ? {
            ...p,
            logs: [...(p.logs ?? []), { date, outcome, ...(mm === undefined ? {} : { mm }) }],
          }
        : p,
    ),
  };
}

/**
 * The dates "Watered it earlier?" offers: the day after the plant's last watering (its latest `done`
 * log or `lastWatered`; skips, still-wet and dry-early logs do not water) up to today, never the future.
 * A plant never watered gets a year back. `undefined` when it was watered today: nothing to backdate.
 */
export function earlierWateringRange(
  plant: Plant,
  today: string,
): { readonly min: string; readonly max: string } | undefined {
  const t = parseDate(today);
  if (t === undefined) return undefined;
  const dates = [
    ...(plant.logs ?? []).filter((l) => l.outcome === "done").map((l) => l.date),
    ...(plant.lastWatered === undefined ? [] : [plant.lastWatered]),
  ]
    .map(parseDate)
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const min = dates.length === 0 ? t - 365 : Math.max(...dates) + 1;
  return min > t ? undefined : { min: formatDate(min), max: today };
}

/**
 * Logs a `done` on an earlier day. The engine replays logs in date order, so the schedule counts from that
 * date. `undefined` for a date outside `earlierWateringRange`, a malformed date or an unknown plant.
 */
export function logWateredEarlier(
  data: AppData,
  plantId: string,
  date: string,
  today: string,
): AppData | undefined {
  const plant = data.plants.find((p) => p.id === plantId);
  const range = plant === undefined ? undefined : earlierWateringRange(plant, today);
  if (range === undefined || parseDate(date) === undefined) return undefined;
  if (date < range.min || date > range.max) return undefined;
  return logOutcome(data, plantId, "done", date);
}
