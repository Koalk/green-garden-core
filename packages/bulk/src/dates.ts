// SPDX-License-Identifier: AGPL-3.0-only

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` plus `days` (negative goes back), in UTC so a daylight-saving change never moves it. */
export function addDaysIso(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
