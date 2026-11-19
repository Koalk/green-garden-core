// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Q-K0 markup: the region list, the follow-ups, the suggested climate and winter
 * minimum and the two selects that let the person change them. The same form sits in Settings and in the
 * dialog that gates the first plant outdoors; the rules (the gate, the draft) live in `@green-garden/bulk`.
 */
import {
  HOME_REGIONS,
  followUpsOf,
  suggestionOf,
  type HomeDraft,
  type HomeRegion,
} from "@green-garden/bulk";
import { getLocale } from "@green-garden/i18n";
import { CLIMATES, WINTER_MINS } from "@green-garden/storage";
import { esc, t } from "./text.ts";

type Text = Readonly<Record<"en-GB" | "es" | "it", string>>;

/** A question-bank text in the active language, English when the language has none. */
function words(text: Text): string {
  const locale = getLocale();
  return (text as Readonly<Record<string, string>>)[locale] ?? text["en-GB"];
}

function option(value: string, label: string, chosen: boolean): string {
  return `<option value="${esc(value)}"${chosen ? " selected" : ""}>${esc(label)}</option>`;
}

function regionSelect(d: HomeDraft): string {
  const group = (country: HomeRegion["country"]): string =>
    `<optgroup label="${esc(t(`home.country.${country}`))}">${HOME_REGIONS.filter(
      (r) => r.country === country,
    )
      .map((r) => option(r.id, words(r.label), r.id === d.regionId))
      .join("")}</optgroup>`;
  return `<label>${esc(t("home.region"))}
    <select name="homeRegion" data-home="region">${option("", t("home.regionNone"), d.regionId === undefined)}${group("GB")}${group("ES")}</select></label>`;
}

function followUpSelects(d: HomeDraft): string {
  return followUpsOf(d)
    .map((f, i) => {
      const answered = d.answers[i];
      return `<label>${esc(words(f.question))}
        <select name="homeFollow${String(i)}" data-home="follow" data-index="${String(i)}">${option("", t("home.followUpNone"), answered === undefined)}${f.options
          .map((o) => option(o.id, words(o.label), o.id === answered))
          .join("")}</select></label>`;
    })
    .join("");
}

/** "Going by: <region>, <answers>": the one-line reason for the suggestion. */
function reason(d: HomeDraft): string {
  const region = HOME_REGIONS.find((r) => r.id === d.regionId);
  if (region === undefined) return "";
  const answers = followUpsOf(d).flatMap((f, i) => {
    const o = f.options.find((x) => x.id === d.answers[i]);
    return o === undefined ? [] : [`${words(f.question)} ${words(o.label)}`];
  });
  return [words(region.label), ...answers].join("; ");
}

function suggestionLine(d: HomeDraft): string {
  if (d.regionId === undefined) return "";
  const s = suggestionOf(d);
  if (s === undefined) return `<p><small>${esc(t("home.needAnswer"))}</small></p>`;
  return `<p class="notice"><small>${esc(
    t("home.suggested", {
      climate: t(`home.climate.${s.climate}`),
      winter: t(`home.winter.${s.winterMin}`),
      why: reason(d),
    }),
  )}</small></p>`;
}

/** The Q-K0 form. `gate` adds the "Not now" button used by the dialog before the first outdoor plant. */
export function homeFormHtml(d: HomeDraft, gate = false): string {
  const climates = CLIMATES.map((c) => option(c, t(`home.climate.${c}`), c === d.climate)).join("");
  const winters = WINTER_MINS.map((w) => option(w, t(`home.winter.${w}`), w === d.winterMin)).join(
    "",
  );
  return `<form data-form="home">
    ${regionSelect(d)}${followUpSelects(d)}${suggestionLine(d)}
    <label>${esc(t("home.climate"))}
      <select name="homeClimate" data-home="climate">${option("", t("home.followUpNone"), d.climate === undefined)}${climates}</select></label>
    <label>${esc(t("home.winterMin"))}
      <select name="homeWinterMin" data-home="winterMin">${option("", t("home.followUpNone"), d.winterMin === undefined)}${winters}</select></label>
    <p><button type="submit">${esc(t("home.save"))}</button>${
      gate
        ? ` <button type="button" class="secondary" data-action="home-cancel">${esc(t("home.cancel"))}</button>`
        : ""
    }</p></form>`;
}

/** Settings: Q-K0 under its own heading, saved on its own (like the Planning and Settings forms). */
export function homeSettingsHtml(d: HomeDraft): string {
  return `<section id="home"><h3>${esc(t("home.title"))}</h3><p><small>${esc(t("home.intro"))}</small></p>${homeFormHtml(d)}</section>`;
}

/** The dialog that asks Q-K0 before the first plant outdoors is saved. */
export function homeDialogHtml(d: HomeDraft): string {
  return `<dialog id="home-modal" aria-labelledby="home-title"><article>
    <header><h2 id="home-title">${esc(t("home.gateTitle"))}</h2></header>
    <p>${esc(t("home.gateIntro"))}</p>${homeFormHtml(d, true)}</article></dialog>`;
}
