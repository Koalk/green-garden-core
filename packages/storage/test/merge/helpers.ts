// SPDX-License-Identifier: AGPL-3.0-only

import { formatStamp, type AppData } from "../../src/index.ts";

export const DEV_A = "aaaaaaaaaaaaaaaa";
export const DEV_B = "bbbbbbbbbbbbbbbb";
export const DEV_C = "cccccccccccccccc";

type Loose = Record<string, unknown>;

/** A stamp at wall time `wall` (ms), counter `n`, on `device`. */
export const st = (wall: number, device: string = DEV_A, n = 0): string =>
  formatStamp({ wall, counter: n, device });

export interface DocOptions {
  readonly device: string;
  readonly me: number;
  readonly stamp?: string;
  readonly plants?: readonly Loose[];
  readonly rooms?: readonly Loose[];
  readonly spaces?: readonly Loose[];
  readonly seen?: Record<string, string>;
  readonly tombstones?: Record<string, string>;
  readonly seasonal?: Loose;
  readonly household?: string;
}

/** A small format 11 document for one device of a two or three member household. */
export function doc(o: DocOptions): AppData {
  return {
    spaces: o.spaces ?? [{ id: "space1", name: "Home", awayDates: [] }],
    plants: o.plants ?? [],
    rooms: o.rooms ?? [],
    ...(o.seasonal === undefined ? {} : { seasonal: o.seasonal }),
    settings: { hemisphere: "north" },
    sync: {
      device: o.device,
      stamp: o.stamp ?? st(1),
      household: { id: o.household ?? "0123456789abcdef", key: "k" },
      members: [
        { index: 0, name: "Ana", personal: {} },
        { index: 1, name: "Ben", personal: {} },
        { index: 2, name: "Cy", personal: {} },
      ],
      me: o.me,
      ...(o.seen === undefined ? {} : { seen: o.seen }),
      ...(o.tombstones === undefined ? {} : { tombstones: o.tombstones }),
    },
  } as unknown as AppData;
}

export function plant(id: string, extra: Loose = {}): Loose {
  return {
    id,
    name: id,
    style: "keep_moist",
    intervalDays: 4,
    spaceId: "space1",
    logs: [],
    ...extra,
  };
}

export function log(id: string, date: string, at: string, outcome = "done", by = 0): Loose {
  return { id, date, outcome, by, at };
}

/** The document as a household sees it: without this device's own identity. */
export function shared(d: AppData): unknown {
  const copy = JSON.parse(JSON.stringify(d)) as Loose;
  const sync = copy["sync"] as Loose;
  delete sync["device"];
  delete sync["me"];
  return copy;
}

export const plantOf = (d: AppData, id: string): Loose =>
  (d.plants as unknown as Loose[]).find((p) => p["id"] === id) as Loose;
