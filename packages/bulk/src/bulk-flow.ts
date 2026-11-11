// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bulk add (01i section 8, B3): the four steps as pure state. Type names, match them to the catalogue,
 * place each plant, verify and save. Nothing here touches the DOM or storage; web-ui's `bulk-modal.ts` and
 * the Stories app wire it. The catalogue rows always come in as an argument.
 * Adding plants has no XP and no daily cap (D-15).
 */
import { createNameMatcher, type MatcherEntry } from "@green-garden/catalogue";
import { DEFAULTS_TABLE } from "@green-garden/questions";
import {
  activeSpaceId,
  type AppData,
  type FieldSource,
  type Plant,
  type PlantDraft,
  SOURCED_FIELDS,
  type SourcedField,
} from "@green-garden/storage";
import { nextBatchId } from "./batch.ts";
import { saveDraft, deleteDraft } from "./drafts.ts";
import { nextId } from "./ids.ts";
import { careFill, type BulkSpecies } from "./species.ts";

type Placement = NonNullable<Plant["placement"]>;
type Reason =
  "exact" | "common" | "alias" | "typo" | "partial" | "genus" | "word-order" | "lookalike";

/** The most plants one typed line can stand for ("500x pothos" is 99). */
export const MAX_PER_LINE = 99;
/** Pot width assumed when nobody said: the defaults table (B2), rank 6. */
export const DEFAULT_POT_CM = Number(
  DEFAULTS_TABLE.find((r) => r.field === "potDiameterCm")?.defaultValue ?? 15,
);
/** The interval a plant with no catalogue match runs on (01i section 2.3). */
export const GENERIC_INTERVAL_DAYS = 10;

// --- Step 1: parsing ---------------------------------------------------------------------------

export interface TypedPlant {
  readonly input: string;
  readonly count: number;
}

/** One plant per line, or comma or semicolon separated. "and", "y", "e" and "&" do not split. */
export function parseTyped(text: string): TypedPlant[] {
  const out: TypedPlant[] = [];
  for (const raw of text.split(/[\n\r,;]+/)) {
    let name = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    let count = 1;
    const lead = /^(\d{1,3})(?:\s*[x×]\s*|\s+)(.+)$/i.exec(name);
    const trail = /^(.+?)\s*[x×]\s*(\d{1,3})$/i.exec(name);
    if (lead?.[1] !== undefined && lead[2] !== undefined) {
      count = Number(lead[1]);
      name = lead[2].trim();
    } else if (trail?.[1] !== undefined && trail[2] !== undefined) {
      count = Number(trail[2]);
      name = trail[1].trim();
    }
    if (name !== "") out.push({ input: name, count: Math.min(MAX_PER_LINE, Math.max(1, count)) });
  }
  return out;
}

/** How many plants the text stands for (the live count of step 1). */
export function typedCount(text: string): number {
  return parseTyped(text).reduce((n, p) => n + p.count, 0);
}

// --- Step 2: matching --------------------------------------------------------------------------

export interface BulkCandidate {
  readonly id: string;
  /** What to show: the plant's name in the user's language. */
  readonly label: string;
  readonly scientificName: string;
  readonly score: number;
  readonly reason: Reason;
  /** The look-alike tell from the catalogue that helps tell this plant from the others in the list. */
  readonly tell?: string;
}

export interface BulkMatch {
  readonly verdict: "confident" | "choose" | "none";
  readonly candidates: readonly BulkCandidate[];
}

export type Matcher = (input: string) => BulkMatch;

function matcherEntry(r: BulkSpecies): MatcherEntry {
  // commonNames lists every name; the ones that also sit in localNames keep their own language tag, so
  // the user's locale wins for them (a name spelt the same in en-GB and es must not count as "other language").
  const local = new Set((r.localNames ?? []).map((n) => n.name));
  return {
    id: r.id,
    taxon: { scientificName: r.scientificName },
    names: {
      common: [
        ...r.commonNames
          .filter((name) => !local.has(name))
          .map((name, i) => ({
            lang: "en-GB",
            name,
            ...(i === 0 ? { primary: true } : {}),
          })),
        ...(r.localNames ?? []),
      ],
      synonyms: r.synonyms,
    },
    lookAlikes: (r.lookAlikes ?? []).flatMap((l) =>
      l.species === undefined ? [] : [{ species: l.species }],
    ),
  };
}

/** What tells `id` apart from the other candidates, from either side's look-alike notes. */
function tellFor(
  id: string,
  others: readonly string[],
  species: readonly BulkSpecies[],
): string | undefined {
  const own = species.find((s) => s.id === id)?.lookAlikes ?? [];
  const mine = own.find((l) => l.species !== undefined && others.includes(l.species));
  if (mine !== undefined) return mine.tell;
  for (const o of others) {
    const theirs = species.find((s) => s.id === o)?.lookAlikes?.find((l) => l.species === id);
    if (theirs !== undefined) return theirs.tell;
  }
  return undefined;
}

/** The catalogue matcher for a locale (user's language first), shaped for the flow. Builds the index once. */
export function makeMatcher(species: readonly BulkSpecies[], locale: string): Matcher {
  const match = createNameMatcher(species.map(matcherEntry), { locale });
  return (input) => {
    const r = match(input)[0];
    if (r === undefined) return { verdict: "none", candidates: [] };
    const ids = r.candidates.map((c) => c.id);
    return {
      verdict: r.verdict,
      candidates: r.candidates.map((c) => {
        const tell =
          ids.length > 1
            ? tellFor(
                c.id,
                ids.filter((i) => i !== c.id),
                species,
              )
            : undefined;
        return {
          id: c.id,
          label: c.label,
          scientificName: species.find((s) => s.id === c.id)?.scientificName ?? c.label,
          score: c.score,
          reason: c.reason,
          ...(tell === undefined ? {} : { tell }),
        };
      }),
    };
  };
}

// --- State -------------------------------------------------------------------------------------

export type Step = "type" | "match" | "place" | "verify";
export type Watered = "unsure" | "today";

export interface BulkRow {
  readonly id: string;
  readonly input: string;
  readonly count: number;
  readonly verdict: BulkMatch["verdict"];
  readonly candidates: readonly BulkCandidate[];
  /** The catalogue entry this row is, once sure or picked. */
  readonly speciesId?: string;
  /** The name to show for it, in the user's language. */
  readonly label?: string;
  /** The user picked it (or retyped it), as opposed to a confident match. */
  readonly confirmed: boolean;
  /** Added as a generic plant: no catalogue entry, the generic profile. */
  readonly generic: boolean;
  /** Set only when the user touched a chip; absent means the default for the species. */
  readonly placement?: Placement;
  /** Absent means "decide later". */
  readonly roomId?: string;
  /** Step 4 tick. Absent until the verify step opens. */
  readonly included?: boolean;
}

export interface BulkState {
  readonly step: Step;
  readonly text: string;
  readonly rows: readonly BulkRow[];
  readonly watered: Watered;
}

export function startBulk(text = ""): BulkState {
  return { step: "type", text, rows: [], watered: "unsure" };
}

export function setText(state: BulkState, text: string): BulkState {
  return { ...state, text };
}

const resolved = (r: BulkRow): boolean => r.speciesId !== undefined || r.generic;

function rowFrom(id: string, input: string, count: number, m: BulkMatch, keep?: BulkRow): BulkRow {
  const top = m.verdict === "confident" ? m.candidates[0] : undefined;
  return {
    id,
    input,
    count,
    verdict: m.verdict,
    candidates: m.candidates,
    ...(top === undefined ? {} : { speciesId: top.id, label: top.label }),
    confirmed: false,
    generic: false,
    ...(keep?.placement === undefined ? {} : { placement: keep.placement }),
    ...(keep?.roomId === undefined ? {} : { roomId: keep.roomId }),
  };
}

/** Step 1 to 2. With nothing typed it stays on step 1. */
export function runMatch(state: BulkState, matcher: Matcher): BulkState {
  const typed = parseTyped(state.text);
  if (typed.length === 0) return { ...state, step: "type", rows: [] };
  const rows = typed.map((p, i) =>
    rowFrom(`r${String(i + 1)}`, p.input, p.count, matcher(p.input)),
  );
  return { ...state, step: "match", rows };
}

export interface Groups {
  readonly sure: readonly BulkRow[];
  readonly choose: readonly BulkRow[];
  readonly unmatched: readonly BulkRow[];
}

/** Rows grouped for step 2: sure (or already resolved), still to choose, and not found. */
export function groupRows(state: BulkState): Groups {
  return {
    sure: state.rows.filter(resolved),
    choose: state.rows.filter((r) => !resolved(r) && r.verdict === "choose"),
    unmatched: state.rows.filter((r) => !resolved(r) && r.verdict !== "choose"),
  };
}

/** A copy of the row without the given optional keys. */
function without(r: BulkRow, ...keys: (keyof BulkRow)[]): BulkRow {
  return Object.fromEntries(
    Object.entries(r).filter(([k]) => !keys.includes(k as keyof BulkRow)),
  ) as unknown as BulkRow;
}

const mapRow = (s: BulkState, id: string, f: (r: BulkRow) => BulkRow): BulkState => ({
  ...s,
  rows: s.rows.map((r) => (r.id === id ? f(r) : r)),
});

/** The user picks one of the listed candidates. */
export function pickCandidate(state: BulkState, id: string, speciesId: string): BulkState {
  return mapRow(state, id, (r) => {
    const c = r.candidates.find((x) => x.id === speciesId);
    return c === undefined
      ? r
      : { ...r, speciesId: c.id, label: c.label, confirmed: true, generic: false };
  });
}

/** The user typed another name for a row; the count stays. */
export function retype(state: BulkState, id: string, text: string, matcher: Matcher): BulkState {
  const input = parseTyped(text)[0]?.input;
  if (input === undefined) return state;
  return mapRow(state, id, (r) => rowFrom(r.id, input, r.count, matcher(input), r));
}

/** No match wanted: add it as a generic plant (01i section 2.3). */
export function useGeneric(state: BulkState, id: string): BulkState {
  return mapRow(state, id, (r) => {
    return { ...without(r, "speciesId", "label"), generic: true, confirmed: true };
  });
}

export function removeRow(state: BulkState, id: string): BulkState {
  return { ...state, rows: state.rows.filter((r) => r.id !== id) };
}

// --- Step 3: placement -------------------------------------------------------------------------

const GROUND_TAGS = ["ground", "garden_bed", "garden"];

/** Where an entry usually lives: in the ground only when it is garden-only, otherwise indoors. */
export function typicalPlacement(r: BulkSpecies | undefined): Placement {
  if (r === undefined || r.tags.includes("indoor") || r.tags.includes("outdoor_pot"))
    return "indoor";
  return r.tags.some((t) => GROUND_TAGS.includes(t)) ? "ground" : "indoor";
}

/** The placement a row will be saved with: the user's chip, else the default for its species. */
export function placementOf(row: BulkRow, species: readonly BulkSpecies[]): Placement {
  return row.placement ?? typicalPlacement(species.find((s) => s.id === row.speciesId));
}

export function setRowPlacement(state: BulkState, id: string, placement: Placement): BulkState {
  return mapRow(state, id, (r) => ({ ...r, placement }));
}

export function setRowRoom(state: BulkState, id: string, roomId: string | undefined): BulkState {
  return mapRow(state, id, (r) => {
    const rest = without(r, "roomId");
    return roomId === undefined ? rest : { ...rest, roomId };
  });
}

/** Copies placement and room from the row above. The first row has nothing above it. */
export function sameAsAbove(
  state: BulkState,
  id: string,
  species: readonly BulkSpecies[],
): BulkState {
  const i = state.rows.findIndex((r) => r.id === id);
  const above = state.rows[i - 1];
  if (i < 1 || above === undefined) return state;
  return setRowRoom(setRowPlacement(state, id, placementOf(above, species)), id, above.roomId);
}

// --- Navigation and step 4 ---------------------------------------------------------------------

/** Match to place, place to verify. Entering verify ticks the resolved rows and leaves the others unticked. */
export function advance(state: BulkState): BulkState {
  if (state.step === "match") return { ...state, step: "place" };
  if (state.step !== "place") return state;
  return {
    ...state,
    step: "verify",
    rows: state.rows.map((r) => (r.included === undefined ? { ...r, included: resolved(r) } : r)),
  };
}

export function goBack(state: BulkState): BulkState {
  const before: Record<Step, Step> = {
    type: "type",
    match: "type",
    place: "match",
    verify: "place",
  };
  return { ...state, step: before[state.step] };
}

/** Ticks or unticks a row; a row without a match cannot be ticked. */
export function toggleRow(state: BulkState, id: string): BulkState {
  return mapRow(state, id, (r) => ({ ...r, included: resolved(r) && r.included !== true }));
}

export function setWatered(state: BulkState, watered: Watered): BulkState {
  return { ...state, watered };
}

// --- Save --------------------------------------------------------------------------------------

export interface SaveResult {
  readonly data: AppData;
  readonly saved: number;
  readonly notAdded: number;
}

const POT_FIELDS: readonly SourcedField[] = ["drainage", "potDiameterCm", "potMaterial"];

type Sources = { -readonly [F in SourcedField]?: FieldSource };

/** The plants a row would become (one per counted plant), with every assumed value marked in `fieldSources`. */
export function plantsForRow(
  row: BulkRow,
  state: BulkState,
  data: AppData,
  today: string,
  species: readonly BulkSpecies[],
): Omit<Plant, "id" | "spaceId">[] {
  const sp = species.find((s) => s.id === row.speciesId);
  const placement = placementOf(row, species);
  const roomLight = data.rooms.find((r) => r.id === row.roomId)?.light;
  const care = sp === undefined ? undefined : careFill(sp);
  const fromCatalogue = care?.style !== undefined && care.intervalDays !== undefined;
  // Every field of the defaults table (B2) starts as an assumed "default"; what the user said or the
  // catalogue knows overrides it. A plant in the ground has no pot, drainage or material to assume.
  const sources: Sources = {};
  for (const r of DEFAULTS_TABLE) {
    const field = SOURCED_FIELDS.find((f) => f === r.field);
    if (field === undefined) continue;
    if (placement === "ground" && POT_FIELDS.includes(field)) continue;
    sources[field] = "default";
  }
  Object.assign(sources, {
    species: sp === undefined ? "default" : row.confirmed ? "user" : "catalogue",
    style: fromCatalogue ? "catalogue" : "default",
    intervalDays: fromCatalogue ? "catalogue" : "default",
    placement: row.placement === undefined ? "default" : "user",
    lastWatered: state.watered === "today" ? "user" : "default",
    light: roomLight === undefined ? "default" : "user",
    name: sp === undefined ? "user" : "catalogue",
  } satisfies Sources);
  const base = row.label ?? sp?.name ?? row.input;
  return Array.from({ length: row.count }, (_, i) => {
    const plant: { -readonly [K in keyof Plant]?: Plant[K] } = {
      name: i === 0 ? base : `${base} ${String(i + 1)}`,
      style: fromCatalogue ? care.style : "let_top_dry",
      intervalDays: fromCatalogue ? care.intervalDays : GENERIC_INTERVAL_DAYS,
      logs: [],
      placement,
      fieldSources: { ...sources },
    };
    if (sp !== undefined) plant.species = sp.scientificName;
    else plant.unmatched = true;
    if (care !== undefined) {
      plant.source = care.source;
      if (care.restFactor !== undefined) plant.restFactor = care.restFactor;
      if (care.dryTolDays !== undefined) plant.dryTolDays = care.dryTolDays;
      if (care.wetTolDays !== undefined) plant.wetTolDays = care.wetTolDays;
      if (care.outdoor !== undefined) Object.assign(plant, care.outdoor);
    } else plant.source = "generic profile: no catalogue match";
    if (row.roomId !== undefined) plant.roomId = row.roomId;
    if (state.watered === "today") plant.lastWatered = today;
    plant.addedOn = today;
    if (placement !== "ground") plant.potDiameterCm = DEFAULT_POT_CM;
    return plant as Omit<Plant, "id" | "spaceId">;
  });
}

/**
 * Creates the ticked plants with every unconfirmed value marked in `fieldSources`, and keeps the unticked
 * rows as drafts ("Not added yet"). Drops the typed-text draft. No XP and no cap on how many (D-15).
 */
export function saveBulk(
  data: AppData,
  state: BulkState,
  today: string,
  species: readonly BulkSpecies[],
): SaveResult {
  let next = clearBulkDraft(data);
  let saved = 0;
  let notAdded = 0;
  const spaceId = activeSpaceId(next);
  for (const row of state.rows) {
    if (row.included === true && resolved(row)) {
      const group = plantsForRow(row, state, next, today, species);
      // Plants from one counted line ("3x aloe vera") share their answers.
      const batchId = group.length > 1 ? nextBatchId(next) : undefined;
      for (const p of group) {
        const id = nextId(
          next.plants.map((x) => x.id),
          "p",
        );
        const batch = batchId === undefined ? {} : { batch: { id: batchId } };
        next = { ...next, plants: [...next.plants, { ...p, ...batch, id, spaceId }] };
        saved += 1;
      }
    } else {
      const sci = species.find((s) => s.id === row.speciesId)?.scientificName;
      next = saveDraft(
        next,
        {
          notAdded: "1",
          plantName: row.label ?? row.input,
          ...(sci === undefined ? {} : { species: sci }),
        },
        today,
      );
      notAdded += 1;
    }
  }
  return { data: next, saved, notAdded };
}

// --- The typed text as a draft -----------------------------------------------------------------

const BULK_DRAFT_ID = "bulk";

/** The draft that keeps the typed text across a reload; not a plant, so never scheduled. */
export function isBulkDraft(d: Pick<PlantDraft, "fields">): boolean {
  return d.fields["bulkText"] !== undefined;
}

/** Keeps the text as the one bulk draft; blank text removes it. */
export function saveBulkDraft(data: AppData, text: string, today: string): AppData {
  return text.trim() === ""
    ? clearBulkDraft(data)
    : saveDraft(data, { bulkText: text }, today, BULK_DRAFT_ID);
}

export function bulkDraftText(data: AppData): string | undefined {
  return (data.drafts ?? []).find(isBulkDraft)?.fields["bulkText"];
}

export function clearBulkDraft(data: AppData): AppData {
  const d = (data.drafts ?? []).find(isBulkDraft);
  return d === undefined ? data : deleteDraft(data, d.id);
}
