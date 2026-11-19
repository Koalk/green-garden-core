// SPDX-License-Identifier: AGPL-3.0-only

/** Pure logic for the add-plant modal: species search, care fill, toxicity wording, look-alikes. */
import {
  toxicityLevel,
  toxicityText as careToxicityText,
  type HouseholdInfo,
} from "@green-garden/care-text";
import { SPECIES, type SpeciesRow } from "./pilot-data.ts";
import { esc, t } from "./text.ts";

export type { SpeciesRow } from "./pilot-data.ts";
export { toxicityLevel, type HouseholdInfo };
/** Care fill moved to `@green-garden/bulk` with the flow that uses it. */
export { careFill, type CareFill } from "@green-garden/bulk";

/** Lower case, no accents, single spaces. */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function names(r: SpeciesRow): string[] {
  return [...r.commonNames, r.scientificName, ...r.synonyms].map(normalise);
}

/** 0 = exact, 1 = a name starts with the query, 2 = a word starts with it, 3 = inside a word. */
function rank(r: SpeciesRow, q: string): number | undefined {
  let best: number | undefined;
  for (const n of names(r)) {
    let score: number | undefined;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.split(" ").some((w) => w.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 3;
    if (score !== undefined && (best === undefined || score < best)) best = score;
  }
  return best;
}

/** Catalogue entries matching `query` in a common name, the scientific name or a synonym, anywhere in the word. */
export function searchSpecies(query: string, rows: readonly SpeciesRow[], limit = 8): SpeciesRow[] {
  const q = normalise(query);
  if (q === "") return [];
  return rows
    .map((r, i) => ({ r, i, s: rank(r, q) }))
    .filter((x): x is { r: SpeciesRow; i: number; s: number } => x.s !== undefined)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.r);
}

/** One line about toxicity. Unknown is never worded as safe. With a household it speaks about them. */
export function toxicityText(tox: SpeciesRow["toxicity"], household?: HouseholdInfo): string {
  return careToxicityText(t, tox, household);
}

/** Toxicity line for a stored plant: its catalogue entry by scientific or common name, else "Not assessed". */
export function toxicityOfPlant(
  plant: { readonly species?: string },
  household?: HouseholdInfo,
  rows: readonly SpeciesRow[] = SPECIES,
): string {
  const key = normalise(plant.species ?? "");
  const row = key === "" ? undefined : rows.find((r) => names(r).includes(key));
  return row === undefined ? t("tox.notAssessed") : toxicityText(row.toxicity, household);
}

const PEOPLE = new Set(["child", "adult"]);

/**
 * The card's toxicity block: the highest level in the summary; opening it lists every exposure
 * with what that level means for pets or people (docs/toxicity-levels.md has the same wording).
 */
export function toxicityPopupHtml(tox: SpeciesRow["toxicity"]): string {
  const level = toxicityLevel(tox);
  if (level === undefined) return `<p>${esc(t("tox.unknown"))}</p>`;
  const items = tox.exposures
    .map((x) => {
      const audience = PEOPLE.has(x.who) ? "people" : "pets";
      return `<li><strong>${esc(t(`tox.who.${x.who}`))}</strong>: ${esc(t(`tox.severity.${x.severity}`))}. ${esc(t(`tox.level.${x.severity}.${audience}`))}</li>`;
    })
    .join("");
  const name = t(`tox.severity.${level}`);
  return `<details class="tox-popup"><summary>${esc(t("tox.levelLabel", { n: level, name }))}</summary>
    <ul>${items}</ul><p><small>${esc(t("tox.guide"))}</small></p></details>`;
}

/** The popup for a stored plant: its catalogue entry by name, else "Not assessed". */
export function toxicityPopupOfPlant(
  plant: { readonly species?: string },
  rows: readonly SpeciesRow[] = SPECIES,
): string {
  const key = normalise(plant.species ?? "");
  const row = key === "" ? undefined : rows.find((r) => names(r).includes(key));
  return row === undefined
    ? `<p>${esc(t("tox.notAssessed"))}</p>`
    : toxicityPopupHtml(row.toxicity);
}

export interface LookAlike {
  readonly name: string;
  readonly tell: string;
  /** The catalogue entry, when the look-alike is one we have (so it has a photo and can be switched to). */
  readonly species?: SpeciesRow;
}

/** Look-alikes of `r`, with catalogue entries resolved. Empty when none are recorded. */
export function lookAlikesOf(r: SpeciesRow, all: readonly SpeciesRow[]): LookAlike[] {
  return (r.lookAlikes ?? []).map((l) => {
    const species = l.species === undefined ? undefined : all.find((x) => x.id === l.species);
    return { name: l.name, tell: l.tell, ...(species === undefined ? {} : { species }) };
  });
}
