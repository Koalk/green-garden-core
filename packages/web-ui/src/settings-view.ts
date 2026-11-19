// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Planning and Settings tabs. Planning holds what decides when to water: away
 * days, the days you cannot or prefer to water, watering before a trip and the plan length. Settings holds
 * the preferences: amounts, who lives with the plants, language, week start, hemisphere and home, and the
 * optional jug measurement. Each tab saves its own form and leaves the other's fields alone.
 */
import { COUNTRIES, spaceView, type AppData } from "@green-garden/storage";
import { LOCALES, getLocale, isMachineTranslated, weekdayName } from "@green-garden/i18n";
import { setDisplay, setHome, setLanguage, setPrefs, setSettings } from "./actions.ts";
import { draftFromSettings, type HomeDraft } from "@green-garden/bulk";
import { MEASURES, amountPrefs } from "./amount.ts";
import { awayCareHtml } from "./away-care.ts";
import { calibrationHtml } from "./calibration.ts";
import { homeSettingsHtml } from "./home-view.ts";
import { NO_FILL } from "./modal.ts";
import { esc, t, tHtml } from "./text.ts";
import { preLeaveOn, weekStartOf } from "./view.ts";
import { getWeatherState, weatherSettingsHtml } from "./weather-view.ts";

export const PETS = ["cat", "dog", "small_pet"] as const;

/** What a submitted form offers; `FormData` and `URLSearchParams` both fit. */
export interface FormFields {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

function num(f: FormFields, k: string): number | undefined {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : undefined;
}

function text(f: FormFields, k: string): string | undefined {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function dayChecks(data: AppData, name: string, chosen: readonly number[]): string {
  return Array.from({ length: 7 }, (_, k) => (weekStartOf(data, getLocale()) + k) % 7)
    .map(
      (i) =>
        `<label><input type="checkbox" name="${name}" value="${i}"${chosen.includes(i) ? " checked" : ""}> ${esc(weekdayName(i, getLocale(), "short"))}</label>`,
    )
    .join(" ");
}

export function planningHtml(data: AppData, today: string): string {
  const prefs = spaceView(data).settings.prefs;
  const away = (prefs.unavailableDates ?? [])
    .map(
      (d) =>
        `<li>${esc(d)} <button data-action="remove-away" data-date="${esc(d)}" aria-label="${tHtml("holidays.ariaRemove", { date: d })}">${esc(t("common.remove"))}</button></li>`,
    )
    .join("");
  return `<section id="away"><h2>${esc(t("planning.heading"))}</h2>
    <form data-form="away"><label>${esc(t("holidays.from"))} <input name="from" type="date" ${NO_FILL} required></label>
    <label>${esc(t("holidays.to"))} <input name="to" type="date" ${NO_FILL} required></label><button type="submit">${esc(t("holidays.add"))}</button></form>
    <ul>${away === "" ? `<li>${esc(t("holidays.none"))}</li>` : away}</ul>
    ${awayCareHtml(data, today)}
    <form data-form="planning">
      <fieldset><legend>${esc(t("holidays.cannotWater"))}</legend>${dayChecks(data, "unavailableWeekdays", prefs.unavailableWeekdays ?? [])}</fieldset>
      <fieldset><legend>${esc(t("holidays.preferWater"))}</legend>${dayChecks(data, "preferredWeekdays", prefs.preferredWeekdays ?? [])}</fieldset>
      <p><label><input type="checkbox" name="preLeaveWatering"${preLeaveOn(prefs) ? " checked" : ""}>
        ${esc(t("holidays.preLeave"))}</label></p>
      <p><label>${esc(t("holidays.horizon"))} <input name="horizonDays" type="number" autocomplete="off" min="7" max="120" value="${data.settings.horizonDays}"></label></p>
      <button type="submit">${esc(t("planning.save"))}</button></form></section>`;
}

export function savePlanning(data: AppData, f: FormFields): AppData {
  const days = (k: string): number[] => f.getAll(k).map(Number);
  return setSettings(
    setPrefs(data, {
      unavailableWeekdays: days("unavailableWeekdays"),
      preferredWeekdays: days("preferredWeekdays"),
      preLeaveWatering: f.get("preLeaveWatering") !== null,
    }),
    { horizonDays: Math.min(120, Math.max(7, Math.round(num(f, "horizonDays") ?? 28))) },
  );
}

function pick<T extends string>(
  name: string,
  values: readonly T[],
  chosen: T,
  label: (v: T) => string,
): string {
  return `<select name="${name}">${values
    .map((v) => `<option value="${v}"${v === chosen ? " selected" : ""}>${esc(label(v))}</option>`)
    .join("")}</select>`;
}

/** How amounts are shown, and who lives with the plants (toxicity speaks to them). */
function displaySettings(data: AppData): string {
  const prefs = amountPrefs(data.settings);
  const home = data.settings.household;
  const box = (name: string, value: string, checked: boolean, label: string): string =>
    `<label><input type="checkbox" name="${name}" value="${value}"${checked ? " checked" : ""}> ${esc(label)}</label>`;
  return `<p><label>${esc(t("settings.measure"))} ${pick("measure", MEASURES, prefs.measure, (v) => t(`measure.${v}`))}</label>
      <label>${esc(t("settings.amountMode"))} ${pick("amountMode", ["qualitative", "precise"] as const, prefs.mode, (v) => t(`mode.${v}`))}</label>
      <label>${esc(t("settings.wording"))} ${pick("wording", ["uk", "us"] as const, prefs.wording, (v) => t(`wording.${v}`))}</label></p>
    <fieldset><legend>${esc(t("settings.household"))}</legend>
      ${PETS.map((p) => box("pets", p, home?.pets.includes(p) === true, t(`tox.who.${p}`))).join(" ")}
      ${box("children", "1", home?.children === true, t("tox.who.child"))}</fieldset>`;
}

function languageSettings(data: AppData): string {
  const chosen = data.settings.locale ?? "auto";
  const languages = LOCALES.map(
    (l) =>
      `<option value="${esc(l.tag)}"${chosen === l.tag ? " selected" : ""}>${esc(l.name)}${l.machine ? ` (${esc(t("settings.machine"))})` : ""}</option>`,
  ).join("");
  const start = data.settings.weekStart;
  const days = [1, 0, 6]
    .map(
      (d) =>
        `<option value="${d}"${start === d ? " selected" : ""}>${esc(weekdayName(d, getLocale(), "long"))}</option>`,
    )
    .join("");
  const note = isMachineTranslated(getLocale())
    ? `<p class="notice"><small>${esc(t("settings.machine"))}</small></p>`
    : "";
  return `<p><label>${esc(t("settings.language"))} <select name="locale">
      <option value="auto"${chosen === "auto" ? " selected" : ""}>${esc(t("settings.languageAuto"))}</option>${languages}</select></label>
      <label>${esc(t("settings.weekStart"))} <select name="weekStart">
      <option value="auto"${start === undefined ? " selected" : ""}>${esc(t("settings.weekStartAuto"))}</option>${days}</select></label></p>${note}`;
}

/** Hemisphere and home: where the rest season falls and how long it lasts. */
function placeSettings(data: AppData): string {
  const s = data.settings;
  return `<p><label>${esc(t("settings.hemisphere"))} <select name="hemisphere">
        <option value="north"${s.hemisphere === "north" ? " selected" : ""}>${esc(t("settings.north"))}</option>
        <option value="south"${s.hemisphere === "south" ? " selected" : ""}>${esc(t("settings.south"))}</option></select></label>
      <label>${esc(t("settings.country"))} <select name="country">
        <option value="auto"${s.country === undefined ? " selected" : ""}>${esc(t("settings.countryAuto"))}</option>${COUNTRIES.map((c) => `<option value="${c}"${s.country === c ? " selected" : ""}>${esc(t(`settings.countryOption.${c}`))}</option>`).join("")}</select></label></p>`;
}

/**
 * Settings: the preferences, then the optional jug measurement for people who want it, behind one quiet
 * button. The defaults are safe assumptions; each honest log nudges a plant's interval without it.
 */
export function settingsHtml(
  data: AppData,
  home: HomeDraft = draftFromSettings(data.settings),
): string {
  return `<section id="settings"><h2>${esc(t("settings.heading"))}</h2>
    <form data-form="settings">
      ${displaySettings(data)}
      ${languageSettings(data)}
      ${placeSettings(data)}
      <button type="submit">${esc(t("settings.save"))}</button></form>
    ${homeSettingsHtml(home)}
    ${weatherSettingsHtml(data, getWeatherState())}
    <details><summary>${esc(t("settings.measureWater"))}</summary>${calibrationHtml(data)}</details></section>`;
}

export function saveSettings(data: AppData, f: FormFields): AppData {
  const week = text(f, "weekStart");
  const display = setDisplay(
    setHome(
      setSettings(data, { hemisphere: text(f, "hemisphere") === "south" ? "south" : "north" }),
      text(f, "country"),
    ),
    {
      measure: MEASURES.find((m) => m === text(f, "measure")) ?? "mug",
      amountMode: text(f, "amountMode") === "precise" ? "precise" : "qualitative",
      wording: text(f, "wording") === "us" ? "us" : "uk",
      pets: PETS.filter((p) => f.getAll("pets").includes(p)),
      children: f.get("children") !== null,
    },
  );
  return setLanguage(display, {
    locale: text(f, "locale"),
    weekStart: week === undefined || week === "auto" ? undefined : Number(week),
  });
}
