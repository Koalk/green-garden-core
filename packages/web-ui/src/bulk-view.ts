// SPDX-License-Identifier: AGPL-3.0-only

/** Markup of the bulk-add dialog: one function per step. Plain HTML strings, no DOM. */
import {
  assumedMarginDays,
  type AppData,
  type FieldSource,
  type PlantDraft,
} from "@green-garden/storage";
import {
  groupRows,
  placementOf,
  plantsForRow,
  typedCount,
  type BulkCandidate,
  type BulkRow,
  type BulkState,
  type Step,
} from "./bulk-flow.ts";
import { photoHtml, type PhotoInfo } from "./modal.ts";
import { SPECIES, type SpeciesRow } from "./pilot-data.ts";
import { esc, t, tHtml } from "./text.ts";
import { notSureWhatHtml } from "./learn.ts";

export interface BulkViewContext {
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly photos: ReadonlyMap<string, PhotoInfo>;
  readonly data: AppData;
  readonly today: string;
  readonly species?: readonly SpeciesRow[];
  /** The text came back from a saved draft. */
  readonly restored?: boolean;
  /** The garden question was dismissed: say why the save did not happen. */
  readonly gardenNote?: boolean;
}

const STEPS: readonly Step[] = ["type", "match", "place", "verify"];
const PLACEMENTS = ["indoor", "outdoor_pot", "ground"] as const;

const times = (n: number): string =>
  n > 1 ? ` <small>${esc(t("bulk.times", { n }))}</small>` : "";

function chip(action: string, attrs: string, label: string, pressed: boolean): string {
  return `<button type="button" class="chip" data-action="${action}" ${attrs} aria-pressed="${String(pressed)}">${esc(label)}</button>`;
}

function typeStep(state: BulkState, ctx: BulkViewContext): string {
  const n = typedCount(state.text);
  return `<label for="bulk-text">${esc(t("bulk.type.label"))}</label>
    <textarea id="bulk-text" name="bulkText" rows="10" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(t("bulk.type.placeholder"))}">${esc(state.text)}</textarea>
    <p><small>${esc(t("bulk.type.hint"))}</small></p>
    <p id="bulk-count" aria-live="polite"><strong>${esc(t("bulk.type.count", { n }))}</strong></p>
    ${ctx.restored === true ? `<p class="notice">${esc(t("bulk.type.restored"))}</p>` : ""}`;
}

function reasonText(c: BulkCandidate, input: string): string {
  return t(`bulk.reason.${c.reason}`, { input, name: c.label });
}

function candidateButton(
  row: BulkRow,
  c: BulkCandidate,
  ctx: BulkViewContext,
  current: boolean,
): string {
  const sp = (ctx.species ?? SPECIES).find((s) => s.id === c.id);
  const photo = sp?.photoFile === undefined ? undefined : ctx.photos.get(sp.photoFile);
  return `<li><button type="button" class="candidate" data-action="bulk-pick" data-row="${esc(row.id)}" data-species="${esc(c.id)}" aria-pressed="${String(current)}">
      ${photoHtml(photo, c.label)}
      <span><strong>${esc(c.label)}</strong><br><small><em>${esc(c.scientificName)}</em></small>
      ${c.tell === undefined ? "" : `<br><small class="tell">${esc(t("bulk.match.alike", { tell: c.tell }))}</small>`}</span></button></li>`;
}

function sureRow(row: BulkRow, ctx: BulkViewContext): string {
  const top = row.candidates.find((c) => c.id === row.speciesId);
  const name = row.generic
    ? `${esc(row.input)} <small>${esc(t("bulk.generic"))}</small>`
    : `<strong>${esc(row.label)}</strong> <small><em>${esc(top?.scientificName)}</em></small>`;
  const why =
    top === undefined || row.confirmed
      ? ""
      : `<br><small>${esc(reasonText(top, row.input))}</small>`;
  const others = row.candidates.filter((c) => c.id !== row.speciesId);
  const retype = `<div class="retype"><input name="retype" data-row="${esc(row.id)}" autocomplete="off" aria-label="${tHtml("bulk.match.ariaRetype", { name: row.input })}" placeholder="${esc(t("bulk.match.retype"))}">
      <button type="button" data-action="bulk-retype" data-row="${esc(row.id)}">${esc(t("bulk.match.retry"))}</button></div>`;
  const change = `<details class="alts"><summary>${esc(t("bulk.match.change"))} <span class="help" role="img" tabindex="0" title="${esc(t("modal.notSureHelp"))}" aria-label="${esc(t("modal.notSureHelp"))}">?</span></summary>${
    others.length === 0
      ? ""
      : `<ul class="candidates">${others.map((c) => candidateButton(row, c, ctx, false)).join("")}</ul>`
  }${retype}</details>`;
  return `<li class="match-row">${name}${times(row.count)}${why}${change}
    <button type="button" class="secondary" data-action="bulk-remove" data-row="${esc(row.id)}" aria-label="${tHtml("bulk.match.ariaRemove", { name: row.input })}">${esc(t("bulk.match.remove"))}</button></li>`;
}

function chooseRow(row: BulkRow, ctx: BulkViewContext): string {
  return `<li class="match-row"><strong>${esc(row.input)}</strong>${times(row.count)}
    <ul class="candidates">${row.candidates.map((c) => candidateButton(row, c, ctx, false)).join("")}</ul>
    <button type="button" class="secondary" data-action="bulk-remove" data-row="${esc(row.id)}" aria-label="${tHtml("bulk.match.ariaRemove", { name: row.input })}">${esc(t("bulk.match.remove"))}</button></li>`;
}

function unmatchedRow(row: BulkRow): string {
  return `<li class="match-row"><strong>${esc(row.input)}</strong>${times(row.count)}
    <div class="retype"><input name="retype" data-row="${esc(row.id)}" autocomplete="off" aria-label="${tHtml("bulk.match.ariaRetype", { name: row.input })}" placeholder="${esc(t("bulk.match.retype"))}">
      <button type="button" data-action="bulk-retype" data-row="${esc(row.id)}">${esc(t("bulk.match.retry"))}</button></div>
    <button type="button" class="secondary" data-action="bulk-generic" data-row="${esc(row.id)}">${esc(t("bulk.match.generic"))}</button>
    <button type="button" class="secondary" data-action="bulk-remove" data-row="${esc(row.id)}" aria-label="${tHtml("bulk.match.ariaRemove", { name: row.input })}">${esc(t("bulk.match.remove"))}</button>
    <br><small>${esc(t("bulk.match.genericNote"))}</small>${notSureWhatHtml()}</li>`;
}

function matchStep(state: BulkState, ctx: BulkViewContext): string {
  const g = groupRows(state);
  const section = (
    id: string,
    title: string,
    rows: readonly BulkRow[],
    one: (r: BulkRow) => string,
  ): string =>
    rows.length === 0
      ? ""
      : `<section data-group="${id}"><h3>${esc(title)} (${String(rows.length)})</h3><ul class="match-list">${rows.map(one).join("")}</ul></section>`;
  return `<p><strong>${esc(t("bulk.match.summary", { sure: g.sure.length, choose: g.choose.length, none: g.unmatched.length }))}</strong></p>
    ${section("choose", t("bulk.match.choose"), g.choose, (r) => chooseRow(r, ctx))}
    ${section("unmatched", t("bulk.match.unmatched"), g.unmatched, unmatchedRow)}
    ${section("sure", t("bulk.match.sure"), g.sure, (r) => sureRow(r, ctx))}`;
}

function placeStep(state: BulkState, ctx: BulkViewContext): string {
  const rows = state.rows
    .map((row, i) => {
      const placed = placementOf(row, ctx.species);
      const chips = PLACEMENTS.map((p) =>
        chip(
          "bulk-placement",
          `data-row="${esc(row.id)}" data-value="${p}"`,
          t(`bulk.place.${p}`),
          placed === p,
        ),
      ).join(" ");
      const rooms = [
        ...ctx.rooms.map((r) =>
          chip(
            "bulk-room",
            `data-row="${esc(row.id)}" data-value="${esc(r.id)}"`,
            r.name,
            row.roomId === r.id,
          ),
        ),
        chip(
          "bulk-room",
          `data-row="${esc(row.id)}" data-value=""`,
          t("bulk.place.later"),
          row.roomId === undefined,
        ),
      ].join(" ");
      const same =
        i === 0
          ? ""
          : ` <button type="button" class="secondary" data-action="bulk-same" data-row="${esc(row.id)}">${esc(t("bulk.place.same"))}</button>`;
      return `<li class="place-row"><strong>${esc(row.label ?? row.input)}</strong>${times(row.count)}${same}
        <div class="chips" role="group" aria-label="${tHtml("bulk.place.ariaWhere", { name: row.label ?? row.input })}">${chips}</div>
        <div class="chips" role="group" aria-label="${tHtml("bulk.place.ariaRoom", { name: row.label ?? row.input })}">${rooms}</div></li>`;
    })
    .join("");
  const gardenNote =
    ctx.gardenNote === true ? `<p class="notice">${esc(t("bulk.place.gardenNote"))}</p>` : "";
  return `${gardenNote}<p><small>${esc(t("bulk.place.note"))}</small></p><ul class="place-list">${rows}</ul>`;
}

/** A value with its mark: greyed and "~" while it is only assumed. */
function value(text: string, source: FieldSource | undefined): string {
  return source === undefined || source === "user"
    ? esc(text)
    : `<span class="assumed" title="${esc(t("bulk.verify.assumed"))}">~ ${esc(text)} <small>(${esc(t("bulk.verify.assumed"))})</small></span>`;
}

function verifyRow(row: BulkRow, state: BulkState, ctx: BulkViewContext): string {
  const ok = row.speciesId !== undefined || row.generic;
  const name = row.label ?? row.input;
  const tick = `<input type="checkbox" data-action="bulk-tick" data-row="${esc(row.id)}"${row.included === true ? " checked" : ""}${ok ? "" : " disabled"} aria-label="${tHtml("bulk.verify.ariaTick", { name })}">`;
  if (!ok) {
    return `<li class="verify-row"><details><summary>${tick} ${esc(name)} <small>${esc(t("bulk.verify.unresolved"))}</small></summary></details></li>`;
  }
  const p = plantsForRow(row, state, ctx.data, ctx.today, ctx.species ?? SPECIES)[0];
  const sp = (ctx.species ?? SPECIES).find((s) => s.id === row.speciesId);
  const photo = sp?.photoFile === undefined ? undefined : ctx.photos.get(sp.photoFile);
  const src = p?.fieldSources;
  const room = ctx.rooms.find((r) => r.id === row.roomId)?.name;
  const margin = p === undefined ? 0 : assumedMarginDays(p);
  const lines = [
    p === undefined
      ? ""
      : `<li>${value(t("bulk.verify.care", { n: p.intervalDays }), src?.intervalDays)}</li>`,
    `<li>${esc(t("bulk.verify.lives"))} ${value(t(`bulk.place.${placementOf(row, ctx.species)}`), src?.placement)}</li>`,
    `<li>${esc(t("bulk.verify.room"))} ${room === undefined ? value(t("bulk.verify.noRoom"), "default") : esc(room)}</li>`,
    p?.potDiameterCm === undefined
      ? ""
      : `<li>${esc(t("bulk.verify.pot"))} ${value(t("modal.chipCm", { cm: p.potDiameterCm }), src?.potDiameterCm)}</li>`,
  ].join("");
  return `<li class="verify-row"><details><summary>${tick} <strong>${esc(name)}</strong>${times(row.count)}${row.generic ? ` <small>${esc(t("bulk.generic"))}</small>` : ""}</summary>
    <div class="species-card">${photoHtml(photo, name)}<div><small><em>${esc(sp?.scientificName)}</em></small><ul>${lines}</ul>
    ${margin === 0 ? "" : `<p><small>${esc(t("bulk.verify.margin", { n: margin }))}</small></p>`}</div></div></details></li>`;
}

function savingCount(state: BulkState): number {
  return state.rows.reduce((n, r) => (r.included === true ? n + r.count : n), 0);
}

function verifyStep(state: BulkState, ctx: BulkViewContext): string {
  const left = state.rows.filter((r) => r.included !== true).length;
  return `<ul class="verify-list">${state.rows.map((r) => verifyRow(r, state, ctx)).join("")}</ul>
    <fieldset><legend>${esc(t("bulk.verify.watered"))}</legend><div class="chips">
      ${chip("bulk-watered", 'data-value="today"', t("bulk.verify.today"), state.watered === "today")}
      ${chip("bulk-watered", 'data-value="unsure"', t("bulk.verify.unsure"), state.watered === "unsure")}</div>
      ${state.watered === "unsure" ? `<small>${esc(t("bulk.verify.unsureNote"))}</small>` : ""}</fieldset>
    ${left === 0 ? "" : `<p><small>${esc(t("bulk.verify.left", { n: left }))}</small></p>`}`;
}

function footer(state: BulkState): string {
  const cancel = `<button type="button" class="secondary" data-action="bulk-close">${esc(t("bulk.cancel"))}</button>`;
  const back =
    state.step === "type"
      ? ""
      : `<button type="button" class="secondary" data-action="bulk-back">${esc(t("bulk.back"))}</button>`;
  switch (state.step) {
    case "type":
      return `${cancel}<button type="button" data-action="bulk-match"${typedCount(state.text) === 0 ? " disabled" : ""}>${esc(t("bulk.type.next"))}</button>`;
    case "match":
    case "place":
      return `${cancel}${back}<button type="button" data-action="bulk-next">${esc(t("bulk.next"))}</button>`;
    case "verify": {
      const n = savingCount(state);
      return `${cancel}${back}<button type="button" data-action="bulk-save"${n === 0 ? " disabled" : ""}>${esc(t("bulk.verify.save", { n }))}</button>`;
    }
  }
}

/** The whole dialog for the current step. */
export function bulkDialogHtml(state: BulkState, ctx: BulkViewContext): string {
  const body = {
    type: typeStep,
    match: matchStep,
    place: placeStep,
    verify: verifyStep,
  }[state.step](state, ctx);
  const heading = t(`bulk.heading.${state.step}`);
  const n = STEPS.indexOf(state.step) + 1;
  return `<dialog id="bulk-modal" class="fullscreen" aria-labelledby="bulk-title">
    <header class="modal-head"><div><h2 id="bulk-title" tabindex="-1">${esc(heading)}</h2>
      <small>${esc(t("bulk.step", { n, total: STEPS.length }))}</small></div>
      <button type="button" class="close" data-action="bulk-close" aria-label="${esc(t("common.close"))}">&times;</button></header>
    <div id="bulk-body" class="modal-scroll"><div class="modal-body">${body}</div></div>
    <footer class="modal-foot">${footer(state)}</footer>
  </dialog>`;
}

/** The bulk-add leftovers on the Plants tab: rows the user did not tick, resumable one by one. */
export function notAddedHtml(drafts: readonly Omit<PlantDraft, "spaceId">[]): string {
  if (drafts.length === 0) return "";
  const items = drafts
    .map((d) => {
      const label = d.fields["plantName"]?.trim() || t("modal.draftUnnamed");
      return `<li>${esc(label)}
        <button type="button" data-action="resume-draft" data-id="${esc(d.id)}" aria-label="${tHtml("modal.ariaResume", { label })}">${esc(t("common.resume"))}</button>
        <button type="button" data-action="delete-draft" data-id="${esc(d.id)}" aria-label="${tHtml("modal.ariaDeleteDraft", { label })}">${esc(t("common.delete"))}</button></li>`;
    })
    .join("");
  return `<section id="not-added"><h3>${esc(t("bulk.notAdded"))}</h3><p><small>${esc(t("bulk.notAddedNote"))}</small></p><ul>${items}</ul></section>`;
}
