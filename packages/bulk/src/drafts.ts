// SPDX-License-Identifier: AGPL-3.0-only

/** Pure helpers for the add-plant modal: drafts ("Save for later"), validation, form values to a plant. */
import type { AppData, Plant, PlantDraft } from "@green-garden/storage";
import { activeSpaceId } from "@green-garden/storage";
import type { Translate } from "@green-garden/i18n";
import { nextId } from "./ids.ts";

const DRAINAGE_VALUES = ["hole", "cachepot", "no_hole", "self_watering"] as const;

type Fields = Readonly<Record<string, string>>;

/**
 * The direct-sun hours field: "" unknown, "none" no sun, else "7-11,15-18". Whole hours, sorted,
 * not overlapping, at most 3 ranges; anything else is undefined (left unset).
 */
export function parseSunRanges(
  text: string,
): readonly { readonly from: number; readonly to: number }[] | undefined {
  const s = text.trim();
  if (s === "none") return [];
  if (s === "") return undefined;
  const out: { from: number; to: number }[] = [];
  for (const part of s.split(",")) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(part.trim());
    if (m === null) return undefined;
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from >= to || to > 24) return undefined;
    const prev = out[out.length - 1];
    if (prev !== undefined && from < prev.to) return undefined;
    out.push({ from, to });
  }
  return out.length > 3 ? undefined : out;
}

/** Saves the form as a draft; with `id` it replaces that draft. Never touches plants, so it is never scheduled. */
export function saveDraft(
  data: AppData,
  fields: Fields,
  savedOn: string,
  id?: string,
  plantId?: string,
): AppData {
  const old = data.drafts ?? [];
  const draftId =
    id ??
    nextId(
      old.map((d) => d.id),
      "d",
    );
  const draft: PlantDraft = {
    id: draftId,
    spaceId: activeSpaceId(data),
    savedOn,
    fields,
    ...(plantId === undefined ? {} : { plantId }),
  };
  const drafts = old.some((d) => d.id === draftId)
    ? old.map((d) => (d.id === draftId ? draft : d))
    : [...old, draft];
  return { ...data, drafts };
}

/** Removes a draft; the `drafts` key goes away with the last one. */
export function deleteDraft(data: AppData, id: string): AppData {
  const rest = (data.drafts ?? []).filter((d) => d.id !== id);
  const others = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "drafts"));
  return (rest.length === 0 ? others : { ...others, drafts: rest }) as unknown as AppData;
}

export function draftFields(data: AppData, id: string): Fields {
  return (data.drafts ?? []).find((d) => d.id === id)?.fields ?? {};
}

/** True when the form differs from how it was opened (whitespace and empty-versus-missing do not count). */
export function hasUnsavedChanges(initial: Fields, current: Fields): boolean {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const k of keys) if ((initial[k] ?? "").trim() !== (current[k] ?? "").trim()) return true;
  return false;
}

const STYLES = ["keep_moist", "let_top_dry", "let_fully_dry"];

export type FieldIssue = "error.name" | "error.style" | "error.interval";

/** What stops the modal from saving a plant, as message keys. Empty when it can be saved. */
export function plantFieldIssues(f: Fields): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if ((f["plantName"] ?? "").trim() === "") issues.push("error.name");
  if (!STYLES.includes(f["style"] ?? "")) issues.push("error.style");
  const interval = Number(f["intervalDays"]);
  if ((f["intervalDays"] ?? "").trim() === "" || !Number.isFinite(interval) || interval < 1)
    issues.push("error.interval");
  return issues;
}

/** The same, worded with `tr` (web-ui passes its `t`, the app its own). */
export function validatePlantFields(f: Fields, tr: Translate): string[] {
  return plantFieldIssues(f).map((k) => tr(k));
}

function fieldNum(f: Fields, k: string): number | undefined {
  const v = (f[k] ?? "").trim();
  return v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
}

/** A plant from the modal's field values. Fields the form does not edit are kept from `old`. */
export function plantFromFields(f: Fields, old: Plant | undefined): Omit<Plant, "id" | "spaceId"> {
  const style = (f["style"] ?? "").trim();
  const base: { -readonly [K in keyof Plant]: Plant[K] } = {
    id: old?.id ?? "",
    spaceId: old?.spaceId ?? "",
    name: (f["plantName"] ?? "").trim() || "Unnamed",
    style: style === "keep_moist" || style === "let_fully_dry" ? style : "let_top_dry",
    intervalDays: Math.max(1, Math.round(fieldNum(f, "intervalDays") ?? 7)),
    logs: old?.logs ?? [],
  };
  for (const k of ["species", "roomId", "lastWatered", "source"] as const) {
    const v = (f[k] ?? "").trim();
    if (v !== "") base[k] = v;
  }
  for (const k of [
    "potDiameterCm",
    "potHeightCm",
    "restFactor",
    "dryTolDays",
    "wetTolDays",
  ] as const) {
    const v = fieldNum(f, k);
    if (v !== undefined) base[k] = v;
  }
  // Indoors is the default and stays unset; only the outdoor chips are saved.
  if (f["placement"] === "outdoor_pot" || f["placement"] === "ground")
    base.placement = f["placement"];
  // Kept when the form does not carry them (placementHistory is only ever written by a move).
  for (const k of ["placementHistory", "sheltered", "directSun"] as const) {
    const v = old?.[k];
    if (v !== undefined) Object.assign(base, { [k]: v });
  }
  if (old?.fieldSources !== undefined) base.fieldSources = old.fieldSources;
  const sources: { [k: string]: "user" } = {};
  // Under cover and sun hours come from the outdoor rows; an empty value means unknown again.
  if (f["sheltered"] !== undefined) {
    delete base.sheltered;
    if (f["sheltered"] === "1" || f["sheltered"] === "0") {
      base.sheltered = f["sheltered"] === "1";
      sources["sheltered"] = "user";
    }
  }
  if (f["directSun"] !== undefined) {
    delete base.directSun;
    const ranges = parseSunRanges(f["directSun"]);
    if (ranges !== undefined) {
      base.directSun = ranges;
      sources["directSun"] = "user";
    }
  }
  if (Object.keys(sources).length > 0) base.fieldSources = { ...base.fieldSources, ...sources };
  const addedOn = (f["addedOn"] ?? "").trim();
  if (addedOn !== "") {
    base.addedOn = addedOn;
    // An estimated date the user left alone stays an estimate; typing a new one makes it real.
    if (old?.addedOnEstimated === true && old.addedOn === addedOn) base.addedOnEstimated = true;
  }
  const drainage = DRAINAGE_VALUES.find((d) => d === f["drainage"]);
  if (drainage !== undefined && drainage !== "hole") base.drainage = drainage;
  for (const k of [
    "anchor",
    "adjustmentDays",
    "doneStreak",
    "notBefore",
    "lastRepotted",
    "growthClass",
  ] as const) {
    const v = old?.[k];
    if (v !== undefined) Object.assign(base, { [k]: v });
  }
  return Object.fromEntries(
    Object.entries(base).filter(([k]) => k !== "id" && k !== "spaceId"),
  ) as Omit<Plant, "id" | "spaceId">;
}
