// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bulk add flow lives in `@green-garden/bulk`. This module binds web-ui's bundled catalogue as
 * the default species list, so the web UI (and the Stories app until switches it) reads as before.
 */
import {
  placementOf as placementOfWith,
  sameAsAbove as sameAsAboveWith,
  saveBulk as saveBulkWith,
  type BulkRow,
  type BulkSpecies,
  type BulkState,
  type SaveResult,
} from "@green-garden/bulk";
import { homeQuestionNeeded } from "@green-garden/bulk";
import type { AppData, Plant } from "@green-garden/storage";
import { SPECIES } from "./pilot-data.ts";

export {
  type BulkCandidate,
  type BulkMatch,
  type BulkRow,
  type BulkState,
  DEFAULT_POT_CM,
  GENERIC_INTERVAL_DAYS,
  type Groups,
  MAX_PER_LINE,
  type Matcher,
  type SaveResult,
  type Step,
  type TypedPlant,
  type Watered,
  advance,
  bulkDraftText,
  clearBulkDraft,
  goBack,
  groupRows,
  isBulkDraft,
  makeMatcher,
  parseTyped,
  pickCandidate,
  plantsForRow,
  removeRow,
  retype,
  runMatch,
  saveBulkDraft,
  setRowPlacement,
  setRowRoom,
  setText,
  setWatered,
  startBulk,
  toggleRow,
  typedCount,
  typicalPlacement,
  useGeneric,
} from "@green-garden/bulk";

export function placementOf(
  row: BulkRow,
  species: readonly BulkSpecies[] = SPECIES,
): NonNullable<Plant["placement"]> {
  return placementOfWith(row, species);
}

export function sameAsAbove(
  state: BulkState,
  id: string,
  species: readonly BulkSpecies[] = SPECIES,
): BulkState {
  return sameAsAboveWith(state, id, species);
}

export function saveBulk(
  data: AppData,
  state: BulkState,
  today: string,
  species: readonly BulkSpecies[] = SPECIES,
): SaveResult {
  return saveBulkWith(data, state, today, species);
}

/**
 * Q-K0 before a bulk save: a plant that lives outdoors waits for the garden question while no climate is
 * set. `dismissed` is where the dialog goes when the question is dismissed: back to placement, with the
 * list and every choice kept (nothing is saved without a climate).
 */
export function gardenGate(
  data: AppData,
  state: BulkState,
  today: string,
): { needed: boolean; dismissed: (s: BulkState) => BulkState } {
  const res = saveBulk(data, state, today);
  return {
    needed: homeQuestionNeeded(data, res.data),
    dismissed: (s) => ({ ...s, step: "place" }),
  };
}
