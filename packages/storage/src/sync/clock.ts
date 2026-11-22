// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The hybrid logical clock behind every change a household shares. A stamp is the wall time in
 * milliseconds, a counter for changes within one millisecond, and the ID of the device that made it.
 * The later stamp wins; the device ID breaks an exact tie. A device's stamps never go backwards, even
 * if its wall clock does.
 *
 * The string form is fixed width, so plain string comparison of two stamps is the same total order.
 * Stamp 0 is older than any real stamp: it marks values that existed before sync did.
 */

/** Older than any real stamp; what a value gets when it was there before stamps existed. */
export const ZERO_STAMP = "0";

export interface Stamp {
  readonly wall: number;
  readonly counter: number;
  readonly device: string;
}

const STAMP_FORM = /^(0|[0-9a-f]{12}-[0-9a-f]{4}-[0-9a-f]{16})$/;
const MAX_COUNTER = 0xffff;

/** Whether `v` is a stamp in its string form. */
export function isStamp(v: unknown): v is string {
  return typeof v === "string" && STAMP_FORM.test(v);
}

export function formatStamp(s: Stamp): string {
  if (s.wall === 0 && s.counter === 0 && s.device === "") return ZERO_STAMP;
  const counter = Math.min(s.counter, MAX_COUNTER);
  return `${s.wall.toString(16).padStart(12, "0")}-${counter.toString(16).padStart(4, "0")}-${s.device}`;
}

/** Reads a stamp's string form. A string that is not one reads as stamp 0. */
export function parseStamp(text: string): Stamp {
  if (!isStamp(text) || text === ZERO_STAMP) return { wall: 0, counter: 0, device: "" };
  return {
    wall: Number.parseInt(text.slice(0, 12), 16),
    counter: Number.parseInt(text.slice(13, 17), 16),
    device: text.slice(18),
  };
}

/** Negative when `a` is older than `b`, positive when newer, 0 when they are the same stamp. */
export function compareStamps(a: string, b: string): number {
  const x = parseStamp(a);
  const y = parseStamp(b);
  if (x.wall !== y.wall) return x.wall < y.wall ? -1 : 1;
  if (x.counter !== y.counter) return x.counter < y.counter ? -1 : 1;
  return x.device === y.device ? 0 : x.device < y.device ? -1 : 1;
}

export interface Clock {
  /** Stamps a local change made at wall time `now` (ms). Always later than the last stamp. */
  tick(now: number): string;
  /** Takes in a stamp from another device so later local stamps follow it. */
  observe(remote: string, now: number): string;
  /** The latest stamp this clock has made or seen. */
  last(): string;
}

/** A clock for `device`, starting after `last` (the last stamp saved) when given. */
export function createClock(device: string, last: string = ZERO_STAMP): Clock {
  let state = parseStamp(last);
  const set = (wall: number, counter: number): string => {
    state = { wall, counter, device };
    return formatStamp(state);
  };
  return {
    tick(now) {
      const wall = Math.max(state.wall, now);
      return set(wall, wall === state.wall ? state.counter + 1 : 0);
    },
    observe(remote, now) {
      const r = parseStamp(remote);
      const wall = Math.max(state.wall, r.wall, now);
      const mine = wall === state.wall ? state.counter + 1 : 0;
      const theirs = wall === r.wall ? r.counter + 1 : 0;
      return set(wall, Math.max(mine, theirs));
    },
    last: () => formatStamp(state),
  };
}
