// SPDX-License-Identifier: AGPL-3.0-only

export { buildPlanInput, fold, makePlan, planToIcs } from "./calendar.ts";
export {
  FORMAT,
  VERSION,
  exportData,
  importData,
  type ImportIssue,
  type ImportOptions,
  type ImportResult,
} from "./exchange.ts";
export {
  earlierWateringRange,
  logOutcome,
  logWateredEarlier,
  pinPreLeave,
  withPins,
} from "./log.ts";
export { migrate } from "./migrate.ts";
export {
  ZERO_STAMP,
  compareStamps,
  createClock,
  formatStamp,
  isStamp,
  parseStamp,
  type Clock,
  type Stamp,
} from "./sync/clock.ts";
export { derivedId, newId } from "./sync/ids.ts";
export {
  HOUSEHOLD_PREFS_KEYS,
  HOUSEHOLD_SETTINGS_KEYS,
  HOUSEHOLD_TOP_KEYS,
  PERSONAL_SETTINGS_KEYS,
  PERSONAL_TOP_KEYS,
} from "./sync/keys.ts";
export {
  DEFAULT_REMINDER_TIME,
  DEFAULT_SPACE_ID,
  PLACEMENTS,
  PLANT_SIZES,
  SUNS,
  GROUND_SOILS,
  DRAUGHTS,
  CLIMATES,
  DORMANCIES,
  DROUGHT_TOLERANCES,
  ESTABLISHMENT_SEASONS,
  ROOT_DEPTHS,
  WINTER_MINS,
  type WinterMin,
  POT_MATERIALS,
  SOIL_TYPES,
  SOURCED_FIELDS,
  activeSpaceId,
  invalidPlants,
  assumedMarginDays,
  COUNTRIES,
  COUNTRY_LATITUDE,
  homeLatitude,
  type Country,
  startFactsFor,
  usesStartMultipliers,
  fieldSource,
  type FieldSource,
  type SourcedField,
  spaceView,
  type Space,
  emptyData,
  type AppData,
  type PlantCheckpoint,
  type Stamps,
  type SyncBlock,
  type SyncMember,
  type Plant,
  type PlantBatch,
  type PlantDraft,
  type ReminderSettings,
  type WeatherSettings,
  type Room,
  type Settings,
  type PlantQuestionState,
  type SeasonalCardState,
} from "./model.ts";
export { BrowserStore, MemoryStore, type KeyValue, type LoadReport, type Store } from "./store.ts";
export { setWeather, weatherSettings } from "./weather-settings.ts";
export {
  CHECKPOINT_CUTOFF_DAYS,
  TOMBSTONE_KEEP_DAYS,
  merge,
  mergeInbox,
  resolve,
  type Conflict,
  type MergeOptions,
  type MergeResult,
  type Remap,
} from "./sync/merge.ts";
