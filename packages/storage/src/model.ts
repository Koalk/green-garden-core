// SPDX-License-Identifier: AGPL-3.0-only

import {
  CLIMATE_CLASSES,
  type Calibration,
  type ClimateClass,
  type Hemisphere,
  type PinnedWatering,
  type PlantInput,
  type Preferences,
  type StartFacts,
  type SunRange,
} from "@green-garden/engine";

/** A plant as the app stores it: the engine's input plus what a person needs to recognise it. */
/** The space every plant, room and draft belongs to unless the user makes another (D-20). */
export const DEFAULT_SPACE_ID = "space1";

/**
 * A named collection with its own plants, rooms, logs, away days and plan (home, office, allotment).
 * Settings are shared; plans are never combined across spaces. The UI shows one space.
 */
export interface Space {
  readonly id: string;
  readonly name: string;
  /** Days nobody can water in this space. */
  readonly awayDates: readonly string[];
}

/** Where a plant field's value came from (01i section 7.1). `user` is the only source a rematch never replaces. */
export type FieldSource = "catalogue" | "default" | "user" | "learned";

export const PLACEMENTS = ["indoor", "outdoor_pot", "ground"] as const;
export const POT_MATERIALS = ["plastic", "terracotta", "glazed", "fabric", "other"] as const;
export const SOIL_TYPES = ["standard", "gritty", "peaty", "other"] as const;
export const PLANT_SIZES = ["small", "medium", "large"] as const;
export const SUNS = ["full_sun", "part_shade", "shade"] as const;
export const GROUND_SOILS = ["sandy", "loam", "clay"] as const;
export const DRAUGHTS = ["yes", "no"] as const;
/** Catalogue-sourced care facts for plants outdoors (02k section 4); the engine reads them as they are. */
export const ROOT_DEPTHS = ["shallow", "medium", "deep"] as const;
export const DROUGHT_TOLERANCES = ["none", "moderate", "high"] as const;
export const DORMANCIES = ["none", "winter", "summer"] as const;
export const ESTABLISHMENT_SEASONS = [1, 2, 3] as const;

/** The seven climate classes of the home (02k 8.4): summer water demand and rain pattern. */
export const CLIMATES: readonly ClimateClass[] = CLIMATE_CLASSES;
/** Winter cold of the home on the RHS hardiness scale (02k 8.4); only hardiness warnings read it. */
export const WINTER_MINS = ["H1c", "H2", "H3", "H4", "H5", "H6"] as const;
export type WinterMin = (typeof WINTER_MINS)[number];

/** Plant fields that can carry a source: the care facts of the defaults table (01i section 3). */
export const SOURCED_FIELDS = [
  "species",
  "intervalDays",
  "style",
  "placement",
  "drainage",
  "lastWatered",
  "light",
  "potDiameterCm",
  "potMaterial",
  "soilType",
  "plantSize",
  "lastRepotted",
  "name",
  "plantedOn",
  "mulched",
  "sheltered",
  "directSun",
] as const;
export type SourcedField = (typeof SOURCED_FIELDS)[number];

/**
 * Plants added together from one counted line ("3x aloe vera") share answers. `id` groups them;
 * `split` lists the questions the user said differ per plant ("They differ"); `filled` records, per
 * question, the answer that came from another member and what it replaced, so it can be reverted.
 */
export interface PlantBatch {
  readonly id: string;
  readonly split?: readonly string[];
  readonly filled?: {
    readonly [questionId: string]: {
      /** The plant whose answer filled this one. */
      readonly from: string;
      /** The fields (null = was not set) and field sources (null = had no entry) before the fill. */
      readonly before: {
        readonly fields: { readonly [field: string]: string | number | null };
        readonly sources: { readonly [field: string]: FieldSource | null };
      };
    };
  };
}

export interface Plant extends PlantInput {
  readonly name: string;
  readonly spaceId: string;
  readonly species?: string;
  readonly roomId?: string;
  readonly potDiameterCm?: number;
  readonly potHeightCm?: number;
  /** Whether the pot can drain; absent means it has a hole (02h section 6). */
  /** The user's own water measurement for this plant; beats the room and global ones. */
  readonly calibration?: Calibration;
  readonly drainage?: "hole" | "cachepot" | "no_hole" | "self_watering";
  /** Reserved (no UI yet): date of the last repotting and the repot-check class (D-07). */
  readonly lastRepotted?: string;
  readonly growthClass?: "fast" | "medium" | "slow";
  /** Where the care values came from, free text (manual entry, fixture, a URL). */
  readonly source?: string;
  /**
   * Per field, where the value came from (01i section 7.1). A field without an entry counts as `user`
   * (the safe direction: a rematch never overwrites it). `light` stands for the room's or the plant's light.
   */
  readonly fieldSources?: { readonly [F in SourcedField]?: FieldSource };
  /** Where the plant lives; absent means indoors, or the ground if the catalogue entry is garden-only. */
  readonly placement?: (typeof PLACEMENTS)[number];
  /** Pot material; absent means plastic. Terracotta and fabric dry faster. */
  readonly potMaterial?: (typeof POT_MATERIALS)[number];
  /** Soil mix; absent means standard. */
  readonly soilType?: (typeof SOIL_TYPES)[number];
  /** How big the plant is now; absent means medium. */
  readonly plantSize?: (typeof PLANT_SIZES)[number];
  /** In the ground: how much sun the spot gets (Q-GROUND). */
  readonly sun?: (typeof SUNS)[number];
  /** In the ground: the soil (Q-GROUND). */
  readonly groundSoil?: (typeof GROUND_SOILS)[number];
  /** Near a radiator, vent or an often-open window (Q-DRAUGHT); only widens the uncertainty note. */
  readonly draught?: (typeof DRAUGHTS)[number];
  /** Set on plants that were added together from one counted line; absent on every other plant. */
  readonly batch?: PlantBatch;
  /** True when no catalogue entry matched and the plant runs on the generic profile (01i section 2.3). */
  readonly unmatched?: boolean;
  /** Day the user got the plant; set when it is created, editable as "Had it since". */
  readonly addedOn?: string;
  /** True when `addedOn` is a guess from the plant's own history (migration), so the form says "about". */
  readonly addedOnEstimated?: boolean;
  /**
   * Set on a store load for a plant this build could not read: the message codes saying why.
   * Such a plant keeps all its original keys, is left out of the plan and listed as "needs attention".
   */
  readonly invalid?: readonly string[];
}

/**
 * An unfinished add-plant form ("Save for later"). It keeps the raw form values so reopening
 * restores exactly what was typed. A draft is never a plant, so the engine never schedules it.
 */
export interface PlantDraft {
  readonly id: string;
  readonly spaceId: string;
  readonly savedOn: string;
  /** Form field name to text, as typed. */
  readonly fields: Readonly<Record<string, string>>;
  /** The plant being edited when the draft was made from an Edit, if any. */
  readonly plantId?: string;
}

export interface Room {
  readonly id: string;
  readonly name: string;
  readonly spaceId: string;
  /** Qualitative light in the room (D-04). */
  readonly light?: "low" | "medium" | "bright_indirect" | "direct";
  /** Calibration for the plants in this room. */
  readonly calibration?: Calibration;
  /** When the room's windows get direct sun (02m 3.2); indoor plants in the room use it. [] = none. */
  readonly directSun?: readonly SunRange[];
  /** The Home Assistant area this room was imported from, kept for sensor mapping later. */
  readonly haAreaId?: string;
}

/** Who lives with the plants; the toxicity text speaks to them. */
export interface Household {
  readonly pets: readonly ("cat" | "dog" | "small_pet")[];
  readonly children?: boolean;
}

/**
 * Optional email reminders sent by the self-hosted server (D-27): one email on each watering day
 * at `time`, through the user's own SMTP. Holds no secret: the SMTP password comes from the server's
 * environment only.
 */
export interface ReminderSettings {
  readonly enabled: boolean;
  /** Local time of day as `HH:MM`, 24 hours; 08:00 unless set. */
  readonly time: string;
  /** Where the reminder goes. */
  readonly email: string;
  readonly smtp: {
    readonly host: string;
    readonly port?: number;
    readonly user?: string;
    /** `tls` connects encrypted (port 465), `starttls` upgrades (587), `none` stays plain. */
    readonly secure?: "tls" | "starttls" | "none";
    /** Sender address; absent means the SMTP user or the recipient. */
    readonly from?: string;
  };
}

export const DEFAULT_REMINDER_TIME = "08:00";

/** Countries the home setting knows; each stands for a typical latitude. */
export const COUNTRIES = ["GB", "ES"] as const;
export type Country = (typeof COUNTRIES)[number];
/** Degrees from the equator the engine uses for a country (UK about 55, Spain about 40). */
export const COUNTRY_LATITUDE: Readonly<Record<Country, number>> = { GB: 55, ES: 40 };

/** The home latitude the engine gets: the user's own figure, else the country's, else unset. */
export function homeLatitude(s: Pick<Settings, "latitude" | "country">): number | undefined {
  if (s.latitude !== undefined) return s.latitude;
  return s.country === undefined ? undefined : COUNTRY_LATITUDE[s.country];
}

export interface Settings {
  readonly hemisphere: Hemisphere;
  /**
   * Home latitude in degrees from the equator, 0 to 90: when the rest season ramps in and out.
   * Rounded to about 0.1 degree by whoever sets it; absent means the country's, then the engine's default.
   */
  readonly latitude?: number;
  /** Home country, a shortcut for a typical latitude (UK, Spain). */
  readonly country?: Country;
  /**
   * Climate class for plants outdoors (Q-K0): suggested from the country and region, never from a
   * location. Absent means the engine's default (`oceanic_wet`).
   */
  readonly climate?: ClimateClass;
  /** Lowest winter temperature class of the home (RHS scale); used for hardiness warnings only. */
  readonly winterMin?: WinterMin;
  readonly horizonDays: number;
  readonly prefs: Preferences;
  /** UI language tag; absent or "auto" follows the device. */
  readonly locale?: string;
  /** First day of the week, 0 = Sunday; absent follows the language. */
  readonly weekStart?: number;
  /** The user's own container for amounts; absent means a mug (02h). */
  readonly measure?: "mug" | "glass" | "jug" | "cup" | "none";
  /** Qualitative (halves) or precise (quarters) amounts; absent means qualitative. */
  readonly amountMode?: "qualitative" | "precise";
  /** UK or US English wording; absent means UK. */
  readonly wording?: "uk" | "us";
  readonly household?: Household;
  /** Calibration for every plant without a more specific one. */
  readonly calibration?: Calibration;
  readonly reminders?: ReminderSettings;
  /** Rain from the weather sources: off unless chosen. */
  readonly weather?: WeatherSettings;
  /** "off" switches the "!" and the pushed questions off for every plant; absent means on (01i section 5.4). */
  readonly questions?: "on" | "off";
}

/**
 * Weather and rain (02k 11): off by default. The home point is rounded to 2 decimals (about 1 km)
 * and is optional: without it only the manual "It rained" works. It leaves the device only to the user's
 * own server, never to the app's makers.
 */
export interface WeatherSettings {
  readonly enabled: boolean;
  readonly lat?: number;
  readonly lon?: number;
}

/** Per plant: what the question pacing remembers (01i section 7.2). Ids are question ids such as `Q-MAT`. */
export interface PlantQuestionState {
  /** The day a question was last put to this plant. */
  readonly lastAskedOn?: string;
  readonly snoozedUntil?: Readonly<Record<string, string>>;
  readonly snoozes?: Readonly<Record<string, number>>;
  readonly never?: Readonly<Record<string, true>>;
  readonly neverPlant?: boolean;
}

export interface AppData {
  /** At least one; the first is the one the UI shows. */
  readonly spaces: readonly Space[];
  readonly plants: readonly Plant[];
  readonly rooms: readonly Room[];
  /** Absent when there are none. */
  readonly drafts?: readonly PlantDraft[];
  /** Pre-leave waterings the user has been shown, kept in place when other plants are logged. */
  readonly pins?: readonly PinnedWatering[];
  /** Question pacing per plant id; absent when nothing has been asked, snoozed or silenced. */
  readonly questionState?: { readonly [plantId: string]: PlantQuestionState };
  readonly settings: Settings;
}

/** Plants a store load kept but could not read; the UI lists them with what is wrong. */
export function invalidPlants(data: Pick<AppData, "plants">): readonly Plant[] {
  return data.plants.filter((p) => p.invalid !== undefined);
}

/** Where a field's value came from; a field without a recorded source reads as `user`. */
export function fieldSource(plant: Pick<Plant, "fieldSources">, field: SourcedField): FieldSource {
  return plant.fieldSources?.[field] ?? "user";
}

/** Fields whose assumed value widens the care window (ranks 3 to 7 of the defaults table, 01i section 3). */
const MARGIN_FIELDS = ["drainage", "lastWatered", "light", "potDiameterCm", "potMaterial"] as const;

/** One day per assumed field in ranks 3 to 7, at most 3. The engine takes this as `uncertaintyDays`. */
export function assumedMarginDays(plant: Pick<Plant, "fieldSources">): number {
  const n = MARGIN_FIELDS.filter((f) => fieldSource(plant, f) !== "user").length;
  return Math.min(3, n);
}

/**
 * Whether the start multipliers apply to a plant's interval. They scale the catalogue's or the
 * defaults table's interval; an interval the user typed is theirs and stays as it is. A plant with no
 * source information counts as typed by the user, except an older one filled from the catalogue, whose
 * `source` text says so (the same rule the version 6 import uses).
 */
export function usesStartMultipliers(plant: Pick<Plant, "fieldSources" | "source">): boolean {
  const recorded = plant.fieldSources?.intervalDays;
  if (recorded !== undefined) return recorded !== "user";
  return plant.source?.startsWith("catalogue") === true;
}

/**
 * The facts the engine scales a plant's interval by (pot size, pot material, the room's light), or
 * undefined when the multipliers do not apply to it. Used for the schedule and for the amount, so both
 * move together.
 */
export function startFactsFor(
  data: Pick<AppData, "rooms">,
  plant: Pick<Plant, "fieldSources" | "source" | "roomId" | "potDiameterCm" | "potMaterial">,
): StartFacts | undefined {
  if (!usesStartMultipliers(plant)) return undefined;
  const light = data.rooms.find((r) => r.id === plant.roomId)?.light;
  return {
    ...(plant.potDiameterCm === undefined ? {} : { potDiameterCm: plant.potDiameterCm }),
    ...(plant.potMaterial === undefined ? {} : { potMaterial: plant.potMaterial }),
    ...(light === undefined ? {} : { light }),
  };
}

/** Id of the space the UI shows: the first one. */
export function activeSpaceId(data: Pick<AppData, "spaces">): string {
  return data.spaces[0]?.id ?? DEFAULT_SPACE_ID;
}

/**
 * One space as a self-contained app state: only its plants, rooms and drafts, its away days as the
 * preferences' `unavailableDates`, and only that space in `spaces`. Everything that plans or lists
 * works on a view like this, so spaces can never mix.
 */
export function spaceView(data: AppData, spaceId: string = activeSpaceId(data)): AppData {
  const space = data.spaces.find((s) => s.id === spaceId) ?? {
    id: spaceId,
    name: spaceId,
    awayDates: [],
  };
  const plants = data.plants.filter((p) => p.spaceId === spaceId);
  const ids = new Set(plants.map((p) => p.id));
  return {
    ...data,
    spaces: [space],
    plants,
    rooms: data.rooms.filter((r) => r.spaceId === spaceId),
    ...(data.drafts === undefined
      ? {}
      : { drafts: data.drafts.filter((d) => d.spaceId === spaceId) }),
    ...(data.pins === undefined ? {} : { pins: data.pins.filter((p) => ids.has(p.plantId)) }),
    settings: {
      ...data.settings,
      prefs: { ...data.settings.prefs, unavailableDates: space.awayDates },
    },
  };
}

export function emptyData(): AppData {
  return {
    spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
    plants: [],
    rooms: [],
    settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
  };
}
