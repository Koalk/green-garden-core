// SPDX-License-Identifier: AGPL-3.0-only

/** One row of the defaults table: what we assume for a field and what a better answer buys. */
export interface DefaultsRow {
  /** 1 is the biggest care improvement. A judgement (`guess`), except drainage and pot size. */
  readonly rank: number;
  readonly field: string;
  /** The value used when nothing is known; `null` means "no value, the plant shows a prompt instead". */
  readonly defaultValue: string | number | null;
  /** What care does while the value is assumed. */
  readonly whenAssumed:
    | "generic_profile"
    | "weather_wording"
    | "amount_wording"
    | "check_the_soil"
    | "wider_window"
    | "amount_hint"
    | "skews_late"
    | "minor"
    | "growth_class_only"
    | "nothing";
  /** Whether a better answer can be exact, or only roughly (a class, a season). */
  readonly known: "exact" | "roughly";
  /** True for the fields that add one day to the window while assumed (`assumedMarginDays`, ranks 3 to 7). */
  readonly countsForMargin: boolean;
  /** The bank question that improves it; `null` when no core question exists (feeding is not asked in v1). */
  readonly questionId: string | null;
}

export const DEFAULTS_TABLE: readonly DefaultsRow[] = [
  {
    rank: 1,
    field: "species",
    defaultValue: null,
    whenAssumed: "generic_profile",
    known: "exact",
    countsForMargin: false,
    questionId: "Q-SPECIES",
  },
  {
    rank: 2,
    field: "placement",
    defaultValue: "indoor",
    whenAssumed: "weather_wording",
    known: "exact",
    countsForMargin: false,
    questionId: "Q-LIVES",
  },
  {
    rank: 3,
    field: "drainage",
    defaultValue: "hole",
    whenAssumed: "amount_wording",
    known: "exact",
    countsForMargin: true,
    questionId: "Q-DRAIN",
  },
  {
    rank: 4,
    field: "lastWatered",
    defaultValue: null,
    whenAssumed: "check_the_soil",
    known: "exact",
    countsForMargin: true,
    questionId: "Q-FIRST",
  },
  {
    rank: 5,
    field: "light",
    defaultValue: "medium",
    whenAssumed: "wider_window",
    known: "roughly",
    countsForMargin: true,
    questionId: "Q-LIGHT",
  },
  {
    rank: 6,
    field: "potDiameterCm",
    defaultValue: 15,
    whenAssumed: "amount_hint",
    known: "roughly",
    countsForMargin: true,
    questionId: "Q-POT",
  },
  {
    rank: 7,
    field: "potMaterial",
    defaultValue: "plastic",
    whenAssumed: "skews_late",
    known: "exact",
    countsForMargin: true,
    questionId: "Q-MAT",
  },
  {
    rank: 8,
    field: "soilType",
    defaultValue: "standard",
    whenAssumed: "minor",
    known: "roughly",
    countsForMargin: false,
    questionId: "Q-STILLWET",
  },
  {
    rank: 9,
    field: "plantSize",
    defaultValue: "medium",
    whenAssumed: "minor",
    known: "roughly",
    countsForMargin: false,
    questionId: "Q-SIZE",
  },
  {
    rank: 10,
    field: "lastRepotted",
    defaultValue: null,
    whenAssumed: "growth_class_only",
    known: "roughly",
    countsForMargin: false,
    questionId: "Q-REPOT",
  },
  {
    rank: 11,
    field: "feeding",
    defaultValue: null,
    whenAssumed: "nothing",
    known: "roughly",
    countsForMargin: false,
    questionId: null,
  },
  {
    rank: 12,
    field: "name",
    defaultValue: null,
    whenAssumed: "nothing",
    known: "exact",
    countsForMargin: false,
    questionId: null,
  },
];
