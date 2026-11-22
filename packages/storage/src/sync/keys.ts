// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which parts of an export belong to the whole household and which to one member. The export file
 * stays complete and keeps its layout; only the keys in the household lists travel as shared data, the
 * personal ones travel tagged with their member. One fixed list, here.
 */

/** Top-level keys of the file that are the household's. */
export const HOUSEHOLD_TOP_KEYS = ["spaces", "plants", "rooms", "pins", "seasonal"] as const;

/** Top-level keys of the file that belong to one member (`stories` is carried through untouched). */
export const PERSONAL_TOP_KEYS = ["drafts", "questionState", "stories"] as const;

/** Keys of `settings` about the house. */
export const HOUSEHOLD_SETTINGS_KEYS = [
  "hemisphere",
  "latitude",
  "country",
  "climate",
  "winterMin",
  "household",
  "weather",
  "calibration",
] as const;

/** Keys of `settings.prefs` that are the household's (away days, watering days). */
export const HOUSEHOLD_PREFS_KEYS = [
  "preferredWeekdays",
  "unavailableWeekdays",
  "unavailableDates",
  "preLeaveWatering",
] as const;

/** Keys of `settings` that belong to one member. */
export const PERSONAL_SETTINGS_KEYS = [
  "locale",
  "measure",
  "amountMode",
  "wording",
  "weekStart",
  "horizonDays",
  "reminders",
  "questions",
] as const;
