// SPDX-License-Identifier: AGPL-3.0-only

export {
  CommonsPhotos,
  commonsInfoRequest,
  parseCommonsInfo,
  type CommonsPhoto,
} from "./commons.ts";
export type { Fetcher, FetchInit, FetchResult, KeyValue } from "./http.ts";
export {
  openPlantbookDetail,
  openPlantbookSearch,
  parseOpenPlantbookDetail,
  parseOpenPlantbookSearch,
  type OpenPlantbookDetail,
  type OpenPlantbookHit,
} from "./openplantbook.ts";
export {
  HA_AREAS_TEMPLATE,
  HomeAssistantAreas,
  ProxyAreas,
  parseHaAreas,
  type Area,
  type AreaFailure,
  type AreaResult,
  type AreaSource,
  type PostResult,
  type Poster,
} from "./home-assistant.ts";
export { OPEN_METEO_ATTRIBUTION, OpenMeteo, openMeteoUrl, parseOpenMeteo } from "./open-meteo.ts";
export {
  EA_ATTRIBUTION,
  EnvironmentAgency,
  dailyTotalsFromReadings,
  eaReadingsUrl,
  eaStationsUrl,
  parseEaReadings,
  parseEaStations,
  type EaReading,
} from "./environment-agency.ts";
export {
  AEMET_ATTRIBUTION,
  Aemet,
  aemetCoord,
  aemetDailyUrl,
  aemetStationsUrl,
  parseAemetDaily,
  parseAemetEnvelope,
  parseAemetStations,
} from "./aemet.ts";
export {
  SEPA_ATTRIBUTION,
  Sepa,
  parseSepaDaily,
  parseSepaStations,
  sepaDailyUrl,
  sepaStationsUrl,
} from "./sepa.ts";
export {
  FORECAST_DAYS,
  GAUGE_RADIUS_KM,
  MAX_STATIONS,
  PAST_DAYS,
  combineGauges,
  mergeRain,
  rainReport,
  weightedMedian,
  type CombinedDay,
  type RainReport,
  type StationDays,
} from "./rain.ts";
export { RAIN_SOURCES, type RainSource } from "./rain-sources.ts";
export {
  WeatherService,
  aemetKeyStatus,
  buildWeatherService,
  candidateGauges,
  type AemetKeyStatus,
  type CacheStore,
  type GaugeId,
  type WeatherNotice,
  type WeatherReply,
  type WeatherServiceOptions,
} from "./weather-service.ts";
export {
  haversineKm,
  roundPoint,
  toWeatherDays,
  type DayBoundary,
  type GaugeDay,
  type GaugeProvider,
  type GaugeStation,
  type GeoPoint,
  type Provenance,
  type ProviderResult,
  type RainDay,
  type WeatherProvider,
} from "./weather.ts";
