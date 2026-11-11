// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Weather on the screens (02k 11): the "measured" and "estimated" marks on credited rain with
 * the station and its distance, the credit lines next to them, the Settings switch with the optional home
 * point, and the "Data sources" block. The engine only ever gets `weatherDays`; nothing here changes a plan.
 */
import type { WeatherDay } from "@green-garden/engine";
import {
  RAIN_SOURCES,
  SEPA_ATTRIBUTION,
  type GeoPoint,
  type RainSource,
  type WeatherReply,
} from "@green-garden/providers";
import { setWeather, type AppData } from "@green-garden/storage";
import type { WeatherFailure } from "./weather-client.ts";
import { NO_FILL } from "./modal.ts";
import { esc, t, tHtml } from "./text.ts";

/** What the app knows about the rain right now. */
export interface WeatherState {
  readonly reply?: WeatherReply;
  /** The last lookup failed (an older `reply`, if any, is still shown). */
  readonly failure?: WeatherFailure;
  readonly loading?: boolean;
}

let current: WeatherState = {};

/** The rain state the screens draw from; the app sets it after each lookup. */
export function getWeatherState(): WeatherState {
  return current;
}

export function setWeatherState(state: WeatherState): void {
  current = state;
}

/** The home point, only while weather is switched on. */
export function weatherPoint(data: AppData): GeoPoint | undefined {
  const w = data.settings.weather;
  return w?.enabled === true && w.lat !== undefined && w.lon !== undefined
    ? { lat: w.lat, lon: w.lon }
    : undefined;
}

/** The days the plan takes: none unless weather is on with a point (manual rain always works). */
export function weatherDays(data: AppData, state: WeatherState): readonly WeatherDay[] {
  return weatherPoint(data) === undefined ? [] : (state.reply?.days ?? []);
}

const round1 = (x: number): string => String(Math.round(x * 10) / 10);

/** How many of the last days to list. */
const RECENT_DAYS = 7;

function minusDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The rain that was credited in the last week, each day marked measured (with the station and its
 * distance) or estimated, and the credit lines of every source behind it. Empty without an answer.
 */
export function rainDetailHtml(state: WeatherState, today: string): string {
  const reply = state.reply;
  if (reply === undefined) return "";
  const from = minusDays(today, RECENT_DAYS - 1);
  const rows = reply.days
    .filter((d) => d.forecast !== true && d.date >= from && d.date <= today && d.rainMm > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((d) => {
      const p = reply.provenance.find((x) => x.day === d.date);
      const measured = (d.kind ?? p?.kind) !== "modelled";
      const where =
        measured && p?.stationLabel !== undefined
          ? ` <small>${tHtml("weather.rain.at", {
              station: p.stationLabel,
              km: p.distanceKm === undefined ? "?" : round1(p.distanceKm),
            })}</small>`
          : "";
      const mark = measured ? "measured" : "estimated";
      return `<li>${tHtml("weather.rain.line", { date: d.date, mm: round1(d.rainMm) })}
        <span class="mark mark-${mark}">${esc(t(`weather.mark.${mark}`))}</span>${where}</li>`;
    })
    .join("");
  const credits = reply.attributions.map(esc).join("; ");
  return `<div class="weather-rain"><h4>${esc(t("weather.rain.heading"))}</h4>
    ${rows === "" ? `<p><small>${esc(t("weather.rain.none"))}</small></p>` : `<ul>${rows}</ul>`}
    ${reply.stale === true ? `<p><small>${esc(t("weather.rain.stale"))}</small></p>` : ""}
    ${credits === "" ? "" : `<p><small>${esc(t("weather.rain.credits"))} ${credits}</small></p>`}</div>`;
}

/** The proper names of the sources (not language). */
const SOURCE_NAMES: Readonly<Record<RainSource["id"], string>> = {
  "open-meteo": "Open-Meteo",
  "environment-agency": "Environment Agency",
  aemet: "AEMET",
  sepa: "SEPA",
};

/** The credit line as shown: SEPA's names its year, which the registry leaves as a placeholder. */
function creditLine(s: RainSource): string {
  return s.id === "sepa" ? SEPA_ATTRIBUTION : s.attribution;
}

/** Every source and the credit line it asks for. */
export function dataSourcesHtml(): string {
  const items = RAIN_SOURCES.map(
    (s) =>
      `<li><strong>${esc(SOURCE_NAMES[s.id])}</strong> (${esc(t(`weather.region.${s.id}`))})<br>
      <small>${esc(creditLine(s))}<br>${esc(t("weather.sources.licence", { licence: s.licenceId }))}</small></li>`,
  ).join("");
  return `<details id="data-sources"><summary>${esc(t("weather.sources.heading"))}</summary>
    <p><small>${esc(t("weather.sources.intro"))}</small></p><ul>${items}</ul></details>`;
}

function noticeText(n: WeatherReply["notices"][number]): string {
  return t(`weather.notice.${n.code}`, { days: n.daysLeft ?? 0 });
}

function statusHtml(data: AppData, state: WeatherState): string {
  const w = data.settings.weather;
  if (w?.enabled !== true) return "";
  const lines: string[] = [];
  if (weatherPoint(data) === undefined) lines.push(t("weather.status.noPoint"));
  else if (state.failure !== undefined) lines.push(t(`weather.status.${state.failure}`));
  else if (state.loading === true && state.reply === undefined) {
    lines.push(t("weather.status.loading"));
  }
  if (state.reply?.stale === true) lines.push(t("weather.rain.stale"));
  for (const n of state.reply?.notices ?? []) lines.push(noticeText(n));
  return lines.length === 0
    ? ""
    : `<div role="status">${lines.map((l) => `<p class="notice"><small>${esc(l)}</small></p>`).join("")}</div>`;
}

/** The weather form in Settings (off by default), its status lines, and the Data sources block. */
export function weatherSettingsHtml(data: AppData, state: WeatherState): string {
  const w = data.settings.weather;
  const coord = (name: string, value: number | undefined, label: string, max: number): string =>
    `<label>${esc(label)} <input name="${name}" type="number" step="0.01" min="-${String(max)}" max="${String(max)}" inputmode="decimal" ${NO_FILL} value="${value === undefined ? "" : String(value)}"></label>`;
  return `<section id="weather"><h3>${esc(t("weather.heading"))}</h3>
    <p><small>${esc(t("weather.help"))}</small></p>
    <form data-form="weather">
      <p><label><input type="checkbox" name="enabled"${w?.enabled === true ? " checked" : ""}> ${esc(t("weather.enable"))}</label></p>
      <p>${coord("lat", w?.lat, t("weather.lat"), 90)} ${coord("lon", w?.lon, t("weather.lon"), 180)}
        <button type="button" class="secondary" data-action="weather-locate">${esc(t("weather.locate"))}</button></p>
      <button type="submit">${esc(t("weather.save"))}</button></form>
    ${statusHtml(data, state)}
    ${dataSourcesHtml()}</section>`;
}

/** What a submitted weather form offers; `FormData` and `URLSearchParams` both fit. */
interface Fields {
  get(name: string): unknown;
}

function coordinate(f: Fields, k: string): number | undefined {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : undefined;
}

/** Saves the switch and the home point (rounded to 2 decimals by storage); leaves every other setting alone. */
export function saveWeather(data: AppData, f: Fields): AppData {
  const lat = coordinate(f, "lat");
  const lon = coordinate(f, "lon");
  return setWeather(data, {
    enabled: f.get("enabled") !== null,
    ...(lat === undefined ? {} : { lat }),
    ...(lon === undefined ? {} : { lon }),
  });
}
