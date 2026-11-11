// SPDX-License-Identifier: AGPL-3.0-only

/** Local calendar date as `YYYY-MM-DD`: watering days are days on the wall, not UTC days. */
export function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
