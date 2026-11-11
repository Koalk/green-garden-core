// SPDX-License-Identifier: AGPL-3.0-only

/** Markup for the question side: the "!", one question at a time, the improve list, the detail rows. */
import {
  COMMON_TEXT,
  type Locale,
  type Question,
  type QuestionText,
} from "@green-garden/questions";
import { getLocale } from "@green-garden/i18n";
import { spaceView, type AppData } from "@green-garden/storage";
import { ROOM_PREFIX, detailRows, improveRows, optionsOf, type Ask, type Chip } from "./improve.ts";

/** "Aloe vera 2" and "Aloe vera" are one kind of plant: the name a group's line speaks of. */
function groupName(data: AppData, plantId: string): string {
  const name = data.plants.find((p) => p.id === plantId)?.name ?? "";
  return name.replace(/\s+\d+$/, "").toLowerCase();
}
import { esc, t, tHtml } from "./text.ts";

/** The UI language when the question bank has it, else English. */
function localeOf(): Locale {
  const tag = getLocale();
  return tag === "es" || tag === "it" ? tag : "en-GB";
}

/** The question's wording in the UI language, falling back to English. */
export function questionText(q: Question): QuestionText {
  return q.text[localeOf()];
}

function commonText() {
  return COMMON_TEXT[localeOf()];
}

/** The small "!" next to a plant or room with a voluntary question waiting. It never blocks anything. */
export function bangHtml(target: string, name: string): string {
  const label = target.startsWith(ROOM_PREFIX)
    ? tHtml("ask.ariaRoom", { name })
    : tHtml("ask.aria", { name });
  return `<button class="bang" data-action="ask" data-target="${esc(target)}" aria-label="${label}">!</button>`;
}

function answerButtons(data: AppData, q: Question, target: string, mode: "run" | "list"): string {
  const text = questionText(q);
  return optionsOf(data, q, text.options, text.options["none"] ?? t("improve.skip"))
    .map(
      (o) =>
        `<button data-action="answer" data-mode="${mode}" data-target="${esc(target)}" data-q="${esc(q.id)}" data-value="${esc(o.value)}">${esc(o.label)}</button>`,
    )
    .join(" ");
}

function nameOf(data: AppData, target: string): string {
  if (target.startsWith(ROOM_PREFIX)) {
    return data.rooms.find((r) => r.id === target.slice(ROOM_PREFIX.length))?.name ?? target;
  }
  return data.plants.find((p) => p.id === target)?.name ?? target;
}

/** One question with its options, a skip, and snooze and never-ask. Plain wording; the Stories layer adds flavour. */
export function askHtml(data: AppData, ask: Ask, waiting: number): string {
  const { target, question: q } = ask;
  const name = nameOf(data, target);
  const common = commonText();
  const heading = target.startsWith(ROOM_PREFIX)
    ? tHtml("ask.headingRoom", { name })
    : tHtml("ask.heading", { name });
  const act = (action: string, label: string, cls = "secondary"): string =>
    `<button class="${cls}" data-action="${action}" data-target="${esc(target)}" data-q="${esc(q.id)}">${esc(label)}</button>`;
  return `<article id="ask" aria-live="polite"><h3>${heading}</h3>
    <p><strong>${esc(questionText(q).question)}</strong></p>
    <p class="chips">${answerButtons(data, q, target, "run")}</p>
    <p class="chips">${act("ask-later", common.askLater)} ${act("ask-skip", t("ask.skip"))}
      ${act("ask-never", common.neverAsk)}
      ${target.startsWith(ROOM_PREFIX) ? "" : act("ask-never-plant", common.neverAskPlant)}
      <button class="secondary" data-action="ask-close">${esc(t("ask.close"))}</button></p>
    <p><small>${esc(t("ask.another", { n: waiting }))}</small></p></article>`;
}

/** What shows in place of the question once a run is over. */
export function askEndHtml(plenty: boolean): string {
  return `<article id="ask" aria-live="polite"><p>${esc(t(plenty ? "ask.plenty" : "ask.none"))}
    <button class="secondary" data-action="ask-close">${esc(t("ask.close"))}</button></p></article>`;
}

const CHIP_KEY: Readonly<Record<Chip, string>> = {
  you: "detail.chip.you",
  assumed: "detail.chip.assumed",
  learned: "detail.chip.learned",
};

/** A source chip: assumed values look softer (dashed outline, `~`). */
export function chipHtml(chip: Chip): string {
  const label = esc(t(CHIP_KEY[chip]));
  return `<small class="chip chip-${chip}">${chip === "assumed" ? "~ " : ""}${label}</small>`;
}

/** The detail rows of one plant: label, value, source chip and a select with the question's options. */
export function detailHtml(data: AppData, plantId: string): string {
  const rows = detailRows(data, plantId)
    .map((r) => {
      const q = r.question;
      const text = questionText(q);
      const options = optionsOf(data, q, text.options, text.options["none"] ?? t("detail.notSet"));
      const shown =
        r.value === undefined
          ? t("detail.notSet")
          : q.id === "Q-POT"
            ? t("detail.cm", { n: Number(r.value) })
            : q.id === "Q-ROOM"
              ? (spaceView(data).rooms.find((x) => x.id === r.value)?.name ?? r.value)
              : (text.options[r.value] ?? r.value);
      const select = `<select data-detail-q="${esc(q.id)}" data-target="${esc(plantId)}" aria-label="${esc(t("detail.change"))}: ${esc(t(`detail.row.${q.id}`))}">
        <option value="">${esc(t("detail.change"))}</option>${options
          .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
          .join("")}</select>`;
      const shared =
        r.sharedWith === 0
          ? ""
          : `<br><small class="shared">${esc(t("batch.also", { n: r.sharedWith, name: groupName(data, plantId) }))}</small>
            <button class="secondary" data-action="they-differ" data-target="${esc(plantId)}" data-q="${esc(q.id)}">${esc(t("batch.differ"))}</button>`;
      return `<dt>${esc(t(`detail.row.${q.id}`))}</dt><dd>${esc(shown)} ${chipHtml(r.chip)} ${select}${shared}</dd>`;
    })
    .join("");
  return `<h5>${esc(t("detail.heading"))}</h5><dl class="known">${rows}</dl>`;
}

/**
 * "Improve care info": every plant with an open field, with the same multiple-choice buttons inline.
 * Ignores pacing. `skipped` holds `target|question` pairs the user passed over in this view.
 */
export function improveHtml(data: AppData, today: string, skipped: ReadonlySet<string>): string {
  const rows = improveRows(data, today)
    .map((r) => ({
      ...r,
      questions: r.questions.filter((q) => !skipped.has(`${r.plant.id}|${q.id}`)),
    }))
    .filter((r) => r.questions.length > 0);
  const things = rows.reduce((n, r) => n + r.questions.length, 0);
  const common = commonText();
  const list = rows
    .map((r) => {
      const id = r.plant.id;
      const qs = r.questions
        .map(
          (q) => `<li><strong>${esc(questionText(q).question)}</strong>${
            (r.alsoFor[q.id] ?? 0) > 0
              ? ` <small class="shared">${esc(t("batch.also", { n: r.alsoFor[q.id] ?? 0, name: groupName(data, id) }))}</small>`
              : ""
          }<br>
          <span class="chips">${answerButtons(data, q, id, "list")}
          <button class="secondary" data-action="improve-skip" data-target="${esc(id)}" data-q="${esc(q.id)}">${esc(t("improve.skip"))}</button>
          <button class="secondary" data-action="ask-later" data-target="${esc(id)}" data-q="${esc(q.id)}">${esc(common.askLater)}</button>
          <button class="secondary" data-action="ask-never" data-target="${esc(id)}" data-q="${esc(q.id)}">${esc(common.neverAsk)}</button></span></li>`,
        )
        .join("");
      return `<article class="card"><h4>${esc(r.plant.name)}</h4>
        <p><small>${esc(t("improve.plantLine", { things: r.questions.length }))}</small>
        <button class="secondary" data-action="fill-all" data-id="${esc(id)}">${esc(t("improve.fillAll"))}</button></p>
        <ul>${qs}</ul></article>`;
    })
    .join("");
  return `<section id="improve"><h2>${esc(t("improve.heading"))}</h2>
    <p><a href="#plants">${esc(t("improve.back"))}</a></p>
    <p><small>${esc(t("improve.note"))}</small></p>
    <p><strong>${esc(t("improve.summary", { plants: rows.length, things }))}</strong></p>
    <form data-form="questions-setting"><label><input type="checkbox" name="questionsOff" data-questions-setting${data.settings.questions === "off" ? " checked" : ""}>
      ${esc(t("improve.questionsOff"))}</label></form>
    ${rows.length === 0 ? `<p>${esc(t("improve.empty"))}</p>` : `<div class="grid">${list}</div>`}</section>`;
}
