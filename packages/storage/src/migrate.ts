// SPDX-License-Identifier: AGPL-3.0-only

import { DEFAULT_SPACE_ID, type AppData, type Plant, type Space } from "./model.ts";

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

/**
 * Steps by the format version they bring a file up to. A step runs on a file older than its `to`;
 * with no version given (state that did not come from a file) every step runs, so each must be idempotent.
 * The version-independent shape fixes (spaces) stay in `migrate` itself.
 */
const STEPS: readonly { readonly to: number; readonly plant?: (p: Plant) => Plant }[] = [
  // 9: addedOn arrived while the format still said 8, so a version 8 file may lack it.
  { to: 9, plant: withAddedOn },
];

/**
 * Brings older state up to the current shape: a default space exists, it holds the away days that
 * used to live in the preferences, and every plant, room and draft names a space. Idempotent. Anything
 * pointing at a space that does not exist moves to the first space.
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
  const legacyAway = data.settings.prefs.unavailableDates;
  const spaces: readonly Space[] =
    data.spaces !== undefined && data.spaces.length > 0
      ? data.spaces
      : [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: legacyAway ?? [] }];
  const known = new Set(spaces.map((s) => s.id));
  const first = spaces[0]?.id ?? DEFAULT_SPACE_ID;
  const home = (id: string | undefined): string => (id !== undefined && known.has(id) ? id : first);
  const prefs = Object.fromEntries(
    Object.entries(data.settings.prefs).filter(([k]) => k !== "unavailableDates"),
  ) as AppData["settings"]["prefs"];
  return {
    ...(data as object),
    spaces,
    plants: data.plants.map((p) => upgrade({ ...p, spaceId: home(p.spaceId) })),
    rooms: data.rooms.map((r) => ({ ...r, spaceId: home(r.spaceId) })),
    ...(data.drafts === undefined
      ? {}
      : { drafts: data.drafts.map((d) => ({ ...d, spaceId: home(d.spaceId) })) }),
    ...(data.pins === undefined ? {} : { pins: data.pins }),
    ...(data.questionState === undefined ? {} : { questionState: data.questionState }),
    settings: { ...data.settings, prefs },
  };
}
