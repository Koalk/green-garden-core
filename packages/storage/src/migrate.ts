// SPDX-License-Identifier: AGPL-3.0-only

import { DEFAULT_SPACE_ID, type AppData, type Plant, type Room, type Space } from "./model.ts";
import { ZERO_STAMP } from "./sync/clock.ts";
import { derivedId, newId } from "./sync/ids.ts";

/**
 * A plant without `addedOn` gets the earliest day its own history shows (first log, else last watered),
 * marked estimated so the edit form says "about". A plant with no history stays without one.
 */
function withAddedOn(p: Plant): Plant {
  if (p.addedOn !== undefined) return p;
  const days = [
    ...(p.logs ?? []).map((l) => l.date),
    ...(p.lastWatered === undefined ? [] : [p.lastWatered]),
  ];
  const first = days.sort()[0];
  return first === undefined ? p : { ...p, addedOn: first, addedOnEstimated: true };
}

/** Plant keys that carry no stamp of their own: the ID, the stamp map itself, the logs (events with their own stamps), placement history (events) and the checkpoint. */
const UNSTAMPED_PLANT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "stamps",
  "logs",
  "invalid",
  "placementHistory",
  "checkpoint",
]);
const UNSTAMPED_ROOM_KEYS: ReadonlySet<string> = new Set(["id", "stamps"]);

/** Gives every field present without a stamp stamp 0 (older than anything, so any real edit wins). */
function withZeroStamps<T extends object & { readonly stamps?: { readonly [f: string]: string } }>(
  record: T,
  skip: ReadonlySet<string>,
): T {
  const stamps: Record<string, string> = { ...record.stamps };
  let changed = false;
  for (const k of Object.keys(record)) {
    if (skip.has(k) || k in stamps) continue;
    stamps[k] = ZERO_STAMP;
    changed = true;
  }
  return changed ? { ...record, stamps } : record;
}

/**
 * Log entries get an ID (derived from plant, date, outcome and position, so two devices that migrate the
 * same file agree) and a stamp 0 when they have none. `by` stays out: nobody made them yet.
 */
function withLogIds(p: Plant): Plant {
  const logs = p.logs ?? [];
  if (logs.every((l) => l.id !== undefined && l.at !== undefined)) return p;
  return {
    ...p,
    logs: logs.map((l, i) => ({
      ...l,
      id: l.id ?? derivedId(p.id, l.date, l.outcome, i),
      at: l.at ?? ZERO_STAMP,
    })),
  };
}

/** Away days get stamp 0 each, so removing one later can win over it. */
function withAwayStamps(s: Space): Space {
  const stamps: Record<string, string> = { ...s.awayStamps };
  let changed = false;
  for (const d of s.awayDates) {
    if (!(d in stamps)) {
      stamps[d] = ZERO_STAMP;
      changed = true;
    }
  }
  return changed ? { ...s, awayStamps: stamps } : s;
}

/**
 * Steps by the format version they bring a file up to. A step runs on a file older than its `to`;
 * with no version given (state that did not come from a file) every step runs, so each must be idempotent.
 * The version-independent shape fixes (spaces) stay in `migrate` itself.
 */
const STEPS: readonly {
  readonly to: number;
  readonly plant?: (p: Plant) => Plant;
  readonly room?: (r: Room) => Room;
  readonly space?: (s: Space) => Space;
}[] = [
  // 9: addedOn arrived while the format still said 8, so a version 8 file may lack it.
  { to: 9, plant: withAddedOn },
  // 11: stamps on fields and away days, stamp 0 for everything that existed before sync.
  {
    to: 11,
    plant: (p) => (p.invalid === undefined ? withZeroStamps(p, UNSTAMPED_PLANT_KEYS) : p),
    room: (r) => withZeroStamps(r, UNSTAMPED_ROOM_KEYS),
    space: withAwayStamps,
  },
];

/**
 * Brings older state up to the current shape: a default space exists, it holds the away days that
 * used to live in the preferences, and every plant, room and draft names a space. Idempotent. Anything
 * pointing at a space that does not exist moves to the first space. Every state also gets log entry
 * IDs and a `sync` block with this device's ID (minted once, never replaced).
 */
export function migrate(
  data: Omit<AppData, "spaces" | "plants" | "rooms" | "drafts"> & {
    readonly spaces?: readonly Space[];
    readonly plants: readonly (Omit<AppData["plants"][number], "spaceId"> & { spaceId?: string })[];
    readonly rooms: readonly (Omit<AppData["rooms"][number], "spaceId"> & { spaceId?: string })[];
    readonly drafts?: readonly (Omit<NonNullable<AppData["drafts"]>[number], "spaceId"> & {
      spaceId?: string;
    })[];
  },
  fromVersion?: number,
): AppData {
  const steps = STEPS.filter((s) => fromVersion === undefined || fromVersion < s.to);
  const upgrade = (p: Plant): Plant => steps.reduce((acc, s) => s.plant?.(acc) ?? acc, p);
  const upgradeRoom = (r: Room): Room => steps.reduce((acc, s) => s.room?.(acc) ?? acc, r);
  const upgradeSpace = (sp: Space): Space => steps.reduce((acc, s) => s.space?.(acc) ?? acc, sp);
  const legacyAway = data.settings.prefs.unavailableDates;
  const spaces: readonly Space[] = (
    data.spaces !== undefined && data.spaces.length > 0
      ? data.spaces
      : [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: legacyAway ?? [] }]
  ).map(upgradeSpace);
  const known = new Set(spaces.map((s) => s.id));
  const first = spaces[0]?.id ?? DEFAULT_SPACE_ID;
  const home = (id: string | undefined): string => (id !== undefined && known.has(id) ? id : first);
  const prefs = Object.fromEntries(
    Object.entries(data.settings.prefs).filter(([k]) => k !== "unavailableDates"),
  ) as AppData["settings"]["prefs"];
  return {
    ...(data as object),
    spaces,
    plants: data.plants.map((p) => withLogIds(upgrade({ ...p, spaceId: home(p.spaceId) }))),
    rooms: data.rooms.map((r) => upgradeRoom({ ...r, spaceId: home(r.spaceId) })),
    ...(data.drafts === undefined
      ? {}
      : { drafts: data.drafts.map((d) => ({ ...d, spaceId: home(d.spaceId) })) }),
    ...(data.pins === undefined ? {} : { pins: data.pins }),
    ...(data.questionState === undefined ? {} : { questionState: data.questionState }),
    ...(data.seasonal === undefined ? {} : { seasonal: data.seasonal }),
    settings: { ...data.settings, prefs },
    sync: data.sync ?? { device: newId(), stamp: ZERO_STAMP },
  };
}
