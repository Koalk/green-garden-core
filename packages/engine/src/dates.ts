// SPDX-License-Identifier: AGPL-3.0-only

/** Day number: whole days since 1970-01-01. Dates are zone-free `YYYY-MM-DD` strings. */
export type Day = number;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days from civil date (proleptic Gregorian), after Howard Hinnant's algorithm. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** Parses `YYYY-MM-DD`; returns undefined for anything that is not a real calendar date. */
export function parseDate(s: string): Day | undefined {
  const hit = ISO.exec(s);
  if (!hit) return undefined;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1) return undefined;
  const n = daysFromCivil(y, m, d);
  const back = civilFromDays(n);
  return back.y === y && back.m === m && back.d === d ? n : undefined;
}

export function formatDate(n: Day): string {
  const { y, m, d } = civilFromDays(n);
  const p = (v: number, w: number): string => String(v).padStart(w, "0");
  return `${p(y, 4)}-${p(m, 2)}-${p(d, 2)}`;
}

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(n: Day): number {
  return (((n + 4) % 7) + 7) % 7;
}

/** 1 to 12. */
export function monthOf(n: Day): number {
  return civilFromDays(n).m;
}

export function yearOf(n: Day): number {
  return civilFromDays(n).y;
}
