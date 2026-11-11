// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Care engine. Pure: no clock, no I/O, no randomness, no dependencies.
 * Every rule the docs do not pin down is marked `PROVISIONAL` in the code, with a reason.
 */
import { band } from "./model.ts";
import type { Band, WateringStyle } from "./types.ts";

export { wateringHint } from "./amount.ts";
export {
  MULTIPLIER_MAX,
  MULTIPLIER_MIN,
  REFERENCE_DIAMETER_CM,
  startMultipliers,
} from "./multipliers.ts";
export { formatDate, parseDate, weekday } from "./dates.ts";
export { RAMP_DAYS, restWeight } from "./season.ts";
export {
  CLIMATE_CLASSES,
  DEFAULT_CLIMATE,
  WINTER_SOAK_DAYS,
  creditMmOn,
  placementOn,
  recordMove,
  resolveCare,
} from "./outdoor.ts";
export type { CareEnv, Move, MoveResult, ResolvedCare } from "./outdoor.ts";
export {
  PUT_OUT_QUIET_DAYS,
  SNOOZE_DAYS,
  leaveOutUntil,
  safeMinC,
  seasonalPrompts,
  snoozeUntil,
} from "./seasonal.ts";
export type {
  SeasonalHome,
  SeasonalInput,
  SeasonalPrompt,
  SeasonalSpecies,
  SeasonalState,
} from "./seasonal.ts";
export { directSunHours } from "./sun.ts";
export type { SunPlace } from "./sun.ts";
export { computeWindows, planDays } from "./plan.ts";
export type * from "./types.ts";

/** Band (acceptable gap between waterings) for each style and interval. */
export function bandTable(
  cases: readonly { readonly style: WateringStyle; readonly intervalDays: number }[],
): Band[] {
  return cases.map((c) => band(c.style, c.intervalDays));
}
