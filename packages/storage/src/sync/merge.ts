// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Merging two copies of a household's garden (format 11). Pure: no I/O, no clock, no randomness. The
 * result does not depend on which copy is "local" or on the order copies arrive in (apart from this
 * device's own identity in `sync`), and merging a copy twice changes nothing.
 *
 * What merges how:
 * - events (log entries, placement moves, seasonal choices, away days) by union; an Undo is a
 *   tombstone on the entry's `id`;
 * - plant and room fields by last writer wins per field, the later stamp winning and the canonical
 *   text of the value breaking an exact tie;
 * - removals are records kept with `deleted` set; a watering stamped later than the removal restores it;
 * - checkpoints: the later cutoff wins, and entries before it are dropped.
 *
 * Records are handled as loose objects inside this file so keys this build does not know are carried.
 */

import type { AppData, Plant, Room, Space, SyncBlock, SyncMember } from "../model.ts";
import { ZERO_STAMP, compareStamps, createClock, parseStamp } from "./clock.ts";
import { CHECKPOINT_CUTOFF_DAYS, TOMBSTONE_KEEP_DAYS } from "./constants.ts";
import { derivedId } from "./ids.ts";

export { CHECKPOINT_CUTOFF_DAYS, TOMBSTONE_KEEP_DAYS };

type Rec = { [key: string]: unknown };
type StampMap = { [key: string]: string };

/** The same field changed on both copies since each last saw the other. The later stamp already won. */
export interface Conflict {
  readonly kind: "plant" | "room";
  readonly id: string;
  readonly field: string;
  /** The local copy's value; `undefined` means the field was cleared. */
  readonly mine: unknown;
  readonly theirs: unknown;
  readonly mineStamp: string;
  readonly theirsStamp: string;
}

/** A record that lost an ID collision was given a new ID. Both devices work out the same one. */
export interface Remap {
  readonly kind: "plant" | "room";
  readonly from: string;
  readonly to: string;
}

export interface MergeResult {
  readonly doc: AppData;
  readonly conflicts: readonly Conflict[];
  readonly remaps: readonly Remap[];
  /** Set when nothing was merged: the incoming copy belongs to another household. */
  readonly ignored?: "other-household";
}

export interface MergeOptions {
  /** Wall time in ms. Without it no old removal records are dropped. */
  readonly now?: number;
}

const DAY_MS = 86_400_000;
/** A record with no recorded creator sorts after every real member index. */
const NO_CREATOR = 32;

// ---------- small helpers ----------

/** Text for a value that is the same for equal values, whatever the key order. */
function canonical(v: unknown): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x)).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Rec;
    const body = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(v);
}

/** A string field of a loose record; anything else reads as empty. */
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const cmpText = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
const byCanonical = (a: unknown, b: unknown): number => cmpText(canonical(a), canonical(b));
const maxStamp = (a: string, b: string): string => (compareStamps(a, b) >= 0 ? a : b);
const stampsOf = (r: Rec | undefined): StampMap => (r?.["stamps"] as StampMap | undefined) ?? {};
const sortKeys = <T>(o: { [k: string]: T }): { [k: string]: T } =>
  Object.fromEntries(Object.entries(o).sort(([x], [y]) => cmpText(x, y)));

/** Merges two key-to-stamp maps, the later stamp per key. */
function maxMap(a: StampMap | undefined, b: StampMap | undefined): StampMap {
  const out: StampMap = {};
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src ?? {}))
      out[k] = out[k] === undefined ? v : maxStamp(out[k], v);
  }
  return sortKeys(out);
}

// ---------- ID collisions ----------

/** Who keeps an ID: the lower creator member index, then the lower creation stamp. */
function creatorOrder(r: Rec): [number, string] {
  const by = r["createdBy"];
  return [typeof by === "number" ? by : NO_CREATOR, stampsOf(r)["created"] ?? ZERO_STAMP];
}

function loses(r: Rec, other: Rec): boolean {
  const [ia, sa] = creatorOrder(r);
  const [ib, sb] = creatorOrder(other);
  return ia !== ib ? ia > ib : compareStamps(sa, sb) > 0;
}

/** Two records with one ID that were created apart: both carry a creation stamp and the stamps differ. */
function collides(a: Rec, b: Rec): boolean {
  const ca = stampsOf(a)["created"];
  const cb = stampsOf(b)["created"];
  return ca !== undefined && cb !== undefined && ca !== cb;
}

/** Gives the records of `doc` that lost a collision a new ID, and follows the references to them. */
function renamed(doc: AppData, plants: Map<string, string>, rooms: Map<string, string>): AppData {
  if (plants.size === 0 && rooms.size === 0) return doc;
  const rekey = (m: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [plants.get(k) ?? k, v]));
  const seasonal = doc.seasonal;
  return {
    ...doc,
    plants: doc.plants.map((p) => {
      const next: Rec = { ...(p as unknown as Rec), id: plants.get(p.id) ?? p.id };
      if (p.roomId !== undefined) next["roomId"] = rooms.get(p.roomId) ?? p.roomId;
      return next as unknown as Plant;
    }),
    rooms: doc.rooms.map((r) => ({ ...r, id: rooms.get(r.id) ?? r.id })),
    ...(seasonal === undefined
      ? {}
      : {
          seasonal: {
            ...(seasonal.snoozedUntil ? { snoozedUntil: rekey(seasonal.snoozedUntil) } : {}),
            ...(seasonal.leftOutUntil ? { leftOutUntil: rekey(seasonal.leftOutUntil) } : {}),
          },
        }),
  };
}

function resolveCollisions(local: AppData, incoming: AppData) {
  const remaps: Remap[] = [];
  const mine = { plants: new Map<string, string>(), rooms: new Map<string, string>() };
  const theirs = { plants: new Map<string, string>(), rooms: new Map<string, string>() };
  const scan = (kind: "plant" | "room", a: readonly Rec[], b: readonly Rec[]): void => {
    const byId = new Map(b.map((r) => [r["id"] as string, r]));
    for (const x of a) {
      const id = x["id"] as string;
      const y = byId.get(id);
      if (y === undefined || !collides(x, y)) continue;
      const iLose = loses(x, y);
      const loser = iLose ? x : y;
      const to = derivedId("remap", kind, id, stampsOf(loser)["created"] ?? ZERO_STAMP);
      const side = iLose ? mine : theirs;
      (kind === "plant" ? side.plants : side.rooms).set(id, to);
      remaps.push({ kind, from: id, to });
    }
  };
  scan("plant", local.plants as unknown as Rec[], incoming.plants as unknown as Rec[]);
  scan("room", local.rooms as unknown as Rec[], incoming.rooms as unknown as Rec[]);
  return {
    local: renamed(local, mine.plants, mine.rooms),
    incoming: renamed(incoming, theirs.plants, theirs.rooms),
    remaps: remaps.sort((p, q) => cmpText(`${p.kind}:${p.from}`, `${q.kind}:${q.from}`)),
  };
}

// ---------- records: last writer wins per field ----------

/** Plant fields that are replay state, not edits: they are never merged field by field. */
const DERIVED_PLANT_KEYS = ["lastWatered", "anchor", "adjustmentDays", "doneStreak"] as const;
const PLANT_SKIP: ReadonlySet<string> = new Set([
  "id",
  "stamps",
  "logs",
  "placementHistory",
  "checkpoint",
  ...DERIVED_PLANT_KEYS,
]);
const ROOM_SKIP: ReadonlySet<string> = new Set(["id", "stamps"]);

interface Ctx {
  /** The last stamp the local copy saw from the member the incoming copy belongs to. */
  readonly localSawThem: string;
  /** The last stamp the incoming copy saw from the member the local copy belongs to. */
  readonly theySawLocal: string;
  readonly tombstones: StampMap;
  readonly conflicts: Conflict[];
}

function mergeFields(kind: "plant" | "room", a: Rec, b: Rec, skip: ReadonlySet<string>, ctx: Ctx) {
  const sa = stampsOf(a);
  const sb = stampsOf(b);
  const keys = new Set<string>();
  for (const k of [...Object.keys(a), ...Object.keys(b), ...Object.keys(sa), ...Object.keys(sb)]) {
    if (!skip.has(k) && k !== "created") keys.add(k);
  }
  const fields: Rec = {};
  const stamps: StampMap = {};
  for (const k of [...keys].sort()) {
    const stampA = sa[k] ?? ZERO_STAMP;
    const stampB = sb[k] ?? ZERO_STAMP;
    const stampOrder = compareStamps(stampA, stampB);
    const order = stampOrder !== 0 ? stampOrder : byCanonical(a[k], b[k]);
    const win = order >= 0 ? a[k] : b[k];
    if (win !== undefined) fields[k] = win;
    if (k in sa || k in sb) stamps[k] = maxStamp(stampA, stampB);
    const changedOnBoth =
      stampOrder !== 0 &&
      compareStamps(stampB, ctx.localSawThem) > 0 &&
      compareStamps(stampA, ctx.theySawLocal) > 0;
    if (k !== "deleted" && changedOnBoth && canonical(a[k]) !== canonical(b[k])) {
      ctx.conflicts.push({
        kind,
        id: a["id"] as string,
        field: k,
        mine: a[k],
        theirs: b[k],
        mineStamp: stampA,
        theirsStamp: stampB,
      });
    }
  }
  const created = [sa["created"], sb["created"]].filter((x): x is string => x !== undefined);
  if (created.length > 0) stamps["created"] = created.reduce(maxStamp);
  return { fields, stamps: sortKeys(stamps) };
}

/** A record only one copy holds: its own fields and stamps as they are. */
function soloFields(r: Rec, skip: ReadonlySet<string>) {
  const fields: Rec = {};
  for (const [k, v] of Object.entries(r)) if (!skip.has(k)) fields[k] = v;
  return { fields, stamps: sortKeys({ ...stampsOf(r) }) };
}

// ---------- plants ----------

type Checkpoint = { cutoff?: string };

function pickCheckpoint(a: Rec, b: Rec): Checkpoint | undefined {
  const ca = a["checkpoint"] as Checkpoint | undefined;
  const cb = b["checkpoint"] as Checkpoint | undefined;
  if (ca === undefined || cb === undefined) return ca ?? cb;
  if (ca.cutoff !== cb.cutoff) return (ca.cutoff ?? "") > (cb.cutoff ?? "") ? ca : cb;
  return byCanonical(ca, cb) >= 0 ? ca : cb;
}

function mergeLogs(
  plantId: string,
  sides: readonly Rec[],
  cutoff: string | undefined,
  tombstones: StampMap,
): Rec[] {
  const byKey = new Map<string, Rec>();
  for (const side of sides) {
    ((side["logs"] as Rec[] | undefined) ?? []).forEach((entry, i) => {
      const key =
        typeof entry["id"] === "string"
          ? entry["id"]
          : `x${derivedId(plantId, canonical(entry), i)}`;
      const have = byKey.get(key);
      if (have === undefined || byCanonical(entry, have) > 0) byKey.set(key, entry);
    });
  }
  const text = (e: Rec, k: string): string => str(e[k]);
  return [...byKey.values()]
    .filter((e) => typeof e["id"] !== "string" || !(e["id"] in tombstones))
    .filter((e) => cutoff === undefined || text(e, "date") >= cutoff)
    .sort(
      (x, y) =>
        cmpText(text(x, "date"), text(y, "date")) ||
        compareStamps(text(x, "at") || ZERO_STAMP, text(y, "at") || ZERO_STAMP) ||
        cmpText(text(x, "id"), text(y, "id")) ||
        byCanonical(x, y),
    );
}

/** Moves are events: the union of both histories, oldest first, an identical move kept once. */
function mergeHistory(a: Rec, b: Rec): Rec[] | undefined {
  const lists = [a["placementHistory"], b["placementHistory"]] as (Rec[] | undefined)[];
  if (lists[0] === undefined && lists[1] === undefined) return undefined;
  const unique = new Map<string, Rec>();
  for (const e of [...(lists[0] ?? []), ...(lists[1] ?? [])]) unique.set(canonical(e), e);
  return [...unique.values()].sort(
    (x, y) => cmpText(String(x["on"]), String(y["on"])) || byCanonical(x, y),
  );
}

const derivedOf = (r: Rec): Rec => Object.fromEntries(DERIVED_PLANT_KEYS.map((k) => [k, r[k]]));

function mergePlant(a: Rec | undefined, b: Rec | undefined, ctx: Ctx): Rec | undefined {
  const only = a === undefined || b === undefined ? (a ?? b) : undefined;
  const one = (a ?? b) as Rec;
  const x = a ?? { id: one["id"] };
  const y = b ?? { id: one["id"] };
  const base =
    only !== undefined ? soloFields(only, PLANT_SKIP) : mergeFields("plant", x, y, PLANT_SKIP, ctx);
  const out: Rec = { id: one["id"], ...base.fields };

  // Replay state is never merged; it comes from the copy with the later last watering (the replay
  // recomputes it from the checkpoint and the entries).
  const last = (r: Rec): string => str(r["lastWatered"]);
  const src =
    only !== undefined
      ? only
      : last(x) !== last(y)
        ? last(x) > last(y)
          ? x
          : y
        : byCanonical(derivedOf(x), derivedOf(y)) >= 0
          ? x
          : y;
  for (const k of DERIVED_PLANT_KEYS) if (src[k] !== undefined) out[k] = src[k];

  const checkpoint = pickCheckpoint(x, y);
  if (checkpoint !== undefined) out["checkpoint"] = checkpoint;
  const history = mergeHistory(x, y);
  if (history !== undefined) out["placementHistory"] = history;
  const logs = mergeLogs(String(one["id"]), [x, y], checkpoint?.cutoff, ctx.tombstones);
  if (logs.length > 0 || x["logs"] !== undefined || y["logs"] !== undefined) out["logs"] = logs;

  // A watering stamped after the removal brings the plant back.
  const removedAt = base.stamps["deleted"];
  if (out["deleted"] === true && removedAt !== undefined) {
    const revived = logs.some(
      (e) => e["outcome"] === "done" && compareStamps(str(e["at"]) || ZERO_STAMP, removedAt) > 0,
    );
    if (revived) delete out["deleted"];
  }
  if (Object.keys(base.stamps).length > 0) out["stamps"] = base.stamps;
  return out;
}

function mergeRoom(a: Rec | undefined, b: Rec | undefined, ctx: Ctx): Rec | undefined {
  const one = (a ?? b) as Rec;
  const base =
    a !== undefined && b !== undefined
      ? mergeFields("room", a, b, ROOM_SKIP, ctx)
      : soloFields(one, ROOM_SKIP);
  const out: Rec = { id: one["id"], ...base.fields };
  if (Object.keys(base.stamps).length > 0) out["stamps"] = base.stamps;
  return out;
}

function unionById(
  a: readonly Rec[],
  b: readonly Rec[],
  merge: (x: Rec | undefined, y: Rec | undefined) => Rec | undefined,
): Rec[] {
  const ma = new Map(a.map((r) => [r["id"] as string, r]));
  const mb = new Map(b.map((r) => [r["id"] as string, r]));
  const out: Rec[] = [];
  for (const id of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    const r = merge(ma.get(id), mb.get(id));
    if (r !== undefined) out.push(r);
  }
  return out;
}

// ---------- spaces (away days), seasonal choices, members ----------

function mergeSpace(a: Space | undefined, b: Space | undefined): Space {
  if (a === undefined || b === undefined) return (a ?? b) as Space;
  // Each day's add stamp is the later one either copy has; a removal wins unless an add is later.
  const added = new Map<string, string>();
  for (const s of [a, b]) {
    for (const d of s.awayDates) {
      const st = s.awayStamps?.[d] ?? ZERO_STAMP;
      added.set(d, added.has(d) ? maxStamp(added.get(d) as string, st) : st);
    }
    for (const [d, st] of Object.entries(s.awayStamps ?? {})) {
      if (added.has(d)) added.set(d, maxStamp(added.get(d) as string, st));
    }
  }
  const tomb = maxMap(a.awayTombstones, b.awayTombstones);
  const live = [...added.keys()]
    .filter((d) => tomb[d] === undefined || compareStamps(added.get(d) as string, tomb[d]) > 0)
    .sort();
  const awayStamps: StampMap = {};
  for (const d of live) {
    const st = added.get(d) as string;
    if (st !== ZERO_STAMP || a.awayStamps !== undefined || b.awayStamps !== undefined)
      awayStamps[d] = st;
  }
  const rest: Rec = { ...a, ...b };
  delete rest["awayStamps"];
  delete rest["awayTombstones"];
  return {
    ...(rest as unknown as Space),
    id: a.id,
    name: byCanonical(a.name, b.name) >= 0 ? a.name : b.name,
    awayDates: live,
    ...(Object.keys(awayStamps).length > 0 ? { awayStamps } : {}),
    ...(Object.keys(tomb).length > 0 ? { awayTombstones: tomb } : {}),
  };
}

/** A seasonal choice is "until a day": the later day per plant wins. */
function mergeSeasonal(a: AppData["seasonal"], b: AppData["seasonal"]): AppData["seasonal"] {
  if (a === undefined || b === undefined) return a ?? b;
  const latest = (x?: Readonly<Record<string, string>>, y?: Readonly<Record<string, string>>) => {
    if (x === undefined || y === undefined) return x ?? y;
    const out: Record<string, string> = { ...x };
    for (const [k, v] of Object.entries(y))
      out[k] = out[k] !== undefined && out[k] >= v ? out[k] : v;
    return sortKeys(out);
  };
  const snoozedUntil = latest(a.snoozedUntil, b.snoozedUntil);
  const leftOutUntil = latest(a.leftOutUntil, b.leftOutUntil);
  return {
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    ...(leftOutUntil === undefined ? {} : { leftOutUntil }),
  };
}

function mergeMembers(
  a: readonly SyncMember[] | undefined,
  b: readonly SyncMember[] | undefined,
): SyncMember[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  const byIndex = new Map<number, SyncMember>();
  for (const m of [...(a ?? []), ...(b ?? [])]) {
    const have = byIndex.get(m.index);
    if (have === undefined || byCanonical(m, have) > 0) byIndex.set(m.index, m);
  }
  return [...byIndex.values()].sort((x, y) => x.index - y.index);
}

// ---------- the merge ----------

interface Sender {
  readonly member: number;
  readonly stamp: string;
}

function core(
  local: AppData,
  incoming: AppData,
  senders: readonly Sender[],
  options: MergeOptions,
): MergeResult {
  const ls: SyncBlock | undefined = local.sync;
  const is: SyncBlock | undefined = incoming.sync;
  if (
    ls?.household !== undefined &&
    is?.household !== undefined &&
    ls.household.id !== is.household.id
  ) {
    return { doc: local, conflicts: [], remaps: [], ignored: "other-household" };
  }
  const fixed = resolveCollisions(local, incoming);
  const a = fixed.local;
  const b = fixed.incoming;
  const tombstones = maxMap(ls?.tombstones, is?.tombstones);
  const ctx: Ctx = {
    localSawThem: is?.me === undefined ? ZERO_STAMP : (ls?.seen?.[String(is.me)] ?? ZERO_STAMP),
    theySawLocal: ls?.me === undefined ? ZERO_STAMP : (is?.seen?.[String(ls.me)] ?? ZERO_STAMP),
    tombstones,
    conflicts: [],
  };

  let plants = unionById(a.plants as unknown as Rec[], b.plants as unknown as Rec[], (x, y) =>
    mergePlant(x, y, ctx),
  );
  let rooms = unionById(a.rooms as unknown as Rec[], b.rooms as unknown as Rec[], (x, y) =>
    mergeRoom(x, y, ctx),
  );
  let spaces = [...new Set([...a.spaces, ...b.spaces].map((s) => s.id))].sort().map((id) =>
    mergeSpace(
      a.spaces.find((s) => s.id === id),
      b.spaces.find((s) => s.id === id),
    ),
  );

  const pins = new Map<string, unknown>();
  for (const p of [...(a.pins ?? []), ...(b.pins ?? [])]) pins.set(canonical(p), p);

  // What has been seen from each member: the later stamp either copy knows, plus the senders just merged.
  let seen = maxMap(ls?.seen, is?.seen);
  for (const s of senders) seen = maxMap(seen, { [String(s.member)]: s.stamp });
  // Every copy knows its own latest stamp, so which copy is local never changes the result.
  if (ls?.me !== undefined && seen[String(ls.me)] === undefined) {
    seen = maxMap(seen, { [String(ls.me)]: ls.stamp });
  }
  const members = mergeMembers(ls?.members, is?.members);

  let tombs = tombstones;
  if (options.now !== undefined) {
    const now = options.now;
    const everyone = (members ?? []).map((m) => String(m.index));
    const droppable = (stamp: string): boolean =>
      Math.floor((now - parseStamp(stamp).wall) / DAY_MS) > TOMBSTONE_KEEP_DAYS &&
      everyone.every((m) => compareStamps(seen[m] ?? ZERO_STAMP, stamp) > 0);
    tombs = Object.fromEntries(Object.entries(tombs).filter(([, st]) => !droppable(st)));
    spaces = spaces.map((s) => {
      const kept = Object.fromEntries(
        Object.entries(s.awayTombstones ?? {}).filter(([, st]) => !droppable(st)),
      );
      const rest: Rec = { ...s };
      delete rest["awayTombstones"];
      return (Object.keys(kept).length > 0
        ? { ...rest, awayTombstones: kept }
        : rest) as unknown as Space;
    });
    const gone = (r: Rec): boolean => {
      const at = stampsOf(r)["deleted"];
      return r["deleted"] === true && at !== undefined && droppable(at);
    };
    plants = plants.filter((r) => !gone(r));
    rooms = rooms.filter((r) => !gone(r));
  }

  const seasonal = mergeSeasonal(a.seasonal, b.seasonal);
  const stamp = [ls?.stamp, is?.stamp]
    .filter((x): x is string => x !== undefined)
    .reduce(maxStamp, ZERO_STAMP);
  const household = ls?.household ?? is?.household;
  const sync: SyncBlock | undefined =
    ls === undefined && is === undefined
      ? undefined
      : {
          ...is,
          ...ls,
          device: (ls?.device ?? is?.device) as string,
          stamp,
          ...(household === undefined ? {} : { household }),
          ...(members === undefined ? {} : { members }),
          ...(Object.keys(seen).length > 0 ? { seen } : {}),
        };
  if (sync !== undefined) {
    const out = sync as { tombstones?: StampMap };
    if (Object.keys(tombs).length > 0) out.tombstones = tombs;
    else delete out.tombstones;
  }

  const doc: AppData = {
    ...a,
    spaces,
    plants: plants as unknown as Plant[],
    rooms: rooms as unknown as Room[],
    ...(pins.size > 0
      ? {
          pins: [...pins.entries()]
            .sort(([x], [y]) => cmpText(x, y))
            .map(([, p]) => p) as NonNullable<AppData["pins"]>,
        }
      : {}),
    ...(seasonal === undefined ? {} : { seasonal }),
    ...(sync === undefined ? {} : { sync }),
  };
  const conflicts = ctx.conflicts.sort((p, q) =>
    cmpText(`${p.kind}:${p.id}:${p.field}`, `${q.kind}:${q.id}:${q.field}`),
  );
  return { doc, conflicts, remaps: fixed.remaps };
}

/** Who the copies come from, for the watermark of what has been seen. This device's own copies do not count. */
function sendersOf(local: AppData, copies: readonly AppData[]): Sender[] {
  return copies.flatMap((c) =>
    c.sync?.me === undefined || c.sync.device === local.sync?.device
      ? []
      : [{ member: c.sync.me, stamp: c.sync.stamp }],
  );
}

/** Merges `incoming` into `local`. */
export function merge(local: AppData, incoming: AppData, options: MergeOptions = {}): MergeResult {
  return core(local, incoming, sendersOf(local, [incoming]), options);
}

/**
 * Merges several incoming copies into `local`. The copies are merged with each other first (union is
 * associative), then once into `local`; the document is the same as merging each in turn. Copies of
 * another household are skipped.
 */
export function mergeInbox(
  local: AppData,
  packets: readonly AppData[],
  options: MergeOptions = {},
): MergeResult {
  const first = packets[0];
  if (first === undefined) return { doc: local, conflicts: [], remaps: [] };
  let combined = first;
  const remaps: Remap[] = [];
  const used: AppData[] = [first];
  for (const next of packets.slice(1)) {
    const step = core(combined, next, [], {});
    if (step.ignored !== undefined) continue;
    combined = step.doc;
    used.push(next);
    remaps.push(...step.remaps);
  }
  const result = core(local, combined, sendersOf(local, used), options);
  return { ...result, remaps: [...remaps, ...result.remaps] };
}

/**
 * Settles a conflict by hand: the chosen value is written to the field with a new stamp from this
 * device, so it wins everywhere. `now` is the wall time in ms.
 */
export function resolve(
  doc: AppData,
  conflict: Conflict,
  choice: "mine" | "theirs",
  now: number,
): AppData {
  const value = choice === "mine" ? conflict.mine : conflict.theirs;
  const stamp = createClock(doc.sync?.device ?? "", doc.sync?.stamp ?? ZERO_STAMP).tick(now);
  const apply = <T extends { readonly id: string }>(list: readonly T[]): T[] =>
    list.map((r) => {
      if (r.id !== conflict.id) return r;
      const rec: Rec = { ...(r as unknown as Rec) };
      rec[conflict.field] = value;
      rec["stamps"] = { ...stampsOf(rec), [conflict.field]: stamp };
      return rec as unknown as T;
    });
  return {
    ...doc,
    ...(conflict.kind === "plant" ? { plants: apply(doc.plants) } : { rooms: apply(doc.rooms) }),
    ...(doc.sync === undefined ? {} : { sync: { ...doc.sync, stamp } }),
  };
}
