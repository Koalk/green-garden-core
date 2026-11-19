// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Markup for the full-screen add-plant modal, as pure string functions (no DOM), so it can be tested.
 * PROVISIONAL: layout and wording are the simplest thing that works; none of it is a design decision.
 */
import type { PlantDraft, Room } from "@green-garden/storage";
import type { SpeciesRow } from "./pilot-data.ts";
import { commonsFileUrl, PHOTO_SIZES } from "@green-garden/catalogue";
import { lookAlikesOf, toxicityText } from "./species.ts";
import { esc, t, tHtml } from "./text.ts";
import { learnMoreHtml, notSureWhatHtml } from "./learn.ts";
import { sunRowHtml } from "./sun-hours.ts";

export { esc } from "./text.ts";

type Fields = Readonly<Record<string, string>>;

/** Keeps password managers and browser autofill off date fields. */
export const NO_FILL = 'autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore';

/** A reference photo with what the licence requires us to show. */
export interface PhotoInfo {
  /** Sharper copy to swap in once it has loaded (the bundled thumbnail stays if it never does). */
  readonly fullUrl?: string;
  readonly thumbUrl: string;
  readonly pageUrl: string;
  readonly licence: string;
  readonly licenceUrl?: string;
  readonly author: string;
}

/** A species the user can pick: from the bundled catalogue, from OpenPlantbook, or typed free text. */
export type Selected =
  | { readonly kind: "catalogue"; readonly row: SpeciesRow }
  | {
      readonly kind: "opb";
      readonly pid: string;
      readonly name: string;
      readonly category?: string;
      readonly imageUrl?: string;
      readonly imageRights?: string;
    }
  | { readonly kind: "text"; readonly text: string };

export type Hit =
  | { readonly kind: "catalogue"; readonly row: SpeciesRow }
  | {
      readonly kind: "opb";
      readonly pid: string;
      readonly name: string;
      readonly category?: string;
    };

export function photoHtml(
  photo: PhotoInfo | undefined,
  alt: string,
  opts: { readonly linkImage?: boolean } = {},
): string {
  if (photo === undefined)
    return `<span class="photo ph" aria-hidden="true">${t("modal.noPhoto")}</span>`;
  const licence =
    photo.licenceUrl === undefined
      ? esc(photo.licence)
      : `<a href="${esc(photo.licenceUrl)}" rel="noopener noreferrer" target="_blank">${esc(photo.licence)}</a>`;
  const img = `<img src="${esc(photo.thumbUrl)}" alt="${esc(alt)}" loading="lazy" width="96" height="72"${photo.fullUrl === undefined ? "" : ` data-full="${esc(photo.fullUrl)}"`}>`;
  const pic =
    opts.linkImage === false
      ? img
      : `<a href="${esc(photo.pageUrl)}" rel="noopener noreferrer" target="_blank">${img}</a>`;
  return `<figure class="photo">${pic}
    <figcaption><small><a href="${esc(photo.pageUrl)}" rel="noopener noreferrer" target="_blank">${esc(t("common.photo"))}</a>:
    ${esc(photo.author)}, ${licence}</small></figcaption></figure>`;
}

/** Licence id as stored ("CC-BY-SA-3.0") to the name people know ("CC BY-SA 3.0"). */
const licenceLabel = (id: string): string =>
  id === "CC0-1.0"
    ? "CC0"
    : id === "PDM-1.0"
      ? "Public domain"
      : id.replace(/^CC-BY-SA-/, "CC BY-SA ").replace(/^CC-BY-/, "CC BY ");

/** The bundled thumbnail and credit when the entry has them (works offline); else the runtime Commons lookup. */
const photoOf = (
  r: SpeciesRow,
  photos: ReadonlyMap<string, PhotoInfo>,
  full = false,
): PhotoInfo | undefined => {
  if (r.photo !== undefined) {
    return {
      thumbUrl: `/catalogue-thumbs/${r.photo.thumbnail}`,
      ...(full ? { fullUrl: commonsFileUrl(r.photo.file, PHOTO_SIZES.detail) } : {}),
      pageUrl: r.photo.sourceUrl,
      licence: licenceLabel(r.photo.licence),
      licenceUrl: r.photo.licenceUrl,
      author: r.photo.creator,
    };
  }
  return r.photoFile === undefined ? undefined : photos.get(r.photoFile);
};

/** Suggestion list under the search box. Empty query gives nothing; no hits offers the typed text. */
export function resultsHtml(
  hits: readonly Hit[],
  photos: ReadonlyMap<string, PhotoInfo>,
  query?: string,
): string {
  if (hits.length === 0) {
    const q = (query ?? "").trim();
    if (q === "") return "";
    return `<p>${tHtml("modal.noMatch", { q })} <button type="button" data-action="use-text" data-text="${esc(q)}">${tHtml("modal.useText", { q })}</button></p>${notSureWhatHtml()}`;
  }
  const items = hits
    .map((h, i) => {
      if (h.kind === "catalogue") {
        const r = h.row;
        return `<li role="presentation"><button type="button" role="option" id="opt-${String(i)}" data-action="pick" data-kind="catalogue" data-id="${esc(r.id)}">
          ${photoHtml(photoOf(r, photos), r.name, { linkImage: false })}
          <span><strong>${esc(r.name)}</strong><br><small><em>${esc(r.scientificName)}</em></small></span></button></li>`;
      }
      return `<li role="presentation"><button type="button" role="option" id="opt-${String(i)}" data-action="pick" data-kind="opb" data-id="${esc(h.pid)}" data-name="${esc(h.name)}">
          ${photoHtml(undefined, h.name)}
          <span><strong>${esc(h.name)}</strong><br><small>OpenPlantbook${h.category === undefined ? "" : `: ${esc(h.category)}`}</small></span></button></li>`;
    })
    .join("");
  return `<ul role="listbox" aria-label="${esc(t("modal.suggestions"))}">${items}</ul>`;
}

/** Selected species with photo, a care and toxicity summary, and the look-alikes to switch to. */
export function speciesPanelHtml(
  sel: Selected | undefined,
  all: readonly SpeciesRow[],
  photos: ReadonlyMap<string, PhotoInfo>,
): string {
  if (sel === undefined) return "";
  if (sel.kind === "text") {
    return `<p>${tHtml("modal.typedSpecies", { text: sel.text })}</p>`;
  }
  if (sel.kind === "opb") {
    const img =
      sel.imageUrl === undefined
        ? photoHtml(undefined, sel.name)
        : `<figure class="photo"><img src="${esc(sel.imageUrl)}" alt="${esc(sel.name)}" loading="lazy" width="96" height="72">
          <figcaption><small>${tHtml("modal.opbCaption", { rights: sel.imageRights ?? t("modal.opbRights") })}</small></figcaption></figure>`;
    return `<div class="species-card">${img}<div><strong>${esc(sel.name)}</strong>
      <br><small>${tHtml("modal.opbCard", { category: sel.category === undefined ? "" : `: ${sel.category}` })}</small></div></div>`;
  }
  const r = sel.row;
  const alikes = lookAlikesOf(r, all);
  const items = alikes
    .map((l, i) => {
      const prev = alikes[i - 1];
      const tell = prev !== undefined && prev.tell === l.tell ? "" : l.tell;
      const switchTo =
        l.species === undefined
          ? ""
          : ` <button type="button" data-action="pick" data-kind="catalogue" data-id="${esc(l.species.id)}">${esc(t("modal.itIsThisOne"))}</button>`;
      const pic = l.species === undefined ? "" : photoHtml(photoOf(l.species, photos), l.name);
      return `<li>${pic}<strong>${esc(l.name)}</strong>${switchTo}${tell === "" ? "" : `<br><small>${esc(tell)}</small>`}</li>`;
    })
    .join("");
  const lookAlikes =
    r.lookAlikes === undefined
      ? `<p><small>${esc(t("modal.lookAlikesNone"))}</small></p>`
      : `<details class="alts"><summary>${esc(t("modal.notSure"))} <span class="help" role="img" tabindex="0" title="${esc(t("modal.notSureHelp"))}" aria-label="${esc(t("modal.notSureHelp"))}">?</span></summary>
        ${r.lookAlikeNote === undefined ? "" : `<p class="sev2"><strong>${esc(r.lookAlikeNote)}</strong></p>`}
        <ul>${items}</ul></details>`;
  return `<div class="species-card">${photoHtml(photoOf(r, photos, true), r.name)}
    <div><strong>${esc(r.name)}</strong> (<em>${esc(r.scientificName)}</em>)
    <br><small>${esc(toxicityText(r.toxicity))}</small></div></div>${lookAlikes}${learnMoreHtml(r.links)}`;
}

export interface CareOptions {
  readonly open: boolean;
  /** Name of the species the values came from. */
  readonly from?: string;
  readonly species?: SpeciesRow;
}

export function careDetailsHtml(f: Fields, o: CareOptions): string {
  const v = (k: string): string => esc(f[k]);
  const sel = (s: string): string => (f["style"] === s ? " selected" : "");
  const heading =
    o.from === undefined ? esc(t("modal.careRequired")) : tHtml("modal.careFrom", { name: o.from });
  const facts =
    o.species === undefined
      ? ""
      : `<p><small>${tHtml("modal.tags", { tags: o.species.tags.length === 0 ? t("common.none") : o.species.tags.join(", ") })}
        ${esc(toxicityText(o.species.toxicity))}</small></p>`;
  return `<details${o.open ? " open" : ""}><summary>${heading}</summary>${facts}
    <label>${esc(t("modal.styleLabel"))} <select name="style">
      <option value="">${esc(t("modal.styleChoose"))}</option>
      <option value="keep_moist"${sel("keep_moist")}>${esc(t("style.keep_moist"))}</option>
      <option value="let_top_dry"${sel("let_top_dry")}>${esc(t("style.let_top_dry"))}</option>
      <option value="let_fully_dry"${sel("let_fully_dry")}>${esc(t("style.let_fully_dry"))}</option></select></label>
    <label>${esc(t("modal.interval"))} <input name="intervalDays" type="number" autocomplete="off" min="1" step="1" value="${v("intervalDays")}"></label>
    <label>${esc(t("modal.restFactor"))} <input name="restFactor" type="number" autocomplete="off" min="0.5" step="0.1" value="${v("restFactor")}"></label>
    <label>${esc(t("modal.dryTol"))} <input name="dryTolDays" type="number" autocomplete="off" min="0" step="1" value="${v("dryTolDays")}"></label>
    <label>${esc(t("modal.wetTol"))} <input name="wetTolDays" type="number" autocomplete="off" min="0" step="1" value="${v("wetTolDays")}"></label>
    <label>${esc(t("modal.sourceLabel"))} <input name="source" autocomplete="off" value="${esc(f["source"] ?? "manual entry")}"></label>
    </details>`;
}

export interface ModalOptions {
  readonly fields: Fields;
  readonly rooms: readonly Pick<Room, "id" | "name">[];
  readonly title: string;
  readonly draftId?: string;
  readonly plantId?: string;
  /** Pre-rendered selected-species panel and care details (default: nothing chosen, care open). */
  readonly panel?: string;
  readonly care?: string;
  /** One quiet line about the water amount, already worded. */
  readonly amountNote?: string;
}

/** Pot diameters offered as chips in the add flow (D-03); anything else lives in the advanced fold. */
export const POT_CHIPS_CM = [8, 12, 15, 20, 25, 30] as const;
/** Where the plant lives. */
const PLACEMENT_CHIPS = ["indoor", "outdoor_pot", "ground"] as const;
const DRAINAGES = ["hole", "cachepot", "no_hole", "self_watering"] as const;

/** The fold opens when it already holds something the chips cannot show. */
function advancedOpen(f: Fields): boolean {
  const d = f["potDiameterCm"] ?? "";
  const custom = d !== "" && !POT_CHIPS_CM.some((cm) => String(cm) === d);
  return custom || (f["potHeightCm"] ?? "") !== "" || (f["drainage"] ?? "hole") !== "hole";
}

export function modalHtml(o: ModalOptions): string {
  const f = o.fields;
  const v = (k: string): string => esc(f[k]);
  const rooms = o.rooms
    .map(
      (r) =>
        `<option value="${esc(r.id)}"${f["roomId"] === r.id ? " selected" : ""}>${esc(r.name)}</option>`,
    )
    .join("");
  return `<dialog id="plant-modal" class="fullscreen" aria-labelledby="modal-title">
    <header class="modal-head"><h2 id="modal-title">${esc(o.title)}</h2>
      <button type="button" class="close" data-action="modal-close" aria-label="${esc(t("common.close"))}">&times;</button></header>
    <div id="close-prompt" role="alert"></div>
    <form id="plant-form" data-form="plant" data-id="${esc(o.plantId)}" data-draft="${esc(o.draftId)}" novalidate>
      <div class="modal-body">
        <p role="alert" id="modal-errors" class="err"></p>
        <label>${esc(t("modal.search"))}
          <input name="speciesSearch" type="search" role="combobox" aria-expanded="false" aria-controls="species-results" aria-autocomplete="list" autocomplete="off" value="">
        </label>
        <div id="species-results" aria-live="polite"></div>
        <input type="hidden" name="species" value="${v("species")}">
        <div id="species-panel">${o.panel ?? ""}</div>
        <label>${esc(t("modal.name"))} <input name="plantName" autocomplete="off" value="${v("plantName")}"></label>
        <button type="button" data-action="randomise">${esc(t("modal.randomise"))}</button>
        <label>${esc(t("modal.room"))} <select name="roomId" autocomplete="off"><option value="">${esc(t("common.none"))}</option>${rooms}</select></label>
        <fieldset class="placement"><legend>${esc(t("modal.placement"))}</legend>
          <input type="hidden" name="placement" value="${esc(f["placement"] ?? "indoor")}">
          <div class="chips">${PLACEMENT_CHIPS.map(
            (pl) =>
              `<button type="button" data-action="placement-chip" data-value="${pl}" aria-pressed="${(f["placement"] ?? "indoor") === pl}">${esc(t(`modal.placement.${pl}`))}</button>`,
          ).join(" ")}</div>
        </fieldset>
        <fieldset class="cover"${(f["placement"] ?? "indoor") === "indoor" ? " hidden" : ""}><legend>${esc(t("move.cover.legend"))}</legend>
          <input type="hidden" name="sheltered" value="${v("sheltered")}">
          <div class="chips">${(["open", "covered"] as const)
            .map(
              (c) =>
                `<button type="button" data-action="cover-chip" data-value="${c}" aria-pressed="${f["sheltered"] === (c === "covered" ? "1" : "0")}">${esc(t(`move.cover.${c}`))}</button>`,
            )
            .join(" ")}</div>
        </fieldset>
        ${sunRowHtml(f["directSun"] ?? "", (f["placement"] ?? "indoor") === "indoor")}
        <fieldset><legend>${esc(t("modal.potSize"))}</legend>
          <div class="chips">${POT_CHIPS_CM.map(
            (cm) =>
              `<button type="button" data-action="pot-chip" data-cm="${cm}" aria-pressed="${f["potDiameterCm"] === String(cm)}">${esc(t("modal.chipCm", { cm }))}</button>`,
          ).join(" ")}</div>
          <details id="pot-advanced"${advancedOpen(f) ? " open" : ""}><summary>${esc(t("modal.advancedPot"))}</summary>
            <label>${esc(t("modal.diameter"))} <input name="potDiameterCm" type="number" autocomplete="off" min="1" step="0.5" value="${v("potDiameterCm")}"></label>
            <label>${esc(t("modal.height"))} <input name="potHeightCm" type="number" autocomplete="off" min="1" step="0.5" value="${v("potHeightCm")}"></label>
            <label>${esc(t("modal.drainage"))} <select name="drainage">${DRAINAGES.map(
              (d) =>
                `<option value="${d}"${(f["drainage"] ?? "hole") === d ? " selected" : ""}>${esc(t(`drainage.${d}`))}</option>`,
            ).join("")}</select></label>
          </details>
        </fieldset>
        ${o.amountNote === undefined ? "" : `<p class="quiet"><small>${esc(o.amountNote)}</small></p>`}
        <label>${esc(t("modal.lastWatered"))} <input name="lastWatered" type="date" ${NO_FILL} value="${v("lastWatered")}"></label>
        ${
          o.plantId === undefined
            ? ""
            : `<label>${esc(t(f["addedOnEstimated"] === undefined ? "modal.addedOn" : "modal.addedOnAbout"))} <input name="addedOn" type="date" ${NO_FILL} value="${v("addedOn")}"></label>`
        }
        <div id="care-details">${o.care ?? careDetailsHtml(f, { open: true })}</div>
      </div>
    </form>
    <footer class="modal-foot">
      <button type="submit" form="plant-form" data-action="modal-save">${esc(t("common.save"))}</button>
      <button type="button" data-action="save-draft">${esc(t("modal.saveForLater"))}</button>
    </footer>
  </dialog>`;
}

/** The Drafts list on the Plants tab. Empty when there are none. */
export function draftsHtml(drafts: readonly Omit<PlantDraft, "spaceId">[]): string {
  if (drafts.length === 0) return "";
  const items = drafts
    .map((d) => {
      const label =
        d.fields["plantName"]?.trim() || d.fields["species"]?.trim() || t("modal.draftUnnamed");
      return `<li>${esc(label)} <small>${tHtml("modal.draftSaved", { date: d.savedOn })}</small>
        <button type="button" data-action="resume-draft" data-id="${esc(d.id)}" aria-label="${tHtml("modal.ariaResume", { label })}">${esc(t("common.resume"))}</button>
        <button type="button" data-action="delete-draft" data-id="${esc(d.id)}" aria-label="${tHtml("modal.ariaDeleteDraft", { label })}">${esc(t("common.delete"))}</button></li>`;
    })
    .join("");
  return `<section id="drafts"><h3>${esc(t("modal.drafts"))}</h3><p><small>${esc(t("modal.draftsNote"))}</small></p><ul>${items}</ul></section>`;
}
