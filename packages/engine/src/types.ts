// SPDX-License-Identifier: AGPL-3.0-only

export type WateringStyle = "keep_moist" | "let_top_dry" | "let_fully_dry";
export type Hemisphere = "north" | "south";
export type LogOutcome =
  | "done"
  | "skipped"
  | "still_wet"
  | "dry_early"
  /** Rain fell: credits an outdoor plant with `mm`, without teaching it anything. */
  | "rain"
  /** "The plant looks fine": answers a drought check and restarts its count. Changes no schedule. */
  | "looks_fine";
export type Light = "low" | "medium" | "bright_indirect" | "direct";
export type PotMaterial = "plastic" | "terracotta" | "glazed" | "fabric" | "other";
export type OutlookLevel = "thrive" | "survive" | "scrape_by" | "decay";

/** Where a plant lives; missing means indoors. Same values as the storage `placement`. */
export type Placement = "indoor" | "outdoor_pot" | "ground";
/** Sun the spot gets (the storage `sun`). */
export type SunExposure = "full_sun" | "part_shade" | "shade";
export type GroundSoil = "sandy" | "loam" | "clay";
export type RootDepth = "shallow" | "medium" | "deep";
/** Drought tolerance once established, in the ground. */
export type DroughtTolerance = "none" | "moderate" | "high";
export type Dormancy = "none" | "winter" | "summer";
/** How a plant is cared for on a day. */
export type CareMode = "interval" | "rain_fed" | "suspended";
/**
 * Summer water demand and rain pattern of the home: the engine reads it to pick its
 * outdoor constants. `winterMin` (hardiness) is a storage setting; watering does not use it.
 */
export type ClimateClass =
  "oceanic_wet" | "oceanic_dry" | "med_mild" | "mediterranean" | "semi_arid" | "arid" | "mountain";

export interface LogEntry {
  readonly date: string;
  readonly outcome: LogOutcome;
  /** Millimetres of rain, for the `rain` outcome. */
  readonly mm?: number;
}

/** One day of weather. Observed rows credit outdoor plants; `forecast` rows never do. */
export interface WeatherDay {
  readonly date: string;
  readonly rainMm: number;
  readonly tMaxC?: number;
  readonly tMinC?: number;
  readonly et0Mm?: number;
  readonly forecast?: boolean;
  /**
   * Where an observed row comes from: `measured` is a gauge, `modelled` a weather model's
   * estimate. A row without it counts as measured. Per day a manual `rain` log beats a measured row,
   * which beats a modelled one.
   */
  readonly kind?: "measured" | "modelled";
}

/** One dated stay in a place. Oldest first in `PlantInput.placementHistory`. */
export interface PlacementEntry {
  /** YYYY-MM-DD, the first day the plant is there. */
  readonly on: string;
  /** "ground" is not a move target: digging up and potting is replanting. */
  readonly placement: "indoor" | "outdoor_pot";
  /** Outdoors only: under cover, so rain gives no credit. Absent means false. */
  readonly sheltered?: boolean;
}

/** A stretch of direct sun, whole hours on the 24 h local clock, 0 <= from < to <= 24. */
export interface SunRange {
  readonly from: number;
  readonly to: number;
}

export interface PlantInput {
  readonly id: string;
  readonly style: WateringStyle;
  /** Base (growth-season) watering interval in days, whole number >= 1. */
  readonly intervalDays: number;
  /** Date of the last watering. Missing means the plant is due today. */
  readonly lastWatered?: string;
  /** Next ideal watering date (the cycle-count anchor). Missing means last + interval. */
  readonly anchor?: string;
  /** Learned interval adjustment in days (positive = water less often). */
  readonly adjustmentDays?: number;
  /** Consecutive on-time `done` logs since the last adjustment decay. */
  readonly doneStreak?: number;
  /** The window may not open before this date (set by "still wet"). */
  readonly notBefore?: string;
  /** Interval multiplier in the rest season. Missing means 1 (no seasonal change). */
  readonly restFactor?: number;
  /** Days past the ideal date the plant tolerates dry. Missing means ceil(I / 2). */
  readonly dryTolDays?: number;
  /** Days the root zone may stay wet / early watering tolerated. Missing means max(1, round(I / 4)). */
  readonly wetTolDays?: number;
  /**
   * Days added to the end of the window because some care facts are assumed, not known: the caller counts one per assumed field. Whole days, 0 to 3; anything else is read as 0.
   */
  readonly uncertaintyDays?: number;
  /**
   * Facts for the start multipliers: pot diameter, the room's light and the pot material
   * scale `intervalDays` (clamped to 0.6 to 1.6 of it). Missing facts count as 1. Leave all three out for
   * an interval the user typed themselves.
   */
  readonly potDiameterCm?: number;
  readonly light?: Light;
  readonly potMaterial?: PotMaterial;
  /**
   * Outdoor and in-ground care. All optional; with none of them (or `placement` indoor)
   * the plant is cared for exactly as before. Catalogue-sourced fields are marked.
   */
  readonly placement?: Placement;
  readonly sun?: SunExposure;
  /**
   * When the place gets direct sun: outdoors the plant's own answer, indoors the room's.
   * Hours win over `sun` and `light`; `[]` means no direct sun; absent means unknown (the class is used).
   */
  readonly directSun?: readonly SunRange[];
  /** Set by the engine from `directSun` on the day; callers leave it out. */
  readonly sunHours?: number;
  readonly groundSoil?: GroundSoil;
  /** Mulch on top: lengthens the interval and slows evaporation. */
  readonly mulched?: boolean;
  /** Under eaves or a canopy: rain does not reach it, so rain gives no credit. */
  readonly sheltered?: boolean;
  /** Planting date; with `establishmentSeasons` it gives the phase. Missing means established. */
  readonly plantedOn?: string;
  /** Catalogue: growing seasons a new planting needs watering (1 perennials, 2 shrubs, 3 trees). */
  readonly establishmentSeasons?: 1 | 2 | 3;
  /** Catalogue. Missing means `medium`. */
  readonly rootDepth?: RootDepth;
  /** Catalogue. Missing means `moderate`. */
  readonly droughtTolerance?: DroughtTolerance;
  /** Catalogue. Missing means `winter`. */
  readonly dormancy?: Dormancy;
  /** Catalogue: days between deep waterings in the growth season while establishing. Missing means 7. */
  readonly establishingIntervalDays?: number;
  /**
   * Where the plant has been and when. Absent means "the current placement, since
   * forever". The first entry reaches back in time; each later one is a move that restarts learning,
   * re-anchors the schedule and decides which days' rain counted. `placement` and `sheltered` above
   * equal the last entry's values.
   */
  readonly placementHistory?: readonly PlacementEntry[];
  /** Plain reminder only, no windows (air plants in v1). */
  readonly reminderOnly?: boolean;
  /** Log entries after the state above, oldest first. */
  readonly logs?: readonly LogEntry[];
}

export interface Preferences {
  /** 0 = Sunday ... 6 = Saturday. Soft tie-break only. */
  readonly preferredWeekdays?: readonly number[];
  readonly unavailableDates?: readonly string[];
  readonly unavailableWeekdays?: readonly number[];
  /** Offer a watering before an unavoidable gap. Off by default. */
  readonly preLeaveWatering?: boolean;
}

export interface PlanInput {
  /** The current date. The engine never reads a clock. */
  readonly today: string;
  readonly hemisphere?: Hemisphere;
  /**
   * Degrees from the equator of the home: decides when the rest season ramps in and out. Missing
   * means about 55 in the north (the UK) and 40 in the south; the hemisphere says which side.
   */
  readonly latitude?: number;
  /** ISO 3166 alpha-2 country of the home: only sets the clock time of solar noon for sun hours. */
  readonly country?: string;
  readonly horizonDays?: number;
  /** Climate class of the home for outdoor care. Missing means `oceanic_wet`. */
  readonly climate?: ClimateClass;
  /** Daily weather for outdoor plants: observed rows credit rain, forecast rows only hint. */
  readonly weather?: readonly WeatherDay[];
  readonly plants?: readonly PlantInput[];
  readonly prefs?: Preferences;
  /**
   * Pre-leave waterings the user has already been shown. Honoured while they still make
   * sense for their plant, so logging another plant does not move them.
   */
  readonly pinned?: readonly PinnedWatering[];
}

export interface PinnedWatering {
  readonly plantId: string;
  readonly date: string;
}

export interface Window {
  readonly plantId: string;
  readonly taskType: "water";
  readonly earliest: string;
  readonly latest: string;
  /** Days past the window end when the window was already over (clamped to today). */
  readonly overdueDays: number;
  /** Uncertainty days included in `latest` (0 to 3). */
  readonly marginDays: number;
  /** Which wording family the UI uses: "around" ("around every 7 days") when `marginDays` > 0. */
  readonly wording: "exact" | "around";
  /** Moved in the last 3 days and a window is open: the UI says "look at the soil first". */
  readonly justMoved?: true;
}

/** A plant that lives on rain: no window, only a drought check. */
export interface RainFedPlant {
  readonly plantId: string;
  /** Days since the last credited rain, watering or "looks fine"; null when nothing is recorded. */
  readonly daysSinceCredit: number | null;
  /** Days without credit after which the check shows (climate class). */
  readonly checkDays: number;
  /** Show "look at it: drooping in the morning?". */
  readonly droughtCheck: boolean;
  /** Care fields that were missing and defaulted; the UI says "assumed". */
  readonly assumed: readonly string[];
}

/** A plant in its dormant season: no window until `until`. */
export interface DormantPlant {
  readonly plantId: string;
  /** First day it is not dormant; null when none within about a year. */
  readonly until: string | null;
  readonly daysSinceCredit: number | null;
  /** Evergreen or newly planted and dry for 28 days: offer an optional winter soak. */
  readonly winterSoak: boolean;
  readonly assumed: readonly string[];
}

export interface WindowsResult {
  readonly windows: readonly Window[];
  /** Plants with `reminderOnly`: no windows, plain reminder. */
  readonly reminderOnly: readonly string[];
  /** Outdoor plants that live on rain. */
  readonly rainFed: readonly RainFedPlant[];
  /** Outdoor plants in their dormant season. */
  readonly dormant: readonly DormantPlant[];
  /** Plants with a window open whose spot gets at least a full credit of rain forecast by tomorrow. */
  readonly rainForecastFor: readonly string[];
  readonly issues: readonly string[];
}

export type WateringReason =
  "on_ideal_day" | "joined_group" | "preferred_day" | "away_days" | "pre_leave" | "overdue";

export interface PlannedWatering {
  readonly date: string;
  readonly windowEarliest: string;
  readonly windowLatest: string;
  readonly inWindow: boolean;
  /** Days from the plant's ideal (anchor) date; negative = earlier. */
  readonly movedDays: number;
  readonly reason: WateringReason;
}

export interface Outlook {
  readonly level: OutlookLevel;
  /** 0 thrive, 1 survive, 2 scrape_by, 3 decay. */
  readonly severity: 0 | 1 | 2 | 3;
  /** Sorted reason codes: away_days, gap_exceeds_band, outside_window, too_early, unserved. */
  readonly reasons: readonly string[];
}

export interface PlantPlan {
  readonly plantId: string;
  readonly waterings: readonly PlannedWatering[];
  readonly wateringCount: number;
  /** Waterings the ideal schedule has inside the horizon. */
  readonly idealCount: number;
  readonly outlook: Outlook;
  /** Same as `Window.justMoved`. */
  readonly justMoved?: true;
}

export interface PlannedDay {
  readonly date: string;
  readonly plantIds: readonly string[];
}

export interface PlanSummary {
  /** Distinct days if every plant were watered on its own ideal dates. */
  readonly naiveDays: number;
  readonly wateringDays: number;
  readonly savingPercent: number;
}

export interface PlanResult {
  readonly days: readonly PlannedDay[];
  readonly plants: readonly PlantPlan[];
  readonly summary: PlanSummary;
  readonly reminderOnly: readonly string[];
  readonly rainFed: readonly RainFedPlant[];
  readonly dormant: readonly DormantPlant[];
  readonly rainForecastFor: readonly string[];
  readonly issues: readonly string[];
}

export interface Band {
  readonly style: WateringStyle;
  readonly intervalDays: number;
  readonly earlyDays: number;
  readonly lateDays: number;
  /** Shortest and longest acceptable gap between two waterings. */
  readonly low: number;
  readonly high: number;
}

/**
 * A user's own measurement (C15): a factor on the estimate, or the measured amount itself. It is
 * input data; the engine only picks which level applies.
 */
export type Calibration =
  | { readonly factor: number; readonly measuredMl?: never }
  | { readonly measuredMl: number; readonly factor?: never };

export type CalibrationLevel = "plant" | "room" | "global";

/** Calibrations at each level; the most specific valid one wins (plant, then room, then global). */
export type Calibrations = { readonly [L in CalibrationLevel]?: Calibration };

export interface HintInput {
  readonly style: WateringStyle;
  readonly potDiameterCm?: number;
  readonly potHeightCm?: number;
  /**
   * What the start multipliers' clamp moved into the amount (`startMultipliers().amountFactor`):
   * scales the estimate, never the user's own measurement. Missing means 1.
   */
  readonly amountFactor?: number;
  readonly calibration?: Calibrations;
}

/** A watering amount in household units; the UI words it per locale. Cups are counted in halves. */
export type HouseholdMeasure =
  | { readonly unit: "cup"; readonly halves: number }
  | { readonly unit: "litre"; readonly count: number };

export interface WateringHint {
  /** Which care instruction applies; the UI looks the sentence up. */
  readonly style: WateringStyle;
  /** Approximate volume rounded to 50 ml, or null. Calibration only; the UI shows `measure`. */
  readonly volumeMl: number | null;
  /** Household measure shown to people (half cups or half litres), or null when no amount should be shown. */
  readonly measure: HouseholdMeasure | null;
  /** Which calibration level the amount came from, or null for the uncalibrated estimate. */
  readonly calibration: CalibrationLevel | null;
  /** "more" or "less" when the clamp moved a noticeable part into the estimate, else null. */
  readonly adjust: "more" | "less" | null;
  readonly provisional: true;
}

/** The facts the start multipliers use. */
export interface StartFacts {
  readonly potDiameterCm?: number;
  readonly light?: Light;
  readonly potMaterial?: PotMaterial;
  /** Hours of direct sun in the window today: pulls the light factor towards `direct`. */
  readonly sunHours?: number;
}

/** Result of `startMultipliers`: the factors, the clamped product and what moved into the amount. */
export interface StartMultipliers {
  readonly potSize: number;
  readonly light: number;
  readonly material: number;
  /** The product before the clamp. */
  readonly raw: number;
  /** The product held to 0.6 to 1.6; the working interval is the catalogue interval times this. */
  readonly factor: number;
  /** Which end the clamp held the product to, or null. */
  readonly clamped: "low" | "high" | null;
  /** What the clamp removed, as a factor on the amount per watering (1 when nothing was clipped). */
  readonly amountFactor: number;
  /** Always true: every number behind this is a guess until measured. */
  readonly guess: true;
}
