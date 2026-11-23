// SPDX-License-Identifier: AGPL-3.0-only

import { t } from "@green-garden/i18n";
import {
  VERSION,
  plantProblem,
  plantText,
  type Plant,
  type PlantProblem,
} from "@green-garden/storage";
import { esc } from "./text.ts";

/** Where "Ask for help" goes: a prefilled issue on the public core repo. Nothing is sent from the page. */
export const HELP_ISSUE_URL = "https://github.com/Koalk/green-garden-core/issues/new";
/** The longest prefilled address we open; past this the plant's JSON is cut and the export is asked for. */
export const MAX_ISSUE_URL = 8000;

/** What the open card of one unreadable plant is showing. */
export interface UnreadableUi {
  readonly id: string;
  readonly mode: "data" | "help";
  /** The text in the box: the plant's JSON, or the issue text. */
  readonly text: string;
  /** Why the last "Check and save" did not read. */
  readonly problem?: PlantProblem;
}

/** The reason in plain words, in the UI's language. Never a raw key and never "NaN". */
export function problemText(p: PlantProblem): string {
  switch (p.kind) {
    case "notObject":
      return t("unreadable.reason.notObject");
    case "notJson":
      return t("unreadable.reason.notJson");
    case "duplicateId":
      return t("unreadable.reason.duplicateId", { value: p.value });
    case "badValue":
      if (p.field === "id") return t("unreadable.reason.id");
      if (p.field === "style") {
        return p.value === undefined
          ? t("unreadable.reason.styleNone")
          : t("unreadable.reason.style", { value: p.value });
      }
      return p.value === undefined
        ? t("unreadable.reason.intervalNone")
        : t("unreadable.reason.interval", { value: p.value });
    case "unknown":
      return t("unreadable.reason.unknown");
  }
}

/** The same reason for a public issue: English, field and value only. */
export function problemPlain(p: PlantProblem): string {
  switch (p.kind) {
    case "notObject":
      return "the plant is not an object";
    case "notJson":
      return "the plant text is not valid JSON";
    case "duplicateId":
      return `duplicate id "${p.value}"`;
    case "badValue":
      return p.value === undefined
        ? `${p.field} is missing`
        : `${p.field} has the value "${p.value}", which is not valid`;
    case "unknown":
      return "unknown";
  }
}

/** The text "Ask for help" would post: versions, the reason and the plant's JSON. */
export function helpBody(plant: Plant): string {
  return [
    `Green Garden web UI, data format version ${VERSION}.`,
    "",
    `A plant could not be read: ${problemPlain(plantProblem(plant))}.`,
    "",
    "The plant's data:",
    "```json",
    plantText(plant),
    "```",
  ].join("\n");
}

const CUT_NOTE =
  "\n\n[The plant's data was cut short here: I can attach my exported file instead.]";
export const HELP_TITLE = "A plant could not be read";

function issueAddress(body: string): string {
  return `${HELP_ISSUE_URL}?title=${encodeURIComponent(HELP_TITLE)}&body=${encodeURIComponent(body)}`;
}

/** The body cut to what fits in an address under the limit, with a note when it was cut. */
export function fitHelpBody(body: string): string {
  if (issueAddress(body).length <= MAX_ISSUE_URL) return body;
  let n = body.length;
  while (n > 0 && issueAddress(body.slice(0, n) + CUT_NOTE).length > MAX_ISSUE_URL) {
    n = Math.floor(n * 0.9);
  }
  return body.slice(0, n) + CUT_NOTE;
}

/** The address "Open GitHub" opens in a new tab, always under the limit. */
export function helpUrl(body: string): string {
  return issueAddress(fitHelpBody(body));
}

/**
 * The card of a plant a store load could not read: what is wrong in plain words and three ways out,
 * never the care words, a next date or raw keys.
 */
export function unreadableCardHtml(plant: Plant, ui: UnreadableUi | undefined): string {
  const id = esc(plant.id);
  const name = esc(plant.name);
  const open = ui?.id === plant.id ? ui : undefined;
  const reason = problemText(plantProblem(plant));
  const btn = (action: string, label: string, aria: string): string =>
    `<button data-action="${action}" data-id="${id}" aria-label="${esc(aria)}: ${name}">${esc(label)}</button>`;
  let panel = "";
  if (open?.mode === "data") {
    panel = `<div class="unreadable-panel"><p><small>${esc(t("unreadable.dataNote"))}</small></p>
      <textarea name="unreadable-text" rows="14" spellcheck="false" aria-label="${esc(t("unreadable.dataLabel"))}">${esc(open.text)}</textarea>
      ${open.problem === undefined ? "" : `<p class="err" role="alert">${esc(t("unreadable.notSaved", { reason: problemText(open.problem) }))}</p>`}
      <p><button data-action="unreadable-check" data-id="${id}">${esc(t("unreadable.check"))}</button>
      <button data-action="unreadable-close" data-id="${id}" class="secondary">${esc(t("unreadable.close"))}</button></p></div>`;
  } else if (open?.mode === "help") {
    panel = `<div class="unreadable-panel"><p><strong>${esc(t("unreadable.helpHeading"))}</strong></p>
      <p><small>${esc(t("unreadable.helpNote"))}</small></p>
      <textarea name="unreadable-text" rows="14" spellcheck="false" aria-label="${esc(t("unreadable.helpLabel"))}">${esc(fitHelpBody(open.text))}</textarea>
      <p><button data-action="unreadable-open-issue" data-id="${id}">${esc(t("unreadable.openIssue"))}</button>
      <button data-action="unreadable-close" data-id="${id}" class="secondary">${esc(t("unreadable.close"))}</button></p></div>`;
  }
  return `<article class="card unreadable"><h4>${name}</h4>
    <p><span class="err badge">${esc(t("unreadable.title"))}</span></p>
    <p>${esc(reason)}</p>
    <p>${btn("unreadable-see", t("unreadable.see"), t("unreadable.see"))}
      ${btn("unreadable-help", t("unreadable.help"), t("unreadable.help"))}
      ${btn("delete", t("common.delete"), t("common.delete"))}</p>${panel}</article>`;
}
